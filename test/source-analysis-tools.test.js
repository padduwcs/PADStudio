import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createDefaultAnalysisService } from "../src/analysis/default-analysis-service.js";
import { sha256File } from "../src/analysis/source-identity.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { assertSelfContainedMediaPath, probeSource, runProcess, selectStream } from "../src/tools/source-analysis-common.js";
import { sampledCoverageIntervals } from "../src/tools/ffmpeg-source-frames.js";
import { createPyscenedetectScenes } from "../src/tools/pyscenedetect-scenes.js";

const execFileAsync = promisify(execFile);

// Several end-to-end tests run the full probe -> scenes -> frames plan. They need the locked Python
// analysis runtime (.runtime-tools, git-ignored). On a machine without it they are reported as
// skipped with the reason instead of failing; set PADSTUDIO_REQUIRE_ANALYSIS_RUNTIME=1 to make a
// missing runtime a failure (for the owner machine or a prepared CI image).
const sceneRuntime = await createPyscenedetectScenes().checkAvailability().catch((error) => ({
  status: "unavailable", reason: error.message
}));
const requireSceneRuntime = process.env.PADSTUDIO_REQUIRE_ANALYSIS_RUNTIME === "1";
const sceneRuntimeSkip = sceneRuntime.status === "available" || requireSceneRuntime
  ? false
  : `analysis runtime unavailable: ${sceneRuntime.reason ?? "scene detection is not installed"}`;

test("sampled frame coverage clamps negative container PTS to the requested media range", () => {
  assert.deepEqual(sampledCoverageIntervals([
    { actualTime: -0.021333 }, { actualTime: 1.5 }, { actualTime: 2 }
  ], { startSeconds: 0, endSeconds: 2 }), [
    { startSeconds: 0, endSeconds: 0.001 },
    { startSeconds: 1.5, endSeconds: 1.501 }
  ]);
});

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-source-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, rootDir: join(directory, "projects") };
}

async function makeVideo(path) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=320x180:r=25:d=2",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,setsar=4/3[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", path
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

async function makeLongGopVideo(path) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=10",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=10",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-g", "600", "-keyint_min", "600", "-sc_threshold", "0", path
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

async function decodedFrameMd5(path) {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", path,
    "-map", "0:v:0", "-frames:v", "1", "-f", "framemd5", "-"
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const row = stdout.trim().split(/\r?\n/).findLast((line) => !line.startsWith("#"));
  return row?.split(",").at(-1)?.trim() ?? null;
}

async function makeImage(path) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=green:s=240x160", "-frames:v", "1", path
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

async function makeAnimatedImage(path) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=1",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,fps=10[v]",
    "-map", "[v]", path
  ]);
}

async function makeAudio(path) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:a", "pcm_s16le", path
  ]);
}

function request(source, operations, extra = {}) {
  return {
    version: "1.0",
    sources: [source],
    operations,
    profiles: {
      probe: "source-probe-v1",
      visual: "source-standard-v1",
      audio: "audio-standard-v1",
      preview: "source-preview-v1"
    },
    reuse: "never",
    ...extra
  };
}

test("production profiles keep the package-A practical default and pinned model bytes", async () => {
  const productionProfiles = JSON.parse(await readFile("runtime/analysis/profiles.json", "utf8"));
  const evaluationProfiles = JSON.parse(await readFile("eval/source-understanding/profiles.json", "utf8"));
  assert.equal(productionProfiles.practicalDefault, evaluationProfiles.practicalDefault);
  assert.equal(productionProfiles.releaseDefault, null);
  const { language: _evaluationLanguage, ...evaluationAsr } =
    evaluationProfiles.profiles[evaluationProfiles.practicalDefault];
  assert.deepEqual(
    productionProfiles.profiles[productionProfiles.practicalDefault],
    { ...evaluationAsr, vadMinimumSilenceMs: 500, temperature: 0 }
  );
  assert.deepEqual(productionProfiles.profiles["source-standard-v1"], {
    ...evaluationProfiles.scenes,
    frameBudget: 24,
    longShotSeconds: 30,
    contactSheetColumns: 4,
    contactSheetRows: 3,
    contactCellWidth: 320,
    contactCellHeight: 180
  });
  const productionModels = JSON.parse(await readFile("runtime/analysis/models.lock.json", "utf8"));
  const evaluationModels = JSON.parse(await readFile("eval/source-understanding/models.lock.json", "utf8"));
  for (const model of Object.keys(productionModels.models)) {
    assert.equal(productionModels.models[model].revision, evaluationModels.models[model].revision);
    assert.deepEqual(productionModels.models[model].files, evaluationModels.models[model].files);
  }
});

