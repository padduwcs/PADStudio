import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./atomic-files.js";
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

async function directoryInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function storedPathAvailable(projectRoot, projectPath, expectedKind) {
  try {
    const path = resolveProjectPath(projectRoot, projectPath);
    const info = await lstat(path);
    if (info.isSymbolicLink()) return false;
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
    !["in_progress", "completed", "failed"].includes(run.status)
  ) {
    throw new ProjectStoreError(`Run không hợp lệ trong project: ${projectId}`);
  }
  return run;
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
  return checkpoint;
}

export class ProjectStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
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
      await mkdir(join(staging, "runs"), { recursive: true });
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
    return this.createProject({ projectId, title: title || projectId });
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

  async startRun(projectId, { capability, inputs = {} }) {
    await this.readProject(projectId);
    const run = {
      version: PROJECT_VERSION,
      id: recordId("run"),
      projectId,
      capability: requireText(capability, "Capability"),
      status: "in_progress",
      startedAt: now(),
      finishedAt: null,
      inputs,
      outputs: [],
      error: null
    };
    await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "runs", `${run.id}.json`), run);
    return run;
  }

  async finishRun(projectId, runId, { status, outputs = [], error = null }) {
    if (!["completed", "failed"].includes(status)) {
      throw new ProjectStoreError("Trạng thái kết thúc run không hợp lệ.");
    }
    const path = join(projectDirectory(this.rootDir, projectId), "runs", `${runId}.json`);
    const run = validateRun(await readJson(path), projectId);
    if (run.status !== "in_progress") {
      throw new ProjectStoreError(`Run đã kết thúc: ${runId}`);
    }
    const finished = {
      ...run,
      status,
      finishedAt: now(),
      outputs: stringList(outputs, "Outputs của run"),
      error: error === null ? null : String(error)
    };
    await writeJsonAtomic(path, finished);
    return finished;
  }

  async readRun(projectId, runId) {
    const path = join(projectDirectory(this.rootDir, projectId), "runs", `${runId}.json`);
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

  async readRuns(projectId) {
    await this.readProject(projectId);
    const runs = await readRecords(join(projectDirectory(this.rootDir, projectId), "runs"));
    return runs
      .map((run) => validateRun(run, projectId))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async writeCheckpoint(projectId, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProjectStoreError("Nội dung checkpoint phải là một JSON object.");
    }
    const allowedFields = new Set(["goal", "constraints", "selectedResources", "pending", "next"]);
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
    const [project, checkpoint, resources, runs, overview] = await Promise.all([
      this.readProject(projectId),
      this.readCheckpoint(projectId),
      this.readResources(projectId),
      this.readRuns(projectId),
      this.readOverview(projectId)
    ]);
    return { project, checkpoint, resources, runs, overview };
  }
}
