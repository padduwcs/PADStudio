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
 * The feedback an acceptance resolves: every pending item of the same sequence. A caller may name the
 * ones it expects; naming a decision from another sequence is an error.
 */
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
