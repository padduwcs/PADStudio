import { randomUUID } from "node:crypto";
import { isAnalysisResultType, validateAnalysisResultData } from "../analysis/contracts.js";
import { sha256File } from "../analysis/source-identity.js";
import { ProjectIntelligenceStore } from "../intelligence/project-intelligence-store.js";
import { createDefaultSkillCatalog } from "../intelligence/skill-catalog.js";
import {
  readExecutionAuthorizations,
  settleExecutionAuthorization
} from "../execution/execution-authorizations.js";
import { readProjectBudget } from "../execution/project-budget.js";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./atomic-files.js";
import { withFileLock } from "./file-lock.js";
import { createHumanConfirmation, requireHumanConfirmation, validHumanConfirmation } from "./human-confirmation.js";
import { compositionTimeline, sequenceDuration } from "../production/sequence-composition.js";
import {
  isPathInside,
  projectDirectory,
  ProjectPathError,
  resolveProjectPath,
  toProjectRelativePath
} from "./project-paths.js";

const PROJECT_VERSION = "1.0";

export class ProjectStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

export class StoredProjectNotFoundError extends ProjectStoreError {
  constructor(projectId) {
    super(`Không tìm thấy project đã khởi tạo: ${projectId}`);
    this.name = "StoredProjectNotFoundError";
  }
}

function now() {
  return new Date().toISOString();
}

function recordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectStoreError(`${label} không hợp lệ.`);
  }
  return value.trim();
}

function stringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ProjectStoreError(`${label} phải là danh sách chuỗi không rỗng.`);
  }
  return value.map((item) => item.trim());
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectStoreError(label + " phải là một object.");
  }
  return value;
}

function optionalTool(value) {
  if (value === null || value === undefined) return null;
  objectValue(value, "Thông tin công cụ");
  return {
    name: requireText(value.name, "Tên công cụ"),
    version: requireText(value.version, "Phiên bản công cụ"),
    provider: requireText(value.provider, "Nhà cung cấp công cụ")
  };
}

function resultDataChecksum(result, fileId) {
  if (fileId === "primary" && typeof result.data?.sha256 === "string") {
    return { sha256: result.data.sha256, source: "result_data" };
  }
  if (result.type === "video.sequence-render" && Array.isArray(result.data?.segments)) {
    const segment = result.data.segments.find((entry) => entry?.fileId === fileId);
    if (typeof segment?.sha256 === "string") {
      return { sha256: segment.sha256, source: "result_data_segment" };
    }
  }
  return null;
}

async function directoryInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function renameAtomicWithRetry(source, destination) {
  const maxRetries = process.platform === "win32" ? 30 : 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (attempt >= maxRetries || !["EBUSY", "EPERM"].includes(error?.code)) throw error;
      await delay(100);
    }
  }
}

