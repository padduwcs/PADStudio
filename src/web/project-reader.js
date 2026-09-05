import { lstat, realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
  isPathInside,
  inputsDirectory,
  projectDirectory,
  ProjectPathError,
  resolveInputPath
} from "../project/project-paths.js";
import { mediaType } from "../resources/media-files.js";
import {
  ProjectStore,
  ProjectStoreError,
  StoredProjectNotFoundError
} from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

export class ProjectNotFoundError extends Error {
  constructor(projectId) {
    super(`Không tìm thấy project: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectInputNotFoundError extends Error {
  constructor(message = "Không tìm thấy tư liệu trong project.") {
    super(message);
    this.name = "ProjectInputNotFoundError";
  }
}

export class ProjectResultFileNotFoundError extends Error {
  constructor(message = "Không tìm thấy file kết quả trong project.") {
    super(message);
    this.name = "ProjectResultFileNotFoundError";
  }
}

async function safeInputDirectory(projectDirectoryPath, rootDir, projectId) {
  const inputDirectory = inputsDirectory(rootDir, projectId);
  try {
    const info = await lstat(inputDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const [resolvedProjectDirectory, resolvedInputDirectory] = await Promise.all([
      realpath(projectDirectoryPath),
      realpath(inputDirectory)
    ]);
    if (!isPathInside(resolvedProjectDirectory, resolvedInputDirectory)) return null;
    return resolvedInputDirectory;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export class ProjectReader {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.store = new ProjectStore(rootDir);
    this.contextAssembler = new ProjectContextAssembler({
      projectStore: this.store,
      toolRegistry: createDefaultToolRegistry()
    });
  }

  async list() {
    return this.store.listProjects();
  }

  async readOverview(projectId) {
    try {
      const [project, overview] = await Promise.all([
        this.store.readProject(projectId),
        this.store.readOverview(projectId)
      ]);
      return { id: project.id, overview };
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readProject(projectId) {
    try {
      return await this.contextAssembler.build(projectId);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readInputFile(projectId, inputPath) {
    let context;
    try {
      context = await this.store.readContext(projectId);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }

    const directory = projectDirectory(this.rootDir, projectId);
    const inputRoot = await safeInputDirectory(directory, this.rootDir, projectId);
    if (!inputRoot) throw new ProjectInputNotFoundError();

    const registeredPaths = new Set(
      context.resources.flatMap((resource) =>
        resource.items.map((item) => item.path.startsWith("inputs/") ? item.path.slice(7) : "")
      )
    );
    if (!registeredPaths.has(inputPath)) throw new ProjectInputNotFoundError();

    try {
      const requestedPath = resolveInputPath(inputRoot, inputPath);
      const resolvedFile = await realpath(requestedPath);
      if (!isPathInside(inputRoot, resolvedFile)) throw new ProjectInputNotFoundError();
      const info = await lstat(resolvedFile);
      if (!info.isFile()) throw new ProjectInputNotFoundError();
      return {
        filePath: resolvedFile,
        name: basename(resolvedFile),
        size: info.size,
        mediaType: mediaType(resolvedFile)
      };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof ProjectPathError) {
        throw new ProjectInputNotFoundError();
      }
      throw error;
    }
  }

  async readResultFile(projectId, resultId, fileId) {
    try {
      const file = await this.store.resolveResultFile(projectId, resultId, fileId);
      return {
        filePath: file.filePath,
        name: file.name,
        size: file.size,
        mediaType: file.mediaType
      };
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      if (error instanceof ProjectStoreError || error instanceof ProjectPathError) {
        throw new ProjectResultFileNotFoundError();
      }
      throw error;
    }
  }
}
