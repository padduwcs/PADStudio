import { buildProductionContext } from "../production/production-context.js";
import { AnalysisReader } from "../analysis/analysis-reader.js";

function activity(kind, id, value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return { kind, id, at: value };
}

function checkpointFreshness(context, analysis = null) {
  const activities = [
    ...context.resources.map((item) => activity("resource", item.id, item.createdAt)),
    ...context.results.map((item) => activity("result", item.id, item.createdAt)),
    ...context.runs.map((item) => activity("run", item.id, item.finishedAt ?? item.startedAt)),
    ...context.authorizations.map((item) => activity("authorization", item.id, item.finishedAt ?? item.approvedAt)),
    ...context.decisions.map((item) => activity("decision", item.id, item.createdAt)),
    ...context.artifacts.map((item) => activity("artifact", item.id, item.createdAt)),
    ...context.workflows.map((item) => activity("workflow", `${item.id}:r${item.revision}`, item.createdAt)),
    ...context.reviews.map((item) => activity("review", item.id, item.createdAt)),
    ...(analysis?.jobs ?? []).map((item) => activity("analysis_job", item.id, item.updatedAt)),
  ].filter(Boolean).sort((left, right) => left.at.localeCompare(right.at));
  const latestActivityAt = activities.at(-1)?.at ?? null;
  if (!context.checkpoint) {
    return {
      status: "missing",
      checkpointUpdatedAt: null,
      latestActivityAt,
      newerActivityCount: activities.length,
      newerActivityKinds: [...new Set(activities.map((item) => item.kind))],
    };
  }
  const newer = activities.filter((item) => item.at > context.checkpoint.updatedAt);
  return {
    status: newer.length ? "stale" : "current",
    checkpointUpdatedAt: context.checkpoint.updatedAt,
    latestActivityAt,
    newerActivityCount: newer.length,
    newerActivityKinds: [...new Set(newer.map((item) => item.kind))],
  };
}

function buildResumeView(context, production, freshness) {
  const current = context.intelligence.currentWorkItems;
  const activeWorkflow = context.intelligence.activeWorkflow;
  const checkpointMatches = Boolean(
    activeWorkflow &&
    context.checkpoint?.activeWorkflowId &&
    context.checkpoint.activeWorkflowId === activeWorkflow.id
  );
  const checkpointItem = checkpointMatches
    ? activeWorkflow.items.find((item) => item.id === context.checkpoint?.activeWorkItemId)
    : null;
  return {
    affectedWorkItems: production.affectedWorkItems,
    checkpoint: context.checkpoint?.resume ?? null,
    checkpointFreshness: freshness,
    activeWorkflowId: activeWorkflow?.id ?? null,
    activeWorkflowRevision: activeWorkflow?.revision ?? null,
    activeWorkItemId: checkpointItem?.id ?? null,
    attention: current.map((item) => ({
      id: item.id,
      status: item.status,
      purpose: item.purpose,
      blockedBy: item.dependsOn.filter((dependencyId) => {
        const dependency = activeWorkflow?.items.find(
          (candidate) => candidate.id === dependencyId
        );
        return dependency?.status !== "completed";
      })
    })),
    pendingApprovalIds: context.intelligence.pendingApprovals.map((item) => item.id)
  };
}

function summarizeProduction(production, runRecovery) {
  return {
    activeSequences: production.sequences.filter((sequence) => sequence.active).map((sequence) => ({
      artifactId: sequence.artifactId,
      key: sequence.key,
      revision: sequence.revision,
      name: sequence.name,
      status: sequence.status,
      durationSeconds: sequence.durationSeconds,
      reasons: sequence.reasons,
      blockedSegments: sequence.segments
        .filter((segment) => segment.blockers.length || segment.reasons.length)
        .map((segment) => ({
          id: segment.id,
          title: segment.title,
          blockers: segment.blockers,
          reasons: segment.reasons
        })),
      latestRenderId: sequence.renders.at(-1)?.resultId ?? null
    })),
    affectedWorkItems: production.affectedWorkItems,
    pendingFinalizations: runRecovery?.pendingFinalizations ?? [],
    note: production.note
  };
}

export class ProjectContextAssembler {
  constructor({ projectStore, toolRegistry = null, analysisReader = null, capabilityCacheTtlMs = 5_000, now = Date.now }) {
    this.projectStore = projectStore;
    this.toolRegistry = toolRegistry;
    this.analysisReader = analysisReader ?? new AnalysisReader({
      rootDir: projectStore.rootDir,
      projectStore
    });
    this.capabilityCacheTtlMs = capabilityCacheTtlMs;
    this.now = now;
    this.capabilitiesCache = null;
  }

  async build(projectId) {
    const [context, capabilities, analysis] = await Promise.all([
      this.projectStore.readContext(projectId),
      this.#capabilities(),
      this.analysisReader.summary(projectId)
    ]);
    const production = buildProductionContext({ ...context, analysis });
    const freshness = checkpointFreshness(context, analysis);
    return {
      ...context,
      capabilities,
      analysis,
      production,
      checkpointFreshness: freshness,
      resumeView: buildResumeView(context, production, freshness)
    };
  }

  async buildSummary(projectId) {
    const [context, capabilities, analysis] = await Promise.all([
      this.projectStore.readContext(projectId),
      this.#capabilities(),
      this.analysisReader.summary(projectId)
    ]);
    const production = buildProductionContext({ ...context, analysis });
    const freshness = checkpointFreshness(context, analysis);
    return {
      version: "1.0",
      view: "summary",
      project: context.project,
      checkpoint: context.checkpoint,
      activeArtifacts: context.intelligence.activeArtifacts,
      activeWorkflow: context.intelligence.activeWorkflow,
      checkpointFreshness: freshness,
      resumeView: buildResumeView(context, production, freshness),
      production: summarizeProduction(production, context.runRecovery),
      capabilities,
      analysis
    };
  }

  async #capabilities() {
    if (!this.toolRegistry) return { capabilities: [] };
    const checkedAt = this.now();
    if (
      !this.capabilitiesCache ||
      checkedAt - this.capabilitiesCache.checkedAt >= this.capabilityCacheTtlMs
    ) {
      const promise = this.toolRegistry.describeCapabilities();
      this.capabilitiesCache = { checkedAt, promise };
      try {
        return await promise;
      } catch (error) {
        if (this.capabilitiesCache?.promise === promise) this.capabilitiesCache = null;
        throw error;
      }
    }
    return this.capabilitiesCache.promise;
  }
}
