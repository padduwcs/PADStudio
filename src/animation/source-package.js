import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ANIMATION_RUNTIMES } from "./animation-composition.js";

export const MAX_SOURCE_FILES = 64;
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
export const MAX_SOURCE_PACKAGE_BYTES = 4 * 1024 * 1024;

export function safeSourcePath(value, label = "source path") {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text.`);
  const path = value.trim().replaceAll("\\", "/");
  if (
    path.startsWith("/") || /^[a-z]:\//i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.length > 300 || /[\u0000-\u001f:*?"<>|]/u.test(path)
  ) throw new Error(`${label} must be a safe relative path.`);
  return posix.normalize(path);
}

export function sourceMediaType(path) {
  const extension = posix.extname(path).toLowerCase();
  return ({
    ".py": "text/x-python", ".js": "text/javascript", ".jsx": "text/jsx",
    ".ts": "text/typescript", ".tsx": "text/tsx", ".html": "text/html",
    ".css": "text/css", ".json": "application/json", ".md": "text/markdown",
    ".txt": "text/plain", ".svg": "image/svg+xml",
  })[extension] ?? "text/plain";
}

export function validateSourcePackageShape(result, expectedRuntime = null) {
  if (result?.type !== "animation.source-package") throw new Error("Expected an animation.source-package Result.");
  const data = result.data;
  if (!data || data.version !== "1.0" || !ANIMATION_RUNTIMES.includes(data.runtime)) {
    throw new Error("Animation source package metadata is invalid.");
  }
  if (expectedRuntime && data.runtime !== expectedRuntime) throw new Error("Animation runtime does not match the source package.");
  const fields = ["version", "runtime", "entryFile", "entrySymbol", "dependencies", "sourceFiles", "packageSha256", "parentSourceResultId", "changeSummary"];
  if (Object.keys(data).some((field) => !fields.includes(field))) throw new Error("Animation source package metadata has unsupported fields.");
  safeSourcePath(data.entryFile, "entryFile");
  if (typeof data.entrySymbol !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(data.entrySymbol)) {
    throw new Error("Animation source package entry symbol is invalid.");
  }
  if (!Array.isArray(data.dependencies) || data.dependencies.length > 50 || data.dependencies.some((dependency) =>
    !dependency || typeof dependency !== "object" || Array.isArray(dependency) ||
    Object.keys(dependency).some((field) => !["name", "version", "integrity"].includes(field)) ||
    typeof dependency.name !== "string" || !dependency.name || typeof dependency.version !== "string" || !dependency.version ||
    /^(?:latest|next|dev|main|master)$/iu.test(dependency.version) || /^[~^*<>=]/u.test(dependency.version) || /\s\|\||\s-\s/u.test(dependency.version) ||
    !(dependency.integrity === null || typeof dependency.integrity === "string"))) {
    throw new Error("Animation source package dependencies are invalid.");
  }
  if (new Set(data.dependencies.map((dependency) => dependency.name)).size !== data.dependencies.length) {
    throw new Error("Animation source package dependency names must be unique.");
  }
  if (!/^[a-f0-9]{64}$/u.test(data.packageSha256) ||
      !(data.parentSourceResultId === null || typeof data.parentSourceResultId === "string") ||
      typeof data.changeSummary !== "string" || !data.changeSummary) {
    throw new Error("Animation source package provenance is invalid.");
  }
  if (!Array.isArray(data.sourceFiles) || !data.sourceFiles.length || data.sourceFiles.length > MAX_SOURCE_FILES) {
    throw new Error("Animation source package file index is invalid.");
  }
  const indexed = new Map(data.sourceFiles.map((file) => [file.path, file]));
  if (indexed.size !== data.sourceFiles.length || new Set(data.sourceFiles.map((file) => String(file.path).toLowerCase())).size !== data.sourceFiles.length) {
    throw new Error("Animation source package paths must be unique.");
  }
  if (!indexed.has(data.entryFile)) throw new Error("Animation source package entry file is missing.");
  let totalBytes = 0;
  for (const file of data.sourceFiles) {
    if (!file || typeof file !== "object" || Array.isArray(file) ||
        Object.keys(file).some((field) => !["path", "fileId", "sizeBytes", "sha256"].includes(field))) {
      throw new Error("Animation source package file entry is invalid.");
    }
    safeSourcePath(file.path);
    const resultFile = result.files.find((item) => item.id === file.fileId);
    if (typeof file.fileId !== "string" || !Number.isInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > MAX_SOURCE_FILE_BYTES ||
        !/^[a-f0-9]{64}$/u.test(file.sha256) || !resultFile || resultFile.sha256 !== file.sha256 || resultFile.sizeBytes !== file.sizeBytes) {
      throw new Error(`Animation source package file index is stale: ${file.path}.`);
    }
    totalBytes += file.sizeBytes;
  }
  if (totalBytes > MAX_SOURCE_PACKAGE_BYTES) throw new Error("Animation source package exceeds the total size limit.");
  const digest = createHash("sha256");
  for (const file of [...data.sourceFiles].sort((left, right) => left.path.localeCompare(right.path))) digest.update(`${file.path}\0${file.sha256}\0`);
  if (digest.digest("hex") !== data.packageSha256) throw new Error("Animation source package checksum is inconsistent.");
  return data;
}

export async function loadSourcePackage(store, projectId, resultId, expectedRuntime = null) {
  const result = await store.readResult(projectId, resultId);
  const data = validateSourcePackageShape(result, expectedRuntime);
  const files = [];
  for (const entry of data.sourceFiles) {
    const resolved = await store.verifyResultFile(projectId, result.id, entry.fileId);
    files.push({ ...entry, filePath: resolved.filePath });
  }
  const manifestFile = await store.verifyResultFile(projectId, result.id, "primary");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestFile.filePath, "utf8")); }
  catch { throw new Error("Animation source package manifest is not valid JSON."); }
  if (!isDeepStrictEqual(manifest, data)) throw new Error("Animation source package manifest does not match Result metadata.");
  return { result, data, files, manifestFile };
}
