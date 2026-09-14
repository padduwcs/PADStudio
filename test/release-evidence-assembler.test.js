import test from "node:test";
import assert from "node:assert/strict";
import { assembleReleaseEvidence } from "../src/release/release-evidence-assembler.js";

test("release evidence assembler replaces holdout and human gates from durable records", () => {
  const review = { id: "review-1", createdAt: "2026-09-14T10:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" }, exactResult: { sha256: "a".repeat(64), artifactId: "sequence", artifactRevision: 2 }, attestation: { listenedFull: true, device: "headphones", context: "final review" } };
  const holdoutBundle = { corpus: { id: "holdout", classification: "holdout" }, measurement: { gateId: "independent_gold_holdout", outcome: "passed" } };
  const result = assembleReleaseEvidence({ baseEvidence: { version: "1.0", scope: "test_fixture", corpora: [], measurements: [{ gateId: "human_viewing_review", outcome: "failed" }, { gateId: "scene_precision_recall", outcome: "passed" }] }, holdoutBundle, reviews: [review], resultId: "result-1", verifiedResult: { id: "result-1", sha256: "a".repeat(64) } });
  assert.equal(result.scope, "release_candidate");
  assert.equal(result.corpora[0].id, "holdout");
  assert.equal(result.measurements.filter((item) => item.gateId === "human_viewing_review").length, 1);
  assert.equal(result.measurements.find((item) => item.gateId === "human_listening_review").resultSha256, "a".repeat(64));
  assert.equal(result.measurements.some((item) => item.gateId === "scene_precision_recall"), true);
});

test("release evidence assembler rejects an attestation after exact bytes drift", () => {
  const review = { id: "review-1", createdAt: "2026-09-14T10:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" }, exactResult: { sha256: "a".repeat(64), artifactId: "sequence", artifactRevision: 2 }, attestation: { listenedFull: true, device: "headphones", context: "final review" } };
  assert.throws(() => assembleReleaseEvidence({ baseEvidence: { corpora: [], measurements: [] }, holdoutBundle: { corpus: { id: "holdout" }, measurement: { gateId: "independent_gold_holdout" } }, reviews: [review], verifiedResult: { id: "result-1", sha256: "b".repeat(64) } }), /reverified/);
});
