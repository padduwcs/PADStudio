import assert from "node:assert/strict";
import test from "node:test";
import { analysisExitCode } from "../src/cli/analysis-exit-code.js";

test("analysis CLI distinguishes completion, execution failure and operational blockers", () => {
  assert.equal(analysisExitCode({ state: "completed", job: { units: [] } }), 0);
  assert.equal(analysisExitCode({ state: "failed", job: { units: [{ state: "failed" }] } }), 1);
  assert.equal(analysisExitCode({ state: "failed", job: { units: [{ state: "blocked" }] } }), 2);
  assert.equal(analysisExitCode({ state: "partial", job: { units: [] } }), 2);
  assert.equal(analysisExitCode(null), 1);
});
