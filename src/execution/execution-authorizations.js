import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";

export class ExecutionAuthorizationError extends Error {
  constructor(message, code = "authorization_invalid") {
    super(message);
    this.name = "ExecutionAuthorizationError";
    this.code = code;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function executionRequestHash(request) {
  return createHash("sha256").update(JSON.stringify(stable({
    capability: request.capability,
    tool: request.tool,
    purpose: request.purpose,
    inputs: request.inputs
  }))).digest("hex");
}

function paths(store, projectId, authorizationId = null) {
  const directory = join(store.rootDir, projectId, "authorizations");
  return {
    directory,
    record: authorizationId ? join(directory, authorizationId + ".json") : null,
    claim: authorizationId ? join(directory, authorizationId + ".claim") : null
  };
}

function usage(value, label) {
  if (!value || value.unit !== "credits" || !Number.isFinite(value.amount) || value.amount < 0) {
    throw new ExecutionAuthorizationError(label + " is invalid.");
  }
  return { unit: "credits", amount: Math.ceil(value.amount), basis: typeof value.basis === "string" ? value.basis : null };
}

function validateRecord(record, projectId) {
  const validStatus = ["approved", "claimed", "consumed", "released", "usage_unknown"];
  if (!record || record.version !== "1.0" || record.projectId !== projectId ||
      typeof record.id !== "string" || !/^authorization-[a-z0-9-]+$/.test(record.id) ||
      record.kind !== "credit_use" || !validStatus.includes(record.status) ||
      typeof record.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(record.requestHash) ||
      !record.tool || typeof record.tool.name !== "string" || typeof record.tool.version !== "string" ||
      typeof record.tool.provider !== "string" ||
      record.approvedBy !== "user" || typeof record.reason !== "string" || !record.reason ||
      !Number.isSafeInteger(record.maxCredits) || record.maxCredits < 0 ||
      typeof record.approvedAt !== "string" || Number.isNaN(Date.parse(record.approvedAt)) ||
      (record.providerResponseReceivedAt !== undefined &&
        (typeof record.providerResponseReceivedAt !== "string" ||
          Number.isNaN(Date.parse(record.providerResponseReceivedAt))))) {
    throw new ExecutionAuthorizationError("Stored credit authorization is invalid.");
  }
  usage(record.estimatedUsage, "Stored estimated usage");
  if (record.actualUsage !== null && record.actualUsage !== undefined) usage(record.actualUsage, "Stored actual usage");
  return record;
}

export async function createExecutionAuthorization(store, projectId, value) {
  await store.readProject(projectId);
  const { requestHash, tool, estimatedUsage, approvedBy, maxCredits, reason } = value;
  if (typeof requestHash !== "string" || !/^[a-f0-9]{64}$/.test(requestHash)) {
    throw new ExecutionAuthorizationError("Request hash is invalid.");
  }
  if (approvedBy !== "user") {
    throw new ExecutionAuthorizationError("Credit use must be approved explicitly by the user.");
  }
  const estimate = usage(estimatedUsage, "Estimated usage");
  if (!Number.isSafeInteger(maxCredits) || maxCredits < estimate.amount) {
    throw new ExecutionAuthorizationError("Approved credit ceiling must be an integer at or above the current estimate.");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new ExecutionAuthorizationError("Approval reason is required.");
  }
  const id = "authorization-" + Date.now().toString(36) + "-" + randomUUID().slice(0, 8);
  const record = {
    version: "1.0", id, projectId, kind: "credit_use", status: "approved", requestHash, tool,
    estimatedUsage: estimate, maxCredits, approvedBy, reason: reason.trim(),
    approvedAt: new Date().toISOString(), claimedByRun: null, finishedAt: null,
    actualUsage: null, providerRequestId: null, traceId: null
  };
  const target = paths(store, projectId, id);
  await mkdir(target.directory, { recursive: true });
  await writeJsonAtomic(target.record, record);
  return record;
}

async function readRecord(store, projectId, authorizationId) {
  if (typeof authorizationId !== "string" || !/^authorization-[a-z0-9-]+$/.test(authorizationId)) {
    throw new ExecutionAuthorizationError("Authorization id is invalid.");
  }
  await store.readProject(projectId);
  try {
    return validateRecord(await readJson(paths(store, projectId, authorizationId).record), projectId);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ExecutionAuthorizationError("Credit authorization was not found.", "approval_required");
    }
    throw error;
  }
}

export async function claimExecutionAuthorization(store, projectId, authorizationId, binding) {
  const target = paths(store, projectId, authorizationId);
  await mkdir(target.directory, { recursive: true });
  try {
    await mkdir(target.claim);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ExecutionAuthorizationError("Credit authorization is already claimed.", "authorization_already_used");
    }
    throw error;
  }
  try {
    const record = await readRecord(store, projectId, authorizationId);
    if (record.status !== "approved") {
      throw new ExecutionAuthorizationError("Credit authorization is no longer available.", "authorization_already_used");
    }
    if (record.requestHash !== binding.requestHash ||
        record.tool?.name !== binding.tool.name ||
        record.tool?.version !== binding.tool.version) {
      throw new ExecutionAuthorizationError("Credit authorization does not match this exact request.", "authorization_mismatch");
    }
    const currentUsage = usage(binding.currentUsage, "Current estimated usage");
    if (currentUsage.amount > record.maxCredits) {
      throw new ExecutionAuthorizationError("Current credit estimate exceeds the approved ceiling.", "approval_limit_exceeded");
    }
    const claimed = { ...record, status: "claimed", currentEstimatedUsage: currentUsage,
      claimedByRun: binding.runId, claimedAt: new Date().toISOString() };
    await writeJsonAtomic(target.record, claimed);
    return claimed;
  } catch (error) {
    await rm(target.claim, { recursive: true, force: true });
    throw error;
  }
}

