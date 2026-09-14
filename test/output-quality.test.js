import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalOutputQuality, parseVisualDefects, sourceCutBoundaryCheck } from "../src/tools/local-output-quality.js";
import { sequenceInspectionPoints } from "../src/quality/output-quality-service.js";

test("visual defect parser keeps exact black and freeze windows", () => {
  const parsed = parseVisualDefects("black_start:1.2 black_end:3.7 black_duration:2.5\nfreeze_start: 4\nfreeze_duration: 5.5\nfreeze_end: 9.5");
  assert.deepEqual(parsed.black, [{ startSeconds: 1.2, endSeconds: 3.7, durationSeconds: 2.5 }]);
  assert.deepEqual(parsed.freeze, [{ startSeconds: 4, endSeconds: 9.5, durationSeconds: 5.5 }]);
  assert.deepEqual(parseVisualDefects("freeze_start: 7", 10).freeze, [{ startSeconds: 7, endSeconds: 10, durationSeconds: 3 }]);
});

test("inspection planner covers segment, caption, overlay and transition windows", () => {
  const points = sequenceInspectionPoints({ data: { segments: [
    { id: "a", title: "A", durationSeconds: 4, captions: [{ text: "Caption", startSeconds: 1, endSeconds: 2 }], overlays: [{ id: "logo", startSeconds: 2, endSeconds: 3 }], transition: { type: "crossfade", durationSeconds: 1 } },
    { id: "b", title: "B", durationSeconds: 3, captions: [], overlays: [], transition: { type: "cut", durationSeconds: 0 } }
  ] } });
  assert.ok(["Hình", "Chữ", "Lớp phủ logo", "Chuyển cảnh"].every((track) => points.some((point) => point.track === track)));
  assert.ok(points.every((point) => point.seconds >= 0 && point.seconds < 6.001));
});

test("source transcript boundary check catches a cut through the final word", () => {
  const rows = [{ words: [
    { text: "hợp", startSeconds: 8.7, endSeconds: 9.0 },
    { text: "lệ", startSeconds: 9.1, endSeconds: 9.38 }
  ] }];
  assert.equal(sourceCutBoundaryCheck(rows, { startSeconds: 0, endSeconds: 9.3 }).status, "failed");
  assert.equal(sourceCutBoundaryCheck(rows, { startSeconds: 0, endSeconds: 9.8 }).status, "passed");
});

async function fixture(t, { lastWordEnd = 9.6, finalScore = 0.9, clipping = 0, frames = 4, sourceCut = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-output-qa-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "preview.mp4");
  const transcriptPath = join(directory, "transcript.jsonl");
  const sourceTranscriptPath = join(directory, "source-transcript.jsonl");
  const genericPath = join(directory, "evidence.jsonl");
  await Promise.all([
    writeFile(sourcePath, "video"),
    writeFile(genericPath, [{ requestedTime: 0, actualTime: 0 }, { requestedTime: 5, actualTime: 5 }, { requestedTime: 9.999, actualTime: 9.999 }].map((row) => JSON.stringify(row)).join("\n") + "\n"),
    writeFile(transcriptPath, JSON.stringify({
      text: "A complete sentence", startSeconds: 0.2, endSeconds: lastWordEnd,
      words: [
        { text: "A", startSeconds: 0.2, endSeconds: 0.3, score: 0.99 },
        { text: "sentence", startSeconds: lastWordEnd - 0.2, endSeconds: lastWordEnd, score: finalScore }
      ]
    }) + "\n"),
    writeFile(sourceTranscriptPath, JSON.stringify({
      text: "source sentence", startSeconds: 100.2, endSeconds: 109.5,
      words: [{ text: "source", startSeconds: 100.2, endSeconds: 100.5 }, { text: "sentence", startSeconds: 109.1, endSeconds: 109.5 }]
    }) + "\n")
  ]);
  const source = {
    id: "result-render", type: "video.sequence-render", name: "Preview", projectId: "demo",
    inputResources: [], inputResults: [], inputArtifacts: ["artifact-film"], files: [{ id: "primary" }],
    data: { durationSeconds: 10, sequence: { artifactId: "artifact-film", revision: 1, key: "film" } },
    verification: { status: "passed", checks: ["rendered"] }
  };
  const analysisJobId = "analysis-job";
  const evidence = [
    { id: "result-probe", type: "source.metadata", data: { analysisJobId, source: { kind: "result", id: source.id, file: "primary" }, details: { format: { durationSeconds: 10 } } }, files: [] },
    { id: "result-frames", type: "source.frames", data: { analysisJobId, source: { kind: "result", id: source.id, file: "primary" }, counts: { frames, contactSheets: 1 }, details: { contactSheets: [{ fileId: "contact-001" }] } }, files: [{ id: "frames" }, { id: "contact-001" }] },
    { id: "result-audio", type: "source.audio-analysis", data: { analysisJobId, source: { kind: "result", id: source.id, file: "primary" }, counts: { clippingCandidates: clipping }, details: { peakNormalized: 0.7, integratedLufs: -17 } }, files: [{ id: "audio" }] },
    { id: "result-transcript", type: "source.transcript", data: { analysisJobId, source: { kind: "result", id: source.id, file: "primary" } }, files: [{ id: "segments" }] }
  ].map((result) => ({ ...result, inputResults: [source.id], inputResources: [], inputArtifacts: [], verification: { status: "passed", checks: ["fixture"] } }));
  const sourceTranscript = {
    id: "result-source-transcript", type: "source.transcript",
    data: { source: { kind: "resource", id: "resource-source" } },
    files: [{ id: "segments" }], inputResults: [], inputResources: ["resource-source"],
    inputArtifacts: [], verification: { status: "passed", checks: ["fixture"] }
  };
  const paths = new Map([
    [`${source.id}:primary`, sourcePath],
    ["result-frames:frames", genericPath], ["result-frames:contact-001", genericPath],
    ["result-audio:audio", genericPath], ["result-transcript:segments", transcriptPath],
    ["result-source-transcript:segments", sourceTranscriptPath]
  ]);
  const store = {
    readContext: async () => ({
      results: [source, ...evidence, ...(sourceCut ? [sourceTranscript] : [])],
      artifacts: [{
        id: "artifact-film",
        data: { segments: sourceCut ? [{
          id: "source-segment", durationSeconds: 10,
          visual: { source: { kind: "resource", id: "resource-source" }, startSeconds: 100 },
          references: [{ kind: "result", id: sourceTranscript.id }]
        }] : [] },
        references: []
      }]
    }),
    verifyResultFile: async (_projectId, resultId, fileId) => ({ id: fileId, filePath: paths.get(`${resultId}:${fileId}`), sha256: "a".repeat(64) })
  };
  const output = join(directory, "output");
  await mkdir(output);
  return { directory, output, source, analysisJobId, evidence, store };
}

