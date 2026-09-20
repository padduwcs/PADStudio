import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";

const criterion = [{ id: "story", criterion: "The demonstration is understandable", status: "passed", evidence: "The product state is visible." }];

function inspection(visual, audio, limitations = []) {
  return {
    version: "1.0",
    visual: { method: visual, evidence: "Exact render inspected at the stated scope." },
    audio: { method: audio, evidence: audio === "not_applicable" ? "The video is silent." : "Exact render audio assessed at the stated scope." },
    limitations
  };
}

test("agent video reviews disclose inspection scope and cannot pass on still frames", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-review-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.createProject({ projectId: "demo", title: "Product demo" });
  const artifact = await store.recordArtifact("demo", {
    key: "film", type: "video.sequence", name: "Product demo", summary: "A short product walkthrough", status: "active", createdBy: "agent",
    data: { version: "1.0", changeReason: "test", format: { width: 320, height: 180, fps: 25 }, segments: [
      { id: "walkthrough", title: "Walkthrough", intent: "Show a product action", durationSeconds: 1, visual: null, narration: null, captions: [], references: [] }
    ] }
  });
  const run = await store.startRun("demo", { capability: "video.render-sequence", purpose: "test", tool: { name: "fixture", version: "1", provider: "test" } });
  const workspace = await store.createRunOutputWorkspace("demo", run.id);
  await writeFile(join(workspace.temporaryDirectory, "preview.mp4"), "exact-render");
  await store.commitRunOutputWorkspace(workspace);
  const result = await store.addResult("demo", {
    runId: run.id, capability: "video.render-sequence", tool: run.tool, type: "video.sequence-render", name: "Preview",
    inputArtifacts: [artifact.id], files: [{ id: "primary", role: "primary", path: `${workspace.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: 12 }],
    data: { sequence: { artifactId: artifact.id, revision: artifact.revision }, hasAudio: true }, verification: { status: "passed", checks: ["fixture"] }
  });
  const base = { target: { kind: "result", id: result.id }, perspective: "combined", reviewer: "agent", summary: "Exact preview reviewed.", criteria: criterion };
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed" }), /requires review\.inspection/);
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed_with_notes", inspection: inspection("sampled_frames", "sampled_listening", ["Motion was not inspected."]) }), /requires motion evidence/);
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed_with_notes", inspection: inspection("motion_samples", "analysis_only", ["Audio was measured but not listened to."]) }), /requires motion evidence and listening/);
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed_with_notes", inspection: inspection("motion_samples", "not_applicable", ["Only selected intervals were inspected."]) }), /cannot be not_applicable/);
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed", inspection: inspection("motion_samples", "sampled_listening", ["Only selected intervals were inspected."]) }), /unqualified passed/);
  await assert.rejects(store.recordReview("demo", { ...base, verdict: "passed_with_notes", inspection: inspection("motion_samples", "sampled_listening") }), /must describe its inspection limits/);
  const scoped = await store.recordReview("demo", { ...base, verdict: "passed_with_notes", inspection: inspection("motion_samples", "sampled_listening", ["Only selected intervals of motion and audio were inspected."]) });
  assert.equal(scoped.inspection.visual.method, "motion_samples");
  assert.deepEqual((await new ProjectStore(root).readReviews("demo")).map((review) => review.inspection?.visual.method), ["motion_samples"]);
  const complete = await store.recordReview("demo", { ...base, verdict: "passed", inspection: inspection("continuous_playback", "continuous_listening") });
  assert.equal(complete.verdict, "passed");
});