export async function recordExecutionAuthorizationReceipt(store, projectId, authorizationId, value) {
  const target = paths(store, projectId, authorizationId);
  const record = await readRecord(store, projectId, authorizationId);
  if (record.status !== "claimed") {
    throw new ExecutionAuthorizationError("Only a claimed authorization can record a provider receipt.");
  }
  const received = {
    ...record,
    providerResponseReceivedAt: new Date().toISOString(),
    actualUsage: value.actualUsage === null || value.actualUsage === undefined ?
      null : usage(value.actualUsage, "Actual usage"),
    providerRequestId: value.providerRequestId || null,
    traceId: value.traceId || null
  };
  await writeJsonAtomic(target.record, received);
  return received;
}

export async function settleExecutionAuthorization(store, projectId, authorizationId, value) {
  if (!["consumed", "released", "usage_unknown"].includes(value.status)) {
    throw new ExecutionAuthorizationError("Authorization settlement status is invalid.");
  }
  const target = paths(store, projectId, authorizationId);
  const record = await readRecord(store, projectId, authorizationId);
  if (record.status === value.status) {
    await rm(target.claim, { recursive: true, force: true });
    return record;
  }
  if (record.status !== "claimed") {
    throw new ExecutionAuthorizationError("Only a claimed authorization can be settled.");
  }
  const actualUsage = value.actualUsage === null || value.actualUsage === undefined ?
    (record.actualUsage ?? null) : usage(value.actualUsage, "Actual usage");
  const finished = {
    ...record, status: value.status, finishedAt: new Date().toISOString(),
    actualUsage,
    providerRequestId: value.providerRequestId || record.providerRequestId || null,
    traceId: value.traceId || record.traceId || null,
    exceededApprovedCeiling: actualUsage === null ? null : actualUsage.amount > record.maxCredits
  };
  await writeJsonAtomic(target.record, finished);
  await rm(target.claim, { recursive: true, force: true });
  return finished;
}

export async function readExecutionAuthorizations(store, projectId) {
  await store.readProject(projectId);
  const target = paths(store, projectId);
  let names;
  try {
    names = await readdir(target.directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names.filter((name) => name.endsWith(".json"))) {
    records.push(validateRecord(await readJson(join(target.directory, name)), projectId));
  }
  return records.sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
}
