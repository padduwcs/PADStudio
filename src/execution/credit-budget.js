import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { withFileLock } from "../project/file-lock.js";
import { projectDirectory } from "../project/project-paths.js";
import { readExecutionAuthorizations } from "./execution-authorizations.js";

// A cap on the credits one project may spend with credit-priced providers (ElevenLabs). The dollar budget cannot do
// this: such a tool reports its price in provider credits, not dollars. The cap counts what each single-use
// authorization has spent or may be spending, so it holds even when an Agent authorizes many requests.

export class CreditBudgetError extends Error {
  constructor(message, code = "credit_budget_invalid") {
    super(message);
    this.name = "CreditBudgetError";
    this.code = code;
  }
}

const FILE = "credit-budget.json";
const FIELDS = ["version", "maxCredits", "updatedAt"];

function canonicalIso(value) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function normalize(value, { stored = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreditBudgetError("Credit budget must be an object.");
  const allowed = stored ? FIELDS : ["maxCredits"];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new CreditBudgetError(`Unsupported credit budget fields: ${unknown.join(", ")}.`);
  if (stored && (value.version !== "1.0" || !canonicalIso(value.updatedAt))) {
    throw new CreditBudgetError("Stored credit budget is invalid.");
  }
  if (!Number.isSafeInteger(value.maxCredits) || value.maxCredits < 0) {
    throw new CreditBudgetError("maxCredits must be a whole number of credits, zero or more.");
  }
  return { version: "1.0", maxCredits: value.maxCredits, ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}) };
}

const pathFor = (store, projectId) => join(projectDirectory(store.rootDir, projectId), FILE);
const lockDirectory = (store, projectId) => projectDirectory(store.rootDir, projectId);

export async function readCreditBudget(store, projectId) {
  await store.readProject(projectId);
  try {
    return normalize(await readJson(pathFor(store, projectId)), { stored: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function configureCreditBudget(store, projectId, value) {
  await store.readProject(projectId);
  const policy = { ...normalize(value), updatedAt: new Date().toISOString() };
  return withFileLock({
    projectDirectory: lockDirectory(store, projectId), name: "credit-budget",
    action: async () => { await writeJsonAtomic(pathFor(store, projectId), policy); return policy; }
  });
}

export async function clearCreditBudget(store, projectId) {
  await store.readProject(projectId);
  return withFileLock({
    projectDirectory: lockDirectory(store, projectId), name: "credit-budget",
    action: async () => { await rm(pathFor(store, projectId), { force: true }); return null; }
  });
}

/** Credits an authorization has used or may still be using. An approved but unused one counts for nothing yet. */
function committedCredits(record) {
  const estimate = record.currentEstimatedUsage?.amount ?? record.estimatedUsage?.amount ?? 0;
  if (record.status === "consumed") return record.actualUsage?.amount ?? estimate;
  if (record.status === "claimed" || record.status === "usage_unknown") return record.actualUsage?.amount ?? estimate;
  return 0;
}

export async function creditBudgetSnapshot(store, projectId) {
  const [policy, authorizations] = await Promise.all([readCreditBudget(store, projectId), readExecutionAuthorizations(store, projectId)]);
  const usedCredits = authorizations.reduce((sum, record) => sum + committedCredits(record), 0);
  const count = (status) => authorizations.filter((record) => record.status === status).length;
  return {
    version: "1.0",
    maxCredits: policy?.maxCredits ?? null,
    usedCredits,
    remainingCredits: policy ? Math.max(0, policy.maxCredits - usedCredits) : null,
    policy,
    authorizations: {
      approved: count("approved"), claimed: count("claimed"), consumed: count("consumed"),
      usageUnknown: count("usage_unknown"), released: count("released")
    }
  };
}

/** Throws when `credits` would take the project past its cap. Without a cap nothing is checked. */
export function assertCreditBudget(snapshot, credits) {
  if (snapshot.maxCredits === null) return;
  if (credits > snapshot.remainingCredits) {
    throw new CreditBudgetError(
      `Request needs about ${credits} credits but the project has ${snapshot.remainingCredits} of ${snapshot.maxCredits} left ` +
        `(${snapshot.usedCredits} used). Raise the cap with project:credits, or shorten the text.`,
      "credit_budget_exceeded"
    );
  }
}

/** Run `action` with the cap check and the authorization claim as one step, so concurrent requests cannot both pass. */
export function withCreditBudgetLock(store, projectId, action) {
  return withFileLock({ projectDirectory: lockDirectory(store, projectId), name: "credit-budget", action });
}
