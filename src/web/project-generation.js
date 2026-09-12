import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { projectDirectory } from "../project/project-paths.js";

const IGNORED_DIRECTORIES = new Set([".locks"]);

async function entries(directory, root, rows) {
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    if (child.name.startsWith(".") || (child.isDirectory() && IGNORED_DIRECTORIES.has(child.name))) continue;
    const path = join(directory, child.name);
    const info = await lstat(path, { bigint: true });
    const name = relative(root, path).replaceAll("\\", "/");
    if (info.isSymbolicLink()) {
      rows.push(`${name}\0link\0${info.mtimeNs}`);
    } else if (info.isDirectory()) {
      rows.push(`${name}/\0directory\0${info.mtimeNs}`);
      await entries(path, root, rows);
    } else if (info.isFile()) {
      rows.push(`${name}\0file\0${info.size}\0${info.mtimeNs}`);
    }
  }
}

export async function projectGeneration(rootDir, projectId) {
  const root = projectDirectory(rootDir, projectId);
  const rows = [];
  await entries(root, root, rows);
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

export function quotedEtag(value) {
  return `"padstudio-${value}"`;
}

export function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(",").map((value) => value.trim()).some((value) => value === etag || value === "*");
}
