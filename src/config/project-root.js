import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT_ENV = "PADSTUDIO_PROJECT_ROOT";
export const ARCHIVE_ROOT_ENV = "PADSTUDIO_ARCHIVE_ROOT";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class ProjectRootConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectRootConfigError";
  }
}

function configuredPath(env, name) {
  const value = env[name];
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectRootConfigError(`${name} phải là đường dẫn không rỗng hoặc không được đặt.`);
  }
  const path = value.trim();
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

/** Thư mục chứa mọi project đang hoạt động. Mặc định là `.padstudio/projects` cạnh mã nguồn. */
export function resolveProjectRoot({ env = process.env } = {}) {
  return configuredPath(env, PROJECT_ROOT_ENV) ?? join(applicationRoot, ".padstudio", "projects");
}

/**
 * Thư mục lưu trữ project đã archive. Mặc định là `archive/projects` nằm cạnh thư mục project,
 * nên với gốc mặc định kết quả vẫn là `.padstudio/archive/projects`.
 */
export function resolveArchiveRoot({ env = process.env, projectRoot = resolveProjectRoot({ env }) } = {}) {
  return configuredPath(env, ARCHIVE_ROOT_ENV) ?? join(dirname(projectRoot), "archive", "projects");
}
