import { randomUUID } from "node:crypto";
import { readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../project/atomic-files.js";
import { withFileLock } from "../project/file-lock.js";
import { removeOutputEntries } from "../project/output-sweep.js";
import { projectDirectory } from "../project/project-paths.js";
import { readReleaseRecords, releasesDirectory } from "../project/release-ledger.js";
import { applyProjectPrune } from "./project-prune.js";

export class ProjectFinishError extends Error {
  constructor(message, code = "finish_failed") {
    super(message);
    this.name = "ProjectFinishError";
    this.code = code;
  }
}

const FINISH_VERSION = "1.0";

const REASONS = Object.freeze({
  no_delivery: "Project chưa có bản đã chốt (Delivery). Chỉ dọn sau khi người dùng đã chốt và Delivery đã được xuất.",
  delivery_not_intact: "File của Delivery mới nhất không còn nguyên vẹn (thiếu hoặc sai SHA-256).",
  source_missing: "Không tìm thấy Result nguồn mà Delivery mới nhất được tạo từ đó.",
  not_accepted: "Không tìm thấy quyết định duyệt gắn với Delivery mới nhất.",
  run_in_progress: "Project còn Run đang chạy; chờ nó xong hoặc xử lý trước."
});

function refusal(code, detail = null) {
  return { reason: code, message: REASONS[code] + (detail ? ` (${detail})` : "") };
}

const RESULT_ID = /^result-[a-z0-9-]+$/;

// Audio and text (scripts, subtitles, animation source) are worth keeping; video and image intermediates are not.
function isValuableFile(file) {
  const kind = String(file.mediaType ?? "").split("/")[0];
  return kind === "audio" || kind === "text" || file.mediaType === "application/json" || file.mediaType === "document";
}

function collectReferences(value, found = { results: new Set(), artifacts: new Set() }) {
  if (typeof value === "string") {
    if (RESULT_ID.test(value)) found.results.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, found);
  } else if (value && typeof value === "object") {
    if (value.kind === "artifact" && typeof value.id === "string") found.artifacts.add(value.id);
    for (const item of Object.values(value)) collectReferences(item, found);
  }
  return found;
}

/** Every Result the final render was made from: its inputs, what its sequence and compositions point to, transitively. */
function dependencyClosure(rootResult, resultsById, artifactsById) {
  const seenResults = new Set();
  const seenArtifacts = new Set();
  const queue = [rootResult.id];
  while (queue.length) {
    const result = resultsById.get(queue.pop());
    if (!result || seenResults.has(result.id)) continue;
    seenResults.add(result.id);
    const found = collectReferences([result.inputResults, result.data]);
    for (const id of result.inputArtifacts ?? []) found.artifacts.add(id);
    const artifactQueue = [...found.artifacts];
    while (artifactQueue.length) {
      const artifact = artifactsById.get(artifactQueue.pop());
      if (!artifact || seenArtifacts.has(artifact.id)) continue;
      seenArtifacts.add(artifact.id);
      const inner = collectReferences([artifact.data, artifact.references]);
      inner.results.forEach((id) => found.results.add(id));
      inner.artifacts.forEach((id) => artifactQueue.push(id));
    }
    for (const id of found.results) if (!seenResults.has(id)) queue.push(id);
  }
  return seenResults;
}

/**
 * What finishing would do. The newest Delivery bundle and the Result it was exported from are kept in full.
 * From everything the final render was made from, audio and text files (narration, music, scripts, animation
 * source) are kept too; every other file of every other Result is released. Result, Run, decision, artifact and review records are never
 * touched, and neither are the project's imported inputs. Changes nothing.
 */
export async function planProjectFinish(store, projectId) {
  const [results, decisions, runs, artifacts] = await Promise.all([
    store.readResults(projectId), store.readDecisions(projectId), store.readRuns(projectId), store.readArtifacts(projectId)
  ]);
  const base = { version: FINISH_VERSION, projectId, mode: "plan" };
  const bundles = results.filter((result) => result.type === "delivery.bundle")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const final = bundles.at(-1);
  if (!final) return { ...base, status: "not_finishable", ...refusal("no_delivery") };
  if (runs.some((run) => run.status === "in_progress")) return { ...base, status: "not_finishable", ...refusal("run_in_progress") };
  for (const file of final.files) {
    try {
      await store.verifyResultFile(projectId, final.id, file.id);
    } catch (error) {
      return { ...base, status: "not_finishable", ...refusal("delivery_not_intact", `${file.id}: ${error.message}`) };
    }
  }
  const source = results.find((result) => result.id === final.data?.sourceResultId);
  if (!source) return { ...base, status: "not_finishable", ...refusal("source_missing") };
  const approved = decisions.some((decision) => decision.id === final.data?.approvalDecisionId && decision.outcome === "accepted");
  if (!approved) return { ...base, status: "not_finishable", ...refusal("not_accepted") };

  const keep = new Set([final.id, source.id]);
  const dependencies = dependencyClosure(source, new Map(results.map((result) => [result.id, result])), new Map(artifacts.map((artifact) => [artifact.id, artifact])));
  const keepFile = (result, file) => dependencies.has(result.id) && result.type !== "delivery.bundle" && isValuableFile(file);
  const files = results.filter((result) => !keep.has(result.id)).flatMap((result) => result.files
    .filter((file) => file.available && !keepFile(result, file))
    .map((file) => ({ resultId: result.id, fileId: file.id, runId: result.createdByRun, path: file.path,
      sizeBytes: file.sizeBytes, sha256: file.sha256 ?? null })));
  return {
    ...base,
    status: files.length ? "planned" : "nothing_to_do",
    keep: {
      deliveryResultId: final.id,
      sourceResultId: source.id,
      files: [...final.files, ...source.files].filter((file) => file.available).length,
      bytes: [...final.files, ...source.files].filter((file) => file.available).reduce((total, file) => total + file.sizeBytes, 0),
      assets: results.filter((result) => !keep.has(result.id)).flatMap((result) => result.files
        .filter((file) => file.available && keepFile(result, file)).map((file) => ({ resultId: result.id, fileId: file.id, name: file.name, sizeBytes: file.sizeBytes })))
    },
    release: {
      results: new Set(files.map((file) => file.resultId)).size,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.sizeBytes, 0)
    },
    files
  };
}

