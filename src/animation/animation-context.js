import {
  ANIMATION_CHOREOGRAPHY_TYPE,
  choreographyReviewPoints,
  normalizeVisualChoreography,
  selectChoreographyPreviewFrames,
} from "./visual-choreography.js";

export function buildAnimationContext(context) {
  const choreographyArtifacts = context.artifacts.filter((artifact) => artifact.type === ANIMATION_CHOREOGRAPHY_TYPE);
  const artifacts = context.artifacts.filter((artifact) => artifact.type === "animation.composition");
  const latestByKey = new Map();
  for (const artifact of artifacts) {
    const latest = latestByKey.get(artifact.key);
    if (!latest || artifact.revision > latest.revision) latestByKey.set(artifact.key, artifact);
  }
  const activeIds = new Set(context.intelligence?.activeArtifacts?.filter((artifact) => artifact.type === "animation.composition").map((artifact) => artifact.id) ?? []);
  const activeChoreographyIds = new Set(context.intelligence?.activeArtifacts
    ?.filter((artifact) => artifact.type === ANIMATION_CHOREOGRAPHY_TYPE).map((artifact) => artifact.id) ?? []);
  const latestChoreographyByKey = new Map();
  for (const artifact of choreographyArtifacts) {
    const latest = latestChoreographyByKey.get(artifact.key);
    if (!latest || artifact.revision > latest.revision) latestChoreographyByKey.set(artifact.key, artifact);
  }
  const choreographies = choreographyArtifacts.map((artifact) => {
    const data = normalizeVisualChoreography(artifact.data);
    return {
      artifactId: artifact.id,
      key: artifact.key,
      revision: artifact.revision,
      name: artifact.name,
      summary: artifact.summary,
      status: artifact.status,
      role: activeChoreographyIds.has(artifact.id) ? "current" : latestChoreographyByKey.get(artifact.key)?.id === artifact.id && artifact.status === "draft" ? "candidate" : "history",
      purpose: data.purpose,
      durationSeconds: data.durationSeconds,
      fps: data.fps,
      objectCount: data.objects.length,
      semanticBeatCount: data.beats.filter((beat) => beat.kind === "semantic").length,
      beats: data.beats,
      reviewCriteria: data.reviewCriteria,
      reviewPoints: choreographyReviewPoints(data),
      recommendedPreviewFrames: selectChoreographyPreviewFrames(data),
    };
  });
  const choreographyById = new Map(choreographies.map((item) => [item.artifactId, item]));
  const validations = context.results.filter((result) => result.type === "animation.validation");
  const preflights = context.results.filter((result) => result.type === "animation.preflight");
  const previews = context.results.filter((result) => result.type === "animation.preview");
  const renders = context.results.filter((result) => result.type === "animation.render");
  const compositions = artifacts.map((artifact) => {
    const sourceResultId = artifact.data.sourceResultId;
    const exactValidations = validations.filter((result) => result.data?.sourceResultId === sourceResultId);
    const exactPreflights = preflights.filter((result) => result.data?.composition?.id === artifact.id && result.data?.composition?.revision === artifact.revision);
    const exactPreviews = previews.filter((result) => result.data?.composition?.id === artifact.id && result.data?.composition?.revision === artifact.revision);
    const exactRenders = renders.filter((result) => result.data?.composition?.id === artifact.id && result.data?.composition?.revision === artifact.revision);
    return {
      artifactId: artifact.id, key: artifact.key, revision: artifact.revision, name: artifact.name,
      summary: artifact.summary, status: artifact.status,
      role: activeIds.has(artifact.id) ? "current" : latestByKey.get(artifact.key)?.id === artifact.id && artifact.status === "draft" ? "candidate" : "history",
      runtime: artifact.data.runtime, sourceResultId, entry: artifact.data.entry,
      propsResultId: artifact.data.propsResultId ?? null,
      choreographyArtifactId: artifact.data.choreographyArtifactId ?? null,
      choreography: artifact.data.choreographyArtifactId ? choreographyById.get(artifact.data.choreographyArtifactId) ?? null : null,
      dependencyReasons: artifact.data.choreographyArtifactId && !activeChoreographyIds.has(artifact.data.choreographyArtifactId)
        ? [{ kind: "artifact", id: artifact.data.choreographyArtifactId, reason: "choreography_not_active_revision" }]
        : [],
      format: artifact.data.format, durationSeconds: artifact.data.durationSeconds,
      timing: artifact.data.timing ?? { mode: artifact.data.runtime === "manim" ? "measured" : "exact" },
      intent: artifact.data.intent, style: artifact.data.style, reviewCriteria: artifact.data.reviewCriteria,
      validation: exactValidations.at(-1) ?? null,
      preflights: exactPreflights.map((result) => ({ resultId: result.id, createdAt: result.createdAt, status: result.data.status,
        scope: result.data.scope, runtimeFingerprint: result.data.runtimeFingerprint, limitations: result.data.limitations,
        findings: result.data.findings ?? null, snapshotCount: result.data.snapshotCount ?? 0, files: result.files })),
      previews: exactPreviews.map((result) => ({ resultId: result.id, createdAt: result.createdAt, frames: result.data.frames,
        range: result.data.range, clip: result.data.clip, motion: result.data.motion ?? null,
        choreographyArtifactId: result.data.choreographyArtifactId ?? null,
        frameSelection: result.data.frameSelection ?? "explicit", files: result.files })),
      renders: exactRenders.map((result) => ({ resultId: result.id, createdAt: result.createdAt,
        files: result.files, verification: result.verification, durationSeconds: result.data.durationSeconds,
        timing: result.data.timing ?? null, video: result.data.video,
        hasAudio: result.data.hasAudio, reviews: context.reviews.filter((review) => review.target?.kind === "result" && review.target.id === result.id) })),
    };
  });
  return {
    version: "1.1", compositions, choreographies,
    activeCompositions: compositions.filter((composition) => composition.role === "current"),
    activeChoreographies: choreographies.filter((choreography) => choreography.role === "current"),
    sourcePackages: context.results.filter((result) => result.type === "animation.source-package"),
    propsPackages: context.results.filter((result) => result.type === "animation.props"),
    note: "Code animation is an optional project-native production branch. Narration-led or stepwise work can bind an exact visual choreography before source authoring; render Results can be used directly by video.sequence.",
  };
}
