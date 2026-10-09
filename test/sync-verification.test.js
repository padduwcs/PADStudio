import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { normalizeVisualChoreography } from "../src/animation/visual-choreography.js";
import {
  analyzeNarrationSync, motionThreshold, parseMotionSeries
} from "../src/animation/sync-analysis.js";
import { normalizeSourceReference } from "../src/analysis/contracts.js";
import { resolveAnalysisSource } from "../src/analysis/source-identity.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createLocalSyncVerifier } from "../src/tools/local-sync-verifier.js";

const exec = promisify(execFile);

function choreographyFixture() {
  return {
    version: "1.3",
    changeReason: "Plan the explanation before authoring motion.",
    purpose: "Show how two source cells accumulate into one prefix result.",
    durationSeconds: 4,
    fps: 24,
    objects: [
      { id: "matrix-a", label: "Input matrix A", role: "subject", continuity: "persistent", initialState: "All cells neutral." },
      { id: "cell-total", label: "Prefix result cell", role: "evidence", continuity: "persistent", initialState: "Empty." }
    ],
    beats: [
      {
        id: "select-cells", kind: "semantic", startSeconds: 0, endSeconds: 2,
        message: "Select the cells that contribute to this prefix.", narrationText: "First, select these cells.",
        visualPurpose: "Make membership visible before arithmetic.", primaryObjectId: "matrix-a", focusObjectIds: ["matrix-a"],
        stateBefore: "All cells are neutral.", stateAfter: "Contributing cells are highlighted.",
        actions: [{ id: "select", startSeconds: 0, endSeconds: 1, verb: "select", meaning: "semantic", effect: "state-change",
          subjectIds: ["matrix-a"], targetIds: [], description: "Highlight contributing cells in reading order.",
          resultingState: "Contributing cells are highlighted." }],
        holdAfterSeconds: 0.5, continuityFromBeatId: null, reviewCriteria: ["Every highlighted cell belongs to the prefix region."],
        visualQuestion: "Which cells participate?", audienceInsight: "The viewer can identify the selected region without reading narration text.",
        relationToPrevious: "establish", continuityCue: "Introduce the concrete matrix that supplies the evidence.",
        compositionIntent: "Use the matrix as a large operational field.",
        visualProof: "The selected cells change state in place and remain visibly grouped.",
        textElements: [{ id: "cell-values", text: "2  4  3", role: "value", purpose: "The values are evidence used by the visible accumulation." }]
      },
      {
        id: "accumulate", kind: "semantic", startSeconds: 2, endSeconds: 4,
        message: "Accumulate the selected values into the result.", narrationText: "Then add them into S.",
        visualPurpose: "Expose causality between the region and the numeric result.", primaryObjectId: "cell-total",
        focusObjectIds: ["matrix-a", "cell-total"], stateBefore: "The region is selected and the result is empty.",
        stateAfter: "The result cell contains the computed total.",
        actions: [{ id: "sum", startSeconds: 2, endSeconds: 3.5, verb: "accumulate", meaning: "semantic", effect: "state-change",
          subjectIds: ["matrix-a"], targetIds: ["cell-total"], description: "Move the selected values into an addition expression and resolve it.",
          resultingState: "The result cell contains the computed total." }],
        holdAfterSeconds: 0.5, continuityFromBeatId: "select-cells", reviewCriteria: ["The displayed total equals the selected values."],
        visualQuestion: "How does that evidence become the stored result?", audienceInsight: "The viewer sees the selected values combine into the answer.",
        relationToPrevious: "reframe", continuityCue: "Carry the selected values into the arithmetic close-up.",
        compositionIntent: "Reframe around the calculation.",
        visualProof: "The same colored values move into an expression and resolve into the stored result.",
        textElements: [{ id: "sum-formula", text: "2 + 4 + 3 = 9", role: "formula", purpose: "The formula makes the exact arithmetic inspectable." }]
      }
    ],
    reviewCriteria: ["Motion and narration describe the same operation."],
    direction: {
      visualThesis: "The viewer follows evidence becoming a conclusion.",
      continuityIntent: "Carry the selected values conceptually.",
      variationIntent: "Move from the matrix operation to a close-up when the question changes.",
      motionLanguage: ["Direct manipulation before labels"],
      antiPatterns: ["Do not repeat one card layout"],
      sampleIntent: "Preview the first selection first."
    },
    presentation: {
      narrationMode: "voice-led", communicationMode: "visual-first",
      stageIntent: "Let the active evidence determine framing.", textIntent: "Only values and short labels."
    },
    narrationCueMap: {
      sourceDescription: "Imported voice alignment with two timed statements.",
      cues: [
        { id: "spoken-select", startSeconds: 0, endSeconds: 1.5, beatId: "select-cells", actionId: "select", visualPurpose: "Select cells when selection is spoken." },
        { id: "spoken-sum", startSeconds: 2, endSeconds: 3.75, beatId: "accumulate", actionId: "sum", visualPurpose: "Resolve values as the sum is spoken." }
      ]
    }
  };
}

