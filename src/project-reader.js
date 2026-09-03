import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export class ProjectNotFoundError extends Error {
  constructor(projectId) {
    super(`Không tìm thấy project: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

function validateProjectId(projectId) {
  if (
    typeof projectId !== "string" ||
    !projectId ||
    projectId === "." ||
    projectId === ".." ||
    projectId.includes("/") ||
    projectId.includes("\\")
  ) {
    throw new Error("Tên project không hợp lệ.");
  }
}

function projectDirectory(rootDir, projectId) {
  validateProjectId(projectId);
  return join(rootDir, projectId);
}

export class ProjectReader {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async list() {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "vi"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readOverview(projectId) {
    const directory = projectDirectory(this.rootDir, projectId);

    try {
      const info = await stat(directory);
      if (!info.isDirectory()) {
        throw new ProjectNotFoundError(projectId);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ProjectNotFoundError(projectId);
      }
      throw error;
    }

    try {
      return {
        id: projectId,
        overview: await readFile(join(directory, "overview.md"), "utf8")
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { id: projectId, overview: null };
      }
      throw error;
    }
  }
}