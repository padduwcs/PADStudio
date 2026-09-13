import { access, cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { basename, extname, join, parse, resolve } from "node:path";
import { indexResourceFiles } from "./media-files.js";
import { isPathInside, inputsDirectory, projectDirectory } from "../project/project-paths.js";
import { ProjectStore } from "../project/project-store.js";
import { withFileLock } from "../project/file-lock.js";

export class ProjectImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectImportError";
  }
}

async function sourceInfo(sourcePath) {
  try {
    return await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProjectImportError("Không tìm thấy file hoặc folder nguồn.");
    }
    throw error;
  }
}

async function assertCopyable(sourcePath) {
  const info = await sourceInfo(sourcePath);
  if (info.isSymbolicLink()) {
    throw new ProjectImportError("Không nhập symbolic link vào project.");
  }
  if (info.isFile()) return "file";
  if (!info.isDirectory()) {
    throw new ProjectImportError("Chỉ có thể nhập file hoặc folder.");
  }
  for (const entry of await readdir(sourcePath)) {
    await assertCopyable(join(sourcePath, entry));
  }
  return "folder";
}

async function ensureRealDirectory(directory, label) {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ProjectImportError(`${label} phải là thư mục thật, không phải symbolic link.`);
  }
}

async function destinationPath(inputRoot, sourceName) {
  const extension = extname(sourceName);
  const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;
  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? sourceName : `${stem} (${attempt})${extension}`;
    const candidate = join(inputRoot, name);
    try {
      await access(candidate);
      attempt += 1;
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
}

export async function importProjectInput({ rootDir, projectId, sourcePath }) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new ProjectImportError("Cần có đường dẫn file hoặc folder nguồn.");
  }

  const source = resolve(sourcePath);
  const sourceName = basename(source) || source;
  const projectRoot = resolve(projectDirectory(rootDir, projectId));
  if (source === parse(source).root) {
    throw new ProjectImportError("Không thể nhập thư mục gốc của ổ đĩa.");
  }
  if (source === projectRoot || isPathInside(projectRoot, source) || isPathInside(source, projectRoot)) {
    throw new ProjectImportError("Nguồn nhập phải nằm ngoài project đích.");
  }

  const store = new ProjectStore(rootDir);
  await store.ensureProject(projectId);
  const run = await store.startRun(projectId, {
    capability: "project.input.import",
    inputs: { sourceName }
  });

  const inputRoot = inputsDirectory(rootDir, projectId);
  let stagingRoot = null;
  let destination = null;
  let resource = null;

  try {
    const kind = await assertCopyable(source);
    await ensureRealDirectory(projectRoot, "Thư mục project");
    await ensureRealDirectory(inputRoot, "Thư mục inputs");

    stagingRoot = await mkdtemp(join(projectRoot, ".import-"));
    const stagedInput = join(stagingRoot, sourceName);
    await cp(source, stagedInput, {
      recursive: kind === "folder",
      force: false,
      errorOnExist: true
    });

    await withFileLock({
      projectDirectory: projectRoot,
      name: "inputs",
      action: async () => {
        destination = await destinationPath(inputRoot, sourceName);
        await rename(stagedInput, destination);
        try {
          const items = await indexResourceFiles(destination, projectRoot, kind);
          resource = await store.addInputResource(projectId, {
            runId: run.id,
            kind,
            name: basename(destination),
            path: destination,
            sourceName,
            items
          });
        } catch (error) {
          await rm(destination, { recursive: true, force: true }).catch(() => {});
          destination = null;
          throw error;
        }
      }
    });
    await store.finishRun(projectId, run.id, {
      status: "completed",
      outputs: [resource.id]
    });

    return {
      projectId,
      runId: run.id,
      resourceId: resource.id,
      kind,
      inputPath: basename(destination)
    };
  } catch (error) {
    try {
      const currentRun = await store.readRun(projectId, run.id);
      if (currentRun.status === "in_progress") {
        await store.finishRun(projectId, run.id, {
          status: "failed",
          error: error?.message || "Import thất bại."
        });
      }
    } catch {
      // Giữ nguyên lỗi import ban đầu nếu không thể cập nhật dấu vết.
    }
    throw error;
  } finally {
    if (stagingRoot) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}
