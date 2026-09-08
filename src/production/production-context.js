import { SEQUENCE_TYPE, compareSequences, sequenceReferences } from "./video-sequence.js";

export function buildProductionContext(context) {
  const artifacts = new Map(context.artifacts.map((a) => [a.id, a]));
  const results = new Map(context.results.map((r) => [r.id, r]));
  const resources = new Map(context.resources.map((r) => [r.id, r]));
  const active = new Map(context.intelligence.activeArtifacts.map((a) => [a.key, a]));
  const memo = new Map();
  function mediaReasons(source) {
    if (!source) return [];
    if (source.kind === "resource") {
      const resource = resources.get(source.id);
      const item = resource?.kind === "file" ? resource.items[0] :
        resource?.items.find((candidate) => candidate.relativePath === source.itemPath);
      if (!resource || resource.available === false || !item || item.available === false) {
        return [{ ...source, reason: "missing_media" }];
      }
    } else {
      const file = results.get(source.id)?.files.find((candidate) => candidate.id === source.file);
      if (!file || file.available === false) return [{ ...source, reason: "missing_media" }];
    }
    return [];
  }
  const mediaDependencies = (segment) => [segment.visual?.source, segment.narration?.source].filter(Boolean);
  function reasons(ref, trail = new Set()) {
    const key = ref.kind + ":" + ref.id;
    if (memo.has(key)) return memo.get(key);
    if (trail.has(key)) return [{ ...ref, reason: "dependency_cycle" }];
    const nextTrail = new Set([...trail, key]);
    let found = [];
    if (ref.kind === "artifact") {
      const a = artifacts.get(ref.id);
      if (!a) return [{ ...ref, reason: "missing" }];
      if (active.get(a.key)?.id !== a.id) found.push({ ...ref, reason: "not_active_revision", replacementId: active.get(a.key)?.id ?? null });
      const dependencies = [...a.references, ...(a.type === SEQUENCE_TYPE ? sequenceReferences(a.data) : [])];
      found.push(...dependencies.flatMap((r) => reasons(r, nextTrail)));
      if (a.type === SEQUENCE_TYPE) found.push(...a.data.segments.flatMap((s) => mediaDependencies(s).flatMap(mediaReasons)));
    } else if (ref.kind === "result") {
      const r = results.get(ref.id);
      if (!r) return [{ ...ref, reason: "missing" }];
      if (r.files.some((file) => file.available === false)) found.push({ ...ref, reason: "missing_media" });
      found.push(...(r.inputArtifacts ?? []).flatMap((id) => reasons({ kind: "artifact", id }, nextTrail)));
      found.push(...r.inputResults.flatMap((id) => reasons({ kind: "result", id }, nextTrail)));
      found.push(...r.inputResources.flatMap((id) => reasons({ kind: "resource", id }, nextTrail)));
    } else if (ref.kind === "resource") {
      const r = resources.get(ref.id);
      if (!r || r.available === false) found.push({ ...ref, reason: "missing_media" });
    }
    found = [...new Map(found.map((r) => [r.kind + ":" + r.id + ":" + (r.file ?? r.itemPath ?? "") + ":" + r.reason, r])).values()];
    memo.set(key, found);
    return found;
  }
  const artifactStates = context.artifacts.map((a) => ({ artifactId: a.id, reasons: reasons({ kind: "artifact", id: a.id }) }));
  const resultStates = context.results.map((r) => ({ resultId: r.id, reasons: reasons({ kind: "result", id: r.id }) }));
  const sequences = context.artifacts.filter((a) => a.type === SEQUENCE_TYPE).map((a) => {
    const previous = artifacts.get(a.supersedes);
    const renders = context.results.filter((r) => r.type === "video.sequence-render" && r.data.sequence?.artifactId === a.id);
    return {
      artifactId: a.id, key: a.key, revision: a.revision, name: a.name, status: a.status,
      active: active.get(a.key)?.id === a.id, changeReason: a.data.changeReason, format: a.data.format,
      references: a.references,
      durationSeconds: a.data.segments.reduce((sum, s) => sum + s.durationSeconds, 0),
      segments: a.data.segments.map((s) => ({ ...s,
        reasons: [...[...a.references, ...sequenceReferences({ segments: [s] })].flatMap((ref) => reasons(ref)),
          ...mediaDependencies(s).flatMap(mediaReasons)],
        blockers: [
        ...(!s.visual ? ["missing_visual"] : mediaReasons(s.visual.source).length ? ["missing_visual_media"] : []),
        ...(s.narration && (!s.narration.source || mediaReasons(s.narration.source).length) ? ["missing_narration_audio"] : []),
      ] })),
      changes: { ...compareSequences(previous?.type === SEQUENCE_TYPE ? previous.data : null, a.data),
        globalReferencesChanged: Boolean(previous && JSON.stringify(previous.references) !== JSON.stringify(a.references)),
      },
      reasons: reasons({ kind: "artifact", id: a.id }),
      renders: renders.map((r) => ({
        resultId: r.id, createdAt: r.createdAt, files: r.files,
        verification: r.verification,
        decisions: context.decisions.filter((d) => d.resultId === r.id),
        reviews: context.reviews.filter((review) => review.target.kind === "result" && review.target.id === r.id),
        reusedSegmentIds: (r.data.segments ?? []).filter((s) => s.reusedFrom).map((s) => s.id),
      })),
    };
  });
  return {
    sequences, artifactStates, resultStates,
    affectedWorkItems: (context.intelligence.activeWorkflow?.items ?? []).map((item) => ({
      id: item.id, reasons: [...item.inputReferences, ...item.outputReferences].flatMap((ref) => reasons(ref)),
    })).filter((item) => item.reasons.length),
    note: "Dependency changes require review; no artifact, approval, workflow or media is automatically rewritten.",
  };
}
