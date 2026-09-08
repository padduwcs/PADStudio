import { randomUUID } from "node:crypto";
import { open, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { projectDirectory } from "../project/project-paths.js";
import {
  ANALYSIS_JOB_STATES,
  ANALYSIS_OPERATIONS,
  ANALYSIS_SCHEMA_VERSION,
  ANALYSIS_UNIT_STATES,
  AnalysisValidationError,
  assertSha256,
  canonicalJson,
  normalizeAnalysisRequest,
  normalizeSourceReference,
  normalizeTimeRange
} from "./contracts.js";

const PROCESS_START_IDENTITY = `${process.pid}:${Date.now() - Math.round(process.uptime() * 1000)}:${randomUUID()}`;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export class AnalysisStoreError extends Error {
  constructor(message, { code = "analysis_store_failed", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisStoreError";
    this.code = code;
  }
}

export class AnalysisLeaseConflictError extends AnalysisStoreError {
  constructor(message, lease = null) {
    super(message, { code: "analysis_lease_conflict" });
    this.name = "AnalysisLeaseConflictError";
    this.lease = lease;
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new AnalysisStoreError(`${label} không hợp lệ.`, { code: "invalid_job" });
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new AnalysisStoreError(`${label} không phải timestamp hợp lệ.`, { code: "invalid_job" });
  }
  return value;
}

function optionalTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}

function validateLeaseReference(value, label) {
  jsonObject(value, label);
  exactFields(value, ["token", "pid", "processStartIdentity", "acquiredAt", "heartbeatAt"], label);
  if (typeof value.token !== "string" || !value.token) {
    throw new AnalysisStoreError(`${label}.token không hợp lệ.`, { code: "invalid_job" });
  }
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new AnalysisStoreError(`${label}.pid không hợp lệ.`, { code: "invalid_job" });
  }
  if (typeof value.processStartIdentity !== "string" || !value.processStartIdentity) {
    throw new AnalysisStoreError(`${label}.processStartIdentity không hợp lệ.`, { code: "invalid_job" });
  }
  timestamp(value.acquiredAt, `${label}.acquiredAt`);
  timestamp(value.heartbeatAt, `${label}.heartbeatAt`);
  return value;
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalysisStoreError(`${label} phải là object.`, { code: "invalid_job" });
  }
  canonicalJson(value);
  return value;
}

function exactFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new AnalysisStoreError(`${label} chứa field không được hỗ trợ: ${unknown.join(", ")}.`, { code: "invalid_job" });
  }
}

function validateAttempt(attempt, label) {
  jsonObject(attempt, label);
  exactFields(
    attempt,
    ["id", "number", "state", "startedAt", "finishedAt", "runId", "resultId", "error"],
    label
  );
  requireId(attempt.id, `${label}.id`);
  if (!Number.isSafeInteger(attempt.number) || attempt.number < 1) {
    throw new AnalysisStoreError(`${label}.number không hợp lệ.`, { code: "invalid_job" });
  }
  if (!["running", "succeeded", "reused", "interrupted", "blocked", "failed", "cancelled", "not_applicable"].includes(attempt.state)) {
    throw new AnalysisStoreError(`${label}.state không hợp lệ.`, { code: "invalid_job" });
  }
  timestamp(attempt.startedAt, `${label}.startedAt`);
  if (attempt.finishedAt !== null) timestamp(attempt.finishedAt, `${label}.finishedAt`);
  if (attempt.runId !== null) requireId(attempt.runId, `${label}.runId`);
  if (attempt.resultId !== null) requireId(attempt.resultId, `${label}.resultId`);
  if (!(attempt.error === null || typeof attempt.error === "string")) {
    throw new AnalysisStoreError(`${label}.error không hợp lệ.`, { code: "invalid_job" });
  }
  return attempt;
}