// A 24 fps solid-colour video; every colour change is a hard cut that registers as motion.
async function makeVideo(path, parts) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const [color, seconds] of parts) args.push("-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=24:d=${seconds}`);
  const inputs = parts.map((_, index) => `[${index}:v]`).join("");
  args.push("-filter_complex", `${inputs}concat=n=${parts.length}:v=1:a=0,format=yuv420p[v]`, "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24", path);
  await exec("ffmpeg", args, { windowsHide: true });
}

async function fixture(t, parts) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-sync-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "demo", title: "Sync" });
  const choreography = await store.recordArtifact("demo", {
    key: "plan", type: "animation.choreography", name: "Plan", summary: "Cue-mapped plan", status: "active", data: choreographyFixture()
  });

  const tool = { name: "fake-render", version: "1", provider: "test" };
  const run = await store.startRun("demo", { capability: "animation.render", purpose: "fixture render", tool });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  await makeVideo(join(output.temporaryDirectory, "animation.mp4"), parts);
  const size = (await readFile(join(output.temporaryDirectory, "animation.mp4"))).length;
  await store.commitRunOutputWorkspace(output);
  const render = await store.addResult("demo", {
    runId: run.id, type: "animation.render", name: "Render", capability: "animation.render", inputResources: [], tool,
    files: [{ id: "primary", role: "primary", path: `${output.projectRelativeDirectory}/animation.mp4`, name: "animation.mp4", mediaType: "video", sizeBytes: size }],
    data: { choreographyArtifactId: choreography.id, composition: null, durationSeconds: 4, video: { frameRate: 24 } },
    verification: { status: "passed", checks: [] }
  });
  await store.finishRun("demo", run.id, { status: "completed", outputs: [render.id] });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([createLocalSyncVerifier()]) });
  const verify = async (inputs) => executor.execute("demo", {
    capability: "animation.verify-sync", tool: "local-sync-verifier", purpose: "verify cue sync", inputs: { resultId: render.id, ...inputs }
  });
  return { workspace, store, choreography, render, verify };
}

async function readReport(store, response) {
  const file = await store.verifyResultFile("demo", response.resultId, "primary");
  return JSON.parse(await readFile(file.filePath, "utf8"));
}

test("motion output from FFmpeg is parsed into a per-frame series with a noise-relative threshold", () => {
  const series = parseMotionSeries([
    "frame:0    pts:0       pts_time:0", "lavfi.signalstats.YDIF=0",
    "frame:1    pts:1024    pts_time:0.1", "lavfi.signalstats.YDIF=0.01",
    "frame:2    pts:2048    pts_time:0.2", "lavfi.signalstats.YDIF=109.52",
    "frame:3    pts:3072    pts_time:0.3", "lavfi.signalstats.YDIF=0.02"
  ].join("\n"));
  assert.deepEqual(series.map((point) => [point.frame, point.seconds, point.value]), [[0, 0, 0], [1, 0.1, 0.01], [2, 0.2, 109.52], [3, 0.3, 0.02]]);
  assert.deepEqual(parseMotionSeries("nothing useful"), []);
  const { noiseFloor, threshold } = motionThreshold(series);
  assert.equal(noiseFloor, 0.02);
  assert.equal(threshold, 0.08);
  assert.equal(motionThreshold([{ seconds: 0, value: 0 }, { seconds: 1, value: 0 }]).threshold, 0.03, "a floor applies to perfectly still video");
});

