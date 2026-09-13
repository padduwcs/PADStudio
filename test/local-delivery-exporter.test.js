import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256File } from "../src/analysis/source-identity.js";
import { createLocalDeliveryExporter } from "../src/tools/local-delivery-exporter.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-delivery-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "source.mp4");
  await writeFile(sourcePath, "exact-approved-video-bytes");
  const hash = await sha256File(sourcePath);
  const artifact = {
    id: "artifact-current", key: "film", revision: 1, type: "video.sequence",
    name: "Film", summary: "Current", status: "active", references: [],
    data: {
      version: "1.0", changeReason: "Initial",
      format: { width: 1080, height: 1920, fps: 30 },
      segments: [{
        id: "opening", title: "Opening", intent: "Open",
        durationSeconds: 1, references: [], captions: [],
        visual: { source: { kind: "resource", id: "resource-source" } }
      }]
    }
  };
  const result = {
    id: "result-approved", projectId: "demo", type: "video.sequence-render",
    name: "Approved cut", createdAt: "2026-09-13T00:00:00.000Z",
    createdByRun: "run-render", tool: { name: "ffmpeg-sequence", version: "1.2.0", provider: "FFmpeg" },
    inputResources: ["resource-source"], inputResults: [], inputArtifacts: [artifact.id],
    files: [{ id: "primary", available: true }],
    data: {
      sequence: { artifactId: artifact.id, key: artifact.key, revision: 1 },
      durationSeconds: 1
    },
    verification: { status: "passed", checks: ["rendered"] }
  };
  const approval = {
    id: "decision-approved", resultId: result.id, outcome: "accepted", decidedBy: "user",
    note: "Approved", createdAt: "2026-09-13T00:01:00.000Z",
    feedbackTarget: { artifactId: artifact.id, revision: 1 }, resolvesDecisionIds: []
  };
  const quality = {
    id: "result-quality", projectId: "demo", type: "video.output-quality",
    name: "Output QA", createdAt: "2026-09-13T00:00:30.000Z",
    createdByRun: "run-quality", tool: { name: "local-output-quality", version: "1.0.0", provider: "PADStudio" },
    inputResources: ["resource-source"], inputResults: [result.id], inputArtifacts: [artifact.id],
    files: [{ id: "report", available: true }],
    data: { sourceResultId: result.id, sourceSha256: hash, gate: { deliveryEligible: true } },
    verification: { status: "passed", checks: ["quality_report_written"] }
  };
  const context = {
    project: { id: "demo" },
    resources: [{
      id: "resource-source", kind: "file", available: true,
      items: [{ available: true }]
    }],
    results: [result, quality],
    artifacts: [artifact],
    decisions: [approval],
    reviews: [],
    runs: [{
      id: "run-render", status: "completed", pendingResult: null, outputs: [result.id]
    }],
    intelligence: { activeArtifacts: [artifact] }
  };
  const store = {
    readContext: async () => context,
    verifyResultFile: async (_projectId, resultId, fileId) => ({
      id: fileId, name: fileId === "report" ? "quality-report.json" : "preview.mp4", size: 26, filePath: sourcePath,
      sha256: hash, checksumSource: "file"
    })
  };
  return { directory, sourcePath, context, result, quality, store };
}

function fakeMediaCommand(_command, args) {
  if (args[0] === "-version") return Promise.resolve({ stdout: "ffmpeg version fixture\n", stderr: "" });
  if (args.includes("-show_streams")) {
    return Promise.resolve({
      stdout: JSON.stringify({
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.000" },
        streams: [
          { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920, avg_frame_rate: "30/1" },
          { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }
        ]
      }),
      stderr: ""
    });
  }
  if (args.some((arg) => String(arg).includes("loudnorm="))) {
    return Promise.resolve({ stdout: "", stderr: '{"input_i":"-18.2","input_tp":"-3.0","input_lra":"2.1"}' });
  }
  if (args.some((arg) => String(arg).includes("silencedetect="))) {
    return Promise.resolve({ stdout: "", stderr: "silence_start: 0.8\nsilence_end: 1.0" });
  }
  return Promise.resolve({ stdout: "", stderr: "" });
}

