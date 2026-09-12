import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planProjectRecovery, recoverProject } from "../src/operations/project-recovery.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-project-recovery-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(join(rootDir, "demo"), { recursive: true });
  const state = {
    pending: [{
      runId: "run-safe", resultIds: ["result-safe"], recoverable: true
    }],
    calls: 0
  };
  const store = {
    rootDir,
    readContext: async () => ({
      runRecovery: { pendingFinalizations: [...state.pending] }
    }),
    recoverRunFinalization: async (_projectId, runId) => {
      state.calls += 1;
      state.pending = state.pending.filter((entry) => entry.runId !== runId);
      return {
        id: runId, outputs: ["result-safe"],
        finishedAt: "2026-09-13T00:00:00.000Z"
      };
    }
  };
  return { store, state };
}

test("project recovery is dry-run by default and apply is idempotent", async (t) => {
  const { store, state } = await fixture(t);
  const plan = await planProjectRecovery(store, "demo");
  assert.equal(plan.status, "planned");
  assert.equal(state.calls, 0);

  const applied = await recoverProject(store, "demo", { apply: true });
  assert.equal(applied.status, "completed");
  assert.equal(applied.summary.completed, 1);
  assert.equal(state.calls, 1);

  const again = await recoverProject(store, "demo", { apply: true });
  assert.equal(again.status, "nothing_to_do");
  assert.equal(state.calls, 1);
});

test("concurrent project recovery applies a recoverable action only once", async (t) => {
  const { store, state } = await fixture(t);
  const responses = await Promise.all([
    recoverProject(store, "demo", { apply: true }),
    recoverProject(store, "demo", { apply: true })
  ]);
  assert.equal(state.calls, 1);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    ["completed", "nothing_to_do"]
  );
});

test("unsafe finalization is reported and never applied", async (t) => {
  const { store, state } = await fixture(t);
  state.pending = [{ runId: "run-unsafe", resultIds: [], recoverable: false }];
  const result = await recoverProject(store, "demo", { apply: true });
  assert.equal(result.status, "partial");
  assert.equal(result.actions[0].status, "skipped");
  assert.equal(state.calls, 0);
});