async function storedPathAvailable(projectRoot, projectPath, expectedKind, containerRoot = projectRoot) {
  try {
    const path = resolveProjectPath(projectRoot, projectPath);
    const [info, containerInfo, resolvedRoot, resolvedPath] = await Promise.all([
      lstat(path),
      lstat(containerRoot),
      realpath(containerRoot),
      realpath(path)
    ]);
    if (
      info.isSymbolicLink() ||
      !containerInfo.isDirectory() ||
      containerInfo.isSymbolicLink() ||
      !isPathInside(resolvedRoot, resolvedPath)
    ) return false;
    return expectedKind === "folder" ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

async function readRecords(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      records.push(await readJson(join(directory, entry.name)));
    }
    return records;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function validateProject(project, expectedId) {
  if (
    !project ||
    project.version !== PROJECT_VERSION ||
    project.id !== expectedId ||
    typeof project.title !== "string" ||
    !project.title
  ) {
    throw new ProjectStoreError(`project.json không hợp lệ cho project: ${expectedId}`);
  }
  return project;
}

function validateRun(run, projectId) {
  if (
    !run ||
    run.version !== PROJECT_VERSION ||
    run.projectId !== projectId ||
    typeof run.id !== "string" ||
    typeof run.capability !== "string" ||
    (run.pendingResult !== undefined && run.pendingResult !== null &&
      (!run.pendingResult || typeof run.pendingResult !== "object" || Array.isArray(run.pendingResult))) ||
    (run.authorizationId !== undefined && run.authorizationId !== null &&
      (typeof run.authorizationId !== "string" || !/^authorization-[a-z0-9-]+$/.test(run.authorizationId))) ||
    !Array.isArray(run.outputs) ||
    !["in_progress", "completed", "failed"].includes(run.status)
  ) {
    throw new ProjectStoreError(`Run không hợp lệ trong project: ${projectId}`);
  }
  return run;
}

async function resultWithAvailability(projectRoot, result) {
  const runOutputRoot = join(projectRoot, "outputs", result.createdByRun);
  return {
    ...result,
    files: await Promise.all(result.files.map(async (file) => {
      let available = false;
      try {
        const candidatePath = resolveProjectPath(projectRoot, file.path);
        available = isPathInside(runOutputRoot, candidatePath) &&
          await storedPathAvailable(projectRoot, file.path, "file", runOutputRoot);
        if (available) available = (await lstat(candidatePath)).size === file.sizeBytes;
      } catch {
        available = false;
      }
      return { ...file, available };
    }))
  };
}

function validateResult(result, projectId) {
  const inputResults = result?.inputResults ?? [];
  const inputArtifacts = result?.inputArtifacts ?? [];
  const files = result?.files ?? [];
  const runCompletion = result?.runCompletion ?? null;
  if (
    !result ||
    result.version !== PROJECT_VERSION ||
    result.projectId !== projectId ||
    typeof result.id !== "string" ||
    typeof result.type !== "string" ||
    typeof result.name !== "string" ||
    typeof result.capability !== "string" ||
    typeof result.createdByRun !== "string" ||
    !Array.isArray(result.inputResources) ||
    result.inputResources.some((id) => typeof id !== "string" || !id) ||
    !Array.isArray(inputResults) ||
    inputResults.some((id) => typeof id !== "string" || !id) ||
    !Array.isArray(inputArtifacts) || inputArtifacts.some((id) => typeof id !== "string" || !id) ||
    !Array.isArray(files) ||
    files.some((file) =>
      !file ||
      typeof file.id !== "string" ||
      !file.id ||
      typeof file.role !== "string" ||
      !file.role ||
      typeof file.path !== "string" ||
      !file.path ||
      typeof file.name !== "string" ||
      !file.name ||
      typeof file.mediaType !== "string" ||
      !file.mediaType ||
      !Number.isInteger(file.sizeBytes) ||
      file.sizeBytes < 0 ||
      !(
        file.sha256 === undefined ||
        (typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256))
      )
    ) ||
    !result.tool ||
    typeof result.tool.name !== "string" ||
    typeof result.tool.version !== "string" ||
    typeof result.tool.provider !== "string" ||
    !result.data ||
    typeof result.data !== "object" ||
    Array.isArray(result.data) ||
    !result.verification ||
    typeof result.verification !== "object" ||
    Array.isArray(result.verification) ||
    result.verification.status !== "passed" ||
    !Array.isArray(result.verification.checks) ||
    !(
      runCompletion === null ||
      (
        typeof runCompletion === "object" &&
        !Array.isArray(runCompletion) &&
        Number.isFinite(runCompletion.durationMs) &&
        runCompletion.durationMs >= 0 &&
        (
          runCompletion.actualCostUsd === null ||
          (Number.isFinite(runCompletion.actualCostUsd) && runCompletion.actualCostUsd >= 0)
        )
      )
    )
  ) {
    throw new ProjectStoreError("Kết quả không hợp lệ trong project: " + projectId);
  }
  if (isAnalysisResultType(result.type)) {
    const normalizedData = validateAnalysisResultData(result.data, { resultType: result.type });
    const fileIds = new Set(files.map((file) => file.id));
    const missingDatasetFiles = normalizedData.datasets.flatMap((dataset) =>
      [dataset.fileId, dataset.indexFileId].filter(Boolean)
    ).filter((id) => !fileIds.has(id));
    if (missingDatasetFiles.length) {
      throw new ProjectStoreError(
        "Result phân tích tham chiếu dataset file không tồn tại: " + missingDatasetFiles.join(", ")
      );
    }
    for (const dataset of normalizedData.datasets) {
      if (dataset.checksum === undefined) continue;
      const file = files.find((candidate) => candidate.id === dataset.fileId);
      if (file?.sha256 !== dataset.checksum) {
        throw new ProjectStoreError(`Checksum dataset ${dataset.kind} không khớp file Result.`);
      }
    }
    result = { ...result, data: normalizedData };
  }
  return { ...result, inputResults, inputArtifacts, files, runCompletion };
}

function validateDecision(decision, projectId) {
  if (decision?.kind === "project_decision") {
    const target = decision.target;
    const validTarget =
      target &&
      typeof target === "object" &&
      (
        (["project", "artifact", "result", "workflow"].includes(target.kind) && typeof target.id === "string" && Boolean(target.id.trim())) ||
        (
          target.kind === "work_item" &&
          typeof target.workflowId === "string" &&
          Boolean(target.workflowId.trim()) &&
          typeof target.workItemId === "string" &&
          Boolean(target.workItemId.trim())
        )
      );
    const validOptions =
      Array.isArray(decision.options) &&
      decision.options.every(
        (option) =>
          option &&
          typeof option.id === "string" &&
          Boolean(option.id.trim()) &&
          typeof option.label === "string" &&
          Boolean(option.label.trim()) &&
          (option.description === null || typeof option.description === "string")
      );
    const binding = decision.binding ?? null;
    const bindingKeys = binding && typeof binding === "object" && !Array.isArray(binding)
      ? Object.keys(binding)
      : [];
    const validBinding =
      binding === null ||
      (
        target?.kind === "work_item" &&
        bindingKeys.every((key) => ["workflowRevision", "outputReferences", "reviewId"].includes(key)) &&
        bindingKeys.length === 3 &&
        Number.isInteger(binding.workflowRevision) &&
        binding.workflowRevision > 0 &&
        Array.isArray(binding.outputReferences) &&
        binding.outputReferences.length > 0 &&
        binding.outputReferences.every(
          (reference) =>
            reference &&
            typeof reference.kind === "string" &&
            Boolean(reference.kind.trim()) &&
            typeof reference.id === "string" &&
            Boolean(reference.id.trim())
        ) &&
        (binding.reviewId === null || (typeof binding.reviewId === "string" && Boolean(binding.reviewId.trim())))
      );
    const validConfirmation = decision.confirmation === undefined ||
      validHumanConfirmation(decision.confirmation, "execute_animation_code", decision.target?.id);
    if (
      decision.version !== PROJECT_VERSION ||
      decision.projectId !== projectId ||
      typeof decision.id !== "string" ||
      !validTarget ||
      typeof decision.category !== "string" ||
      !decision.category.trim() ||
      typeof decision.subject !== "string" ||
      !decision.subject.trim() ||
      !["approved", "changes_requested", "rejected", "recorded"].includes(decision.outcome) ||
      !validOptions ||
      !validBinding ||
      !validConfirmation ||
      !(decision.selected === null || typeof decision.selected === "string") ||
      typeof decision.reason !== "string" ||
      !decision.reason.trim() ||
      !["user", "agent"].includes(decision.decidedBy) ||
      typeof decision.userVisible !== "boolean" ||
      !(decision.confidence === null || ["low", "medium", "high"].includes(decision.confidence)) ||
      typeof decision.createdAt !== "string" ||
      !Number.isFinite(Date.parse(decision.createdAt))
    ) {
      throw new ProjectStoreError("Project decision is invalid in project: " + projectId);
    }
    if (decision.selected !== null && !decision.options.some((option) => option.id === decision.selected)) {
      throw new ProjectStoreError("Selected decision option does not exist.");
    }
    return { ...decision, binding };
  }
  const feedbackTarget = decision?.feedbackTarget;
  const feedbackTargetKeys = feedbackTarget && typeof feedbackTarget === "object" && !Array.isArray(feedbackTarget)
    ? Object.keys(feedbackTarget)
    : [];
  const timeRange = feedbackTarget?.timeRange;
  const validTimeRange = timeRange === undefined || (
    timeRange && typeof timeRange === "object" && !Array.isArray(timeRange) &&
    Object.keys(timeRange).length === 2 &&
    Object.keys(timeRange).every((key) => ["startSeconds", "endSeconds"].includes(key)) &&
    Number.isFinite(timeRange.startSeconds) && Number.isFinite(timeRange.endSeconds) &&
    timeRange.startSeconds >= 0 && timeRange.endSeconds > timeRange.startSeconds
  );
  const validFeedbackTarget = feedbackTarget === undefined || feedbackTarget === null || (
    feedbackTargetKeys.every((key) => ["artifactId", "revision", "segmentId", "timeRange"].includes(key)) &&
    typeof feedbackTarget.artifactId === "string" && Boolean(feedbackTarget.artifactId.trim()) &&
    Number.isInteger(feedbackTarget.revision) && feedbackTarget.revision > 0 &&
    (feedbackTarget.segmentId === undefined || (typeof feedbackTarget.segmentId === "string" && Boolean(feedbackTarget.segmentId.trim()))) &&
    validTimeRange
  );
  const resolvesDecisionIds = decision?.resolvesDecisionIds;
  const validResolutions = resolvesDecisionIds === undefined || (
    Array.isArray(resolvesDecisionIds) &&
    resolvesDecisionIds.every((id) => typeof id === "string" && /^decision-[a-z0-9-]+$/i.test(id)) &&
    new Set(resolvesDecisionIds).size === resolvesDecisionIds.length
  );
  const validConfirmation = decision?.confirmation === undefined ||
    validHumanConfirmation(decision.confirmation, "accept_video", decision?.resultId);
  if (
    !decision ||
    decision.version !== PROJECT_VERSION ||
    decision.projectId !== projectId ||
    typeof decision.id !== "string" ||
    typeof decision.resultId !== "string" ||
    !["accepted", "changes_requested", "rejected"].includes(decision.outcome) ||
    !(decision.note === null || typeof decision.note === "string") ||
    !validFeedbackTarget ||
    !validResolutions ||
    !validConfirmation ||
    decision.decidedBy !== "user" ||
    typeof decision.createdAt !== "string" ||
    !Number.isFinite(Date.parse(decision.createdAt))
  ) {
    throw new ProjectStoreError("Quyết định không hợp lệ trong project: " + projectId);
  }
  if (decision.outcome === "changes_requested" && !decision.note?.trim()) {
    throw new ProjectStoreError("Quyết định yêu cầu sửa phải có phản hồi.");
  }
  return decision;
}

function resultReference(value) {
  const resultId = requireText(value, "Result id");
  if (!/^result-[a-z0-9-]+$/i.test(resultId)) {
    throw new ProjectStoreError("Result id không hợp lệ.");
  }
  return resultId;
}

function runReference(value) {
  const runId = requireText(value, "Run id");
  if (!/^run-[a-z0-9-]+$/i.test(runId)) {
    throw new ProjectStoreError("Run id không hợp lệ.");
  }
  return runId;
}

function resultFileReference(value) {
  const fileId = requireText(value, "File id");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(fileId)) {
    throw new ProjectStoreError("File id không hợp lệ.");
  }
  return fileId;
}

function validateResource(resource, projectId, projectRoot) {
  if (
    !resource ||
    resource.version !== PROJECT_VERSION ||
    resource.projectId !== projectId ||
    typeof resource.id !== "string" ||
    typeof resource.createdByRun !== "string" ||
    resource.role !== "input" ||
    !["file", "folder"].includes(resource.kind) ||
    !Array.isArray(resource.items)
  ) {
    throw new ProjectStoreError(`Resource không hợp lệ trong project: ${projectId}`);
  }
  const resourcePath = resolveProjectPath(projectRoot, resource.path);
  const inputRoot = join(projectRoot, "inputs");
  if (!isPathInside(inputRoot, resourcePath)) {
    throw new ProjectStoreError(`Resource ${resource.id} phải nằm trong inputs.`);
  }
  for (const item of resource.items) {
    if (!item || typeof item.path !== "string") {
      throw new ProjectStoreError(`Resource ${resource.id} chứa file không hợp lệ.`);
    }
    const itemPath = resolveProjectPath(projectRoot, item.path);
    if (itemPath !== resourcePath && !isPathInside(resourcePath, itemPath)) {
      throw new ProjectStoreError(`Resource ${resource.id} chứa file nằm ngoài resource.`);
    }
  }
  return resource;
}

