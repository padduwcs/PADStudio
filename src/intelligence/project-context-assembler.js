import { buildProductionContext } from "../production/production-context.js";
import { AnalysisReader } from "../analysis/analysis-reader.js";
import { buildProjectHealth } from "../operations/project-health.js";

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
      status: "missing", checkpointUpdatedAt: null, latestActivityAt,
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

export function pendingResultFeedback(decisions) {
  const resolved = new Set(decisions.flatMap((decision) => decision.resolvesDecisionIds ?? []));
  return decisions.filter((decision) =>
    decision.kind !== "project_decision" &&
    decision.outcome === "changes_requested" &&
    !resolved.has(decision.id)
  );
}

function buildResumeView(context, production, freshness, pendingFeedback) {
  const current = context.intelligence.currentWorkItems;
  const activeWorkflow = context.intelligence.activeWorkflow;
  const checkpointMatches = Boolean(
    activeWorkflow && context.checkpoint?.activeWorkflowId === activeWorkflow.id
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
      id: item.id, status: item.status, purpose: item.purpose,
      blockedBy: item.dependsOn.filter((dependencyId) => {
        const dependency = activeWorkflow?.items.find((candidate) => candidate.id === dependencyId);
        return dependency?.status !== "completed";
      })
    })),
    pendingApprovalIds: context.intelligence.pendingApprovals.map((item) => item.id),
    pendingFeedbackIds: pendingFeedback.map((item) => item.id),
    pendingFeedbackCount: pendingFeedback.length
  };
}

function summarizeProduction(production, runRecovery) {
  return {
    activeSequences: production.sequences.filter((sequence) => sequence.active).map((sequence) => ({
      artifactId: sequence.artifactId, key: sequence.key, revision: sequence.revision,
      name: sequence.name, status: sequence.status, durationSeconds: sequence.durationSeconds,
      reasons: sequence.reasons,
      blockedSegments: sequence.segments
        .filter((segment) => segment.blockers.length || segment.reasons.length)
        .map((segment) => ({ id: segment.id, title: segment.title, blockers: segment.blockers, reasons: segment.reasons })),
      latestRenderId: sequence.renders.at(-1)?.resultId ?? null,
      renders: sequence.renders.map((render) => ({
        resultId: render.resultId,
        createdAt: render.createdAt,
        verificationStatus: render.verification?.status ?? null,
        decisionOutcomes: render.decisions.map((decision) => decision.outcome)
      }))
    })),
    affectedWorkItems: production.affectedWorkItems,
    pendingFinalizations: runRecovery?.pendingFinalizations ?? [],
    note: production.note
  };
}

function compactArtifact(artifact) {
  return {
    id: artifact.id, key: artifact.key, revision: artifact.revision, supersedes: artifact.supersedes,
    type: artifact.type, name: artifact.name, summary: artifact.summary, status: artifact.status,
    references: artifact.references, createdAt: artifact.createdAt
  };
}

function compactWorkflow(workflow) {
  if (!workflow) return null;
  return {
    id: workflow.id, revision: workflow.revision, name: workflow.name,
    purpose: workflow.purpose, status: workflow.status, createdAt: workflow.createdAt,
    items: workflow.items.map((item) => ({
      id: item.id, title: item.title, purpose: item.purpose, status: item.status,
      dependsOn: item.dependsOn, expectedOutputs: item.expectedOutputs,
      outputReferences: item.outputReferences,
      reviewRequired: item.review?.required ?? false
    }))
  };
}

function compactCapabilities(value) {
  return {
    capabilities: (value.capabilities ?? []).map((capability) => ({
      id: capability.id,
      available: capability.available,
      tools: (capability.tools ?? []).map((tool) => ({
        name: tool.name, version: tool.version, provider: tool.provider,
        runtime: tool.runtime, executionMode: tool.executionMode,
        approvalRequired: tool.approvalRequired,
        estimatedCost: tool.cost?.estimated ?? null,
        availability: tool.availability?.status ?? "unknown"
      }))
    }))
  };
}