function validateUnit(unit, index) {
  const label = `job.units[${index}]`;
  jsonObject(unit, label);
  exactFields(
    unit,
    [
      "id", "sourceKey", "operation", "state", "dependencies", "planFingerprint", "fingerprint", "method", "profileId",
      "range", "executorRequest", "attempts", "runId", "resultId", "error", "notApplicableReason"
    ],
    label
  );
  requireId(unit.id, `${label}.id`);
  assertSha256(unit.sourceKey, `${label}.sourceKey`);
  if (!ANALYSIS_OPERATIONS.includes(unit.operation)) {
    throw new AnalysisStoreError(`${label}.operation không hợp lệ.`, { code: "invalid_job" });
  }
  if (!ANALYSIS_UNIT_STATES.includes(unit.state)) {
    throw new AnalysisStoreError(`${label}.state không hợp lệ.`, { code: "invalid_job" });
  }
  if (!Array.isArray(unit.dependencies)) {
    throw new AnalysisStoreError(`${label}.dependencies phải là array.`, { code: "invalid_job" });
  }
  unit.dependencies.forEach((id, dependencyIndex) => requireId(id, `${label}.dependencies[${dependencyIndex}]`));
  if (new Set(unit.dependencies).size !== unit.dependencies.length) {
    throw new AnalysisStoreError(`${label}.dependencies không được trùng.`, { code: "invalid_job" });
  }
  assertSha256(unit.planFingerprint, `${label}.planFingerprint`);
  assertSha256(unit.fingerprint, `${label}.fingerprint`);
  jsonObject(unit.method, `${label}.method`);
  if (Object.keys(unit.method).length === 0) {
    throw new AnalysisStoreError(`${label}.method không được rỗng.`, { code: "invalid_job" });
  }
  if (!(unit.profileId === null || (typeof unit.profileId === "string" && unit.profileId.trim()))) {
    throw new AnalysisStoreError(`${label}.profileId không hợp lệ.`, { code: "invalid_job" });
  }
  if (unit.range !== null) normalizeTimeRange(unit.range, `${label}.range`, { nullable: false });
  jsonObject(unit.executorRequest, `${label}.executorRequest`);
  exactFields(unit.executorRequest, ["capability", "tool", "purpose", "inputs"], `${label}.executorRequest`);
  if (!Array.isArray(unit.attempts)) {
    throw new AnalysisStoreError(`${label}.attempts phải là array.`, { code: "invalid_job" });
  }
  unit.attempts.forEach((attempt, attemptIndex) => validateAttempt(attempt, `${label}.attempts[${attemptIndex}]`));
  if (new Set(unit.attempts.map((attempt) => attempt.id)).size !== unit.attempts.length) {
    throw new AnalysisStoreError(`${label}.attempt IDs phải duy nhất.`, { code: "invalid_job" });
  }
  if (unit.attempts.some((attempt, attemptIndex) => attempt.number !== attemptIndex + 1)) {
    throw new AnalysisStoreError(`${label}.attempt number phải tăng liên tục.`, { code: "invalid_job" });
  }
  if (unit.runId !== null) requireId(unit.runId, `${label}.runId`);
  if (unit.resultId !== null) requireId(unit.resultId, `${label}.resultId`);
  if (!(unit.error === null || typeof unit.error === "string")) {
    throw new AnalysisStoreError(`${label}.error không hợp lệ.`, { code: "invalid_job" });
  }
  if (!(unit.notApplicableReason === null || typeof unit.notApplicableReason === "string")) {
    throw new AnalysisStoreError(`${label}.notApplicableReason không hợp lệ.`, { code: "invalid_job" });
  }
  if (["succeeded", "reused"].includes(unit.state) && (!unit.runId || !unit.resultId)) {
    throw new AnalysisStoreError(`${label} thành công nhưng thiếu Run/Result.`, { code: "invalid_job" });
  }
  if (unit.state === "not_applicable" && !unit.notApplicableReason) {
    throw new AnalysisStoreError(`${label} not_applicable nhưng thiếu lý do.`, { code: "invalid_job" });
  }
  if (unit.state === "running" && unit.attempts.at(-1)?.state !== "running") {
    throw new AnalysisStoreError(`${label} running nhưng không có attempt đang chạy.`, { code: "invalid_job" });
  }
  return unit;
}