function stillSeries(spikes, { fps = 24, seconds = 4 } = {}) {
  return Array.from({ length: Math.round(seconds * fps) }, (_, frame) => {
    const time = frame / fps;
    return { frame, seconds: time, value: spikes.some((spike) => Math.abs(spike - time) < 0.5 / fps) ? 50 : 0 };
  });
}

test("each action cue is classified by when the first pixel change happens", () => {
  const choreography = normalizeVisualChoreography(choreographyFixture());
  const report = (spikes, extra = {}) => analyzeNarrationSync({
    choreography, series: stillSeries(spikes), durationSeconds: 4, ...extra
  });

  const aligned = report([0.25, 2]);
  assert.deepEqual(aligned.cues.map((cue) => cue.visual.status), ["aligned", "aligned"]);
  assert.equal(aligned.cues[0].visual.offsetSeconds, 0.25);
  assert.equal(aligned.summary.aligned, 2);

  const late = report([0.25, 2.75]);
  assert.equal(late.cues[1].visual.status, "late");
  assert.equal(late.cues[1].visual.offsetSeconds, 0.75);

  const missing = report([0.25]);
  assert.equal(missing.cues[1].visual.status, "no_visible_change");
  assert.equal(missing.summary.noVisibleChange, 1);

  const tight = report([0.25, 2.25], { toleranceSeconds: 0.1 });
  assert.equal(tight.cues[1].visual.status, "late", "a smaller tolerance reclassifies the same video");
  assert.equal(tight.toleranceSeconds, 0.1);
  assert.equal(report([0.25, 2.25], { toleranceSeconds: 0.01 }).toleranceSeconds, 0.083, "tolerance never goes below two frames");
});

test("motion that was already running cannot be credited to the action", () => {
  const choreography = normalizeVisualChoreography(choreographyFixture());
  const series = Array.from({ length: 96 }, (_, frame) => ({ frame, seconds: frame / 24, value: frame > 0 ? 5 : 0 }));
  const report = analyzeNarrationSync({ choreography, series, durationSeconds: 4 });
  // A constantly moving video has a high noise floor, so nothing stands out; both cues stay honest about it.
  assert.ok(report.motion.threshold > 5);
  assert.deepEqual(report.cues.map((cue) => cue.visual.status), ["no_visible_change", "no_visible_change"]);

  const burst = Array.from({ length: 96 }, (_, frame) => ({ frame, seconds: frame / 24, value: frame >= 30 && frame <= 60 ? 40 : 0 }));
  const ambiguous = analyzeNarrationSync({ choreography, series: burst, durationSeconds: 4 });
  assert.equal(ambiguous.cues[1].visual.status, "ambiguous_ongoing_motion");
  assert.equal(ambiguous.cues[1].visual.offsetSeconds, null);
});

test("a deliberate hold is checked for stillness instead of motion", () => {
  const value = choreographyFixture();
  delete value.narrationCueMap.cues[1].actionId;
  value.narrationCueMap.cues[1].holdReason = "The completed result stays visible while it is explained.";
  const choreography = normalizeVisualChoreography(value);
  const still = analyzeNarrationSync({ choreography, series: stillSeries([0.25]), durationSeconds: 4 });
  assert.equal(still.cues[1].kind, "hold");
  assert.equal(still.cues[1].visual.status, "held");
  const busy = analyzeNarrationSync({ choreography, series: stillSeries(Array.from({ length: 17 }, (_, index) => 2 + index * 0.1)), durationSeconds: 4 });
  assert.equal(busy.cues[1].visual.status, "moving_during_hold");
  assert.equal(busy.summary.holdCues, 1);
});