test("analysis process abort stops a real child promptly", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: controller.signal,
    timeoutMs: 30_000
  });
  setTimeout(() => controller.abort(), 100).unref();
  await assert.rejects(pending, (error) => error.code === "analysis_cancelled");
  assert.ok(Date.now() - started < 5_000);
});

test("stream selection is deterministic and requires an explicit ambiguous track", () => {
  const probe = {
    streams: [
      { index: 1, codec_type: "audio", disposition: { default: 0 } },
      { index: 2, codec_type: "audio", disposition: { default: 0 } }
    ]
  };
  assert.throws(() => selectStream(probe, "audio"), (error) => error.code === "track_selection_required");
  assert.equal(selectStream(probe, "audio", 2).stream.index, 2);
  probe.streams[0].disposition.default = 1;
  assert.equal(selectStream(probe, "audio").stream.index, 1);
  assert.throws(
    () => selectStream(probe, "audio", null, { allowDefault: false }),
    (error) => error.code === "track_selection_required"
  );
});

test("analysis rejects local playlists before FFmpeg can follow referenced files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-source-playlist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const disguised = join(directory, "disguised.mp4");
  await writeFile(disguised, "#EXTM3U\n#EXTINF:10,external\n../../outside.mp4\n", "utf8");
  await assert.rejects(
    assertSelfContainedMediaPath(disguised),
    (error) => error.code === "referenced_media_unsupported"
  );
});