function validateSnapshot(snapshot, index) {
  const label = `job.sourceSnapshots[${index}]`;
  jsonObject(snapshot, label);
  exactFields(
    snapshot,
    [
      "source", "sourceKey", "sourceVersion", "sizeBytes", "modifiedAt", "hashedAt",
      "fingerprintMethod", "mediaType", "itemName", "inputResources", "inputResults"
    ],
    label
  );
  normalizeSourceReference(snapshot.source, `${label}.source`);
  assertSha256(snapshot.sourceKey, `${label}.sourceKey`);
  assertSha256(snapshot.sourceVersion, `${label}.sourceVersion`);
  if (!Number.isSafeInteger(snapshot.sizeBytes) || snapshot.sizeBytes < 0) {
    throw new AnalysisStoreError(`${label}.sizeBytes không hợp lệ.`, { code: "invalid_job" });
  }
  timestamp(snapshot.modifiedAt, `${label}.modifiedAt`);
  timestamp(snapshot.hashedAt, `${label}.hashedAt`);
  if (snapshot.fingerprintMethod !== "sha256-full-file-v1") {
    throw new AnalysisStoreError(`${label}.fingerprintMethod không được hỗ trợ.`, { code: "invalid_job" });
  }
  if (typeof snapshot.mediaType !== "string" || !snapshot.mediaType) {
    throw new AnalysisStoreError(`${label}.mediaType không hợp lệ.`, { code: "invalid_job" });
  }
  if (typeof snapshot.itemName !== "string" || !snapshot.itemName) {
    throw new AnalysisStoreError(`${label}.itemName không hợp lệ.`, { code: "invalid_job" });
  }
  for (const field of ["inputResources", "inputResults"]) {
    if (!Array.isArray(snapshot[field])) {
      throw new AnalysisStoreError(`${label}.${field} phải là array.`, { code: "invalid_job" });
    }
    snapshot[field].forEach((id, itemIndex) => requireId(id, `${label}.${field}[${itemIndex}]`));
  }
  return snapshot;
}