test("transcript words show whether the voice arrives on cue", () => {
  const choreography = normalizeVisualChoreography(choreographyFixture());
  const words = [
    { text: "first", startSeconds: 0.1, endSeconds: 0.5 },
    { text: "then", startSeconds: 2.9, endSeconds: 3.2 }
  ];
  const report = analyzeNarrationSync({ choreography, series: stillSeries([0.25, 2]), words, durationSeconds: 4 });
  assert.equal(report.transcriptSupplied, true);
  assert.deepEqual(report.cues.map((cue) => cue.speech.status), ["on_cue", "late_voice"]);
  assert.equal(report.cues[1].speech.offsetSeconds, 0.9);
  assert.equal(report.summary.speechOnCue, 1);
  assert.equal(report.summary.speechOffCue, 1);
  const silent = analyzeNarrationSync({ choreography, series: stillSeries([0.25, 2]), words: [], durationSeconds: 4 });
  assert.deepEqual(silent.cues.map((cue) => cue.speech.status), ["absent", "absent"]);
  const unmeasured = analyzeNarrationSync({ choreography, series: stillSeries([0.25, 2]), durationSeconds: 4 });
  assert.equal(unmeasured.cues[0].speech.status, "not_measured");
});

test("the tool measures a real render and stores an exact, reusable report", async (t) => {
  const { store, choreography, render, verify } = await fixture(t, [["black", 0.25], ["blue", 1.75], ["red", 2]]);
  const response = await verify({});
  assert.equal(response.status, "completed");
  const result = await store.readResult("demo", response.resultId);
  assert.equal(result.type, "animation.sync-report");
  assert.deepEqual(result.inputResults, [render.id]);
  assert.deepEqual(result.inputArtifacts, [choreography.id]);
  assert.equal(result.data.sourceResultId, render.id);
  assert.equal(result.verification.details.creativeReview, "not_performed");
  assert.equal((await store.verifyResultFile("demo", result.id, "motion")).integrity, "verified");

  const report = await readReport(store, response);
  assert.deepEqual(report.cues.map((cue) => [cue.id, cue.visual.status, cue.visual.onsetSeconds]),
    [["spoken-select", "aligned", 0.25], ["spoken-sum", "aligned", 2]]);
  assert.equal(report.cues[0].speech.status, "not_measured");
  assert.equal(result.data.summary.aligned, 2);
});

test("a late change in the video is reported as late with the measured offset", async (t) => {
  const { store, verify } = await fixture(t, [["black", 0.25], ["blue", 2.5], ["red", 1.25]]);
  const report = await readReport(store, await verify({}));
  assert.equal(report.cues[1].visual.status, "late");
  assert.equal(report.cues[1].visual.offsetSeconds, 0.75);
});

test("a render that never changes where the cue map expects it is reported, not hidden", async (t) => {
  const { store, verify } = await fixture(t, [["black", 0.25], ["blue", 3.75]]);
  const report = await readReport(store, await verify({}));
  assert.equal(report.cues[1].visual.status, "no_visible_change");
  assert.equal(report.summary.noVisibleChange, 1);
});

