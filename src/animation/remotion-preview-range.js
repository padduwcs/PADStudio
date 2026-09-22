export async function resolveRemotionPreviewRange(store, projectId, compositionReference, startSeconds, endSeconds) {
  if (!compositionReference || typeof compositionReference !== "string") {
    throw new Error("A composition artifact ID or key is required.");
  }
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error("Preview range must have nonnegative start and an end after the start.");
  }
  if (endSeconds - startSeconds > 30) throw new Error("Preview range may be at most 30 seconds.");

  const [artifacts, results, context] = await Promise.all([
    store.readArtifacts(projectId),
    store.readResults(projectId),
    store.readContext(projectId),
  ]);
  const activeRevisions = new Set(context.intelligence.activeArtifacts
    .map((artifact) => `${artifact.id}:${artifact.revision}`));
  const candidates = artifacts.filter((artifact) => artifact.type === "animation.composition"
    && activeRevisions.has(`${artifact.id}:${artifact.revision}`)
    && (artifact.id === compositionReference || artifact.key === compositionReference));
  if (candidates.length !== 1) {
    throw new Error(candidates.length
      ? `Composition reference is ambiguous: ${compositionReference}. Use the exact artifact ID.`
      : `No active animation composition matches: ${compositionReference}.`);
  }
  const artifact = candidates[0];
  if (artifact.data?.runtime !== "remotion") {
    throw new Error(`Preview-range shortcut supports Remotion compositions; ${artifact.id} uses ${artifact.data?.runtime ?? "an unknown runtime"}.`);
  }
  if (endSeconds > artifact.data.durationSeconds) {
    throw new Error(`Preview end exceeds the ${artifact.data.durationSeconds}s composition duration.`);
  }

  const preflight = results.filter((result) => result.type === "animation.preflight"
    && result.data?.status === "passed"
    && result.data?.runtime === "remotion"
    && result.data?.composition?.id === artifact.id
    && result.data?.composition?.revision === artifact.revision
    && result.data?.sourceResultId === artifact.data.sourceResultId
    && result.data?.propsResultId === (artifact.data.propsResultId ?? null))
    .at(-1);
  if (!preflight) {
    throw new Error("The active composition has no passed exact Remotion preflight. Validate and preflight it first.");
  }

  return {
    capability: "animation.preview",
    tool: "remotion-preview",
    purpose: `Review ${startSeconds}s-${endSeconds}s with motion and composition audio`,
    inputs: {
      artifactId: artifact.id,
      artifactRevision: artifact.revision,
      validationResultId: preflight.data.validationResultId,
      preflightResultId: preflight.id,
      range: { startSeconds, endSeconds },
    },
  };
}
