import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { evaluateReleaseGates } from "../src/release/release-gates.js";

const manifest = JSON.parse(await readFile(new URL("../eval/release-gates/manifest.json", import.meta.url), "utf8"));
const fixture = JSON.parse(await readFile(new URL("../eval/release-gates/test-fixture-evidence.json", import.meta.url), "utf8"));

test("release gates are fail-closed when evidence is absent", () => {
  const result = evaluateReleaseGates(manifest);
  assert.equal(result.status, "blocked");
  assert.equal(result.releaseDefault, null);
  assert.equal(result.releaseReady, false);
  assert.equal(result.summary.notMeasured, manifest.gates.length);
  assert.ok(result.gates.every((gate) => gate.blocking));
});

test("complete fixture evidence verifies mechanics but never certifies release", () => {
  const result = evaluateReleaseGates(manifest, fixture);
  assert.equal(result.status, "fixture_passed");
  assert.equal(result.summary.measuredPassed, manifest.gates.length);
  assert.equal(result.releaseReady, false);
  assert.equal(result.ownerDecisionRequired, false);
  assert.match(result.note, /cannot certify/i);
});

test("the known owner development corpus cannot masquerade as an independent holdout", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  evidence.corpora.push({
    id: "owner_vertical_development_2026", classification: "holdout", knownDevelopment: false,
    lockedBeforeEvaluation: true, rightsConfirmed: true,
    manifestSha256: "c".repeat(64)
  });
  evidence.measurements.find((entry) => entry.gateId === "independent_gold_holdout").corpusId = "owner_vertical_development_2026";
  const result = evaluateReleaseGates(manifest, evidence);
  const gate = result.gates.find((entry) => entry.id === "independent_gold_holdout");
  assert.equal(result.status, "blocked");
  assert.equal(gate.status, "invalid");
  assert.ok(gate.issues.some((entry) => entry.code === "not_independent_holdout"));
});

test("failed, duplicate, and unsupported evidence cannot be counted as measured pass", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  evidence.measurements.find((entry) => entry.gateId === "human_listening_review").outcome = "failed";
  evidence.measurements.push(structuredClone(evidence.measurements.find((entry) => entry.gateId === "landscape_source")));
  evidence.measurements.push({ gateId: "invented_gate", outcome: "passed" });
  const result = evaluateReleaseGates(manifest, evidence);
  assert.equal(result.status, "blocked");
  assert.equal(result.releaseReady, false);
  assert.equal(result.gates.find((entry) => entry.id === "human_listening_review").status, "measured_failed");
  assert.equal(result.gates.find((entry) => entry.id === "landscape_source").status, "invalid");
  assert.ok(result.documentIssues.some((entry) => entry.code === "unknown_gate"));
});

test("human and delivery gates require exact review targets and complete checks", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  delete evidence.measurements.find((entry) => entry.gateId === "human_viewing_review").reviewer;
  evidence.measurements.find((entry) => entry.gateId === "representative_delivery_promise_review").checks.audio = "not_measured";
  const result = evaluateReleaseGates(manifest, evidence);
  assert.ok(result.gates.find((entry) => entry.id === "human_viewing_review").issues.some((entry) => entry.code === "missing_human_reviewer"));
  assert.ok(result.gates.find((entry) => entry.id === "representative_delivery_promise_review").issues.some((entry) => entry.code === "incomplete_delivery_review"));
});

test("declared passes cannot override measured thresholds or metric domains", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  evidence.measurements.find((entry) => entry.gateId === "asr_cer_and_timing_thresholds").metrics.cleanCer = -0.01;
  evidence.measurements.find((entry) => entry.gateId === "scene_precision_recall").metrics.precision = 1.01;
  evidence.measurements.find((entry) => entry.gateId === "hundred_file_ten_hour_query_benchmark").metrics.peakMemoryBytes = 17 * 1024 ** 3;
  const result = evaluateReleaseGates(manifest, evidence);
  for (const gateId of ["asr_cer_and_timing_thresholds", "scene_precision_recall", "hundred_file_ten_hour_query_benchmark"]) {
    const gate = result.gates.find((entry) => entry.id === gateId);
    assert.equal(gate.status, "invalid");
    assert.ok(gate.issues.some((entry) => entry.code === "metric_threshold_failed"));
  }
});

test("holdout evidence must prove the gold corpus characteristics", () => {
  const missing = structuredClone(fixture);
  missing.scope = "release_candidate";
  delete missing.corpora.find((entry) => entry.id === "fixture-holdout").characteristics;
  let gate = evaluateReleaseGates(manifest, missing).gates.find((entry) => entry.id === "independent_gold_holdout");
  assert.ok(gate.issues.some((entry) => entry.code === "missing_holdout_characteristics"));

  const insufficient = structuredClone(fixture);
  insufficient.scope = "release_candidate";
  insufficient.corpora.find((entry) => entry.id === "fixture-holdout").characteristics.timingBoundaryCount = 299;
  gate = evaluateReleaseGates(manifest, insufficient).gates.find((entry) => entry.id === "independent_gold_holdout");
  assert.ok(gate.issues.some((entry) => entry.code === "holdout_characteristics_failed"));
});

test("media and human gates require evidence of the actual exercise", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  delete evidence.measurements.find((entry) => entry.gateId === "landscape_source").metrics.endToEndCompleted;
  delete evidence.measurements.find((entry) => entry.gateId === "human_listening_review").attestation;
  const result = evaluateReleaseGates(manifest, evidence);
  assert.ok(result.gates.find((entry) => entry.id === "landscape_source").issues.some((entry) => entry.code === "missing_metrics"));
  assert.ok(result.gates.find((entry) => entry.id === "human_listening_review").issues.some((entry) => entry.code === "incomplete_human_attestation"));
});

test("duplicate corpus declarations are rejected instead of silently overwriting", () => {
  const evidence = structuredClone(fixture);
  evidence.scope = "release_candidate";
  evidence.corpora.push(structuredClone(evidence.corpora[0]));
  const result = evaluateReleaseGates(manifest, evidence);
  assert.equal(result.status, "blocked");
  assert.ok(result.documentIssues.some((entry) => entry.code === "duplicate_corpus_id"));
});
