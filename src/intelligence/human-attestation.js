import { assertOnlyFields, normalizeStringList, requireObject, requireText } from "./contracts.js";
import { validHumanConfirmation } from "../project/human-confirmation.js";

export function normalizeHumanAttestation(value) {
  requireObject(value, "review.attestation");
  assertOnlyFields(value, ["watchedFull", "listenedFull", "device", "context", "findings"], "review.attestation");
  if (value.watchedFull !== true) throw new Error("Human attestation requires watchedFull=true.");
  if (![true, "not_applicable"].includes(value.listenedFull)) throw new Error("listenedFull must be true or not_applicable.");
  return { version: "1.0", watchedFull: true, listenedFull: value.listenedFull,
    device: requireText(value.device, "review.attestation.device"),
    context: requireText(value.context, "review.attestation.context"),
    findings: normalizeStringList(value.findings, "review.attestation.findings") };
}

export function releaseMeasurementsFromHumanReview(review) {
  if (review?.perspective !== "human" || review?.reviewer !== "user" || !review.attestation || !review.exactResult ||
      !validHumanConfirmation(review.confirmation, "review_video", review.target?.id)) return [];
  const base = { outcome: ["passed", "passed_with_notes"].includes(review.verdict) ? "passed" : "failed",
    measuredAt: review.createdAt, method: "Full human review recorded in PADStudio Review Store.", evidenceRefs: [review.id],
    reviewer: { kind: "human", id: "project-user" }, resultId: review.target.id,
    resultSha256: review.exactResult.sha256, artifactId: review.exactResult.artifactId,
    artifactRevision: review.exactResult.artifactRevision };
  const measurements = [{ ...base, gateId: "human_viewing_review", attestation: { action: "viewed", completedEntireResult: true, device: review.attestation.device, context: review.attestation.context } }];
  if (review.attestation.listenedFull === true) measurements.push({ ...base, gateId: "human_listening_review", attestation: { action: "listened", completedEntireResult: true, device: review.attestation.device, context: review.attestation.context } });
  return measurements;
}
