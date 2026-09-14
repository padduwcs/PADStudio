import { releaseMeasurementsFromHumanReview } from "../intelligence/human-attestation.js";

export function assembleReleaseEvidence({ baseEvidence, holdoutBundle, reviews, resultId = null, verifiedResult }) {
  if (!baseEvidence || !Array.isArray(baseEvidence.corpora) || !Array.isArray(baseEvidence.measurements)) throw new Error("Base release evidence must contain corpora and measurements arrays.");
  if (!holdoutBundle?.corpus || !holdoutBundle?.measurement) throw new Error("A locked holdout bundle is required.");
  const candidates = (reviews ?? []).filter((review) => releaseMeasurementsFromHumanReview(review).length > 0 && (!resultId || review.target?.id === resultId));
  const review = candidates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!review) throw new Error("No matching full human attestation was found.");
  if (!verifiedResult || verifiedResult.id !== review.target.id || verifiedResult.sha256 !== review.exactResult.sha256) {
    throw new Error("Human attestation must be reverified against the exact current Result bytes.");
  }
  const replacements = [holdoutBundle.measurement, ...releaseMeasurementsFromHumanReview(review)];
  const ids = new Set(["independent_gold_holdout", "human_viewing_review", "human_listening_review"]);
  return {
    ...baseEvidence, version: "1.0", scope: "release_candidate",
    corpora: [...baseEvidence.corpora.filter((item) => item.id !== holdoutBundle.corpus.id), holdoutBundle.corpus],
    measurements: [...baseEvidence.measurements.filter((item) => !ids.has(item.gateId)), ...replacements]
  };
}
