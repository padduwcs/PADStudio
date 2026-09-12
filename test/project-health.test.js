import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectHealth } from "../src/operations/project-health.js";

function fixture() {
  return {
    context: {
      resources: [], results: [], runs: [], authorizations: [],
      runRecovery: { pendingFinalizations: [] }
    },
    production: { sequences: [] },
    checkpointFreshness: { status: "current" },
    pendingFeedback: []
  };
}

test("project health is ready when no current operational issue exists", () => {
  assert.equal(buildProjectHealth(fixture()).status, "ready");
});

test("project health separates recoverable attention from unsafe blockers", () => {
  const recoverable = fixture();
  recoverable.context.runRecovery.pendingFinalizations.push({
    runId: "run-safe", resultIds: ["result-safe"], recoverable: true
  });
  const first = buildProjectHealth(recoverable);
  assert.equal(first.status, "attention");
  assert.equal(first.issues[0].code, "recoverable_finalizations");

  recoverable.context.runRecovery.pendingFinalizations.push({
    runId: "run-unsafe", resultIds: [], recoverable: false
  });
  const blocked = buildProjectHealth(recoverable);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.issues.some((entry) => entry.code === "unrecoverable_finalizations"));
});

test("historical failed runs alone do not block project health", () => {
  const value = fixture();
  value.context.runs.push({ id: "run-old", status: "failed" });
  assert.equal(buildProjectHealth(value).status, "ready");
});