async function removeEmptyDirectories(directory, { keepRoot = false } = {}) {
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  let empty = true;
  for (const child of children) {
    if (child.isDirectory() && await removeEmptyDirectories(join(directory, child.name))) continue;
    empty = false;
  }
  if (empty && !keepRoot) {
    try { await rmdir(directory); return true; } catch { return false; }
  }
  return empty;
}

/**
 * Release the planned files after the user's final choice. Re-plans inside the project lock, records the
 * release in `releases/` before deleting anything (so a file missing afterwards is known to be intentional),
 * sweeps leftover scratch, and proves the kept Delivery and its source Result are still intact.
 */
export async function applyProjectFinish(store, projectId, { now = () => new Date().toISOString() } = {}) {
  const root = projectDirectory(store.rootDir, projectId);
  return withFileLock({
    projectDirectory: root,
    name: "project-finish",
    action: async () => {
      const plan = await planProjectFinish(store, projectId);
      if (plan.status === "not_finishable") throw new ProjectFinishError(plan.message, plan.reason);
      const record = {
        version: FINISH_VERSION,
        id: `release-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
        projectId,
        kind: "project_finish",
        createdAt: now(),
        kept: { deliveryResultId: plan.keep.deliveryResultId, sourceResultId: plan.keep.sourceResultId },
        files: plan.files.map(({ resultId, fileId, path, sizeBytes, sha256 }) => ({ resultId, fileId, path, sizeBytes, sha256 })),
        outcome: null
      };
      if (plan.files.length) await writeJsonAtomic(join(releasesDirectory(root), `${record.id}.json`), record);

      const byRun = new Map();
      for (const file of plan.files) byRun.set(file.runId, [...(byRun.get(file.runId) ?? []), file]);
      let bytesFreed = 0;
      const failed = [];
      for (const [runId, files] of byRun) {
        const prefix = `outputs/${runId}/`;
        const entries = files.filter((file) => file.path.startsWith(prefix))
          .map((file) => ({ path: file.path.slice(prefix.length), kind: "file", bytes: file.sizeBytes, files: 1 }));
        const outcome = await removeOutputEntries(join(root, "outputs", runId), entries);
        bytesFreed += outcome.removed.filter((entry) => !entry.alreadyGone).reduce((total, entry) => total + entry.bytes, 0);
        failed.push(...outcome.failed.map((entry) => ({ runId, ...entry })));
        await removeEmptyDirectories(join(root, "outputs", runId));
      }
      const prune = await applyProjectPrune(store, projectId, { now });
      bytesFreed += prune.bytesFreed;

      const [results] = await Promise.all([store.readResults(projectId)]);
      const damaged = results.filter((result) => [record.kept.deliveryResultId, record.kept.sourceResultId].includes(result.id))
        .flatMap((result) => result.files.filter((file) => !file.available).map((file) => `${result.id}/${file.id}`));
      record.outcome = { bytesFreed, failedFiles: failed.length, integrity: damaged.length ? "failed" : "verified" };
      if (plan.files.length) await writeJsonAtomic(join(releasesDirectory(root), `${record.id}.json`), record);
      return {
        version: FINISH_VERSION,
        projectId,
        mode: "apply",
        status: damaged.length ? "integrity_failure" : failed.length ? "partial" : plan.files.length || prune.bytesFreed ? "completed" : "nothing_to_do",
        bytesFreed,
        releasedFiles: plan.files.length - failed.length,
        failed,
        integrity: record.outcome.integrity,
        keep: plan.keep,
        recordId: plan.files.length ? record.id : null
      };
    }
  });
}

/** Append-only history of what finishing released for a project. */
export async function readProjectReleases(store, projectId) {
  await store.readProject(projectId);
  return readReleaseRecords(projectDirectory(store.rootDir, projectId));
}
