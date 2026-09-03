import { access, cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { basename, extname, join, parse, resolve } from "node:path";
import { isPathInside, projectDirectory, toProjectRelativePath } from "./project-paths.js";

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

  if (info.isFile()) {
    return "file";
  }

  if (!info.isDirectory()) {
    throw new ProjectImportError("Chỉ có thể nhập file hoặc folder.");
  }

  for (const entry of await readdir(sourcePath)) {
    await assertCopyable(join(sourcePath, entry));
  }

  return "folder";
}

async function ensureProjectDirectory(directory, label) {
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
      if (error?.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
  }
}

export async function importProjectInput({ rootDir, projectId, sourcePath }) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new ProjectImportError("Cần có đường dẫn file hoặc folder nguồn.");
  }

  const source = resolve(sourcePath);
  const projectRoot = resolve(projectDirectory(rootDir, projectId));
  if (source === parse(source).root) {
    throw new ProjectImportError("Không thể nhập thư mục gốc của ổ đĩa.");
  }
  if (source === projectRoot || isPathInside(projectRoot, source) || isPathInside(source, projectRoot)) {
    throw new ProjectImportError("Nguồn nhập phải nằm ngoài project đích.");
  }

  const kind = await assertCopyable(source);
  const inputRoot = join(projectRoot, "inputs");
  await ensureProjectDirectory(projectRoot, "Thư mục project");
  await ensureProjectDirectory(inputRoot, "Thư mục inputs");

  const stagingRoot = await mkdtemp(join(projectRoot, ".import-"));
  let destination;
  try {
    const stagedInput = join(stagingRoot, basename(source));
    await cp(source, stagedInput, {
      recursive: kind === "folder",
      force: false,
      errorOnExist: true
    });

    destination = await destinationPath(inputRoot, basename(source));
    await rename(stagedInput, destination);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }

  return {
    projectId,
    kind,
    inputPath: toProjectRelativePath(inputRoot, destination)
  };
}