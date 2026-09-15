import test from "node:test";
import assert from "node:assert/strict";
import { assembleReleaseEvidence, selectLatestHumanAttestation } from "../src/release/release-evidence-assembler.js";
import { createHumanConfirmation } from "../src/project/human-confirmation.js";

test("release evidence assembler replaces holdout and human gates from durable records", () => {
  const review = { id: "review-1", createdAt: "2026-09-14T10:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" }, exactResult: { sha256: "a".repeat(64), artifactId: "sequence", artifactRevision: 2 }, attestation: { listenedFull: true, device: "headphones", context: "final review" }, confirmation: createHumanConfirmation("review_video", "result-1") };
  const holdoutBundle = { corpus: { id: "holdout", classification: "holdout" }, measurement: { gateId: "independent_gold_holdout", outcome: "passed", corpusId: "holdout" } };
  const result = assembleReleaseEvidence({ baseEvidence: { version: "1.0", scope: "test_fixture", corpora: [], measurements: [{ gateId: "human_viewing_review", outcome: "failed" }, { gateId: "scene_precision_recall", outcome: "passed" }] }, holdoutBundle, reviews: [review], resultId: "result-1", verifiedResult: { id: "result-1", sha256: "a".repeat(64) } });
  assert.equal(result.scope, "release_candidate");
  assert.equal(result.corpora[0].id, "holdout");
  assert.equal(result.measurements.filter((item) => item.gateId === "human_viewing_review").length, 1);
  assert.equal(result.measurements.find((item) => item.gateId === "human_listening_review").resultSha256, "a".repeat(64));
  assert.equal(result.measurements.some((item) => item.gateId === "scene_precision_recall"), true);
});

test("release evidence assembler rejects an attestation after exact bytes drift", () => {
  const review = { id: "review-1", createdAt: "2026-09-14T10:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" }, exactResult: { sha256: "a".repeat(64), artifactId: "sequence", artifactRevision: 2 }, attestation: { listenedFull: true, device: "headphones", context: "final review" }, confirmation: createHumanConfirmation("review_video", "result-1") };
  assert.throws(() => assembleReleaseEvidence({ baseEvidence: { corpora: [], measurements: [] }, holdoutBundle: { corpus: { id: "holdout" }, measurement: { gateId: "independent_gold_holdout", corpusId: "holdout" } }, reviews: [review], verifiedResult: { id: "result-1", sha256: "b".repeat(64) } }), /reverified/);
});

test("release evidence assembler rejects a holdout measurement bound to another corpus", () => {
  assert.throws(() => assembleReleaseEvidence({ baseEvidence: { corpora: [], measurements: [] }, holdoutBundle: {
    corpus: { id: "holdout-a" }, measurement: { gateId: "independent_gold_holdout", corpusId: "holdout-b" }
  }, reviews: [] }), /same corpus/);
});

test("release evidence selection ignores a newer ordinary human review", () => {
  const attestation = { id: "attestation", createdAt: "2026-09-14T10:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" }, exactResult: { sha256: "a".repeat(64) }, attestation: { listenedFull: true, device: "headphones", context: "final review" }, confirmation: createHumanConfirmation("review_video", "result-1") };
  const ordinary = { id: "ordinary", createdAt: "2026-09-14T11:00:00.000Z", perspective: "human", reviewer: "user", verdict: "passed", target: { kind: "result", id: "result-1" } };
  assert.equal(selectLatestHumanAttestation([attestation, ordinary], { resultId: "result-1" }).id, "attestation");
});