export function validateAnalysisJob(job, expectedProjectId = null) {
  jsonObject(job, "job");
  exactFields(
    job,
    [
      "version", "id", "projectId", "revision", "state", "createdAt", "updatedAt", "request",
      "sourceSnapshots", "units", "warnings", "ownerLease", "cancelRequestedAt"
    ],
    "job"
  );
  if (job.version !== ANALYSIS_SCHEMA_VERSION) {
    throw new AnalysisStoreError(`job.version phải là ${ANALYSIS_SCHEMA_VERSION}.`, { code: "invalid_job" });
  }
  requireId(job.id, "job.id");
  requireId(job.projectId, "job.projectId");
  if (expectedProjectId !== null && job.projectId !== expectedProjectId) {
    throw new AnalysisStoreError("Analysis job thuộc project khác.", { code: "invalid_job" });
  }
  if (!Number.isSafeInteger(job.revision) || job.revision < 1) {
    throw new AnalysisStoreError("job.revision không hợp lệ.", { code: "invalid_job" });
  }
  if (!ANALYSIS_JOB_STATES.includes(job.state)) {
    throw new AnalysisStoreError("job.state không hợp lệ.", { code: "invalid_job" });
  }
  timestamp(job.createdAt, "job.createdAt");
  timestamp(job.updatedAt, "job.updatedAt");
  normalizeAnalysisRequest(job.request);
  if (!Array.isArray(job.sourceSnapshots) || job.sourceSnapshots.length === 0) {
    throw new AnalysisStoreError("job.sourceSnapshots phải có ít nhất một source.", { code: "invalid_job" });
  }
  job.sourceSnapshots.forEach(validateSnapshot);
  if (new Set(job.sourceSnapshots.map((item) => item.sourceKey)).size !== job.sourceSnapshots.length) {
    throw new AnalysisStoreError("job.sourceSnapshots không được trùng sourceKey.", { code: "invalid_job" });
  }
  if (!Array.isArray(job.units) || job.units.length === 0) {
    throw new AnalysisStoreError("job.units phải có ít nhất một unit.", { code: "invalid_job" });
  }
  job.units.forEach(validateUnit);
  const unitIds = new Set(job.units.map((unit) => unit.id));
  if (unitIds.size !== job.units.length) throw new AnalysisStoreError("Unit IDs phải duy nhất.", { code: "invalid_job" });
  for (const unit of job.units) {
    const snapshot = job.sourceSnapshots.find((candidate) => candidate.sourceKey === unit.sourceKey);
    if (!snapshot) {
      throw new AnalysisStoreError(`Unit ${unit.id} trỏ sourceKey không có trong snapshot.`, { code: "invalid_job" });
    }
    if (unit.dependencies.some((id) => !unitIds.has(id) || id === unit.id)) {
      throw new AnalysisStoreError(`Unit ${unit.id} có dependency không hợp lệ.`, { code: "invalid_job" });
    }
    const executorRequest = unit.executorRequest;
    for (const field of ["capability", "tool", "purpose"]) {
      if (typeof executorRequest[field] !== "string" || !executorRequest[field].trim()) {
        throw new AnalysisStoreError(`Unit ${unit.id} có executorRequest.${field} không hợp lệ.`, { code: "invalid_job" });
      }
    }
    const analysisInput = executorRequest.inputs?.analysis;
    if (!analysisInput || typeof analysisInput !== "object" || Array.isArray(analysisInput)) {
      throw new AnalysisStoreError(`Unit ${unit.id} thiếu executorRequest.inputs.analysis.`, { code: "invalid_job" });
    }
    if (
      analysisInput.analysisJobId !== job.id ||
      analysisInput.unitId !== unit.id ||
      analysisInput.sourceKey !== unit.sourceKey ||
      analysisInput.sourceVersion !== snapshot.sourceVersion ||
      analysisInput.fingerprint !== unit.fingerprint ||
      canonicalJson(analysisInput.method) !== canonicalJson(unit.method) ||
      canonicalJson(executorRequest.inputs.source) !== canonicalJson(snapshot.source)
    ) {
      throw new AnalysisStoreError(`Unit ${unit.id} có executor provenance không khớp manifest.`, { code: "invalid_job" });
    }
  }
  const visited = new Set();
  const visiting = new Set();
  const dependencies = new Map(job.units.map((unit) => [unit.id, unit.dependencies]));
  function visit(unitId) {
    if (visiting.has(unitId)) throw new AnalysisStoreError("Analysis job chứa dependency cycle.", { code: "invalid_job" });
    if (visited.has(unitId)) return;
    visiting.add(unitId);
    for (const dependency of dependencies.get(unitId)) visit(dependency);
    visiting.delete(unitId);
    visited.add(unitId);
  }
  for (const unit of job.units) visit(unit.id);
  const evidenceUnits = job.units.filter((unit) => ["succeeded", "reused"].includes(unit.state));
  const problemUnits = job.units.filter((unit) => ["blocked", "failed", "cancelled"].includes(unit.state));
  const unfinishedUnits = job.units.filter((unit) => ["pending", "running"].includes(unit.state));
  if (job.state === "completed" && !job.units.every((unit) => ["succeeded", "reused", "not_applicable"].includes(unit.state))) {
    throw new AnalysisStoreError("Job completed nhưng còn unit chưa hoàn tất thành công.", { code: "invalid_job" });
  }
  if (job.state === "partial" && (evidenceUnits.length === 0 || problemUnits.length === 0 || unfinishedUnits.length > 0)) {
    throw new AnalysisStoreError("Job partial phải có bằng chứng, có vấn đề và không còn unit đang chạy.", { code: "invalid_job" });
  }
  if (job.state === "failed" && (evidenceUnits.length > 0 || problemUnits.length === 0 || unfinishedUnits.length > 0)) {
    throw new AnalysisStoreError("Job failed không được có bằng chứng hữu ích hoặc unit chưa kết thúc.", { code: "invalid_job" });
  }
  if (job.state === "cancelled" && unfinishedUnits.length > 0) {
    throw new AnalysisStoreError("Job cancelled không được còn unit pending/running.", { code: "invalid_job" });
  }
  if (!Array.isArray(job.warnings)) throw new AnalysisStoreError("job.warnings phải là array.", { code: "invalid_job" });
  canonicalJson(job.warnings);
  if (!(job.ownerLease === null || (typeof job.ownerLease === "object" && !Array.isArray(job.ownerLease)))) {
    throw new AnalysisStoreError("job.ownerLease không hợp lệ.", { code: "invalid_job" });
  }
  if (job.ownerLease) validateLeaseReference(job.ownerLease, "job.ownerLease");
  optionalTimestamp(job.cancelRequestedAt, "job.cancelRequestedAt");
  if (job.state === "cancelled" && job.cancelRequestedAt === null) {
    throw new AnalysisStoreError("Job cancelled phải giữ thời điểm yêu cầu hủy.", { code: "invalid_job" });
  }
  return job;
}

