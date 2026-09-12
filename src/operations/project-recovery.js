import { withFileLock } from "../project/file-lock.js";
import { projectDirectory } from "../project/project-paths.js";

export async function planProjectRecovery(store, projectId) {
  const context = await store.readContext(projectId);
  const actions = (context.runRecovery?.pendingFinalizations ?? []).map((entry) => ({
    type: "recover_run_finalization",
    runId: entry.runId,
    resultIds: entry.resultIds,
    status: entry.recoverable ? "planned" : "blocked",
    safeToApply: entry.recoverable,
    reason: entry.recoverable
      ? "Durable Result/output and runCompletion are present."
      : "Run does not have exactly one complete durable Result/output."
  }));
  return {
    version: "1.0",
    projectId,
    mode: "plan",
    status: actions.some((action) => action.status === "blocked")
      ? "attention"
      : actions.length ? "planned" : "nothing_to_do",
    actions,
    summary: {
      total: actions.length,
      recoverable: actions.filter((action) => action.safeToApply).length,
      blocked: actions.filter((action) => !action.safeToApply).length
    }
  };
}

export async function recoverProject(store, projectId, { apply = false } = {}) {
  if (!apply) return planProjectRecovery(store, projectId);
  return withFileLock({
    projectDirectory: projectDirectory(store.rootDir, projectId),
    name: "project-recovery",
    action: async () => {
      const plan = await planProjectRecovery(store, projectId);
      const actions = [];
      for (const action of plan.actions) {
        if (!action.safeToApply) {
          actions.push({ ...action, status: "skipped" });
          continue;
        }
        try {
          const run = await store.recoverRunFinalization(projectId, action.runId);
          actions.push({
            ...action,
            status: "completed",
            outputs: run.outputs,
            finishedAt: run.finishedAt
          });
        } catch (error) {
          actions.push({ ...action, status: "failed", error: error.message });
        }
      }
      const failed = actions.filter((action) =>
        action.status === "failed" || action.status === "skipped"
      ).length;
      return {
        version: "1.0",
        projectId,
        mode: "apply",
        status: failed ? "partial" : actions.length ? "completed" : "nothing_to_do",
        actions,
        summary: {
          total: actions.length,
          completed: actions.filter((action) => action.status === "completed").length,
          failed: actions.filter((action) => action.status === "failed").length,
          skipped: actions.filter((action) => action.status === "skipped").length
        }
      };
    }
  });
}
