import { lstat, readdir } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import { toProjectRelativePath } from "../project/project-paths.js";

const mediaExtensions = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"]),
  video: new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".ogg", ".opus", ".aac", ".flac"])
};

export function mediaType(fileName) {
  const extension = extname(fileName).toLowerCase();
  for (const [type, extensions] of Object.entries(mediaExtensions)) {
    if (extensions.has(extension)) return type;
  }
  return "other";
}

async function describeFile(filePath, resourcePath, projectRoot, isSingleFile) {
  const info = await lstat(filePath);
  return {
    path: toProjectRelativePath(projectRoot, filePath),
    name: basename(filePath),
    relativePath: isSingleFile
      ? basename(filePath)
      : relative(resourcePath, filePath).split(sep).join("/"),
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    mediaType: mediaType(filePath)
  };
}

async function listFolderFiles(directory, resourcePath, projectRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await listFolderFiles(path, resourcePath, projectRoot)));
    } else if (entry.isFile()) {
      files.push(await describeFile(path, resourcePath, projectRoot, false));
    }
  }
  return files;
}

export async function indexResourceFiles(resourcePath, projectRoot, kind) {
  const files = kind === "file"
    ? [await describeFile(resourcePath, resourcePath, projectRoot, true)]
    : await listFolderFiles(resourcePath, resourcePath, projectRoot);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "vi"));
}