test("package-C adapters run through lifecycle and preserve a real video source", { skip: sceneRuntimeSkip }, async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "source.mp4");
  await makeVideo(sourcePath);
  const before = await sha256File(sourcePath);
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath });
  const source = { kind: "resource", id: imported.resourceId, itemPath: null };
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("demo", request(
    source,
    ["frames", "audio", "preview"],
    {
      ranges: {
        scenes: { startSeconds: 0, endSeconds: 4 },
        frames: { startSeconds: 0, endSeconds: 4 },
        audio: { startSeconds: 0, endSeconds: 4 },
        preview: { startSeconds: 0, endSeconds: 4 }
      },
      options: {
        scenes: { adaptiveThreshold: 3.5 },
        frames: { budget: 4, contactSheet: true }
      }
    }
  ));
  assert.equal(response.state, "completed", JSON.stringify(response.job.units, null, 2));
  assert.deepEqual(response.job.units.map((unit) => unit.operation), ["probe", "scenes", "frames", "audio", "preview"]);
  assert.ok(response.job.units.every((unit) => unit.state === "succeeded"));

  const store = new ProjectStore(rootDir);
  const results = await store.readResults("demo");
  assert.deepEqual(new Set(results.map((result) => result.type)), new Set([
    "source.metadata", "source.scenes", "source.frames", "source.audio-analysis", "source.preview"
  ]));
  for (const result of results) {
    assert.equal(result.verification.status, "passed");
    assert.equal(result.data.contentReview, "not_performed");
    assert.ok(result.files.every((file) => file.available && /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.match(result.data.method.availability.profileDigest, /^[a-f0-9]{64}$/);
  }
  const scenes = results.find((result) => result.type === "source.scenes");
  const metadata = results.find((result) => result.type === "source.metadata");
  assert.equal(metadata.data.coverage.mode, "sampled");
  assert.deepEqual(metadata.data.coverage.intervals, [
    { startSeconds: 0, endSeconds: 1 },
    { startSeconds: 2, endSeconds: 3 },
    { startSeconds: 3, endSeconds: 4 }
  ]);
  const videoTrack = metadata.data.details.streams.find((stream) => stream.type === "video");
  assert.equal(videoTrack.encodedWidth, 320);
  assert.equal(videoTrack.displayedWidth, 427);
  assert.equal(videoTrack.sampleAspectRatio, "4:3");
  assert.ok(scenes.data.counts.scenes >= 2);
  const sceneDataset = await store.resolveResultFile("demo", scenes.id, "scenes");
  const sceneRows = (await readFile(sceneDataset.filePath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(Number.isFinite(sceneRows[1].score));
  const frames = results.find((result) => result.type === "source.frames");
  assert.ok(frames.data.counts.frames <= 4);
  assert.ok(frames.files.some((file) => file.id === "contact-001"));
  const contact = await store.resolveResultFile("demo", frames.id, "contact-001");
  const contactProbe = await probeSource(contact.filePath);
  const contactVideo = contactProbe.streams.find((stream) => stream.codec_type === "video");
  assert.deepEqual([contactVideo.width, contactVideo.height], [1292, 620]);
  const frameDataset = await store.resolveResultFile("demo", frames.id, "frames");
  const frameRows = (await readFile(frameDataset.filePath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(frameRows.every((row) => Number.isFinite(row.actualTime) && Number.isSafeInteger(row.pts) && Math.abs(row.actualTime - row.requestedTime) <= 0.05));
  assert.ok(frameRows.every((row) => row.actualTime >= 0 && row.actualTime < 4));
  const audio = results.find((result) => result.type === "source.audio-analysis");
  assert.ok(audio.data.counts.levelWindows > 0);
  assert.equal(audio.data.warnings[0].code, "silence_is_level_threshold");
  const preview = results.find((result) => result.type === "source.preview");
  assert.equal(preview.files[0].mediaType, "video/mp4");
  assert.equal(preview.data.details.output.sampleAspectRatio, "1:1");
  assert.equal(await sha256File(sourcePath), before);
});

test("frame extraction decodes through a long GOP and binds output pixels to recorded PTS", { skip: sceneRuntimeSkip }, async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "long-gop.mp4");
  const referencePath = join(directory, "reference.png");
  await makeLongGopVideo(sourcePath);
  const before = await sha256File(sourcePath);
  const { stdout: keyframes } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
    "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
    "-of", "csv=p=0", sourcePath
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(keyframes.trim().split(/\r?\n/).filter(Boolean).length, 1, "fixture must contain one distant keyframe");

  const imported = await importProjectInput({ rootDir, projectId: "long-gop-demo", sourcePath });
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("long-gop-demo", request(
    { kind: "resource", id: imported.resourceId, itemPath: null },
    ["frames"],
    {
      ranges: {
        scenes: { startSeconds: 0, endSeconds: 20 },
        frames: { startSeconds: 0, endSeconds: 20 }
      },
      options: { frames: { timestamps: [15, 19.999], budget: 2, contactSheet: false } }
    }
  ));
  assert.equal(response.state, "completed", JSON.stringify(response.job.units, null, 2));
  const frameUnit = response.job.units.find((unit) => unit.operation === "frames");
  const store = new ProjectStore(rootDir);
  const result = await store.readResult("long-gop-demo", frameUnit.resultId);
  const dataset = await store.resolveResultFile("long-gop-demo", result.id, "frames");
  const rows = (await readFile(dataset.filePath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.requestedTime), [15, 19.999]);
  assert.ok(Math.abs(rows[0].actualTime - 15) <= 1 / 30);
  assert.ok(Math.abs(rows[1].actualTime - 19.999) <= 1 / 30 + 0.001);
  assert.ok(result.verification.checks.includes("output_pts_matches_metadata"));
  for (const [index, row] of rows.entries()) {
    const rowReferencePath = index === 0 ? referencePath : join(directory, `reference-${index}.png`);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", sourcePath,
      "-map", "0:v:0", "-vf", `select='eq(pts\\,${row.pts})',scale=w='max(2,trunc(iw*sar*min(1,1920/(iw*sar))/2)*2)':h='max(2,trunc(ih*min(1,1920/(iw*sar))/2)*2)',setsar=1`,
      "-frames:v", "1", rowReferencePath
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const extracted = await store.resolveResultFile("long-gop-demo", result.id, row.fileId);
    assert.equal(await decodedFrameMd5(extracted.filePath), await decodedFrameMd5(rowReferencePath));
  }
  assert.equal(await sha256File(sourcePath), before);
});

test("frame budget records every omitted shot range in a checksum-bound dataset", { skip: sceneRuntimeSkip }, async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "budget.mp4");
  await makeVideo(sourcePath);
  const imported = await importProjectInput({ rootDir, projectId: "budget-demo", sourcePath });
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("budget-demo", request(
    { kind: "resource", id: imported.resourceId, itemPath: null },
    ["frames"],
    {
      ranges: {
        scenes: { startSeconds: 0, endSeconds: 4 },
        frames: { startSeconds: 0, endSeconds: 4 }
      },
      options: { frames: { budget: 1, contactSheet: false } }
    }
  ));
  assert.equal(response.state, "completed");
  const frameUnit = response.job.units.find((unit) => unit.operation === "frames");
  const store = new ProjectStore(rootDir);
  const result = await store.readResult("budget-demo", frameUnit.resultId);
  assert.equal(result.data.counts.frames, 1);
  assert.equal(result.data.counts.omittedShots, 1);
  assert.deepEqual(result.data.details.omittedShotIds, ["shot-00002"]);
  assert.deepEqual(result.data.details.unsampledRanges, [{ startSeconds: 2, endSeconds: 4 }]);
  assert.equal(result.data.details.omissionsTruncated, false);
  assert.ok(result.verification.checks.includes("omitted_ranges_recorded"));
  const dataset = await store.resolveResultFile("budget-demo", result.id, "omissions");
  assert.deepEqual(JSON.parse((await readFile(dataset.filePath, "utf8")).trim()), {
    shotId: "shot-00002",
    startSeconds: 2,
    endSeconds: 4
  });
});

