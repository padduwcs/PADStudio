import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { withFileLock } from "../project/file-lock.js";
import { projectDirectory } from "../project/project-paths.js";
import { join } from "node:path";

export class ProjectBudgetError extends Error {
  constructor(message, code = "budget_invalid") { super(message); this.name = "ProjectBudgetError"; this.code = code; }
}

function canonicalIso(value) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function normalize(value, { stored = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectBudgetError("Budget policy must be an object.");
  const fields = stored
    ? ["version", "mode", "totalUsd", "reserveUsd", "singleActionApprovalUsd", "updatedAt"]
    : ["mode", "totalUsd", "reserveUsd", "singleActionApprovalUsd"];
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) throw new ProjectBudgetError(`Unsupported budget fields: ${unknown.join(", ")}.`);
  if (stored && value.version !== "1.0") throw new ProjectBudgetError("Stored budget version must be 1.0.");
  if (stored && !canonicalIso(value.updatedAt)) {
    throw new ProjectBudgetError("Stored budget updatedAt must be a canonical ISO timestamp.");
  }
  const mode = value.mode ?? "observe";
  if (!["observe", "cap"].includes(mode)) throw new ProjectBudgetError("Budget mode must be observe or cap.");
  for (const key of ["totalUsd", "reserveUsd", "singleActionApprovalUsd"]) if (!Number.isFinite(value[key]) || value[key] < 0) throw new ProjectBudgetError(`${key} must be a non-negative number.`);
  if (value.reserveUsd > value.totalUsd) throw new ProjectBudgetError("reserveUsd cannot exceed totalUsd.");
  return { version: "1.0", mode, totalUsd: value.totalUsd, reserveUsd: value.reserveUsd, singleActionApprovalUsd: value.singleActionApprovalUsd,
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}) };
}

function pathFor(store, projectId) { return join(projectDirectory(store.rootDir, projectId), "budget.json"); }

export async function configureProjectBudget(store, projectId, value) {
  await store.readProject(projectId); const policy = { ...normalize(value), updatedAt: new Date().toISOString() };
  return withFileLock({ projectDirectory: projectDirectory(store.rootDir, projectId), name: "budget", action: async () => { await writeJsonAtomic(pathFor(store, projectId), policy); return policy; } });
}

export async function readProjectBudget(store, projectId) {
  await store.readProject(projectId);
  try { return normalize(await readJson(pathFor(store, projectId)), { stored: true }); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function projectBudgetSnapshot(store, projectId) {
  const [policy, runs] = await Promise.all([readProjectBudget(store, projectId), store.readRuns(projectId)]);
  const spentUsd = runs.filter((run) => run.status === "completed").reduce((sum, run) => sum + (run.cost?.actual ?? run.cost?.estimated ?? 0), 0);
  const reservedUsd = runs.filter((run) => run.status === "in_progress").reduce((sum, run) => sum + (run.cost?.estimated ?? 0), 0);
  return { version: "1.0", policy, spentUsd, reservedUsd,
    remainingUsd: policy ? Math.max(0, policy.totalUsd - spentUsd - reservedUsd) : null,
    usableUsd: policy ? Math.max(0, policy.totalUsd - policy.reserveUsd - spentUsd - reservedUsd) : null };
}

export async function startBudgetedRun(store, projectId, runValue, { approved = false } = {}) {
  return withFileLock({ projectDirectory: projectDirectory(store.rootDir, projectId), name: "budget", action: async () => {
    const snapshot = await projectBudgetSnapshot(store, projectId);
    const estimate = runValue.estimatedCostUsd;
    if (!snapshot.policy || estimate === null || estimate === 0) return store.startRun(projectId, runValue);
    if (estimate > snapshot.policy.singleActionApprovalUsd && !approved) {
      throw new ProjectBudgetError(`Estimated cost $${estimate.toFixed(4)} requires exact approval.`, "budget_approval_required");
    }
    if (snapshot.policy.mode === "cap" && estimate > snapshot.usableUsd) {
      throw new ProjectBudgetError(`Estimated cost $${estimate.toFixed(4)} exceeds usable project budget $${snapshot.usableUsd.toFixed(4)}.`, "budget_exceeded");
    }
    return store.startRun(projectId, runValue);
  } });
}
