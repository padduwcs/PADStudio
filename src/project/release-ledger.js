import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./atomic-files.js";

/**
 * Files of Results that were deliberately released when a project was finished. The Result records stay
 * untouched and immutable; only the bytes are gone. The ledger lives in `<project>/releases/` as append-only
 * records so a missing file can be told apart from a damaged one.
 */
export function releasesDirectory(projectRoot) {
  return join(projectRoot, "releases");
}

export function releasedKey(resultId, fileId) {
  return `${resultId}/${fileId}`;
}

export async function readReleaseRecords(projectRoot) {
  const directory = releasesDirectory(projectRoot);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson(join(directory, name))));
  return records.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

export async function readReleasedFiles(projectRoot) {
  const released = new Set();
  for (const record of await readReleaseRecords(projectRoot)) {
    for (const file of record.files ?? []) released.add(releasedKey(file.resultId, file.fileId));
  }
  return released;
}
