import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore, ProjectStoreError } from "../src/project/project-store.js";
import { createHumanConfirmation } from "../src/project/human-confirmation.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";

const tool = { name: "test-renderer", version: "1.0.0", provider: "test" };
const sequenceData = {
  version: "1.0",
  changeReason: "Initial cut",
  format: { width: 320, height: 180, fps: 25 },
  segments: [
    { id: "opening", title: "Opening", intent: "Open clearly", durationSeconds: 2, visual: null },
    { id: "ending", title: "Ending", intent: "Close clearly", durationSeconds: 3, visual: null }
  ]
};

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-phase5b-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Phase 5B feedback" });
  const artifact = await store.recordArtifact("demo", {
    key: "film", type: "video.sequence", name: "Film", summary: "Exact feedback fixture", data: sequenceData
  });
  async function result(name) {
    const run = await store.startRun("demo", { capability: "video.render-sequence", purpose: name, tool });
    const created = await store.addResult("demo", {
      runId: run.id, type: "video.sequence-render", name, capability: "video.render-sequence",
      inputResources: [], inputArtifacts: [artifact.id], files: [], tool,
      data: {
        sequence: { artifactId: artifact.id, key: artifact.key, revision: artifact.revision },
        segments: [{ id: "opening" }, { id: "ending" }]
      },
      verification: { status: "passed", checks: ["fixture"] }
    });
    await store.finishRun("demo", run.id, { status: "completed", outputs: [created.id] });
    return created;
  }
  return { rootDir, store, artifact, first: await result("First"), second: await result("Second") };
}

test("exact segment feedback survives reopen and appears in resume context", async (t) => {
  const { rootDir, store, artifact, first } = await fixture(t);
  const feedback = await store.recordDecision("demo", {
    resultId: first.id,
    outcome: "changes_requested",
    note: "Shorten the opening.",
    feedbackTarget: {
      artifactId: artifact.id,
      revision: artifact.revision,
      segmentId: "opening",
      timeRange: { startSeconds: 0.25, endSeconds: 1.5 }
    }
  });
  const reopenedStore = new ProjectStore(rootDir);
  assert.deepEqual((await reopenedStore.readDecisions("demo"))[0], feedback);
  const context = await new ProjectContextAssembler({ projectStore: reopenedStore }).build("demo");
  assert.deepEqual(context.pendingFeedback.map((item) => item.id), [feedback.id]);
  assert.deepEqual(context.resumeView.pendingFeedbackIds, [feedback.id]);
  assert.equal(context.resumeView.pendingFeedbackCount, 1);
});

test("feedback rejects mismatched revisions, missing segments and out-of-range time", async (t) => {
  const { store, artifact, first } = await fixture(t);
  const base = { resultId: first.id, outcome: "changes_requested", note: "Change this." };
  await assert.rejects(store.recordDecision("demo", base), /requires an exact feedbackTarget/);
  await assert.rejects(store.recordDecision("demo", {
    ...base, feedbackTarget: { artifactId: artifact.id, revision: artifact.revision + 1 }
  }), /does not match the exact Result/);
  await assert.rejects(store.recordDecision("demo", {
    ...base, feedbackTarget: { artifactId: artifact.id, revision: artifact.revision, segmentId: "missing" }
  }), /not present in the exact Result/);
  await assert.rejects(store.recordDecision("demo", {
    ...base,
    feedbackTarget: {
      artifactId: artifact.id, revision: artifact.revision, segmentId: "opening",
      timeRange: { startSeconds: 1.5, endSeconds: 2.5 }
    }
  }), /outside the selected segment/);
  assert.deepEqual(await store.readDecisions("demo"), []);
});

test("accepted replacement resolves pending feedback exactly once", async (t) => {
  const { rootDir, store, artifact, first, second } = await fixture(t);
  const feedback = await store.recordDecision("demo", {
    resultId: first.id, outcome: "changes_requested", note: "Use the second render.",
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision }
  });
  const attempts = await Promise.allSettled([1, 2].map(() => store.recordDecision("demo", {
    resultId: second.id, outcome: "accepted", note: "The replacement addresses the request.",
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision },
    resolvesDecisionIds: [feedback.id]
  }, { humanConfirmation: createHumanConfirmation("accept_video", second.id) })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  assert.ok(attempts.find((item) => item.status === "rejected").reason instanceof ProjectStoreError);
  const assembler = new ProjectContextAssembler({ projectStore: new ProjectStore(rootDir) });
  assert.deepEqual((await assembler.build("demo")).pendingFeedback, []);
});

test("concurrent feedback writes are all durable with monotonic timestamps", async (t) => {
  const { store, artifact, first } = await fixture(t);
  const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) => store.recordDecision("demo", {
    resultId: first.id, outcome: "changes_requested", note: "Feedback " + index,
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision, segmentId: "ending" }
  })));
  const reopened = await store.readDecisions("demo");
  assert.equal(reopened.length, 12);
  assert.equal(new Set(decisions.map((item) => item.id)).size, 12);
  assert.equal(new Set(reopened.map((item) => item.createdAt)).size, 12);
  assert.deepEqual(reopened.map((item) => item.createdAt), reopened.map((item) => item.createdAt).toSorted());
});
