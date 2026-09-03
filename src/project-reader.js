import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  isPathInside,
  inputsDirectory,
  projectDirectory,
  ProjectPathError,
  resolveInputPath,
  toProjectRelativePath
} from "./project-paths.js";

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

const inputExtensions = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]),
  video: new Set([".mp4", ".webm", ".mov", ".m4v"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"])
};

function mediaType(fileName) {
  const extension = extname(fileName).toLowerCase();
  for (const [type, extensions] of Object.entries(inputExtensions)) {
    if (extensions.has(extension)) {
      return type;
    }
  }
  return "other";
}

async function existingProjectDirectory(rootDir, projectId) {
  const directory = projectDirectory(rootDir, projectId);

  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ProjectNotFoundError(projectId);
    }
    return directory;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProjectNotFoundError(projectId);
    }
    throw error;
  }
}

async function safeInputDirectory(projectDirectoryPath, rootDir, projectId) {
  const inputDirectory = inputsDirectory(rootDir, projectId);
  try {
    const info = await lstat(inputDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return null;
    }

    const [resolvedProjectDirectory, resolvedInputDirectory] = await Promise.all([
      realpath(projectDirectoryPath),
      realpath(inputDirectory)
    ]);
    if (!isPathInside(resolvedProjectDirectory, resolvedInputDirectory)) {
      return null;
    }

    return resolvedInputDirectory;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readOverview(directory) {
  try {
    return await readFile(join(directory, "overview.md"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listInputFiles(inputRoot, relativeRoot = inputRoot) {
  try {
    const entries = await readdir(inputRoot, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const entryPath = join(inputRoot, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        files.push(...(await listInputFiles(entryPath, relativeRoot)));
      } else if (entry.isFile()) {
        const info = await stat(entryPath);
        files.push({
          path: toProjectRelativePath(relativeRoot, entryPath),
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          mediaType: mediaType(entry.name)
        });
      }
    }

    return files.sort((left, right) => left.path.localeCompare(right.path, "vi"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
    const directory = await existingProjectDirectory(this.rootDir, projectId);
    return { id: projectId, overview: await readOverview(directory) };
  }

  async readProject(projectId) {
    const directory = await existingProjectDirectory(this.rootDir, projectId);
    const inputDirectory = await safeInputDirectory(directory, this.rootDir, projectId);
    return {
      id: projectId,
      overview: await readOverview(directory),
      inputs: inputDirectory ? await listInputFiles(inputDirectory) : []
    };
  }

  async readInputFile(projectId, inputPath) {
    const directory = await existingProjectDirectory(this.rootDir, projectId);
    const inputRoot = await safeInputDirectory(directory, this.rootDir, projectId);

    if (!inputRoot) {
      throw new ProjectInputNotFoundError();
    }

    try {
      const requestedPath = resolveInputPath(inputRoot, inputPath);
      const resolvedFile = await realpath(requestedPath);
      if (!isPathInside(inputRoot, resolvedFile)) {
        throw new ProjectInputNotFoundError();
      }

      const info = await lstat(resolvedFile);
      if (!info.isFile()) {
        throw new ProjectInputNotFoundError();
      }

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
}