import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSequence, sequenceReferences } from "../src/production/video-sequence.js";
import { sequenceDuration, compositionTimeline } from "../src/production/sequence-composition.js";
import { createStyledAss } from "../src/tools/sequence-compositor.js";
import { parseSilenceDetection } from "../src/tools/ffmpeg-sequence-renderer.js";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
const exec = promisify(execFile);
const ref = { kind: "resource", id: "resource-test" };
const raw = () => ({ version: "1.1", changeReason: "Composition test", format: { width: 320, height: 180, fps: 25 },
  captionStyle: { fontSize: 18 }, segments: [{ id: "a", title: "A", intent: "Demonstrate timing", durationSeconds: 2, visual: { source: ref } }] });
test("composition contracts preserve ranges, reject overflow and track all sources", () => {
  const s = raw();
  s.segments[0].narration = { text: "Lời đọc", source: ref, offsetSeconds: 1, durationSeconds: 1 };
  s.segments[0].overlays = [{ id: "logo", source: { kind: "result", id: "result-logo", file: "primary" }, startSeconds: 0, endSeconds: 1, x: 0, y: 0, width: 0.2, height: 0.2 }];
  s.music = [{ id: "bed", source: { kind: "result", id: "result-music" } }];
  const normalized = normalizeSequence(s);
  assert.deepEqual(normalizeSequence(normalized), normalized);
  assert.equal(sequenceReferences(normalized).length, 3);
  assert.equal(compositionTimeline(normalized).find((r) => r.track === "Lời đọc").startSeconds, 1);
  s.segments[0].narration.offsetSeconds = 1.5;
  assert.throws(() => normalizeSequence(s), /duration/);
  delete s.segments[0].narration;
  s.segments[0].overlays[0].x = 0.9;
  assert.throws(() => normalizeSequence(s), /overlay x/);
  s.segments[0].overlays[0].x = 0;
  s.segments[0].transition = { type: "crossfade", durationSeconds: 0.2 };
  assert.throws(() => normalizeSequence(s), /Last segment/);
});
test("styled captions escape commands, wrap Vietnamese and reject overflow", () => {
  const s = raw();
  s.segments[0].captions = [{ text: "Tiếng Việt {\\pos(0,0)}", startSeconds: 0, endSeconds: 1, animation: { enter: "slideLeft" } }];
  const n = normalizeSequence(s);
  const ass = createStyledAss(n.segments[0].captions, n.format);
  assert.match(ass, /Tiếng Việt/);
  assert.match(ass, /｛＼pos/);
  assert.match(ass, /\\move/);
  n.segments[0].captions[0].text = "x".repeat(200);
  assert.throws(() => createStyledAss(n.segments[0].captions, n.format), /too wide/);
});
test("silence detection reports closed and trailing intervals", () => {
  const parsed = parseSilenceDetection([
    "[silencedetect] silence_start: -0.02",
    "[silencedetect] silence_end: 0.3 | silence_duration: 0.32",
    "[silencedetect] silence_start: 1.25",
    "[silencedetect] silence_end: 1.75 | silence_duration: 0.5",
    "[silencedetect] silence_start: 3.924687",
  ].join("\n"), 8);
  assert.deepEqual(parsed.silenceIntervals, [
    { startSeconds: 0, endSeconds: 0.3, durationSeconds: 0.3 },
    { startSeconds: 1.25, endSeconds: 1.75, durationSeconds: 0.5 },
    { startSeconds: 3.925, endSeconds: 8, durationSeconds: 4.075 },
  ]);
  assert.equal(parsed.maxSilenceSeconds, 4.075);
  assert.equal(parsed.tailSilenceSeconds, 4.075);
});
async function sampleRgb(path, seconds, x, y) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", path, "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer" });
  return [...stdout];
}
async function rms(path, start, duration) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-ss", String(start), "-i", path, "-t", String(duration), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 4e6 });
  let sum = 0;
  for (let i = 0; i < stdout.length; i += 4) sum += stdout.readFloatLE(i) ** 2;
  return Math.sqrt(sum / (stdout.length / 4));
}
test("real composition renders timed audio, overlays, styled text, transitions, music and reuses unchanged segments", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "padstudio-composition-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rootDir = join(dir, "projects ' quoted"), store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Composition" });
  async function media(name, args) {
    const path = join(dir, name);
    await exec("ffmpeg", ["-v", "error", ...args, "-y", path]);
    const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath: path });
    return { kind: "resource", id: imported.resourceId };
  }
  const blue = await media("blue.mp4", ["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=3", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest"]);
  const red = await media("red.png", ["-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1"]);
  const voice = await media("voice.wav", ["-f", "lavfi", "-i", "sine=frequency=880:duration=0.8"]);
  const bed = await media("music.wav", ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"]);
  const s = raw(); s.segments[0].visual = { source: blue, volume: 0, volumeRanges: [{ startSeconds: 1.4, endSeconds: 2, volume: 0.5 }] };
  s.segments[0].narration = { text: "Giọng thử", source: voice, offsetSeconds: 0.4, durationSeconds: 0.8, fadeInSeconds: 0.05, fadeOutSeconds: 0.05 };
  s.segments[0].overlays = [{ id: "logo", source: red, startSeconds: 0.5, endSeconds: 1.3, x: 0, y: 0, width: 0.25, height: 0.25, animation: { enter: "fade", exit: "fade", durationSeconds: 0.1 } }];
  s.segments[0].captions = [{ text: "Một ý rõ ràng", startSeconds: 0.4, endSeconds: 1.4, style: { position: "bottom", fontSize: 18 }, animation: { enter: "slideUp", exit: "fade", durationSeconds: 0.1 } }];
  s.segments[0].transition = { type: "crossfade", durationSeconds: 0.4 };
  s.segments.push({ id: "b", title: "B", intent: "Concept card", durationSeconds: 1.6, visual: { source: red, motion: "zoomIn" } });
  s.music = [{ id: "bed", source: bed, loop: true, volume: 0.2, ducking: true, fadeInSeconds: 0.1, fadeOutSeconds: 0.2 }];
  const save = (data, expectedRevision) => store.recordArtifact("demo", { key: "film", type: "video.sequence", name: "Film", summary: "Test", status: "active", data, ...(expectedRevision ? { expectedRevision } : {}) });
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const render = (artifactId, reuseResultId) => executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Composition acceptance", inputs: { artifactId, ...(reuseResultId ? { reuseResultId } : {}) } });
  const first = await save(s), r1 = (await render(first.id)).result;
  assert.ok(Math.abs(r1.data.durationSeconds - 3.2) < 0.1);
  assert.equal(sequenceDuration(first.data), 3.2);
  const segment = await store.resolveResultFile("demo", r1.id, "segment-0");
  assert.ok(await rms(segment.filePath, 0.05, 0.2) < 0.001, "source is muted before delayed narration");
  assert.ok(await rms(segment.filePath, 0.6, 0.2) > 0.02, "delayed narration audible");
  assert.ok(await rms(segment.filePath, 1.6, 0.2) > 0.01, "source volume automation resumes");
  const before = await sampleRgb(segment.filePath, 0.2, 20, 20), during = await sampleRgb(segment.filePath, 0.8, 20, 20), after = await sampleRgb(segment.filePath, 1.5, 20, 20);
  assert.ok(before[2] > before[0] + 100 && during[0] > during[2] + 100 && after[2] > after[0] + 100, "overlay appears only in declared interval");
  const final = await store.resolveResultFile("demo", r1.id, "primary");
  const transition = await sampleRgb(final.filePath, 1.8, 250, 20);
  assert.ok(transition[0] > 40 && transition[2] > 40, "crossfade mixes adjacent images");
  assert.ok(await rms(final.filePath, 2.4, 0.3) > 0.005, "looped music survives across segments");
  s.music[0].volume = 0.1; s.changeReason = "Change music only";
  const second = await save(s, first.revision), r2 = (await render(second.id, r1.id)).result;
  assert.ok(r2.data.segments.every((x) => x.reusedFrom?.resultId === r1.id));
  s.segments[1].visual.motion = "panRight"; s.changeReason = "Change one visual";
  s.audio = { loudnessTargetLufs: -18 };
  s.segments[0].transition = { type: "fadeBlack", durationSeconds: 0.4 };
  const third = await save(s, second.revision), r3 = (await render(third.id, r2.id)).result;
  assert.equal(r3.data.segments[1].reusedFrom, null);
  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.ok(context.production.sequences.at(-1).timeline.some((r) => r.track === "Nhạc bed"));
  assert.ok(r3.inputResources.includes(bed.id) && r3.inputResources.includes(red.id));
  // Exercise mixed joins, multiple music keys and a sliding overlay, not only two clips.
  const mixed = structuredClone(s);
  delete mixed.audio;
  mixed.segments[0].transition = { type: "cut" };
  mixed.segments[0].overlays[0].animation = { enter: "slideLeft", durationSeconds: 0.2 };
  mixed.segments[1].transition = { type: "crossfade", durationSeconds: 0.4 };
  mixed.segments.push({ id: "c", title: "C", intent: "Mixed joins", durationSeconds: 1.2, visual: { source: red, motion: "zoomOut" }, transition: { type: "fadeBlack", durationSeconds: 0.2 } });
  mixed.segments.push({ id: "d", title: "D", intent: "Final frame", durationSeconds: 1, visual: { source: red, motion: "panLeft", fit: "crop" } });
  mixed.music.push({ id: "second-bed", source: bed, loop: true, volume: 0.05, ducking: true, startSeconds: 0.3 });
  const mixedArtifact = await store.recordArtifact("demo", { key: "mixed", type: "video.sequence", name: "Mixed joins", summary: "Test several transitions and music tracks", status: "draft", data: mixed });
  const mixedResult = (await render(mixedArtifact.id)).result;
  assert.equal(mixedResult.data.sequenceRole, "candidate");
  assert.equal(mixedResult.data.historical, false);
  assert.ok(Math.abs(mixedResult.data.durationSeconds - 5.2) < 0.1);
  const mixedSegment = await store.resolveResultFile("demo", mixedResult.id, "segment-0");
  const slideStart = await sampleRgb(mixedSegment.filePath, 0.52, 60, 20);
  const slideEnd = await sampleRgb(mixedSegment.filePath, 0.9, 60, 20);
  assert.ok(slideStart[2] > slideStart[0] && slideEnd[0] > slideEnd[2], "overlay slides into its destination");
  const finish = store.finishRun.bind(store);
  store.finishRun = async (...args) => { if (args[2].status === "completed") throw new Error("Injected completion failure"); return finish(...args); };
  const pending = await render(third.id, r3.id);
  assert.equal(pending.status, "finalization_pending");
  store.finishRun = finish;
  const recovered = await store.recoverRunFinalization("demo", pending.runId);
  assert.equal(recovered.status, "completed");
  assert.ok((await store.readResult("demo", pending.resultId)).files.every((f) => f.available));
  s.segments[0].narration.durationSeconds = 1.5; s.changeReason = "Invalid source range";
  const bad = await save(s, third.revision);
  const count = (await store.readResults("demo")).length;
  await assert.rejects(render(bad.id), /Narration/);
  assert.equal((await store.readResults("demo")).length, count);
  const overlayFile = await store.resolveMediaSource("demo", red);
  await rm(overlayFile.filePath);
  const missing = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.ok(missing.production.sequences.find((x) => x.artifactId === bad.id).segments[0].blockers.includes("missing_overlay_media"));
});
