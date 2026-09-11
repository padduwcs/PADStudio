import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ProjectStore } from "../src/project/project-store.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { createBrowserGraphicRenderer } from "../src/tools/browser-graphic-renderer.js";
import { createFfmpegAudioPreparer } from "../src/tools/ffmpeg-audio-preparer.js";
import { normalizeGraphic, graphicHtml } from "../src/tools/graphic-layout.js";
import { command, hashFile } from "../src/tools/asset-tool-common.js";
import { publicMediaUrl, isPublicIPv4, publicAddress, downloadPublicMedia } from "../src/tools/public-media-download.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { createPadStudioServer } from "../src/web/server.js";
import { ProjectReader } from "../src/web/project-reader.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-assets-'unicode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootDir = join(directory, "projects");
  const store = new ProjectStore(rootDir);
  return { directory, rootDir, store };
}
const ref = (id) => ({ kind: "result", id, file: "primary" });
const graphic = (inputs) => ({ capability: "graphic.render", tool: "browser-graphic", purpose: "Prepare a reusable visual", inputs });
const audio = (inputs) => ({ capability: "audio.prepare", tool: "ffmpeg-audio-prepare", purpose: "Prepare reusable narration", inputs });
const acquire = (inputs) => ({ capability: "media.acquire", tool: "https-media", purpose: "Acquire selected material", inputs });
const acquisition = { url: "https://media.example.test/source.png", mediaType: "image", name: "Selected illustration",
  attribution: { creator: "Fixture author", license: "Test fixture only", sourcePage: "https://media.example.test/page" } };

test("graphic contracts support varied content without raw paths or silent field loss", () => {
  for (const inputs of [
    { kind: "card", title: "Giới thiệu", body: "Nội dung rõ ràng", width: 720, height: 1280 },
    { kind: "bar-chart", title: "Business", items: [{ label: "Loss", value: -10 }, { label: "Gain", value: 20 }] },
    { kind: "steps", title: "Process", steps: ["Collect", "Explain"] }
  ]) assert.equal(normalizeGraphic(inputs).spec.kind, inputs.kind);
  for (const inputs of [
    { kind: "card", title: "X", body: "Y", outputPath: "C:/escape.png" },
    { kind: "card", title: "X", body: "Y", width: 321 },
    { kind: "bar-chart", title: "X", items: [{ label: "Y", value: Infinity }] },
    { kind: "bar-chart", title: "X", items: [{ label: "Y", value: 1 }, { label: "Y", value: 2 }] },
    { kind: "steps", title: "X", steps: ["Only one"] },
    { kind: "card", title: "X", body: "Y", items: [] },
    { kind: "card", title: "X", body: "Y", accent: "red;url(http://bad)" }
  ]) assert.throws(() => normalizeGraphic(inputs));
  const hostile = '</script><img src="https://unwanted.test/">';
  assert.ok(!graphicHtml(normalizeGraphic({ kind: "card", title: "Literal", body: hostile }).spec).includes(hostile));
});

test("public downloads reject private addresses, credentials and unsafe redirects", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.2.4", "192.168.0.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "2001:db8::1", "198.18.0.1", "192.0.2.4"]) assert.equal(isPublicIPv4(address), false);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
  for (const url of ["http://example.com/a", "https://user:pass@example.com/a", "file:///tmp/a", "https://example.com:444/a"]) assert.throws(() => publicMediaUrl(url));
  await assert.rejects(publicAddress("example.com", async () => [{ address: "8.8.8.8" }, { address: "127.0.0.1" }]), /public/);
});