function validateCheckpoint(checkpoint, projectId) {
  if (
    !checkpoint ||
    checkpoint.version !== PROJECT_VERSION ||
    checkpoint.projectId !== projectId ||
    typeof checkpoint.goal !== "string" ||
    !checkpoint.goal.trim() ||
    !Array.isArray(checkpoint.constraints) ||
    !Array.isArray(checkpoint.selectedResources) ||
    !Array.isArray(checkpoint.pending) ||
    !(checkpoint.next === null || typeof checkpoint.next === "string")
  ) {
    throw new ProjectStoreError(`Checkpoint không hợp lệ trong project: ${projectId}`);
  }
  if (
    !(checkpoint.activeWorkflowId === undefined || checkpoint.activeWorkflowId === null || typeof checkpoint.activeWorkflowId === "string") ||
    !(checkpoint.activeWorkItemId === undefined || checkpoint.activeWorkItemId === null || typeof checkpoint.activeWorkItemId === "string") ||
    !(checkpoint.activeArtifacts === undefined || Array.isArray(checkpoint.activeArtifacts)) ||
    !(checkpoint.pendingDecisions === undefined || Array.isArray(checkpoint.pendingDecisions)) ||
    !(
      checkpoint.resume === undefined ||
      (
        checkpoint.resume &&
        typeof checkpoint.resume === "object" &&
        typeof checkpoint.resume.summary === "string" &&
        Array.isArray(checkpoint.resume.risks) &&
        Array.isArray(checkpoint.resume.blockedBy)
      )
    )
  ) {
    throw new ProjectStoreError("Checkpoint intelligence pointers are invalid in project: " + projectId);
  }
  return checkpoint;
}