function analysisPaths(rootDir, projectId) {
  const root = join(projectDirectory(rootDir, projectId), "analysis");
  return {
    root,
    jobs: join(root, "jobs"),
    indexes: join(root, "indexes"),
    leases: join(root, "leases"),
    leaseArchive: join(root, "leases", "archive"),
    writerLease: join(root, "leases", "writer.json"),
    cancellations: join(root, "cancellations")
  };
}

async function ensureRealDirectory(path, label) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AnalysisStoreError(`${label} không phải thư mục an toàn.`, { code: "unsafe_analysis_path" });
  }
}

function publicLease(lease) {
  return {
    token: lease.token,
    pid: lease.pid,
    processStartIdentity: lease.processStartIdentity,
    acquiredAt: lease.acquiredAt,
    heartbeatAt: lease.heartbeatAt
  };
}

async function defaultOwnerAlive(lease) {
  if (lease.pid === process.pid) return lease.processStartIdentity === PROCESS_START_IDENTITY;
  try {
    process.kill(lease.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export class AnalysisStore {
  constructor({ rootDir, projectStore, ownerAlive = defaultOwnerAlive, clock = () => new Date() }) {
    if (!rootDir || !projectStore) throw new AnalysisStoreError("AnalysisStore cần rootDir và projectStore.");
    this.rootDir = rootDir;
    this.projectStore = projectStore;
    this.ownerAlive = ownerAlive;
    this.clock = clock;
  }

  now() {
    return this.clock().toISOString();
  }

  async ensureLayout(projectId) {
    await this.projectStore.readProject(projectId);
    const paths = analysisPaths(this.rootDir, projectId);
    await ensureRealDirectory(paths.root, "Thư mục analysis");
    for (const [path, label] of [
      [paths.jobs, "Thư mục analysis/jobs"],
      [paths.indexes, "Thư mục analysis/indexes"],
      [paths.leases, "Thư mục analysis/leases"],
      [paths.leaseArchive, "Thư mục analysis/leases/archive"],
      [paths.cancellations, "Thư mục analysis/cancellations"]
    ]) await ensureRealDirectory(path, label);
    return paths;
  }

  async acquireLease(projectId) {
    const paths = await this.ensureLayout(projectId);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const acquiredAt = this.now();
      const lease = {
        version: ANALYSIS_SCHEMA_VERSION,
        projectId,
        token: randomUUID(),
        pid: process.pid,
        processStartIdentity: PROCESS_START_IDENTITY,
        acquiredAt,
        heartbeatAt: acquiredAt
      };
      let handle;
      try {
        handle = await open(paths.writerLease, "wx");
        await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, "utf8");
        await handle.sync();
        return lease;
      } catch (error) {
        if (error?.code !== "EEXIST") throw new AnalysisStoreError("Không thể tạo analysis lease.", { cause: error });
        let existing;
        try {
          existing = JSON.parse(await readFile(paths.writerLease, "utf8"));
        } catch (readError) {
          throw new AnalysisLeaseConflictError("Analysis lease hiện có nhưng không thể kiểm tra an toàn.");
        }
        if (await this.ownerAlive(existing)) {
          throw new AnalysisLeaseConflictError("Project đang có một analysis writer còn sống.", publicLease(existing));
        }
        const archived = join(
          paths.leaseArchive,
          `writer-${Date.now()}-${randomUUID().slice(0, 8)}.json`
        );
        try {
          await rename(paths.writerLease, archived);
        } catch (renameError) {
          if (renameError?.code !== "ENOENT") continue;
        }
      } finally {
        await handle?.close().catch(() => {});
      }
    }
    throw new AnalysisLeaseConflictError("Không thể nhận analysis lease do writer thay đổi đồng thời.");
  }

  async assertLease(projectId, lease) {
    const paths = await this.ensureLayout(projectId);
    let stored;
    try {
      stored = await readJson(paths.writerLease);
    } catch (error) {
      throw new AnalysisLeaseConflictError("Analysis lease không còn tồn tại.");
    }
    if (
      stored.projectId !== projectId ||
      stored.token !== lease?.token ||
      stored.processStartIdentity !== lease?.processStartIdentity
    ) {
      throw new AnalysisLeaseConflictError("Analysis lease không thuộc writer hiện tại.", publicLease(stored));
    }
    return stored;
  }

  async heartbeat(projectId, lease) {
    const stored = await this.assertLease(projectId, lease);
    const updated = { ...stored, heartbeatAt: this.now() };
    const paths = analysisPaths(this.rootDir, projectId);
    await writeJsonAtomic(paths.writerLease, updated);
    Object.assign(lease, updated);
    return updated;
  }

  async releaseLease(projectId, lease) {
    await this.assertLease(projectId, lease);
    const paths = analysisPaths(this.rootDir, projectId);
    await rm(paths.writerLease, { force: true });
  }

  async createJob(projectId, value, { lease } = {}) {
    await this.assertLease(projectId, lease);
    const paths = await this.ensureLayout(projectId);
    const job = validateAnalysisJob(structuredClone(value), projectId);
    const path = join(paths.jobs, `${job.id}.json`);
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(job, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new AnalysisStoreError(`Analysis job đã tồn tại: ${job.id}`, { code: "job_exists" });
      }
      throw error;
    }
    return job;
  }

  async readJob(projectId, jobId) {
    requireId(jobId, "Analysis job ID");
    await this.projectStore.readProject(projectId);
    try {
      return validateAnalysisJob(
        await readJson(join(analysisPaths(this.rootDir, projectId).jobs, `${jobId}.json`)),
        projectId
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new AnalysisStoreError(`Không tìm thấy analysis job: ${jobId}`, { code: "job_not_found" });
      }
      if (error instanceof AnalysisStoreError || error instanceof AnalysisValidationError) throw error;
      throw new AnalysisStoreError(`Không thể đọc analysis job: ${jobId}`, { code: "invalid_job", cause: error });
    }
  }

  async listJobs(projectId) {
    await this.projectStore.readProject(projectId);
    let entries;
    try {
      entries = await readdir(analysisPaths(this.rootDir, projectId).jobs, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      jobs.push(validateAnalysisJob(await readJson(join(analysisPaths(this.rootDir, projectId).jobs, entry.name)), projectId));
    }
    return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateJob(projectId, jobId, mutate, {
    expectedRevision = null,
    lease,
    releaseOwnership = false
  } = {}) {
    await this.assertLease(projectId, lease);
    const current = await this.readJob(projectId, jobId);
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      throw new AnalysisStoreError("Analysis job revision conflict; hãy đọc lại manifest.", { code: "job_revision_conflict" });
    }
    const draft = structuredClone(current);
    const returned = await mutate(draft);
    const candidate = returned ?? draft;
    candidate.revision = current.revision + 1;
    candidate.updatedAt = this.now();
    candidate.ownerLease = releaseOwnership ? null : (lease ? publicLease(lease) : null);
    const validated = validateAnalysisJob(candidate, projectId);
    await writeJsonAtomic(
      join(analysisPaths(this.rootDir, projectId).jobs, `${jobId}.json`),
      validated
    );
    return validated;
  }

  async requestCancellation(projectId, jobId) {
    const job = await this.readJob(projectId, jobId);
    if (job.state === "cancelled") {
      return {
        version: ANALYSIS_SCHEMA_VERSION,
        projectId,
        analysisJobId: job.id,
        requestedAt: job.cancelRequestedAt
      };
    }
    if (["completed", "partial", "failed"].includes(job.state)) {
      throw new AnalysisStoreError(`Không thể hủy analysis job đã ${job.state}.`, { code: "job_terminal" });
    }
    const paths = await this.ensureLayout(projectId);
    const request = {
      version: ANALYSIS_SCHEMA_VERSION,
      projectId,
      analysisJobId: job.id,
      requestedAt: this.now()
    };
    await writeJsonAtomic(join(paths.cancellations, `${job.id}.json`), request);
    return request;
  }

  async readCancellation(projectId, jobId) {
    try {
      const value = await readJson(join(analysisPaths(this.rootDir, projectId).cancellations, `${jobId}.json`));
      if (
        value.version !== ANALYSIS_SCHEMA_VERSION ||
        value.projectId !== projectId ||
        value.analysisJobId !== jobId
      ) throw new AnalysisStoreError("Cancellation request không hợp lệ.", { code: "invalid_cancel_request" });
      timestamp(value.requestedAt, "cancellation.requestedAt");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async clearCancellation(projectId, jobId, { lease } = {}) {
    await this.assertLease(projectId, lease);
    await rm(join(analysisPaths(this.rootDir, projectId).cancellations, `${jobId}.json`), { force: true });
  }
}