test("download validates each hop, stream size, content type and cancellation", async (t) => {
  const { directory } = await fixture(t);
  const resolve = async () => [{ address: "8.8.8.8" }];
  const response = (chunks, headers = {}, statusCode = 200) => Object.assign(Readable.from(chunks), { headers, statusCode });
  let seenAddress;
  const good = await downloadPublicMedia("https://example.test/a", join(directory, "ok"), {
    mediaType: "image", resolve, open: async (_url, address) => { seenAddress = address; return response([Buffer.from("png")], { "content-type": "image/png", "content-length": "3" }); }
  });
  assert.equal(seenAddress, "8.8.8.8"); assert.equal(good.sizeBytes, 3);
  for (const [name, headers, chunks] of [
    ["huge", { "content-type": "image/png" }, [Buffer.alloc(9)]],
    ["html", { "content-type": "text/html" }, [Buffer.from("bad")]],
    ["short", { "content-type": "image/png", "content-length": "4" }, [Buffer.from("a")]]
  ]) await assert.rejects(downloadPublicMedia("https://example.test/a", join(directory, name), {
    mediaType: "image", maxBytes: 8, resolve, open: async () => response(chunks, headers)
  }));
  let calls = 0;
  await assert.rejects(downloadPublicMedia("https://example.test/a", join(directory, "redirect"), {
    mediaType: "image", resolve, open: async () => { calls++; return response([], { location: "https://127.0.0.1/a" }, 302); }
  }), /public/);
  assert.equal(calls, 1);
  await assert.rejects(downloadPublicMedia("https://example.test/a", join(directory, "cancel"), {
    mediaType: "image", resolve, signal: AbortSignal.abort(), open: async () => { throw new Error("Must not request"); }
  }), { name: "AbortError" });
});

test("audio preparation extracts actual ranges, verifies source, chains results and recovers finalization", async (t) => {
  const availability = await createFfmpegAudioPreparer().checkAvailability();
  if (availability.status !== "available") return t.skip(availability.reason);
  const { directory, rootDir, store } = await fixture(t);
  const path = join(directory, "lời đọc.mp4");
  await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=4",
    "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=4", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-y", path]);
  const sourceHash = await hashFile(path);
  const imported = await importProjectInput({ rootDir, projectId: "education", sourcePath: path });
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const source = { kind: "resource", id: imported.resourceId };
  const first = await executor.execute("education", audio({ source, startSeconds: 1, endSeconds: 3, fadeInSeconds: 0.2, fadeOutSeconds: 0.3, loudnessTargetLufs: -18 }));
  assert.equal(first.result.type, "audio.prepared"); assert.ok(Math.abs(first.result.data.durationSeconds - 2) < 0.01);
  assert.equal(first.result.verification.details.loudnessTwoPass, true);
  assert.equal(first.result.data.sourceSha256, sourceHash);
  const selected = await executor.execute("education", audio({ source: ref(first.resultId), startSeconds: 0.3, endSeconds: 1.3, gainDb: -3 }));
  assert.deepEqual(selected.result.inputResults, [first.resultId]);
  assert.equal(await hashFile(path), sourceHash);
  const runsBefore = (await store.readRuns("education")).length, resultsBefore = (await store.readResults("education")).length;
  for (const inputs of [
    { source, endSeconds: 20 }, { source, audioStream: 8 }, { source, startSeconds: 3, endSeconds: 2 },
    { source, endSeconds: 1, fadeInSeconds: 2 }, { source: { ...source, path: "escape" } }
  ]) await assert.rejects(executor.execute("education", audio(inputs)));
  assert.equal((await store.readResults("education")).length, resultsBefore);
  assert.equal((await store.readRuns("education")).length, runsBefore + 5);
  const finish = store.finishRun.bind(store);
  let failOnce = true;
  store.finishRun = async (...args) => { if (failOnce && args[2].status === "completed") { failOnce = false; throw new Error("Simulated finalization interruption"); } return finish(...args); };
  const pending = await executor.execute("education", audio({ source, endSeconds: 1 }));
  assert.equal(pending.status, "finalization_pending");
  await store.recoverRunFinalization("education", pending.runId);
  const reopened = new ProjectStore(rootDir);
  assert.equal((await reopened.readRun("education", pending.runId)).status, "completed");
  assert.equal((await reopened.readResult("education", pending.resultId)).files[0].available, true);

  const reader = new ProjectReader(rootDir), server = createPadStudioServer({ reader });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const media = await fetch(url + "/project-results/education/" + first.resultId + "/primary", { headers: { Range: "bytes=0-15" } });
  assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 16);
});

