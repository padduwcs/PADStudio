export function buildAnimationContext(context) {
  const artifacts = context.artifacts.filter((artifact) => artifact.type === "animation.composition");
  const latestByKey = new Map();
  for (const artifact of artifacts) {
    const latest = latestByKey.get(artifact.key);
    if (!latest || artifact.revision > latest.revision) latestByKey.set(artifact.key, artifact);
  }
  const activeIds = new Set(context.intelligence?.activeArtifacts?.filter((artifact) => artifact.type === "animation.composition").map((artifact) => artifact.id) ?? []);
  const validations = context.results.filter((result) => result.type === "animation.validation");
  const renders = context.results.filter((result) => result.type === "animation.render");
  const compositions = artifacts.map((artifact) => {
    const sourceResultId = artifact.data.sourceResultId;
    const approval = context.decisions.filter((decision) => decision.kind === "project_decision" &&
      decision.category === "animation_code_execution" && decision.target?.kind === "result" &&
      decision.target.id === sourceResultId && decision.decidedBy === "user").at(-1) ?? null;
    const exactValidations = validations.filter((result) => result.data?.sourceResultId === sourceResultId);
    const exactRenders = renders.filter((result) => result.data?.composition?.id === artifact.id && result.data?.composition?.revision === artifact.revision);
    return {
      artifactId: artifact.id, key: artifact.key, revision: artifact.revision, name: artifact.name,
      summary: artifact.summary, status: artifact.status,
      role: activeIds.has(artifact.id) ? "current" : latestByKey.get(artifact.key)?.id === artifact.id && artifact.status === "draft" ? "candidate" : "history",
      runtime: artifact.data.runtime, sourceResultId, entry: artifact.data.entry,
      format: artifact.data.format, durationSeconds: artifact.data.durationSeconds,
      intent: artifact.data.intent, style: artifact.data.style, reviewCriteria: artifact.data.reviewCriteria,
      validation: exactValidations.at(-1) ?? null,
      executionApproval: approval ? { id: approval.id, outcome: approval.outcome, reason: approval.reason, createdAt: approval.createdAt } : null,
      renders: exactRenders.map((result) => ({ resultId: result.id, createdAt: result.createdAt,
        files: result.files, verification: result.verification, video: result.data.video,
        hasAudio: result.data.hasAudio, reviews: context.reviews.filter((review) => review.target?.kind === "result" && review.target.id === result.id) })),
    };
  });
  return {
    version: "1.0", compositions,
    activeCompositions: compositions.filter((composition) => composition.role === "current"),
    sourcePackages: context.results.filter((result) => result.type === "animation.source-package"),
    note: "Code animation is an optional project-native production branch; its render Results can be used directly by video.sequence.",
  };
}
