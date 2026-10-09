import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { scanOutputDirectory } from "../project/output-sweep.js";
import { projectDirectory, toProjectRelativePath } from "../project/project-paths.js";

const RECORD_DIRECTORIES = [
  "resources", "results", "runs", "decisions", "artifacts", "workflows", "reviews",
  "authorizations", "prunes"
];

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 2)} ${units[unit]}`;
}

/** Add up regular files below `directory`. Symbolic links are counted as entries but never followed. */
export async function directoryFootprint(directory) {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { bytes: 0, files: 0 };
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      files += 1;
    } else if (entry.isDirectory()) {
      const inner = await directoryFootprint(path);
      bytes += inner.bytes;
      files += inner.files;
    } else if (entry.isFile()) {
      bytes += (await lstat(path)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

// Paths a Run's Results (and a not-yet-recovered pending Result draft) register, relative to the Run's
// output directory. Anything else in that directory is not part of the project's data.
function registeredPathsByRun(results, runs) {
  const byRun = new Map();
  const add = (runId, path) => {
    if (typeof path !== "string") return;
    const prefix = `outputs/${runId}/`;
    const normalized = path.replaceAll("\\", "/");
    if (!normalized.startsWith(prefix)) return;
    if (!byRun.has(runId)) byRun.set(runId, new Set());
    byRun.get(runId).add(normalized.slice(prefix.length));
  };
  for (const result of results) for (const file of result.files) add(result.createdByRun, file.path);
  for (const run of runs) for (const file of run.pendingResult?.files ?? []) add(run.id, file.path);
  return byRun;
}

/**
 * Read-only account of where a project's disk space goes. A completed Run's output directory should
 * contain only files its Result registers; anything else is `unregistered`: PADStudio can never serve,
 * verify or reuse it, so it is reclaimable. Runs that are not completed, directories without a Run
 * record and temporary directories are reported but never considered reclaimable here.
 */
export async function analyzeProjectStorage(store, projectId) {
  await store.readProject(projectId);
  const root = projectDirectory(store.rootDir, projectId);
  const [results, runs] = await Promise.all([store.readResults(projectId), store.readRuns(projectId)]);
  const registeredByRun = registeredPathsByRun(results, runs);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const resultsByRun = new Map();
  for (const result of results) {
    if (!resultsByRun.has(result.createdByRun)) resultsByRun.set(result.createdByRun, []);
    resultsByRun.get(result.createdByRun).push(result);
  }

  const outputsRoot = join(root, "outputs");
  let outputEntries = [];
  try {
    outputEntries = await readdir(outputsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const runOutputs = [];
  const temporary = [];
  const orphans = [];
  for (const entry of outputEntries) {
    if (!entry.isDirectory()) continue;
    const path = join(outputsRoot, entry.name);
    if (entry.name.startsWith(".")) {
      temporary.push({ path: toProjectRelativePath(root, path), ...(await directoryFootprint(path)) });
      continue;
    }
    const run = runById.get(entry.name);
    if (!run || run.status !== "completed") {
      orphans.push({
        path: toProjectRelativePath(root, path), runId: entry.name,
        runStatus: run?.status ?? "no_run_record", ...(await directoryFootprint(path))
      });
      continue;
    }
    const scan = await scanOutputDirectory(path, registeredByRun.get(run.id) ?? new Set());
    const runResults = resultsByRun.get(run.id) ?? [];
    runOutputs.push({
      runId: run.id,
      capability: run.capability,
      resultIds: runResults.map((result) => result.id),
      resultTypes: [...new Set(runResults.map((result) => result.type))],
      startedAt: run.startedAt,
      registeredBytes: scan.registered.bytes,
      registeredFiles: scan.registered.files,
      unregisteredBytes: scan.unregistered.bytes,
      unregisteredFiles: scan.unregistered.files,
      unregisteredEntries: scan.unregistered.entries,
      symbolicLinks: scan.symbolicLinks
    });
  }

  const [inputs, analysis] = await Promise.all([
    directoryFootprint(join(root, "inputs")),
    directoryFootprint(join(root, "analysis"))
  ]);
  const records = { bytes: 0, files: 0 };
  for (const name of RECORD_DIRECTORIES) {
    const part = await directoryFootprint(join(root, name));
    records.bytes += part.bytes;
    records.files += part.files;
  }

  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  const registeredBytes = sum(runOutputs, "registeredBytes");
  const unregisteredBytes = sum(runOutputs, "unregisteredBytes");
  const orphanBytes = sum(orphans, "bytes");
  const temporaryBytes = sum(temporary, "bytes");
  const outputBytes = registeredBytes + unregisteredBytes + orphanBytes + temporaryBytes;
  return {
    version: "1.0",
    projectId,
    generatedAt: new Date().toISOString(),
    totalBytes: inputs.bytes + analysis.bytes + records.bytes + outputBytes,
    areas: {
      inputs,
      analysis,
      records,
      outputs: { bytes: outputBytes, registeredBytes, unregisteredBytes, orphanBytes, temporaryBytes }
    },
    reclaimable: {
      unregisteredBytes,
      unregisteredRuns: runOutputs.filter((run) => run.unregisteredBytes > 0).length
    },
    runs: runOutputs.sort((left, right) =>
      (right.registeredBytes + right.unregisteredBytes) - (left.registeredBytes + left.unregisteredBytes)),
    orphans,
    temporary
  };
}