test("local delivery packages the exact approved current Result with evidence", async (t) => {
  const { directory, store, result, quality } = await fixture(t);
  const tool = createLocalDeliveryExporter({
    executeCommand: fakeMediaCommand,
    analysisSummary: async () => ({ sources: [] }),
    now: () => "2026-09-13T01:00:00.000Z"
  });
  const availability = await tool.checkAvailability();
  const prepared = await tool.prepare({
    store, projectId: "demo",
    inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
    outputWorkspace: {
      temporaryDirectory: join(directory, "bundle.tmp"),
      projectRelativeDirectory: "outputs/run-delivery"
    }
  });
  const execution = await tool.execute({ ...prepared.runtime, availability });
  const created = tool.createResult({ prepared, execution });
  assert.equal(created instanceof Promise, false);
  assert.equal(created.type, "delivery.bundle");
  assert.deepEqual(created.inputResults, [result.id, quality.id]);
  assert.equal(created.files.length, 7);
  assert.equal(created.verification.status, "passed");
  assert.equal(
    await readFile(join(directory, "bundle.tmp", "video", "output.mp4"), "utf8"),
    "exact-approved-video-bytes"
  );
  const checksums = await readFile(join(directory, "bundle.tmp", "metadata", "checksums.sha256"), "utf8");
  assert.match(checksums, /video\/output\.mp4/);
  assert.match(checksums, /metadata\/approval\.json/);
  assert.match(checksums, /metadata\/quality\.json/);
});

test("local delivery fails closed without exact automated output QA", async (t) => {
  const { directory, store, context, result } = await fixture(t);
  context.results = context.results.filter((candidate) => candidate.type !== "video.output-quality");
  const tool = createLocalDeliveryExporter({ executeCommand: fakeMediaCommand, analysisSummary: async () => ({ sources: [] }) });
  await assert.rejects(tool.prepare({
    store, projectId: "demo", inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
    outputWorkspace: { temporaryDirectory: join(directory, "no-qa.tmp"), projectRelativeDirectory: "outputs/run-no-qa" }
  }), (error) => error.code === "output_quality_required");
});

test("local delivery fails closed when exact automated output QA failed", async (t) => {
  const { directory, store, quality, result } = await fixture(t);
  quality.data.gate.deliveryEligible = false;
  const tool = createLocalDeliveryExporter({ executeCommand: fakeMediaCommand, analysisSummary: async () => ({ sources: [] }) });
  await assert.rejects(tool.prepare({
    store, projectId: "demo", inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
    outputWorkspace: { temporaryDirectory: join(directory, "failed-qa.tmp"), projectRelativeDirectory: "outputs/run-failed-qa" }
  }), (error) => error.code === "output_quality_failed");
});

test("local delivery fails closed when QA is stale for the exact output bytes", async (t) => {
  const { directory, store, quality, result } = await fixture(t);
  quality.data.sourceSha256 = "0".repeat(64);
  const tool = createLocalDeliveryExporter({ executeCommand: fakeMediaCommand, analysisSummary: async () => ({ sources: [] }) });
  await assert.rejects(tool.prepare({
    store, projectId: "demo", inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
    outputWorkspace: { temporaryDirectory: join(directory, "stale-qa.tmp"), projectRelativeDirectory: "outputs/run-stale-qa" }
  }), (error) => error.code === "output_quality_stale");
});

test("local delivery blocks unresolved feedback for the same sequence", async (t) => {
  const { directory, store, context, result } = await fixture(t);
  context.results.push({
    ...result, id: "result-old",
    data: { ...result.data, sequence: { ...result.data.sequence, artifactId: "artifact-old", revision: 0 } }
  });
  context.decisions.push({
    id: "decision-pending", resultId: "result-old", outcome: "changes_requested",
    note: "Fix it", decidedBy: "user", createdAt: "2026-09-12T00:00:00.000Z"
  });
  const tool = createLocalDeliveryExporter({
    executeCommand: fakeMediaCommand,
    analysisSummary: async () => ({ sources: [] })
  });
  await assert.rejects(
    tool.prepare({
      store, projectId: "demo",
      inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
      outputWorkspace: {
        temporaryDirectory: join(directory, "blocked.tmp"),
        projectRelativeDirectory: "outputs/run-blocked"
      }
    }),
    (error) => error.code === "pending_feedback"
  );
});

test("local delivery requires the latest exact Result decision to be accepted", async (t) => {
  const { directory, store, context, result } = await fixture(t);
  context.decisions.push({
    id: "decision-rejected", resultId: result.id, outcome: "rejected",
    note: "Do not deliver", decidedBy: "user", createdAt: "2026-09-13T00:02:00.000Z"
  });
  const tool = createLocalDeliveryExporter({
    executeCommand: fakeMediaCommand,
    analysisSummary: async () => ({ sources: [] })
  });
  await assert.rejects(
    tool.prepare({
      store, projectId: "demo",
      inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" },
      outputWorkspace: {
        temporaryDirectory: join(directory, "rejected.tmp"),
        projectRelativeDirectory: "outputs/run-rejected"
      }
    }),
    (error) => error.code === "approval_required"
  );
});