test("graphics work across three projects and orientations, then become sequence media", async (t) => {
  const availability = await createBrowserGraphicRenderer().checkAvailability();
  if (availability.status !== "available") return t.skip(availability.reason);
  const { rootDir, store } = await fixture(t);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const cases = [
    ["education", { kind: "steps", title: "Giải bài toán", steps: ["Hiểu yêu cầu", "Chọn cách làm", "Kiểm tra kết quả"], width: 720, height: 1280 }],
    ["marketing", { kind: "card", title: "Không gian làm việc", body: 'Yên tĩnh. Đủ ánh sáng.\nĐặt chỗ hôm nay — 100% rõ ràng.', width: 1280, height: 720, theme: "light" }],
    ["business", { kind: "bar-chart", title: "Thay đổi theo quý", items: [{ label: "Q1", value: -10 }, { label: "Q2", value: 0 }, { label: "Q3", value: 24.5 }], width: 720, height: 1280, footer: "Dữ liệu minh họa" }]
  ];
  for (const [projectId, inputs] of cases) {
    await store.createProject({ projectId, title: projectId });
    const first = await executor.execute(projectId, graphic(inputs));
    assert.equal(first.result.files[0].mediaType, "image");
    assert.ok(first.result.verification.details.layout.blocks.some((block) => block.text === inputs.title));
    const next = await executor.execute(projectId, graphic({ ...inputs, width: inputs.height, height: inputs.width, title: inputs.title + " — bản 2" }));
    assert.notEqual(first.result.files[0].sha256, next.result.files[0].sha256);
    await store.recordDecision(projectId, { resultId: first.resultId, outcome: "accepted" });
    assert.equal((await store.readDecisions(projectId)).filter((item) => item.resultId === next.resultId).length, 0);
    const film = await store.recordArtifact(projectId, { key: "sample", type: "video.sequence", name: "Sample", summary: "Reusable graphic",
      data: { version: "1.0", changeReason: "Prepare the selected graphic for video", format: { width: 320, height: 180, fps: 25 },
        segments: [{ id: "opening", title: "Opening", intent: "Explain clearly", durationSeconds: 1, visual: { source: ref(first.resultId), startSeconds: 0 }, narration: null, captions: [], references: [] }] } });
    const video = await executor.execute(projectId, { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Use graphic in sequence", inputs: { artifactId: film.id } });
    assert.ok(video.result.inputResults.includes(first.resultId));
    assert.equal((await new ProjectStore(rootDir).readResult(projectId, first.resultId)).files[0].available, true);
  }
  const before = (await store.readResults("marketing")).length;
  await assert.rejects(executor.execute("marketing", graphic({ kind: "card", title: "Too much", body: "Difficult content ".repeat(100), width: 320, height: 320 })), /fit|layout/i);
  await assert.rejects(executor.execute("marketing", graphic({ kind: "card", title: "Missing", body: "Basis", artifactIds: ["artifact-does-not-exist"] })), /unknown artifact/);
  assert.equal((await store.readResults("marketing")).length, before);
  const outputNames = await readdir(join(rootDir, "marketing", "outputs"));
  assert.equal(outputNames.filter((name) => name.startsWith(".")).length, 0);
});

test("acquired media preserves attribution and bytes, rejects tampering and corrupt media", async (t) => {
  const { directory, rootDir, store } = await fixture(t);
  const png = join(directory, "source.png");
  await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", "-y", png]);
  const expected = await hashFile(png);
  let corrupt = false, calls = 0;
  const registry = createDefaultToolRegistry({ mediaAcquire: { download: async (url, output) => {
    calls++;
    if (corrupt) await writeFile(output, "not media"); else await copyFile(png, output);
    return { finalUrl: url, redirects: [], contentType: "image/png" };
  } } });
  const executor = new ToolExecutor({ store, registry });
  await store.createProject({ projectId: "sourced", title: "Sourced footage" });
  const first = await executor.execute("sourced", acquire({ ...acquisition, expectedSha256: expected }));
  assert.equal(first.result.files[0].sha256, expected);
  assert.deepEqual(first.result.data.acquisition.attribution, acquisition.attribution);
  const clip = await executor.execute("sourced", { capability: "image.to-video", tool: "ffmpeg-image-to-video", purpose: "Use acquired asset", inputs: { source: ref(first.resultId), durationSeconds: 1 } });
  assert.deepEqual(clip.result.inputResults, [first.resultId]);
  await assert.rejects(executor.execute("sourced", acquire({ ...acquisition, expectedSha256: "0".repeat(64) })), /checksum/);
  corrupt = true;
  await assert.rejects(executor.execute("sourced", acquire(acquisition)));
  const before = calls;
  await assert.rejects(executor.execute("sourced", acquire({ ...acquisition, outputPath: "outside.png" })));
  await assert.rejects(executor.execute("sourced", acquire({ ...acquisition, expectedSha256: 42 })));
  assert.equal(calls, before);
  assert.equal((await new ProjectStore(rootDir).readResults("sourced")).length, 2);
});
