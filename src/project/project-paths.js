import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class ProjectPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectPathError";
  }
}

export function validateProjectId(projectId) {
  if (
    typeof projectId !== "string" ||
    !projectId ||
    projectId !== projectId.trim() ||
    projectId.startsWith(".") ||
    projectId === "." ||
    projectId === ".." ||
    projectId.includes("/") ||
    projectId.includes("\\") ||
    /[<>:"|?*\u0000-\u001f]/.test(projectId) ||
    /[. ]$/.test(projectId) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(projectId)
  ) {
    throw new ProjectPathError("Tên project không hợp lệ.");
  }
}

export function projectDirectory(rootDir, projectId) {
  validateProjectId(projectId);
  return join(rootDir, projectId);
}

export function inputsDirectory(rootDir, projectId) {
  return join(projectDirectory(rootDir, projectId), "inputs");
}

export function isPathInside(rootPath, candidatePath) {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    Boolean(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

export function resolveInputPath(inputRoot, inputPath) {
  if (typeof inputPath !== "string" || !inputPath) {
    throw new ProjectPathError("Đường dẫn tư liệu không hợp lệ.");
  }

  const resolvedPath = resolve(inputRoot, inputPath);
  if (!isPathInside(inputRoot, resolvedPath)) {
    throw new ProjectPathError("Tư liệu phải nằm trong inputs của project.");
  }

  return resolvedPath;
}

export function resolveProjectPath(projectRoot, projectPath) {
  if (typeof projectPath !== "string" || !projectPath) {
    throw new ProjectPathError("Đường dẫn trong project không hợp lệ.");
  }

  const resolvedPath = resolve(projectRoot, projectPath);
  if (!isPathInside(projectRoot, resolvedPath)) {
    throw new ProjectPathError("Đường dẫn phải nằm trong project.");
  }

  return resolvedPath;
}

export function toProjectRelativePath(rootPath, targetPath) {
  return relative(rootPath, targetPath).split(sep).join("/");
}
