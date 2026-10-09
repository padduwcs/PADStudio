import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { withFileLock } from "../project/file-lock.js";
import { removeOutputEntries } from "../project/output-sweep.js";
import { projectDirectory } from "../project/project-paths.js";
import { analyzeProjectStorage } from "./project-storage.js";

export class ProjectPruneError extends Error {
  constructor(message, code = "prune_failed") {
    super(message);
    this.name = "ProjectPruneError";
    this.code = code;
  }
}

const PRUNE_VERSION = "1.0";

function summarize(runs) {
  return {
    runs: runs.length,
    entries: runs.reduce((total, run) => total + run.entries.length, 0),
    files: runs.reduce((total, run) => total + run.files, 0),
    bytes: runs.reduce((total, run) => total + run.bytes, 0)
  };
}

function selectRuns(report, runIds) {
  const wanted = runIds ? new Set(runIds) : null;
  if (wanted) {
    const known = new Set(report.runs.map((run) => run.runId));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length) {
      throw new ProjectPruneError(`Run không thuộc output đã hoàn tất của project: ${unknown.join(", ")}`, "unknown_run");
    }
  }
  return report.runs
    .filter((run) => run.unregisteredBytes > 0 || run.unregisteredEntries.length > 0)
    .filter((run) => !wanted || wanted.has(run.runId))
    .map((run) => ({
      runId: run.runId,
      capability: run.capability,
      resultIds: run.resultIds,
      bytes: run.unregisteredBytes,
      files: run.unregisteredFiles,
      entries: run.unregisteredEntries
    }));
}

/**
 * Describe what would be removed. Only files inside a completed Run's output directory that none of its
 * Results registers are ever candidates; registered files, inputs, records, in-progress or unknown
 * directories are out of scope. Changes nothing.
 */
export async function planProjectPrune(store, projectId, { runIds = null } = {}) {
  const report = await analyzeProjectStorage(store, projectId);
  const runs = selectRuns(report, runIds);
  return {
    version: PRUNE_VERSION,
    projectId,
    mode: "plan",
    status: runs.length ? "planned" : "nothing_to_do",
    scope: "unregistered_output_of_completed_runs",
    summary: summarize(runs),
    runs,
    notReclaimable: {
      orphanOutputBytes: report.areas.outputs.orphanBytes,
      temporaryBytes: report.areas.outputs.temporaryBytes
    }
  };
}

/**
 * Remove the planned files. Re-plans inside the project lock, removes only entries from that fresh plan,
 * records an append-only audit entry under `prunes/` and finally proves every registered file of every
 * affected Result is still intact. Safe to repeat.
 */
export async function applyProjectPrune(store, projectId, { runIds = null, now = () => new Date().toISOString() } = {}) {
  const root = projectDirectory(store.rootDir, projectId);
  return withFileLock({
    projectDirectory: root,
    name: "project-prune",
    action: async () => {
      const plan = await planProjectPrune(store, projectId, { runIds });
      const outcomes = [];
      for (const run of plan.runs) {
        const outcome = await removeOutputEntries(join(root, "outputs", run.runId), run.entries);
        outcomes.push({
          runId: run.runId,
          capability: run.capability,
          removed: outcome.removed.map(({ path, kind, bytes, files, alreadyGone }) => ({
            path, kind, bytes, files, ...(alreadyGone ? { alreadyGone: true } : {})
          })),
          failed: outcome.failed
        });
      }
      const removedRuns = outcomes.map((run) => ({
        ...run,
        bytes: run.removed.filter((entry) => !entry.alreadyGone).reduce((total, entry) => total + entry.bytes, 0)
      }));
      const bytesFreed = removedRuns.reduce((total, run) => total + run.bytes, 0);
      const failedEntries = removedRuns.reduce((total, run) => total + run.failed.length, 0);

      // Prove nothing registered was lost before reporting success.
      const damaged = [];
      for (const run of plan.runs) {
        for (const resultId of run.resultIds) {
          const result = await store.readResult(projectId, resultId);
          for (const file of result.files) if (!file.available && !file.released) damaged.push(`${resultId}/${file.id}`);
        }
      }

      let record = null;
      if (outcomes.length) {
        record = {
          version: PRUNE_VERSION,
          id: `prune-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
          projectId,
          kind: "unregistered_output",
          createdAt: now(),
          runs: removedRuns,
          bytesFreed,
          failedEntries,
          integrity: damaged.length ? { status: "failed", unavailableFiles: damaged } : { status: "verified" }
        };
        await writeJsonAtomic(join(root, "prunes", `${record.id}.json`), record);
      }
      return {
        version: PRUNE_VERSION,
        projectId,
        mode: "apply",
        status: damaged.length ? "integrity_failure"
          : failedEntries ? "partial"
            : outcomes.length ? "completed" : "nothing_to_do",
        bytesFreed,
        removedEntries: removedRuns.reduce((total, run) => total + run.removed.filter((entry) => !entry.alreadyGone).length, 0),
        failedEntries,
        integrity: record?.integrity ?? { status: "verified" },
        recordId: record?.id ?? null,
        runs: removedRuns
      };
    }
  });
}

/** Read the append-only history of prune operations for a project. */
export async function readProjectPrunes(store, projectId) {
  await store.readProject(projectId);
  const directory = join(projectDirectory(store.rootDir, projectId), "prunes");
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