function compactAnalysis(value) {
  return {
    version: value.version, view: "summary", counts: value.counts, jobStates: value.jobStates,
    jobs: (value.jobs ?? []).map((job) => ({
      id: job.id, state: job.state, revision: job.revision,
      createdAt: job.createdAt, updatedAt: job.updatedAt
    })),
    sources: (value.sources ?? []).map((source) => ({
      sourceKey: source.sourceKey, source: source.source, versions: source.versions,
      freshness: source.freshness, verifiedAt: source.verifiedAt,
      operations: Object.fromEntries(Object.entries(source.operations ?? {}).map(([name, operation]) => [name, {
        id: operation.id, type: operation.type, createdAt: operation.createdAt,
        outcome: operation.outcome, counts: operation.counts,
        freshness: operation.freshness, verifiedAt: operation.verifiedAt,
        coverage: operation.coverage ? {
          startSeconds: operation.coverage.startSeconds,
          endSeconds: operation.coverage.endSeconds,
          mode: operation.coverage.mode
        } : null,
        warningCodes: (operation.warnings ?? []).map((warning) => warning.code)
      }])),
      resultSetCount: source.resultSets?.length ?? 0,
      assessments: source.assessments ?? []
    }))
  };
}

export class ProjectContextAssembler {
  constructor({ projectStore, toolRegistry = null, analysisReader = null, capabilityCacheTtlMs = 5_000, now = Date.now }) {
    this.projectStore = projectStore;
    this.toolRegistry = toolRegistry;
    this.analysisReader = analysisReader ?? new AnalysisReader({ rootDir: projectStore.rootDir, projectStore });
    this.capabilityCacheTtlMs = capabilityCacheTtlMs;
    this.now = now;
    this.capabilitiesCache = null;
  }

  async build(projectId) {
    const [context, capabilities, analysis] = await Promise.all([
      this.projectStore.readContext(projectId), this.#capabilities(), this.analysisReader.summary(projectId)
    ]);
    const production = buildProductionContext({ ...context, analysis });
    const freshness = checkpointFreshness(context, analysis);
    const pendingFeedback = pendingResultFeedback(context.decisions);
    const health = buildProjectHealth({
      context, production, checkpointFreshness: freshness, pendingFeedback
    });
    return {
      ...context, capabilities, analysis, production, pendingFeedback, health,
      checkpointFreshness: freshness,
      resumeView: buildResumeView(context, production, freshness, pendingFeedback)
    };
  }

  async buildSummary(projectId) {
    const [context, capabilities, analysis] = await Promise.all([
      this.projectStore.readContext(projectId), this.#capabilities(), this.analysisReader.summary(projectId)
    ]);
    const production = buildProductionContext({ ...context, analysis });
    const freshness = checkpointFreshness(context, analysis);
    const pendingFeedback = pendingResultFeedback(context.decisions);
    const health = buildProjectHealth({
      context, production, checkpointFreshness: freshness, pendingFeedback
    });
    return {
      version: "1.0", view: "summary", project: context.project, checkpoint: context.checkpoint,
      activeArtifacts: context.intelligence.activeArtifacts.map(compactArtifact),
      activeWorkflow: compactWorkflow(context.intelligence.activeWorkflow),
      checkpointFreshness: freshness,
      resumeView: buildResumeView(context, production, freshness, pendingFeedback),
      pendingFeedback,
      health,
      budget: context.budget,
      production: summarizeProduction(production, context.runRecovery),
      capabilities: compactCapabilities(capabilities),
      analysis: compactAnalysis(analysis)
    };
  }

  async #capabilities() {
    if (!this.toolRegistry) return { capabilities: [] };
    const checkedAt = this.now();
    if (!this.capabilitiesCache || checkedAt - this.capabilitiesCache.checkedAt >= this.capabilityCacheTtlMs) {
      const promise = this.toolRegistry.describeCapabilities();
      this.capabilitiesCache = { checkedAt, promise };
      try { return await promise; }
      catch (error) {
        if (this.capabilitiesCache?.promise === promise) this.capabilitiesCache = null;
        throw error;
      }
    }
    return this.capabilitiesCache.promise;
  }
}
