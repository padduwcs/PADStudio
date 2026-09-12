import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-concurrency-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "demo", title: "Concurrency demo" });
  return store;
}

function item(status = "ready") {
  return {
    id: "edit",
    title: "Edit",
    purpose: "Exercise serialized workflow revisions.",
    status,
    dependsOn: [],
    skillIds: [],
    inputReferences: [],
    expectedOutputs: [{ kind: "workflow", description: "A recorded workflow revision." }],
    outputReferences: [],
    review: { required: false, perspective: "combined", criteria: [] },
    approval: "auto",
  };
}

test("concurrent artifact creators cannot commit duplicate revision one", async (t) => {
  const store = await fixture(t);
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
    store.recordArtifact("demo", {
      key: "shared-output",
      type: "test.concurrent-output",
      name: `Candidate ${index}`,
      summary: "Only one writer may create the first immutable revision.",
      status: "active",
      data: { candidate: index },
      references: [],
      expectedRevision: 0,
    })
  ));

  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = attempts.filter(({ status }) => status === "rejected");
  assert.equal(rejected.length, 11);
  assert.ok(rejected.every(({ reason }) => /revision conflict/.test(reason.message)));
  const records = (await store.readArtifacts("demo")).filter(({ key }) => key === "shared-output");
  assert.deepEqual(records.map(({ revision }) => revision), [1]);
});

test("concurrent workflow updates use compare-and-swap", async (t) => {
  const store = await fixture(t);
  const workflow = await store.writeWorkflow("demo", {
    name: "Concurrent workflow",
    purpose: "Prove stale writers cannot overwrite one another.",
    status: "active",
    items: [item()],
  });
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    store.writeWorkflow("demo", {
      id: workflow.id,
      expectedRevision: workflow.revision,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: `Writer ${index} starts the edit.`,
      items: [item("in_progress")],
    })
  ));

  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(attempts.filter(({ status }) => status === "rejected").length, 7);
  assert.deepEqual((await store.readWorkflows("demo")).map(({ revision }) => revision), [1, 2]);
});

test("concurrent reviews receive unique monotonic rounds", async (t) => {
  const store = await fixture(t);
  const artifact = await store.recordArtifact("demo", {
    key: "review-target",
    type: "test.review-target",
    name: "Review target",
    summary: "A stable target for concurrent review rounds.",
    status: "active",
    data: {},
    references: [],
  });
  const reviews = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    store.recordReview("demo", {
      target: { kind: "artifact", id: artifact.id },
      perspective: "technical",
      verdict: "passed",
      summary: `Concurrent review ${index}.`,
      criteria: [{
        id: "durable",
        criterion: "The review is durably recorded.",
        status: "passed",
        evidence: `Writer ${index} completed.`,
      }],
    })
  ));

  assert.deepEqual(reviews.map(({ round }) => round).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual((await store.readReviews("demo")).map(({ round }) => round), [1, 2, 3, 4, 5, 6, 7, 8]);
});