test("a transcript bound to the exact render adds speech timing, and a foreign transcript is refused", async (t) => {
  const { store, render, verify } = await fixture(t, [["black", 0.25], ["blue", 1.75], ["red", 2]]);
  const tool = { name: "fixture-transcript", version: "1", provider: "test" };
  const source = normalizeSourceReference({ kind: "result", id: render.id, file: "primary" });
  const identity = await resolveAnalysisSource({ store, projectId: "demo", source });

  async function transcript(words, { sourceVersion = identity.sourceVersion, sourceId = render.id } = {}) {
    const run = await store.startRun("demo", { capability: "audio.transcribe", purpose: "transcript fixture", tool });
    const workspace = await store.createRunOutputWorkspace("demo", run.id);
    const contents = JSON.stringify({ id: "segment-1", startSeconds: 0, endSeconds: 4, text: "x", language: "vi", words, diagnostics: {} }) + "\n";
    await writeFile(join(workspace.temporaryDirectory, "transcript.jsonl"), contents, "utf8");
    await store.commitRunOutputWorkspace(workspace);
    const result = await store.addResult("demo", {
      runId: run.id, type: "source.transcript", name: "Transcript", capability: "audio.transcribe", inputResources: [], inputResults: [render.id],
      files: [{ id: "segments", role: "dataset", path: `${workspace.projectRelativeDirectory}/transcript.jsonl`, name: "transcript.jsonl", mediaType: "application/x-ndjson", sizeBytes: Buffer.byteLength(contents) }],
      tool,
      data: {
        schemaVersion: "1.0", source: { ...source, id: sourceId }, sourceKey: identity.sourceKey, sourceVersion,
        operation: "transcript", analysisJobId: null, unitId: null, fingerprint: "a".repeat(64),
        coverage: { startSeconds: 0, endSeconds: 4, mode: "continuous" }, method: { profileId: "fixture" }, outcome: "produced",
        counts: { segments: 1 }, datasets: [{ kind: "transcript", fileId: "segments" }], warnings: [], contentReview: "not_performed"
      },
      verification: { status: "passed", checks: ["fixture"] }, runCompletion: { durationMs: 1, actualCostUsd: 0 }
    });
    await store.finishRun("demo", run.id, { status: "completed", outputs: [result.id], durationMs: 1, actualCostUsd: 0 });
    store.releaseRunOutputWorkspace(workspace);
    return result;
  }

  const good = await transcript([
    { text: "first", startSeconds: 0.2, endSeconds: 0.6, score: 0.9 },
    { text: "then", startSeconds: 2.1, endSeconds: 2.5, score: 0.9 }
  ]);
  const response = await verify({ transcriptResultId: good.id });
  const report = await readReport(store, response);
  assert.equal(report.transcriptSupplied, true);
  assert.deepEqual(report.cues.map((cue) => cue.speech.status), ["on_cue", "on_cue"]);
  const stored = await store.readResult("demo", response.resultId);
  assert.deepEqual(stored.inputResults, [render.id, good.id]);
  assert.ok(stored.verification.checks.includes("transcript_bound_to_render_bytes"));

  const foreign = await transcript([{ text: "x", startSeconds: 0, endSeconds: 1, score: 1 }], { sourceVersion: "b".repeat(64) });
  await assert.rejects(verify({ transcriptResultId: foreign.id }), { code: "transcript_not_for_render" });
});

test("the tool refuses inputs it cannot verify instead of guessing", async (t) => {
  const { store, render, verify } = await fixture(t, [["black", 0.25], ["blue", 3.75]]);
  await assert.rejects(verify({ unexpected: true }), { code: "invalid_input" });
  await assert.rejects(verify({ toleranceSeconds: 5 }), { code: "invalid_input" });
  await assert.rejects(verify({ transcriptResultId: render.id }), { code: "invalid_transcript" });

  // Without a cue map there is nothing to verify.
  const plain = choreographyFixture();
  delete plain.narrationCueMap;
  const withoutMap = await store.recordArtifact("demo", {
    key: "plain-plan", type: "animation.choreography", name: "Plain", summary: "No cue map", status: "active", data: plain
  });
  const tool = { name: "fake-render", version: "1", provider: "test" };
  const run = await store.startRun("demo", { capability: "animation.render", purpose: "no map", tool });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  await makeVideo(join(output.temporaryDirectory, "animation.mp4"), [["black", 4]]);
  const size = (await readFile(join(output.temporaryDirectory, "animation.mp4"))).length;
  await store.commitRunOutputWorkspace(output);
  const plainRender = await store.addResult("demo", {
    runId: run.id, type: "animation.render", name: "Render without map", capability: "animation.render", inputResources: [], tool,
    files: [{ id: "primary", role: "primary", path: `${output.projectRelativeDirectory}/animation.mp4`, name: "animation.mp4", mediaType: "video", sizeBytes: size }],
    data: { choreographyArtifactId: withoutMap.id, composition: null, durationSeconds: 4, video: { frameRate: 24 } },
    verification: { status: "passed", checks: [] }
  });
  await store.finishRun("demo", run.id, { status: "completed", outputs: [plainRender.id] });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([createLocalSyncVerifier()]) });
  await assert.rejects(
    executor.execute("demo", { capability: "animation.verify-sync", tool: "local-sync-verifier", purpose: "no map", inputs: { resultId: plainRender.id } }),
    { code: "no_cue_map" }
  );
});
