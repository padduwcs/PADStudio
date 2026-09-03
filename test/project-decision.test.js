import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore, ProjectStoreError } from "../src/project/project-store.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-decision-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Decision demo" });
  const tool = { name: "writer", version: "1.0.0", provider: "test" };
  const run = await store.startRun("demo", {
    capability: "script.draft",
    purpose: "Create a script option",
    tool
  });
  const result = await store.addResult("demo", {
    runId: run.id,
    type: "script.draft",
    name: "Script A",
    capability: "script.draft",
    inputResources: [],
    tool,
    data: { text: "Opening scene" },
    verification: { status: "passed", checks: ["text_present"] }
  });
  await store.finishRun("demo", run.id, {
    status: "completed",
    outputs: [result.id]
  });
  return { rootDir, store, result };
}

test("a result decision survives reopening with its user feedback", async (t) => {
  const { rootDir, store, result } = await fixture(t);
  const checkpoint = await store.writeCheckpoint("demo", {
    goal: "Chọn một phương án kịch bản",
    selectedResources: [],
    next: "Chờ người dùng phản hồi"
  });
  const decision = await store.recordDecision("demo", {
    resultId: result.id,
    outcome: "changes_requested",
    note: "Giữ bản này nhưng thay câu kết"
  });
  const reopened = await new ProjectStore(rootDir).readContext("demo");

  assert.equal(reopened.decisions.length, 1);
  assert.deepEqual(reopened.decisions[0], decision);
  assert.equal(decision.decidedBy, "user");
  assert.equal(decision.resultId, result.id);
  assert.deepEqual(reopened.checkpoint, checkpoint);
  assert.deepEqual(await store.readResult("demo", result.id), result);
});

test("decision history is append-only and ordered", async (t) => {
  const { store, result } = await fixture(t);
  const first = await store.recordDecision("demo", {
    resultId: result.id,
    outcome: "changes_requested",
    note: "Thay câu kết"
  });
  const second = await store.recordDecision("demo", {
    resultId: result.id,
    outcome: "accepted",
    note: "Câu kết mới đã phù hợp"
  });
  const decisions = await store.readDecisions("demo");

  assert.deepEqual(decisions.map((decision) => decision.id), [first.id, second.id]);
  assert.ok(second.createdAt > first.createdAt);
});

test("invalid decisions leave no durable record", async (t) => {
  const { store, result } = await fixture(t);
  await assert.rejects(
    store.recordDecision("demo", { resultId: result.id, outcome: "changes_requested" }),
    /phải có phản hồi/
  );
  await assert.rejects(
    store.recordDecision("demo", { resultId: result.id, outcome: "maybe" }),
    /không được hỗ trợ/
  );
  await assert.rejects(
    store.recordDecision("demo", {
      resultId: "result-does-not-exist",
      outcome: "accepted"
    }),
    (error) => error instanceof ProjectStoreError && /Không tìm thấy result/.test(error.message)
  );
  await assert.rejects(
    store.recordDecision("demo", { resultId: "../../outside", outcome: "accepted" }),
    /Result id không hợp lệ/
  );
  await assert.rejects(
    store.recordDecision("demo", {
      resultId: result.id,
      outcome: "accepted",
      unexpected: true
    }),
    /field không được hỗ trợ/
  );
  assert.deepEqual(await store.readDecisions("demo"), []);
});

test("projects created before decisions existed open with an empty decision list", async (t) => {
  const { rootDir, store } = await fixture(t);
  await rm(join(rootDir, "demo", "decisions"), { recursive: true });
  assert.deepEqual((await store.readContext("demo")).decisions, []);
});