test("image evidence succeeds while scene/audio units are explicitly not applicable", { skip: sceneRuntimeSkip }, async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "source.png");
  await makeImage(sourcePath);
  const imported = await importProjectInput({ rootDir, projectId: "image-demo", sourcePath });
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("image-demo", request(
    { kind: "resource", id: imported.resourceId, itemPath: null },
    ["frames", "audio", "preview"],
    { options: { frames: { budget: 1, contactSheet: true } } }
  ));
  assert.equal(response.state, "completed");
  const states = Object.fromEntries(response.job.units.map((unit) => [unit.operation, unit.state]));
  assert.deepEqual(states, { probe: "succeeded", scenes: "not_applicable", frames: "succeeded", audio: "not_applicable", preview: "succeeded" });
  const results = await new ProjectStore(rootDir).readResults("image-demo");
  assert.equal(results.find((result) => result.type === "source.frames").data.coverage.mode, "full_image");
  assert.equal(results.find((result) => result.type === "source.preview").files[0].mediaType, "image/png");
});

test("animated images are sampled over time and previewed as video", { skip: sceneRuntimeSkip }, async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "animated.gif");
  await makeAnimatedImage(sourcePath);
  const imported = await importProjectInput({ rootDir, projectId: "animation-demo", sourcePath });
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("animation-demo", request(
    { kind: "resource", id: imported.resourceId, itemPath: null },
    ["frames", "preview"],
    {
      ranges: {
        frames: { startSeconds: 0, endSeconds: 2 },
        preview: { startSeconds: 0, endSeconds: 2 }
      },
      options: { frames: { budget: 3, contactSheet: false } }
    }
  ));
  assert.equal(response.state, "completed", JSON.stringify(response.job.units, null, 2));
  const store = new ProjectStore(rootDir);
  const results = await store.readResults("animation-demo");
  const metadata = results.find((result) => result.type === "source.metadata");
  const frames = results.find((result) => result.type === "source.frames");
  const preview = results.find((result) => result.type === "source.preview");
  assert.equal(metadata.data.details.animated, true);
  assert.equal(frames.data.coverage.mode, "sampled");
  assert.ok(new Set(frames.files.filter((file) => file.role === "evidence").map((file) => file.sha256)).size > 1);
  assert.equal(preview.files[0].mediaType, "video/mp4");
  assert.equal(preview.data.details.animatedImage, true);
  assert.equal(preview.data.details.output.codec, "h264");
});

test("audio-only sources produce measurements and a browser-safe AAC preview", async (t) => {
  const { directory, rootDir } = await workspace(t);
  const sourcePath = join(directory, "tone.wav");
  await makeAudio(sourcePath);
  const imported = await importProjectInput({ rootDir, projectId: "audio-demo", sourcePath });
  const response = await createDefaultAnalysisService({ rootDir }).createAndRun("audio-demo", request(
    { kind: "resource", id: imported.resourceId, itemPath: null },
    ["audio", "preview"],
    {
      ranges: {
        audio: { startSeconds: 0, endSeconds: 2 },
        preview: { startSeconds: 0, endSeconds: 2 }
      }
    }
  ));
  assert.equal(response.state, "completed", JSON.stringify(response.job.units, null, 2));
  const results = await new ProjectStore(rootDir).readResults("audio-demo");
  const audio = results.find((result) => result.type === "source.audio-analysis");
  const preview = results.find((result) => result.type === "source.preview");
  assert.ok(audio.data.counts.levelWindows > 0);
  assert.equal(preview.files[0].mediaType, "audio/mp4");
  assert.equal(preview.data.details.output.codec, "aac");
});
