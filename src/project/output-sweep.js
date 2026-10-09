import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isPathInside } from "./project-paths.js";

/*
 * A completed Run's output directory is supposed to hold exactly the files its Result registers.
 * Tools sometimes leave scratch behind (for example a copied source workspace and a bundler cache).
 * Such files can never be served, verified or reused, so they are safe to remove. These helpers find
 * and remove them without ever touching a registered file.
 */

function normalize(path) {
  return path.replaceAll("\\", "/");
}

// Registered paths are compared case-insensitively on every platform: wrongly keeping a file is
// harmless, wrongly deleting a registered file is not.
function registeredKey(path) {
  return normalize(path).toLowerCase();
}

/**
 * Split the files below `directory` into registered and unregistered ones.
 *
 * `registeredRelativePaths` are paths relative to `directory`. The result lists the unregistered
 * entries, each relative to `directory`: a single file, or a whole directory when nothing below it is
 * registered (so a bundler cache is one entry, not thousands). Symbolic links are never followed or
 * reported as reclaimable.
 */
export async function scanOutputDirectory(directory, registeredRelativePaths) {
  const registeredKeys = new Set([...registeredRelativePaths].map(registeredKey));
  const registered = { bytes: 0, files: 0 };
  const symbolicLinks = [];

  // Returns the unregistered entries below `current` and whether anything below it is registered.
  async function visit(current, prefix) {
    const result = { holdsRegistered: false, entries: [], bytes: 0, files: 0 };
    for (const child of await readdir(current, { withFileTypes: true })) {
      const path = join(current, child.name);
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isSymbolicLink()) {
        symbolicLinks.push(relative);
        continue;
      }
      if (child.isDirectory()) {
        const inner = await visit(path, relative);
        result.bytes += inner.bytes;
        result.files += inner.files;
        if (inner.holdsRegistered) {
          result.holdsRegistered = true;
          result.entries.push(...inner.entries);
        } else {
          result.entries.push({ path: relative, kind: "directory", bytes: inner.bytes, files: inner.files });
        }
        continue;
      }
      if (!child.isFile()) continue;
      const size = (await lstat(path)).size;
      if (registeredKeys.has(registeredKey(relative))) {
        registered.bytes += size;
        registered.files += 1;
        result.holdsRegistered = true;
      } else {
        result.bytes += size;
        result.files += 1;
        result.entries.push({ path: relative, kind: "file", bytes: size, files: 1 });
      }
    }
    return result;
  }

  const top = await visit(directory, "");
  return {
    registered,
    unregistered: {
      bytes: top.bytes,
      files: top.files,
      entries: top.entries.sort((left, right) => right.bytes - left.bytes)
    },
    symbolicLinks
  };
}

/**
 * Remove entries previously returned by scanOutputDirectory. Entries are re-validated: they must stay
 * inside `directory` and must not be symbolic links. A failure on one entry does not stop the others.
 */
export async function removeOutputEntries(directory, entries, { platform = process.platform } = {}) {
  const removed = [];
  const failed = [];
  const retry = platform === "win32" ? { maxRetries: 20, retryDelay: 100 } : { maxRetries: 0 };
  for (const entry of entries) {
    try {
      if (typeof entry.path !== "string" || !entry.path || entry.path.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Invalid output entry path.");
      }
      const target = join(directory, ...entry.path.split("/"));
      if (!isPathInside(directory, target)) throw new Error("Entry is outside the output directory.");
      const info = await lstat(target).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (!info) {
        removed.push({ ...entry, alreadyGone: true });
        continue;
      }
      if (info.isSymbolicLink()) throw new Error("Refusing to remove a symbolic link.");
      await rm(target, { recursive: true, force: true, ...retry });
      removed.push(entry);
    } catch (error) {
      failed.push({ path: entry.path, error: error?.message ?? String(error) });
    }
  }
  return { removed, failed };
}
