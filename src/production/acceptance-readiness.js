import { pendingResultFeedback } from "../intelligence/project-context-assembler.js";

function sequenceKeyForDecision(context, decision) {
  return context.results.find((result) => result.id === decision.resultId)?.data?.sequence?.key ?? null;
}

/** Pending `changes_requested` feedback attached to any render of the same sequence as `result`. */
export function pendingFeedbackForResult(context, result) {
  const sequenceKey = result.data?.sequence?.key ?? null;
  if (!sequenceKey) return [];
  return pendingResultFeedback(context.decisions).filter((decision) =>
    sequenceKeyForDecision(context, decision) === sequenceKey
  );
}

/**
 * The feedback an acceptance resolves: every pending item of the same sequence, plus pending items of
 * another sequence that the caller names. Feedback given on a pilot or an earlier cut is often carried
 * out in the film that is finally accepted; only an explicit name resolves it, never a default.
 */
export function acceptanceResolutionIds(context, result, requestedIds = []) {
  const sameSequence = pendingFeedbackForResult(context, result).map((decision) => decision.id);
  const pending = new Set(pendingResultFeedback(context.decisions).map((decision) => decision.id));
  const unsupported = requestedIds.filter((id) => !pending.has(id));
  if (unsupported.length) {
    throw new Error(
      "Acceptance can only resolve pending changes_requested feedback of this project: " + unsupported.join(", ")
    );
  }
  return [...sameSequence, ...requestedIds.filter((id) => !sameSequence.includes(id))];
}

/** The resolved feedback that belongs to another sequence than `result`, so callers can say so. */
export function carriedFeedbackIds(context, result, resolutionIds) {
  const sameSequence = new Set(pendingFeedbackForResult(context, result).map((decision) => decision.id));
  return resolutionIds.filter((id) => !sameSequence.has(id));
}
