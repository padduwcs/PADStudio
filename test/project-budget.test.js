import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { configureProjectBudget, projectBudgetSnapshot, startBudgetedRun } from "../src/execution/project-budget.js";

test("project budget atomically reserves in-progress Runs and reconciles completed spend", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root); await store.createProject({ projectId: "demo", title: "Demo" });
  await configureProjectBudget(store, "demo", { mode: "cap", totalUsd: 10, reserveUsd: 2, singleActionApprovalUsd: 1 });
  const value = { capability: "image.generate", purpose: "Generate", tool: { name: "paid", version: "1", provider: "test" }, inputs: {}, estimatedCostUsd: 3 };
  await assert.rejects(startBudgetedRun(store, "demo", value), (error) => error.code === "budget_approval_required");
  const run = await startBudgetedRun(store, "demo", value, { approved: true });
  assert.equal((await projectBudgetSnapshot(store, "demo")).reservedUsd, 3);
  await assert.rejects(startBudgetedRun(store, "demo", { ...value, estimatedCostUsd: 6 }, { approved: true }), (error) => error.code === "budget_exceeded");
  await store.finishRun("demo", run.id, { status: "completed", actualCostUsd: 2 });
  const snapshot = await projectBudgetSnapshot(store, "demo");
  assert.equal(snapshot.spentUsd, 2); assert.equal(snapshot.reservedUsd, 0); assert.equal(snapshot.usableUsd, 6);
});

test("observe budget records overspend without blocking", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-budget-observe-")); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root); await store.createProject({ projectId: "demo", title: "Demo" });
  await configureProjectBudget(store, "demo", { mode: "observe", totalUsd: 1, reserveUsd: 0, singleActionApprovalUsd: 10 });
  const run = await startBudgetedRun(store, "demo", { capability: "x", purpose: "x", tool: null, inputs: {}, estimatedCostUsd: 2 });
  assert.equal(run.status, "in_progress"); assert.equal((await projectBudgetSnapshot(store, "demo")).usableUsd, 0);
});