export class ProjectStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.outputWorkspaces = new Map();
    this.intelligence = new ProjectIntelligenceStore({
      rootDir,
      projectStore: this,
      skillCatalog: (projectId) =>
        createDefaultSkillCatalog({ projectRoot: projectDirectory(rootDir, projectId) })
    });
  }

  async createProject({ projectId, title }) {
    const normalizedTitle = requireText(title, "Tiêu đề project");
    const target = projectDirectory(this.rootDir, projectId);
    await mkdir(this.rootDir, { recursive: true });
    if (await directoryInfo(target)) {
      throw new ProjectStoreError(`Project đã tồn tại: ${projectId}`);
    }

    const staging = join(this.rootDir, `.project-${randomUUID()}`);
    const createdAt = now();
    try {
      await mkdir(join(staging, "inputs"), { recursive: true });
      await mkdir(join(staging, "resources"), { recursive: true });
      await mkdir(join(staging, "results"), { recursive: true });
      await mkdir(join(staging, "outputs"), { recursive: true });
      await mkdir(join(staging, "decisions"), { recursive: true });
      await mkdir(join(staging, "runs"), { recursive: true });
      await mkdir(join(staging, "authorizations"), { recursive: true });
      await mkdir(join(staging, "artifacts"), { recursive: true });
      await mkdir(join(staging, "workflows"), { recursive: true });
      await mkdir(join(staging, "reviews"), { recursive: true });
      await mkdir(join(staging, "skills"), { recursive: true });
      await mkdir(join(staging, "analysis", "jobs"), { recursive: true });
      await mkdir(join(staging, "analysis", "indexes"), { recursive: true });
      await mkdir(join(staging, "analysis", "leases", "archive"), { recursive: true });
      await mkdir(join(staging, "analysis", "cancellations"), { recursive: true });
      await writeJsonAtomic(join(staging, "project.json"), {
        version: PROJECT_VERSION,
        id: projectId,
        title: normalizedTitle,
        createdAt
      });
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }

    return this.readProject(projectId);
  }

  async ensureProject(projectId) {
    try {
      return await this.readProject(projectId);
    } catch (error) {
      if (!(error instanceof StoredProjectNotFoundError)) throw error;
    }

    const directory = projectDirectory(this.rootDir, projectId);
    if (await directoryInfo(directory)) {
      throw new ProjectStoreError(
        `Thư mục ${projectId} chưa phải project theo định dạng hiện tại. Hãy dùng project id khác hoặc xóa dữ liệu thử cũ.`
      );
    }
    const title = projectId
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
    try {
      return await this.createProject({ projectId, title: title || projectId });
    } catch (createError) {
      try {
        return await this.readProject(projectId);
      } catch {
        throw createError;
      }
    }
  }

  async readProject(projectId) {
    const directory = projectDirectory(this.rootDir, projectId);
    const info = await directoryInfo(directory);
    if (!info || !info.isDirectory() || info.isSymbolicLink()) {
      throw new StoredProjectNotFoundError(projectId);
    }
    try {
      return validateProject(await readJson(join(directory, "project.json")), projectId);
    } catch (error) {
      if (error?.code === "ENOENT") throw new StoredProjectNotFoundError(projectId);
      throw error;
    }
  }

  async listProjects() {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      const projects = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        try {
          projects.push(await this.readProject(entry.name));
        } catch (error) {
          if (!(error instanceof ProjectStoreError) && !(error instanceof ProjectPathError)) throw error;
        }
      }
      return projects.sort((left, right) => left.title.localeCompare(right.title, "vi"));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async startRun(projectId, {
    capability,
    inputs = {},
    purpose = null,
    tool = null,
    estimatedCostUsd = null,
    authorizationId = null
  }) {
    await this.readProject(projectId);
    objectValue(inputs, "Đầu vào run");
    if (authorizationId !== null &&
        (typeof authorizationId !== "string" || !/^authorization-[a-z0-9-]+$/.test(authorizationId))) {
      throw new ProjectStoreError("Authorization id của run không hợp lệ.");
    }
    if (estimatedCostUsd !== null && (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0)) {
      throw new ProjectStoreError("Chi phí ước lượng của run không hợp lệ.");
    }
    const run = {
      version: PROJECT_VERSION,
      id: recordId("run"),
      projectId,
      capability: requireText(capability, "Capability"),
      purpose: purpose === null ? null : requireText(purpose, "Mục đích run"),
      tool: optionalTool(tool),
      authorizationId,
      status: "in_progress",
      startedAt: now(),
      finishedAt: null,
      inputs,
      outputs: [],
      pendingResult: null,
      error: null,
      durationMs: null,
      cost: estimatedCostUsd === null ? null : {
        currency: "USD",
        estimated: estimatedCostUsd,
        actual: null
      }
    };
    await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "runs", `${run.id}.json`), run);
    return run;
  }

  async stageRunResult(projectId, runId, value) {
    const normalizedRunId = runReference(runId);
    const path = join(projectDirectory(this.rootDir, projectId), "runs", `${normalizedRunId}.json`);
    const run = validateRun(await readJson(path), projectId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError("Không thể stage Result cho Run đã kết thúc: " + runId);
    }
    objectValue(value, "Pending Result");
    const staged = { ...run, pendingResult: value };
    await writeJsonAtomic(path, staged);
    return staged;
  }

  async finishRun(projectId, runId, {
    status,
    outputs = [],
    error = null,
    durationMs = null,
    actualCostUsd = null
  }) {
    if (!["completed", "failed"].includes(status)) {
      throw new ProjectStoreError("Trạng thái kết thúc run không hợp lệ.");
    }
    const normalizedRunId = runReference(runId);
    const path = join(projectDirectory(this.rootDir, projectId), "runs", `${normalizedRunId}.json`);
    const run = validateRun(await readJson(path), projectId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError(`Run đã kết thúc: ${runId}`);
    }
    if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0)) {
      throw new ProjectStoreError("Thời lượng run không hợp lệ.");
    }
    if (actualCostUsd !== null && (!Number.isFinite(actualCostUsd) || actualCostUsd < 0)) {
      throw new ProjectStoreError("Chi phí thực tế của run không hợp lệ.");
    }
    const finishedAt = now();
    const finished = {
      ...run,
      status,
      finishedAt,
      outputs: stringList(outputs, "Outputs của run"),
      pendingResult: null,
      error: error === null ? null : String(error),
      durationMs: durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
      cost: run.cost === null ? null : {
        ...run.cost,
        actual: actualCostUsd
      }
    };
    await writeJsonAtomic(path, finished);
    return finished;
  }

  async readRun(projectId, runId) {
    const normalizedRunId = runReference(runId);
    const path = join(projectDirectory(this.rootDir, projectId), "runs", `${normalizedRunId}.json`);
    return validateRun(await readJson(path), projectId);
  }

  async addInputResource(projectId, { runId, kind, name, path, sourceName, items }) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    await this.readProject(projectId);
    const run = await this.readRun(projectId, runId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError(`Không thể thêm resource vào run đã kết thúc: ${runId}`);
    }
    if (
      !["file", "folder"].includes(kind) ||
      !Array.isArray(items) ||
      (kind === "file" && items.length !== 1)
    ) {
      throw new ProjectStoreError("Thông tin resource nhập không hợp lệ.");
    }
    const resource = {
      version: PROJECT_VERSION,
      id: recordId("resource"),
      projectId,
      role: "input",
      kind,
      name: requireText(name, "Tên resource"),
      path: toProjectRelativePath(projectRoot, resolveProjectPath(projectRoot, path)),
      source: { name: requireText(sourceName, "Tên nguồn") },
      createdAt: now(),
      createdByRun: requireText(runId, "Run tạo resource"),
      items: items.map((item) => ({
        path: toProjectRelativePath(projectRoot, resolveProjectPath(projectRoot, item.path)),
        name: requireText(item.name, "Tên file"),
        relativePath: requireText(item.relativePath, "Đường dẫn tương đối"),
        sizeBytes: item.sizeBytes,
        modifiedAt: item.modifiedAt,
        mediaType: item.mediaType
      }))
    };
    validateResource(resource, projectId, projectRoot);
    await writeJsonAtomic(join(projectRoot, "resources", `${resource.id}.json`), resource);
    return resource;
  }

  async readResources(projectId) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    await this.readProject(projectId);
    const resources = await readRecords(join(projectRoot, "resources"));
    const validated = resources
      .map((resource) => validateResource(resource, projectId, projectRoot))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return Promise.all(validated.map(async (resource) => ({
      ...resource,
      available: await storedPathAvailable(projectRoot, resource.path, resource.kind),
      items: await Promise.all(resource.items.map(async (item) => ({
        ...item,
        available: await storedPathAvailable(projectRoot, item.path, "file")
      })))
    })));
  }

  async resolveInputResourceItem(projectId, { resourceId, itemPath = null }) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const resources = await this.readResources(projectId);
    const resource = resources.find((candidate) => candidate.id === resourceId);
    if (!resource) {
      throw new ProjectStoreError("Không tìm thấy resource đầu vào: " + resourceId);
    }

    let item;
    if (resource.kind === "file") {
      if (itemPath !== null && itemPath !== resource.items[0]?.relativePath) {
        throw new ProjectStoreError("Resource " + resourceId + " không chứa file: " + itemPath);
      }
      item = resource.items[0];
    } else {
      if (typeof itemPath !== "string" || !itemPath.trim()) {
        throw new ProjectStoreError("Cần chỉ rõ itemPath cho resource folder: " + resourceId);
      }
      item = resource.items.find((candidate) => candidate.relativePath === itemPath);
    }
    if (!item) {
      throw new ProjectStoreError("Resource " + resourceId + " không chứa file: " + (itemPath ?? ""));
    }

    const inputRoot = join(projectRoot, "inputs");
    const inputInfo = await directoryInfo(inputRoot);
    if (!inputInfo?.isDirectory() || inputInfo.isSymbolicLink()) {
      throw new ProjectStoreError("Thư mục inputs không an toàn hoặc không còn tồn tại.");
    }
    const candidatePath = resolveProjectPath(projectRoot, item.path);
    if (!isPathInside(inputRoot, candidatePath)) {
      throw new ProjectStoreError("File của resource " + resourceId + " phải nằm trong inputs.");
    }
    try {
      const [resolvedInputRoot, resolvedFile] = await Promise.all([
        realpath(inputRoot),
        realpath(candidatePath)
      ]);
      const info = await lstat(candidatePath);
      if (info.isSymbolicLink() || !info.isFile() || !isPathInside(resolvedInputRoot, resolvedFile)) {
        throw new ProjectStoreError(
          "File của resource " + resourceId + " không an toàn hoặc không còn tồn tại."
        );
      }
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        itemPath: item.relativePath,
        itemName: item.name,
        mediaType: item.mediaType,
        filePath: resolvedFile
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ProjectStoreError("File của resource " + resourceId + " không còn tồn tại.");
      }
      throw error;
    }
  }

  async createRunOutputWorkspace(projectId, runId) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const run = await this.readRun(projectId, runId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError("Không thể tạo output cho run đã kết thúc: " + runId);
    }
    const outputRoot = join(projectRoot, "outputs");
    await mkdir(outputRoot, { recursive: true });
    const rootInfo = await lstat(outputRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new ProjectStoreError("Thư mục outputs không an toàn.");
    }
    const finalDirectory = join(outputRoot, runId);
    if (await directoryInfo(finalDirectory)) {
      throw new ProjectStoreError("Output của run đã tồn tại: " + runId);
    }
    const token = randomUUID();
    const temporaryDirectory = join(outputRoot, "." + runId + "-" + token);
    await mkdir(temporaryDirectory);
    const workspace = {
      token,
      projectId,
      runId,
      temporaryDirectory,
      finalDirectory,
      projectRelativeDirectory: "outputs/" + runId
    };
    this.outputWorkspaces.set(token, { ...workspace, committed: false });
    return workspace;
  }

  async commitRunOutputWorkspace(workspace) {
    const registered = this.#registeredOutputWorkspace(workspace);
    const info = await directoryInfo(registered.temporaryDirectory);
    if (!info?.isDirectory() || info.isSymbolicLink()) {
      throw new ProjectStoreError("Output tạm không an toàn hoặc không còn tồn tại.");
    }
    if (await directoryInfo(registered.finalDirectory)) {
      throw new ProjectStoreError("Output đích đã tồn tại: " + registered.runId);
    }
    await renameAtomicWithRetry(registered.temporaryDirectory, registered.finalDirectory);
    registered.committed = true;
  }

  async discardRunOutputWorkspace(workspace) {
    const registered = this.#registeredOutputWorkspace(workspace);
    this.outputWorkspaces.delete(registered.token);
    const target = registered.committed
      ? registered.finalDirectory
      : registered.temporaryDirectory;
    await rm(target, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 20 : 0, retryDelay: 100 });
  }

  releaseRunOutputWorkspace(workspace) {
    const registered = this.#registeredOutputWorkspace(workspace);
    if (!registered.committed) {
      throw new ProjectStoreError("Không thể bàn giao workspace output chưa commit.");
    }
    this.outputWorkspaces.delete(registered.token);
  }

  #registeredOutputWorkspace(workspace) {
    const registered = workspace && this.outputWorkspaces.get(workspace.token);
    if (
      !registered ||
      workspace.projectId !== registered.projectId ||
      workspace.runId !== registered.runId ||
      workspace.temporaryDirectory !== registered.temporaryDirectory ||
      workspace.finalDirectory !== registered.finalDirectory
    ) {
      throw new ProjectStoreError("Workspace output không do ProjectStore cấp.");
    }
    return registered;
  }

  async resolveResultFile(projectId, resultId, fileId) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const result = await this.readResult(projectId, resultId);
    const normalizedFileId = resultFileReference(fileId);
    const file = result.files.find((candidate) => candidate.id === normalizedFileId);
    if (!file) {
      throw new ProjectStoreError("Result " + resultId + " không chứa file: " + normalizedFileId);
    }
    const outputRoot = join(projectRoot, "outputs");
    const runOutputRoot = join(outputRoot, result.createdByRun);
    const outputRootInfo = await directoryInfo(outputRoot);
    const runOutputInfo = await directoryInfo(runOutputRoot);
    if (
      !outputRootInfo?.isDirectory() ||
      outputRootInfo.isSymbolicLink() ||
      !runOutputInfo?.isDirectory() ||
      runOutputInfo.isSymbolicLink()
    ) {
      throw new ProjectStoreError("Thư mục outputs không an toàn hoặc không còn tồn tại.");
    }
    const candidatePath = resolveProjectPath(projectRoot, file.path);
    if (!isPathInside(runOutputRoot, candidatePath)) {
      throw new ProjectStoreError("File của result phải nằm trong output của run đã tạo nó.");
    }
    try {
      const [resolvedRunOutputRoot, resolvedFile] = await Promise.all([
        realpath(runOutputRoot),
        realpath(candidatePath)
      ]);
      const info = await lstat(candidatePath);
      if (info.isSymbolicLink() || !info.isFile() || !isPathInside(resolvedRunOutputRoot, resolvedFile)) {
        throw new ProjectStoreError("File của result không an toàn hoặc không còn tồn tại.");
      }
      if (info.size !== file.sizeBytes) {
        throw new ProjectStoreError("Kích thước file của result không khớp với bản ghi.");
      }
      return { ...file, filePath: resolvedFile, size: info.size, resultId: result.id };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ProjectStoreError("File của result không còn tồn tại.");
      }
      throw error;
    }
  }

  async verifyResultFile(projectId, resultId, fileId, { requireChecksum = true } = {}) {
    const [result, resolved] = await Promise.all([
      this.readResult(projectId, resultId),
      this.resolveResultFile(projectId, resultId, fileId)
    ]);
    const file = result.files.find((candidate) => candidate.id === resolved.id);
    const fallbackChecksum = resultDataChecksum(result, resolved.id);
    const expectedSha256 = file?.sha256 ?? fallbackChecksum?.sha256;
    if (!expectedSha256) {
      if (requireChecksum) {
        throw new ProjectStoreError("Result file không có SHA-256 để xác minh byte chính xác.");
      }
      return { ...resolved, integrity: "legacy_unchecked", sha256: null, checksumSource: null };
    }
    const actualSha256 = await sha256File(resolved.filePath);
    if (actualSha256 !== expectedSha256) {
      throw new ProjectStoreError("SHA-256 file của result không khớp với bản ghi.");
    }
    return {
      ...resolved,
      integrity: "verified",
      sha256: actualSha256,
      checksumSource: file?.sha256 ? "file" : fallbackChecksum.source
    };
  }

  async resolveMediaSource(projectId, source) {
    objectValue(source, "Nguồn media");
    if (source.kind === "resource") {
      const input = await this.resolveInputResourceItem(projectId, {
        resourceId: source.id,
        itemPath: source.itemPath ?? null
      });
      return {
        filePath: input.filePath,
        mediaType: input.mediaType,
        itemName: input.itemName,
        trace: { kind: "resource", id: input.resourceId, itemPath: input.itemPath },
        inputResources: [input.resourceId],
        inputResults: []
      };
    }
    if (source.kind === "result") {
      const file = await this.verifyResultFile(
        projectId, source.id, source.file ?? "primary", { requireChecksum: false }
      );
      return {
        filePath: file.filePath,
        mediaType: file.mediaType,
        itemName: file.name,
        trace: { kind: "result", id: source.id, file: file.id },
        inputResources: [],
        inputResults: [source.id]
      };
    }
    throw new ProjectStoreError("Nguồn media phải là resource hoặc result.");
  }

  async addResult(projectId, {
    runId,
    type,
    name,
    capability,
    inputResources,
    inputResults = [],
    inputArtifacts = [],
    files = [],
    tool,
    data,
    verification,
    runCompletion = null
  }) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const run = await this.readRun(projectId, runId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError("Không thể thêm kết quả vào run đã kết thúc: " + runId);
    }
    const normalizedCapability = requireText(capability, "Capability của kết quả");
    const normalizedType = requireText(type, "Loại kết quả");
    const normalizedTool = optionalTool(tool);
    if (run.capability !== normalizedCapability) {
      throw new ProjectStoreError("Capability của kết quả không khớp với run.");
    }
    if (
      !run.tool ||
      run.tool.name !== normalizedTool?.name ||
      run.tool.version !== normalizedTool?.version ||
      run.tool.provider !== normalizedTool?.provider
    ) {
      throw new ProjectStoreError("Công cụ của kết quả không khớp với run.");
    }
    const resourceIds = new Set((await this.readResources(projectId)).map((resource) => resource.id));
    const normalizedInputs = stringList(inputResources, "Resource đầu vào của kết quả");
    const missing = normalizedInputs.filter((id) => !resourceIds.has(id));
    if (missing.length) {
      throw new ProjectStoreError("Kết quả tham chiếu resource không tồn tại: " + missing.join(", "));
    }
    const existingResultIds = new Set((await this.readResults(projectId)).map((item) => item.id));
    const normalizedInputResults = stringList(inputResults, "Result đầu vào của kết quả");
    const missingResults = normalizedInputResults.filter((id) => !existingResultIds.has(id));
    if (missingResults.length) {
      throw new ProjectStoreError("Kết quả tham chiếu result không tồn tại: " + missingResults.join(", "));
    }
    const artifactIds = new Set((await this.readArtifacts(projectId)).map((artifact) => artifact.id));
    const normalizedInputArtifacts = stringList(inputArtifacts, "Input artifact IDs");
    if (normalizedInputArtifacts.some((id) => !artifactIds.has(id))) {
      throw new ProjectStoreError("Result references an unknown input artifact.");
    }
    if (!Array.isArray(files)) {
      throw new ProjectStoreError("Files của kết quả phải là một danh sách.");
    }
    const normalizedFiles = files.map((file) => ({
      id: resultFileReference(file?.id),
      role: requireText(file?.role, "Vai trò file"),
      path: requireText(file?.path, "Đường dẫn file"),
      name: requireText(file?.name, "Tên file"),
      mediaType: requireText(file?.mediaType, "Loại media"),
      sizeBytes: file?.sizeBytes,
      ...(file?.sha256 === undefined ? {} : { sha256: file.sha256 })
    }));
    if (new Set(normalizedFiles.map((file) => file.id)).size !== normalizedFiles.length) {
      throw new ProjectStoreError("File id trong kết quả phải là duy nhất.");
    }
    const outputRoot = join(projectRoot, "outputs");
    const runOutputRoot = join(outputRoot, runId);
    const outputRootInfo = await directoryInfo(outputRoot);
    const runOutputInfo = await directoryInfo(runOutputRoot);
    if (
      normalizedFiles.length &&
      (
        !outputRootInfo?.isDirectory() ||
        outputRootInfo.isSymbolicLink() ||
        !runOutputInfo?.isDirectory() ||
        runOutputInfo.isSymbolicLink()
      )
    ) {
      throw new ProjectStoreError("Thư mục outputs không an toàn hoặc không còn tồn tại.");
    }
    for (const file of normalizedFiles) {
      if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) {
        throw new ProjectStoreError("Kích thước file kết quả không hợp lệ.");
      }
      const candidatePath = resolveProjectPath(projectRoot, file.path);
      if (!isPathInside(runOutputRoot, candidatePath)) {
        throw new ProjectStoreError("File kết quả phải nằm trong output của run hiện tại.");
      }
      const [resolvedRunOutputRoot, resolvedFile] = await Promise.all([
        realpath(runOutputRoot),
        realpath(candidatePath)
      ]);
      const info = await lstat(candidatePath);
      if (info.isSymbolicLink() || !info.isFile() || !isPathInside(resolvedRunOutputRoot, resolvedFile)) {
        throw new ProjectStoreError("File kết quả không an toàn.");
      }
      if (info.size !== file.sizeBytes) {
        throw new ProjectStoreError("Kích thước file kết quả không khớp với file đã ghi.");
      }
      const checksum = await sha256File(resolvedFile);
      if (file.sha256 !== undefined && file.sha256 !== checksum) {
        throw new ProjectStoreError("SHA-256 file kết quả không khớp với file đã ghi.");
      }
      file.sha256 = checksum;
    }
    const result = {
      version: PROJECT_VERSION,
      id: recordId("result"),
      projectId,
      type: normalizedType,
      name: requireText(name, "Tên kết quả"),
      capability: normalizedCapability,
      inputResources: normalizedInputs,
      inputResults: normalizedInputResults,
      inputArtifacts: normalizedInputArtifacts,
      files: normalizedFiles,
      tool: normalizedTool,
      data: objectValue(data, "Dữ liệu kết quả"),
      verification: objectValue(verification, "Kiểm tra kết quả"),
      runCompletion,
      createdAt: now(),
      createdByRun: requireText(runId, "Run tạo kết quả")
    };
    validateResult(result, projectId);
    await writeJsonAtomic(join(projectRoot, "results", result.id + ".json"), result);
    return result;
  }

  async discardResult(projectId, resultId, runId) {
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const normalizedResultId = resultReference(resultId);
    const path = join(projectRoot, "results", normalizedResultId + ".json");
    const result = validateResult(await readJson(path), projectId);
    if (result.createdByRun !== runId) {
      throw new ProjectStoreError("Run " + runId + " không tạo kết quả " + resultId + ".");
    }
    await rm(path, { force: true });
  }

  async readResult(projectId, resultId) {
    await this.readProject(projectId);
    const normalizedResultId = resultReference(resultId);
    try {
      const projectRoot = projectDirectory(this.rootDir, projectId);
      const result = validateResult(
        await readJson(
          join(projectRoot, "results", normalizedResultId + ".json")
        ),
        projectId
      );
      return resultWithAvailability(projectRoot, result);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ProjectStoreError("Không tìm thấy result trong project: " + normalizedResultId);
      }
      throw error;
    }
  }

  async readResults(projectId) {
    await this.readProject(projectId);
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const results = await readRecords(join(projectRoot, "results"));
    const validated = results
      .map((result) => validateResult(result, projectId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return Promise.all(validated.map((result) => resultWithAvailability(projectRoot, result)));
  }

  async #normalizeFeedbackTarget(projectId, result, value) {
    if (value === null || value === undefined) return null;
    const target = objectValue(value, "Feedback target");
    const unknown = Object.keys(target).filter(
      (key) => !["artifactId", "revision", "segmentId", "timeRange"].includes(key)
    );
    if (unknown.length) {
      throw new ProjectStoreError("Feedback target contains unsupported fields: " + unknown.join(", "));
    }
    if (result.type !== "video.sequence-render") {
      throw new ProjectStoreError("Structured feedback target is only supported for a video sequence render.");
    }
    const artifactId = requireText(target.artifactId, "Feedback artifact id");
    if (!Number.isInteger(target.revision) || target.revision < 1) {
      throw new ProjectStoreError("Feedback artifact revision must be a positive integer.");
    }
    const artifact = (await this.readArtifacts(projectId)).find((candidate) => candidate.id === artifactId);
    if (!artifact || artifact.type !== "video.sequence") {
      throw new ProjectStoreError("Feedback targets an unknown video sequence artifact: " + artifactId);
    }
    if (result.data?.sequence?.artifactId !== artifact.id || artifact.revision !== target.revision) {
      throw new ProjectStoreError("Feedback target does not match the exact Result artifact revision.");
    }
    const segmentId = target.segmentId === undefined
      ? null
      : requireText(target.segmentId, "Feedback segment id");
    const segment = segmentId
      ? artifact.data.segments.find((candidate) => candidate.id === segmentId)
      : null;
    if (segmentId && (!segment || !(result.data?.segments ?? []).some((candidate) => candidate.id === segmentId))) {
      throw new ProjectStoreError("Feedback targets a segment that is not present in the exact Result.");
    }
    let timeRange = null;
    if (target.timeRange !== undefined) {
      const range = objectValue(target.timeRange, "Feedback time range");
      const unknownRange = Object.keys(range).filter(
        (key) => !["startSeconds", "endSeconds"].includes(key)
      );
      if (unknownRange.length || Object.keys(range).length !== 2) {
        throw new ProjectStoreError("Feedback time range must contain only startSeconds and endSeconds.");
      }
      const { startSeconds, endSeconds } = range;
      const duration = sequenceDuration(artifact.data);
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
          startSeconds < 0 || endSeconds <= startSeconds || endSeconds > duration + 1e-6) {
        throw new ProjectStoreError("Feedback time range is outside the exact Result duration.");
      }
      if (segment) {
        const segmentRange = compositionTimeline(artifact.data)
          .find((candidate) => candidate.segmentId === segmentId);
        if (!segmentRange || startSeconds < segmentRange.startSeconds - 1e-6 ||
            endSeconds > segmentRange.endSeconds + 1e-6) {
          throw new ProjectStoreError("Feedback time range is outside the selected segment.");
        }
      }
      timeRange = { startSeconds, endSeconds };
    }
    return {
      artifactId,
      revision: target.revision,
      ...(segmentId ? { segmentId } : {}),
      ...(timeRange ? { timeRange } : {})
    };
  }

  async recordDecision(projectId, value, { humanConfirmation = null } = {}) {
    if (value?.target) return this.recordProjectDecision(projectId, value, { humanConfirmation });
    objectValue(value, "Nội dung quyết định");
    const allowedFields = new Set(["resultId", "outcome", "note", "feedbackTarget", "resolvesDecisionIds"]);
    const unknownFields = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      throw new ProjectStoreError(
        "Quyết định chứa field không được hỗ trợ: " + unknownFields.join(", ")
      );
    }
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "decisions",
      action: async () => {
        const resultId = resultReference(value.resultId);
        const result = await this.readResult(projectId, resultId);
        const outcome = requireText(value.outcome, "Kết quả quyết định");
        if (!["accepted", "changes_requested", "rejected"].includes(outcome)) {
          throw new ProjectStoreError("Kết quả quyết định không được hỗ trợ: " + outcome);
        }
        const note = value.note === null || value.note === undefined
          ? null
          : requireText(value.note, "Phản hồi quyết định");
        if (outcome === "changes_requested" && note === null) {
          throw new ProjectStoreError("Quyết định yêu cầu sửa phải có phản hồi.");
        }
        const feedbackTarget = await this.#normalizeFeedbackTarget(projectId, result, value.feedbackTarget);
        if (result.type === "video.sequence-render" && feedbackTarget === null) {
          throw new ProjectStoreError("A video sequence Result decision requires an exact feedbackTarget.");
        }
        const confirmation = result.type === "video.sequence-render" && outcome === "accepted"
          ? requireHumanConfirmation(humanConfirmation, "accept_video", result.id)
          : null;
        const resolvesDecisionIds = stringList(value.resolvesDecisionIds, "Decision IDs được giải quyết");
        if (new Set(resolvesDecisionIds).size !== resolvesDecisionIds.length) {
          throw new ProjectStoreError("Decision IDs được giải quyết phải là duy nhất.");
        }
        if (resolvesDecisionIds.length && outcome !== "accepted") {
          throw new ProjectStoreError("Chỉ decision accepted mới được giải quyết phản hồi đang chờ.");
        }
        const existingDecisions = await this.readDecisions(projectId);
        const resolved = new Set(existingDecisions.flatMap((decision) => decision.resolvesDecisionIds ?? []));
        for (const decisionId of resolvesDecisionIds) {
          const pending = existingDecisions.find((decision) => decision.id === decisionId);
          if (!pending || pending.kind === "project_decision" || pending.outcome !== "changes_requested") {
            throw new ProjectStoreError("Decision cần giải quyết không phải phản hồi changes_requested hợp lệ: " + decisionId);
          }
          if (resolved.has(decisionId)) {
            throw new ProjectStoreError("Phản hồi đã được giải quyết: " + decisionId);
          }
        }
        const latestTimestamp = existingDecisions.reduce(
          (latest, decision) => Math.max(latest, Date.parse(decision.createdAt)),
          0
        );
        const decision = {
          version: PROJECT_VERSION,
          id: recordId("decision"),
          projectId,
          resultId,
          outcome,
          note,
          feedbackTarget,
          resolvesDecisionIds,
          decidedBy: "user",
          ...(confirmation ? { confirmation: createHumanConfirmation("accept_video", result.id) } : {}),
          createdAt: new Date(Math.max(Date.now(), latestTimestamp + 1)).toISOString()
        };
        validateDecision(decision, projectId);
        await writeJsonAtomic(
          join(projectDirectory(this.rootDir, projectId), "decisions", decision.id + ".json"),
          decision
        );
        return decision;
      }
    });
  }
  async recordProjectDecision(projectId, value, { humanConfirmation = null } = {}) {
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "decisions",
      action: () => this.#recordProjectDecisionUnlocked(projectId, value, { humanConfirmation })
    });
  }

  async #recordProjectDecisionUnlocked(projectId, value, { humanConfirmation = null } = {}) {
    objectValue(value, "Project decision");
    const allowedFields = new Set([
      "target", "category", "subject", "outcome", "options", "selected",
      "reason", "decidedBy", "userVisible", "confidence"
    ]);
    const unknownFields = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      throw new ProjectStoreError("Project decision contains unsupported fields: " + unknownFields.join(", "));
    }
    const target = objectValue(value.target, "Decision target");
    const targetKind = requireText(target.kind, "Decision target kind");
    let normalizedTarget;
    if (["project", "artifact", "result", "workflow"].includes(targetKind)) {
      const unknownTargetFields = Object.keys(target).filter((key) => !["kind", "id"].includes(key));
      if (unknownTargetFields.length) {
        throw new ProjectStoreError("Decision target contains unsupported fields: " + unknownTargetFields.join(", "));
      }
      normalizedTarget = { kind: targetKind, id: requireText(target.id, "Decision target id") };
    } else if (targetKind === "work_item") {
      const unknownTargetFields = Object.keys(target).filter(
        (key) => !["kind", "workflowId", "workItemId"].includes(key)
      );
      if (unknownTargetFields.length) {
        throw new ProjectStoreError("Decision target contains unsupported fields: " + unknownTargetFields.join(", "));
      }
      normalizedTarget = {
        kind: targetKind,
        workflowId: requireText(target.workflowId, "Workflow id"),
        workItemId: requireText(target.workItemId, "Work item id")
      };
    } else {
      throw new ProjectStoreError("Decision target kind is not supported: " + targetKind);
    }
    await this.#assertDecisionTarget(projectId, normalizedTarget);
    const options = value.options ?? [];
    if (!Array.isArray(options)) throw new ProjectStoreError("Decision options must be an array.");
    const normalizedOptions = options.map((option, index) => {
      objectValue(option, "Decision option " + index);
      const unknownOptionFields = Object.keys(option).filter(
        (key) => !["id", "label", "description"].includes(key)
      );
      if (unknownOptionFields.length) {
        throw new ProjectStoreError("Decision option contains unsupported fields: " + unknownOptionFields.join(", "));
      }
      return {
        id: requireText(option.id, "Decision option id"),
        label: requireText(option.label, "Decision option label"),
        description: option.description == null ? null : requireText(option.description, "Decision option description")
      };
    });
    if (new Set(normalizedOptions.map((option) => option.id)).size !== normalizedOptions.length) {
      throw new ProjectStoreError("Decision option IDs must be unique.");
    }
    const outcome = requireText(value.outcome, "Decision outcome");
    if (!["approved", "changes_requested", "rejected", "recorded"].includes(outcome)) {
      throw new ProjectStoreError("Decision outcome is not supported: " + outcome);
    }
    const selected = value.selected == null ? null : requireText(value.selected, "Selected option");
    if (selected && !normalizedOptions.some((option) => option.id === selected)) {
      throw new ProjectStoreError("Selected decision option does not exist.");
    }
    if (outcome === "recorded" && (normalizedOptions.length < 2 || !selected)) {
      throw new ProjectStoreError("A recorded choice requires at least two options and a selection.");
    }
    const decidedBy = value.decidedBy ?? "agent";
    if (value.category === "animation_code_execution") {
      throw new ProjectStoreError("animation_code_execution is retired; managed animation execution no longer records a user code-approval decision.");
    }
    if (normalizedTarget.kind === "work_item" && outcome === "approved" && decidedBy !== "user") {
      throw new ProjectStoreError("A work item approval must be decided by the user.");
    }
    const binding = normalizedTarget.kind === "work_item" && outcome !== "recorded"
      ? await this.intelligence.createWorkItemDecisionBinding(
          projectId,
          normalizedTarget.workflowId,
          normalizedTarget.workItemId
        )
      : null;
    const existingDecisions = await this.readDecisions(projectId);
    const latestTimestamp = existingDecisions.reduce(
      (latest, entry) => Math.max(latest, Date.parse(entry.createdAt)),
      0
    );
    const decision = {
      version: PROJECT_VERSION,
      kind: "project_decision",
      id: recordId("decision"),
      projectId,
      target: normalizedTarget,
      category: requireText(value.category, "Decision category"),
      subject: requireText(value.subject, "Decision subject"),
      outcome,
      options: normalizedOptions,
      selected,
      reason: requireText(value.reason, "Decision reason"),
      decidedBy,
      userVisible: value.userVisible ?? true,
      confidence: value.confidence ?? null,
      ...(binding ? { binding } : {}),
      createdAt: new Date(Math.max(Date.now(), latestTimestamp + 1)).toISOString()
    };
    validateDecision(decision, projectId);
    await writeJsonAtomic(
      join(projectDirectory(this.rootDir, projectId), "decisions", decision.id + ".json"),
      decision
    );
    return decision;
  }

  async #assertDecisionTarget(projectId, target) {
    if (target.kind === "project") {
      if (target.id !== projectId) throw new ProjectStoreError("Decision targets another project.");
      await this.readProject(projectId);
      return;
    }
    if (target.kind === "result") {
      await this.readResult(projectId, target.id);
      return;
    }
    if (target.kind === "artifact") {
      if (!(await this.readArtifacts(projectId)).some((artifact) => artifact.id === target.id)) {
        throw new ProjectStoreError("Decision targets an unknown artifact: " + target.id);
      }
      return;
    }
    const workflow = (await this.readWorkflows(projectId))
      .filter((candidate) => candidate.id === (target.id ?? target.workflowId))
      .at(-1);
    if (!workflow) throw new ProjectStoreError("Decision targets an unknown workflow.");
    if (target.kind === "work_item" && !workflow.items.some((item) => item.id === target.workItemId)) {
      throw new ProjectStoreError("Decision targets an unknown work item.");
    }
  }

  async readDecisions(projectId) {
    await this.readProject(projectId);
    const decisions = await readRecords(join(projectDirectory(this.rootDir, projectId), "decisions"));
    return decisions
      .map((decision) => validateDecision(decision, projectId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async readRuns(projectId) {
    await this.readProject(projectId);
    const runs = await readRecords(join(projectDirectory(this.rootDir, projectId), "runs"));
    return runs
      .map((run) => validateRun(run, projectId))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async recoverRunFinalization(projectId, runId) {
    const normalizedRunId = runReference(runId);
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "run-finalization-" + normalizedRunId,
      action: () => this.#recoverRunFinalizationUnlocked(projectId, normalizedRunId)
    });
  }

  async #recoverRunFinalizationUnlocked(projectId, runId) {
    const run = await this.readRun(projectId, runId);
    if (run.status === "completed") return run;
    if (run.status !== "in_progress") {
      throw new ProjectStoreError(`Run không thể được phục hồi từ trạng thái ${run.status}: ${runId}`);
    }
    let results = (await this.readResults(projectId)).filter(
      (result) => result.createdByRun === runId
    );
    if (results.length === 0 && run.pendingResult) {
      await this.addResult(projectId, {
        runId,
        ...run.pendingResult
      });
      results = (await this.readResults(projectId)).filter(
        (result) => result.createdByRun === runId
      );
    }
    if (results.length !== 1) {
      throw new ProjectStoreError(
        `Run ${runId} cần đúng một result bền vững để hoàn tất lại.`
      );
    }
    const [result] = results;
    if (!result.runCompletion) {
      throw new ProjectStoreError(`Result của run ${runId} không có dữ liệu hoàn tất.`);
    }
    if (result.files.some((file) => !file.available)) {
      throw new ProjectStoreError(`Output của run ${runId} không còn đầy đủ.`);
    }
    if (run.authorizationId) {
      const authorization = (await readExecutionAuthorizations(this, projectId))
        .find((candidate) => candidate.id === run.authorizationId);
      if (!authorization) {
        throw new ProjectStoreError(`Authorization của run ${runId} không còn tồn tại.`);
      }
      if (authorization.status === "claimed") {
        if (!authorization.providerResponseReceivedAt) {
          throw new ProjectStoreError(
            `Authorization của run ${runId} chưa có provider receipt để phục hồi an toàn.`
          );
        }
        await settleExecutionAuthorization(this, projectId, authorization.id, {
          status: "consumed",
          actualUsage: authorization.actualUsage,
          providerRequestId: authorization.providerRequestId,
          traceId: authorization.traceId
        });
      } else if (authorization.status !== "consumed") {
        throw new ProjectStoreError(
          `Authorization của run ${runId} có trạng thái không thể phục hồi: ${authorization.status}.`
        );
      }
    }
    return this.finishRun(projectId, runId, {
      status: "completed",
      outputs: [result.id],
      durationMs: result.runCompletion.durationMs,
      actualCostUsd: result.runCompletion.actualCostUsd
    });
  }

  async writeCheckpoint(projectId, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProjectStoreError("Nội dung checkpoint phải là một JSON object.");
    }
    const allowedFields = new Set([
      "goal", "constraints", "selectedResources", "pending", "next",
      "activeWorkflowId", "activeWorkItemId", "activeArtifacts", "pendingDecisions", "resume"
    ]);
    const unknownFields = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      throw new ProjectStoreError(`Checkpoint chứa field không được hỗ trợ: ${unknownFields.join(", ")}`);
    }
    const project = await this.readProject(projectId);
    const resources = await this.readResources(projectId);
    const resourceIds = new Set(resources.map((resource) => resource.id));
    const selectedResources = stringList(value.selectedResources, "Resource được chọn");
    const missing = selectedResources.filter((id) => !resourceIds.has(id));
    if (missing.length) {
      throw new ProjectStoreError(`Checkpoint tham chiếu resource không tồn tại: ${missing.join(", ")}`);
    }

    const checkpoint = {
      version: PROJECT_VERSION,
      projectId,
      updatedAt: now(),
      goal: requireText(value.goal, "Mục tiêu"),
      constraints: stringList(value.constraints, "Ràng buộc"),
      selectedResources,
      pending: stringList(value.pending, "Việc đang chờ"),
      next: value.next === null || value.next === undefined ? null : requireText(value.next, "Việc tiếp theo")
    };
    if (value.activeWorkflowId !== undefined) {
      checkpoint.activeWorkflowId =
        value.activeWorkflowId === null ? null : requireText(value.activeWorkflowId, "Active workflow id");
    }
    if (value.activeWorkItemId !== undefined) {
      checkpoint.activeWorkItemId =
        value.activeWorkItemId === null ? null : requireText(value.activeWorkItemId, "Active work item id");
    }
    if (value.activeArtifacts !== undefined) {
      checkpoint.activeArtifacts = stringList(value.activeArtifacts, "Active artifacts");
    }
    if (value.pendingDecisions !== undefined) {
      checkpoint.pendingDecisions = stringList(value.pendingDecisions, "Pending decisions");
    }
    if (value.resume !== undefined) {
      objectValue(value.resume, "Resume state");
      checkpoint.resume = {
        summary: requireText(value.resume.summary, "Resume summary"),
        risks: stringList(value.resume.risks, "Resume risks"),
        blockedBy: stringList(value.resume.blockedBy, "Resume blockers")
      };
    }
    await this.#assertCheckpointPointers(projectId, checkpoint);
    validateCheckpoint(checkpoint, projectId);

    const projectRoot = projectDirectory(this.rootDir, projectId);
    await writeJsonAtomic(join(projectRoot, "checkpoint.json"), checkpoint);
    const selectedNames = resources
      .filter((resource) => selectedResources.includes(resource.id))
      .map((resource) => `- ${resource.name}`);
    const overview = [
      `# ${project.title}`,
      "",
      checkpoint.goal,
      ...(checkpoint.constraints.length ? ["", "## Ràng buộc", "", ...checkpoint.constraints.map((item) => `- ${item}`)] : []),
      ...(selectedNames.length ? ["", "## Tư liệu đang chọn", "", ...selectedNames] : []),
      ...(checkpoint.pending.length ? ["", "## Đang chờ", "", ...checkpoint.pending.map((item) => `- ${item}`)] : []),
      ...(checkpoint.next ? ["", "## Tiếp theo", "", checkpoint.next] : []),
      ""
    ].join("\n");
    await writeTextAtomic(join(projectRoot, "overview.md"), overview);
    return checkpoint;
  }

  async #assertCheckpointPointers(projectId, checkpoint) {
    if (checkpoint.activeWorkflowId) {
      const workflow = (await this.readWorkflows(projectId))
        .filter((candidate) => candidate.id === checkpoint.activeWorkflowId)
        .at(-1);
      if (!workflow) throw new ProjectStoreError("Checkpoint targets an unknown workflow.");
      if (
        checkpoint.activeWorkItemId &&
        !workflow.items.some((item) => item.id === checkpoint.activeWorkItemId)
      ) {
        throw new ProjectStoreError("Checkpoint targets an unknown work item.");
      }
    } else if (checkpoint.activeWorkItemId) {
      throw new ProjectStoreError("Active work item requires an active workflow.");
    }
    if (checkpoint.activeArtifacts) {
      const known = new Set((await this.readArtifacts(projectId)).map((artifact) => artifact.id));
      const missing = checkpoint.activeArtifacts.filter((id) => !known.has(id));
      if (missing.length) throw new ProjectStoreError("Checkpoint targets unknown artifacts: " + missing.join(", "));
    }
    if (checkpoint.pendingDecisions) {
      const known = new Set((await this.readDecisions(projectId)).map((decision) => decision.id));
      const missing = checkpoint.pendingDecisions.filter((id) => !known.has(id));
      if (missing.length) throw new ProjectStoreError("Checkpoint targets unknown decisions: " + missing.join(", "));
    }
  }

  async readCheckpoint(projectId) {
    await this.readProject(projectId);
    try {
      return validateCheckpoint(
        await readJson(join(projectDirectory(this.rootDir, projectId), "checkpoint.json")),
        projectId
      );
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async readOverview(projectId) {
    await this.readProject(projectId);
    try {
      return await readFile(join(projectDirectory(this.rootDir, projectId), "overview.md"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async readContext(projectId) {
    const [project, checkpoint, resources, results, decisions, runs, authorizations, overview, budgetPolicy] = await Promise.all([
      this.readProject(projectId),
      this.readCheckpoint(projectId),
      this.readResources(projectId),
      this.readResults(projectId),
      this.readDecisions(projectId),
      this.readRuns(projectId),
      readExecutionAuthorizations(this, projectId),
      this.readOverview(projectId),
      readProjectBudget(this, projectId)
    ]);
    const intelligence = await this.intelligence.readIntelligence(projectId);
    const projectRoot = projectDirectory(this.rootDir, projectId);
    const pendingFinalizations = await Promise.all(runs
      .filter((run) => run.status === "in_progress")
      .map(async (run) => {
        const durableResults = results.filter((result) => result.createdByRun === run.id);
        const pendingFiles = Array.isArray(run.pendingResult?.files) ? run.pendingResult.files : [];
        const pendingOutputRoot = join(projectRoot, "outputs", run.id);
        const pendingFilesAvailable = pendingFiles.length > 0 && (await Promise.all(
          pendingFiles.map((file) => storedPathAvailable(
            projectRoot, file.path, "file", pendingOutputRoot
          ))
        )).every(Boolean);
        return {
          runId: run.id,
          resultIds: durableResults.map((result) => result.id),
          recoverable:
            (durableResults.length === 1 &&
              Boolean(durableResults[0].runCompletion) &&
              durableResults[0].files.every((file) => file.available)) ||
            (durableResults.length === 0 && Boolean(run.pendingResult?.runCompletion) &&
              pendingFilesAvailable)
        };
      }));
    const runRecovery = { pendingFinalizations };
    const spentUsd = runs.filter((run) => run.status === "completed").reduce((sum, run) => sum + (run.cost?.actual ?? run.cost?.estimated ?? 0), 0);
    const reservedUsd = runs.filter((run) => run.status === "in_progress").reduce((sum, run) => sum + (run.cost?.estimated ?? 0), 0);
    const budget = { policy: budgetPolicy, spentUsd, reservedUsd,
      remainingUsd: budgetPolicy ? Math.max(0, budgetPolicy.totalUsd - spentUsd - reservedUsd) : null,
      usableUsd: budgetPolicy ? Math.max(0, budgetPolicy.totalUsd - budgetPolicy.reserveUsd - spentUsd - reservedUsd) : null };
    return {
      project,
      checkpoint,
      resources,
      results,
      decisions,
      runs,
      authorizations,
      overview,
      runRecovery,
      budget,
      ...intelligence,
      intelligence: {
        activeArtifacts: intelligence.activeArtifacts,
        activeWorkflow: intelligence.activeWorkflow,
        currentWorkItems: intelligence.currentWorkItems,
        pendingApprovals: intelligence.pendingApprovals,
        latestReviews: intelligence.latestReviews,
        relevantSkills: intelligence.relevantSkills
      }
    };
  }

  async recordArtifact(projectId, value) {
    return this.intelligence.recordArtifact(projectId, value);
  }

  async readArtifacts(projectId) {
    return this.intelligence.readArtifacts(projectId);
  }

  async writeWorkflow(projectId, value) {
    return this.intelligence.writeWorkflow(projectId, value);
  }

  async readWorkflows(projectId) {
    return this.intelligence.readWorkflows(projectId);
  }

  async recordReview(projectId, value, options = {}) {
    return this.intelligence.recordReview(projectId, value, options);
  }

  async abandonRun(projectId, runId, { reason, confirmStopped = false } = {}) {
    const normalizedRunId = runReference(runId);
    if (confirmStopped !== true) {
      throw new ProjectStoreError("Abandoning a Run requires explicit confirmation that its process has stopped.");
    }
    const normalizedReason = requireText(reason, "Run abandonment reason");
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "run-abandon-" + normalizedRunId,
      action: async () => {
        const run = await this.readRun(projectId, normalizedRunId);
        if (run.status !== "in_progress") throw new ProjectStoreError(`Run is already finished: ${normalizedRunId}`);
        if (run.authorizationId) {
          throw new ProjectStoreError("A Run with an execution authorization cannot be abandoned; inspect its provider receipt first.");
        }
        if (run.pendingResult || (await this.readResults(projectId)).some((result) => result.createdByRun === normalizedRunId)) {
          throw new ProjectStoreError("A Run with staged or durable output must use finalization recovery, not abandonment.");
        }
        return this.finishRun(projectId, normalizedRunId, {
          status: "failed",
          outputs: [],
          error: `Abandoned after operator confirmed the process stopped: ${normalizedReason}`,
          actualCostUsd: 0
        });
      }
    });
  }

  async readReviews(projectId) {
    return this.intelligence.readReviews(projectId);
  }
}
