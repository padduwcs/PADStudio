import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { releaseMeasurementsFromHumanReview } from "../src/intelligence/human-attestation.js";
import { createHumanConfirmation } from "../src/project/human-confirmation.js";

test("human attestation binds full review to exact render bytes and revision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-attest-")); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root); await store.createProject({ projectId: "demo", title: "Demo" });
  const artifact = await store.recordArtifact("demo", { key: "film", type: "video.sequence", name: "Film", summary: "Exact review target", status: "active", createdBy: "agent",
    data: { version: "1.0", changeReason: "test", format: { width: 320, height: 180, fps: 25 }, segments: [{ id: "one", title: "One", intent: "Test", durationSeconds: 1, visual: null, narration: null, captions: [], references: [] }] } });
  const run = await store.startRun("demo", { capability: "video.render-sequence", purpose: "test", tool: { name: "fixture", version: "1", provider: "test" } });
  const workspace = await store.createRunOutputWorkspace("demo", run.id); await writeFile(join(workspace.temporaryDirectory, "preview.mp4"), "exact-render"); await store.commitRunOutputWorkspace(workspace);
  const result = await store.addResult("demo", { runId: run.id, capability: "video.render-sequence", tool: run.tool, type: "video.sequence-render", name: "Preview",
    inputArtifacts: [artifact.id], files: [{ id: "primary", role: "primary", path: `${workspace.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: 12 }],
    data: { sequence: { artifactId: artifact.id, revision: artifact.revision } }, verification: { status: "passed", checks: ["fixture"] } });
  const review = await store.recordReview("demo", { target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed", summary: "Watched and listened in full.",
    criteria: [{ id: "full-review", criterion: "Full human review", status: "passed", evidence: "Desktop headphones" }],
    attestation: { watchedFull: true, listenedFull: true, device: "Desktop headphones", context: "Quiet room", findings: [] } },
  { humanConfirmation: createHumanConfirmation("review_video", result.id) });
  assert.match(review.exactResult.sha256, /^[a-f0-9]{64}$/); assert.equal(review.exactResult.artifactRevision, 1);
  assert.deepEqual(releaseMeasurementsFromHumanReview(review).map((item) => item.gateId), ["human_viewing_review", "human_listening_review"]);
  await assert.rejects(store.recordReview("demo", { target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed", summary: "Agent-authored claim",
    criteria: [{ id: "full-review", criterion: "Full human review", status: "passed", evidence: "Opaque JSON" }],
    attestation: { watchedFull: true, listenedFull: true, device: "Unknown", context: "Agent payload", findings: [] } }),
  /direct interactive human confirmation/);
  await assert.rejects(store.recordReview("demo", { target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed", summary: "Invalid",
    criteria: [{ id: "full-review", criterion: "Full human review", status: "passed", evidence: "Claim" }],
    attestation: { watchedFull: false, listenedFull: true, device: "Desktop", context: "Quiet room", findings: [] } },
  { humanConfirmation: createHumanConfirmation("review_video", result.id) }), /watchedFull/);
});
