import { pendingResultFeedback } from "../intelligence/project-context-assembler.js";
import { matchingDeliveryProfiles } from "./delivery-readiness.js";

function sequenceKeyForDecision(context, decision) {
  return context.results.find((result) => result.id === decision.resultId)?.data?.sequence?.key ?? null;
}

export function pendingFeedbackForResult(context, result) {
  const sequenceKey = result.data?.sequence?.key ?? null;
  if (!sequenceKey) return [];
  return pendingResultFeedback(context.decisions).filter((decision) =>
    sequenceKeyForDecision(context, decision) === sequenceKey
  );
}

export function acceptanceResolutionIds(context, result, requestedIds = []) {
  const applicable = pendingFeedbackForResult(context, result).map((decision) => decision.id);
  const unsupported = requestedIds.filter((id) => !applicable.includes(id));
  if (unsupported.length) {
    throw new Error(
      "Acceptance can only resolve pending feedback for the same sequence: " + unsupported.join(", ")
    );
  }
  return applicable;
}

export function deliveryProfilesForAcceptance(media, result, policyCatalog) {
  const profiles = policyCatalog.listOutputProfiles().map(({ id }) => policyCatalog.readOutputProfile(id));
  return matchingDeliveryProfiles(media, profiles, {
    expectedDurationSeconds: Number.isFinite(Number(result.data?.durationSeconds))
      ? Number(result.data.durationSeconds)
      : null
  });
}