async function assess(state, visualStderr = "") {
  const tool = createLocalOutputQuality({ executeCommand: async (_command, args) => ({ stdout: "ffmpeg version fixture\n", stderr: args.includes("blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2") ? visualStderr : "" }) });
  const prepared = await tool.prepare({
    store: state.store, projectId: "demo",
    inputs: {
      resultId: state.source.id, analysisJobId: state.analysisJobId, profileId: "spoken-video-v1",
      evidenceResultIds: { probe: "result-probe", frames: "result-frames", audio: "result-audio", transcript: "result-transcript" },
      inspectionPoints: [{ seconds: 0, track: "Hình", label: "One", position: "start" }, { seconds: 5, track: "Hình", label: "One", position: "middle" }, { seconds: 9.999, track: "Hình", label: "One", position: "end" }]
    },
    outputWorkspace: { temporaryDirectory: state.output, projectRelativeDirectory: "outputs/run-quality" }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability: await tool.checkAvailability() });
  return { execution, result: tool.createResult({ prepared, execution }) };
}

test("output QA produces an exact delivery-eligible report with honest human-review limits", async (t) => {
  const assessed = await assess(await fixture(t));
  assert.equal(assessed.execution.report.gate.deliveryEligible, true);
  assert.equal(assessed.execution.report.gate.status, "passed_with_notes");
  assert.equal(assessed.execution.report.metrics.speechTailSeconds, 0.4);
  assert.equal(assessed.execution.report.humanReview.auditory, "not_performed");
  assert.equal(assessed.result.type, "video.output-quality");
  assert.equal(assessed.result.verification.status, "passed");
});

test("output QA makes source transcript cut evidence a durable dependency", async (t) => {
  const assessed = await assess(await fixture(t, { sourceCut: true }));
  assert.equal(assessed.execution.report.checks.find((item) => item.id === "source-word-boundaries").status, "passed");
  assert.ok(assessed.result.inputResults.includes("result-source-transcript"));
});

test("output QA records a valid failed report for unsafe speech tail, low confidence and clipping", async (t) => {
  const assessed = await assess(await fixture(t, { lastWordEnd: 9.85, finalScore: 0.2, clipping: 1 }));
  assert.equal(assessed.execution.report.gate.deliveryEligible, false);
  assert.deepEqual(assessed.execution.report.gate.failedCheckIds.sort(), ["clipping", "final-word-confidence", "speech-tail"]);
  assert.equal(assessed.result.verification.status, "passed");
});

test("output QA blocks a severe black window and reports freeze as advisory", async (t) => {
  const assessed = await assess(await fixture(t), "black_start:1 black_end:4 black_duration:3\nfreeze_start: 4\nfreeze_duration: 5.5\nfreeze_end: 9.5");
  assert.equal(assessed.execution.report.checks.find((item) => item.id === "black-frame-windows").status, "failed");
  assert.equal(assessed.execution.report.checks.find((item) => item.id === "freeze-windows").status, "warning");
  assert.equal(assessed.execution.report.gate.deliveryEligible, false);
});

test("output QA rejects evidence belonging to another exact render", async (t) => {
  const state = await fixture(t);
  state.evidence[1].data.source.id = "result-other";
  const tool = createLocalOutputQuality({ executeCommand: async () => ({ stdout: "ffmpeg version fixture\n", stderr: "" }) });
  await assert.rejects(tool.prepare({
    store: state.store, projectId: "demo",
    inputs: { resultId: state.source.id, analysisJobId: state.analysisJobId, profileId: "spoken-video-v1", evidenceResultIds: { probe: "result-probe", frames: "result-frames", audio: "result-audio", transcript: "result-transcript" }, inspectionPoints: [{ seconds: 0, track: "Hình", label: "One", position: "start" }] },
    outputWorkspace: { temporaryDirectory: state.output, projectRelativeDirectory: "outputs/run-quality" }
  }), (error) => error.code === "invalid_evidence");
});
