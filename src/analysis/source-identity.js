import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { canonicalJson, normalizeSourceReference } from "./contracts.js";

export class SourceIdentityError extends Error {
  constructor(message, { code = "source_identity_failed", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SourceIdentityError";
    this.code = code;
  }
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sameStat(left, right) {
  return left.size === right.size && left.mtimeNs === right.mtimeNs;
}

export async function hashFileStable(filePath) {
  let before;
  let after;
  let sourceVersion;
  try {
    before = await stat(filePath, { bigint: true });
    if (!before.isFile()) throw new SourceIdentityError("Nguồn phân tích không phải file.", { code: "invalid_source" });
    sourceVersion = await sha256File(filePath);
    after = await stat(filePath, { bigint: true });
  } catch (error) {
    if (error instanceof SourceIdentityError) throw error;
    const code = error?.code === "ENOENT" ? "source_missing" : "source_hash_failed";
    throw new SourceIdentityError("Không thể đọc đầy đủ nguồn để tạo fingerprint.", { code, cause: error });
  }
  if (!sameStat(before, after)) {
    throw new SourceIdentityError("Nguồn đã thay đổi trong lúc tính hash.", { code: "source_changed" });
  }
  return {
    sourceVersion,
    sizeBytes: Number(after.size),
    modifiedAt: new Date(Number(after.mtimeNs / 1_000_000n)).toISOString(),
    hashedAt: new Date().toISOString(),
    fingerprintMethod: "sha256-full-file-v1"
  };
}

export function sourceKeyFor(projectId, source) {
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new SourceIdentityError("Project ID không hợp lệ.", { code: "invalid_source" });
  }
  const normalizedSource = normalizeSourceReference(source);
  return sha256Text(canonicalJson({ projectId, source: normalizedSource }));
}

async function canonicalResolvedReference(store, projectId, requested, resolved) {
  if (requested.kind === "result") {
    return normalizeSourceReference({ kind: "result", id: requested.id, file: resolved.trace.file });
  }
  const resource = (await store.readResources(projectId)).find((item) => item.id === requested.id);
  if (!resource) {
    throw new SourceIdentityError(`Không tìm thấy resource: ${requested.id}`, { code: "source_missing" });
  }
  return normalizeSourceReference({
    kind: "resource",
    id: resource.id,
    itemPath: resource.kind === "file" ? null : resolved.trace.itemPath
  });
}

export async function resolveAnalysisSource({ store, projectId, source }) {
  const requested = normalizeSourceReference(source);
  let resolved;
  try {
    resolved = await store.resolveMediaSource(projectId, requested);
  } catch (error) {
    throw new SourceIdentityError(error?.message || "Không thể resolve source.", {
      code: error?.code || "invalid_source",
      cause: error
    });
  }
  const normalizedSource = await canonicalResolvedReference(store, projectId, requested, resolved);
  const identity = await hashFileStable(resolved.filePath);
  return {
    source: normalizedSource,
    sourceKey: sourceKeyFor(projectId, normalizedSource),
    ...identity,
    mediaType: resolved.mediaType,
    itemName: resolved.itemName,
    inputResources: [...resolved.inputResources],
    inputResults: [...resolved.inputResults],
    filePath: resolved.filePath
  };
}

export function analysisFingerprint(value) {
  return sha256Text(canonicalJson(value));
}
