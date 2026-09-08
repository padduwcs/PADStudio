const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const ANALYSIS_SCHEMA_VERSION = "1.0";
export const ANALYSIS_OPERATIONS = Object.freeze([
  "probe",
  "scenes",
  "frames",
  "audio",
  "transcript",
  "preview"
]);
export const ANALYSIS_JOB_STATES = Object.freeze([
  "planned",
  "running",
  "completed",
  "partial",
  "failed",
  "interrupted",
  "cancelled"
]);
export const ANALYSIS_UNIT_STATES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "reused",
  "not_applicable",
  "blocked",
  "failed",
  "cancelled"
]);

const ANALYSIS_RESULT_OPERATION = Object.freeze({
  "source.metadata": "probe",
  "source.scenes": "scenes",
  "source.frames": "frames",
  "source.audio-analysis": "audio",
  "source.transcript": "transcript",
  "source.preview": "preview"
});

export class AnalysisValidationError extends Error {
  constructor(message, { code = "invalid_analysis_data", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisValidationError";
    this.code = code;
  }
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) throw new AnalysisValidationError(`${label} phải là object.`);
  return value;
}

function onlyFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw new AnalysisValidationError(`${label} chứa field không được hỗ trợ: ${unknown.join(", ")}.`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AnalysisValidationError(`${label} phải là chuỗi không rỗng.`);
  }
  return value.trim();
}

function requireId(value, label) {
  const id = requireText(value, label);
  if (!ID_PATTERN.test(id)) throw new AnalysisValidationError(`${label} không đúng định dạng.`);
  return id;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new AnalysisValidationError(`${label} phải là SHA-256 chữ thường.`);
  }
  return value;
}

function optionalId(value, label) {
  return value === null || value === undefined ? null : requireId(value, label);
}

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new AnalysisValidationError(`${label} phải là số hữu hạn không âm.`);
  }
  return value;
}

function normalizeItemPath(value, label) {
  if (value === null || value === undefined) return null;
  const path = requireText(value, label);
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new AnalysisValidationError(`${label} phải là đường dẫn tương đối đã chuẩn hóa.`);
  }
  return path;
}

export function normalizeSourceReference(value, label = "source") {
  const source = requireObject(value, label);
  const kind = requireText(source.kind, `${label}.kind`);
  if (kind === "resource") {
    onlyFields(source, ["kind", "id", "itemPath"], label);
    return {
      kind,
      id: requireId(source.id, `${label}.id`),
      itemPath: normalizeItemPath(source.itemPath, `${label}.itemPath`)
    };
  }
  if (kind === "result") {
    onlyFields(source, ["kind", "id", "file"], label);
    return {
      kind,
      id: requireId(source.id, `${label}.id`),
      file: requireId(source.file ?? "primary", `${label}.file`)
    };
  }
  throw new AnalysisValidationError(`${label}.kind phải là resource hoặc result.`);
}

export function normalizeTimeRange(value, label = "range", { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new AnalysisValidationError(`${label} là bắt buộc.`);
  }
  const range = requireObject(value, label);
  onlyFields(range, ["startSeconds", "endSeconds"], label);
  const startSeconds = finiteNonNegative(range.startSeconds, `${label}.startSeconds`);
  const endSeconds = finiteNonNegative(range.endSeconds, `${label}.endSeconds`);
  if (endSeconds <= startSeconds) {
    throw new AnalysisValidationError(`${label} phải theo interval [startSeconds,endSeconds).`);
  }
  return { startSeconds, endSeconds };
}

export function normalizeTimeBase(value, label = "timeBase") {
  if (typeof value === "string") {
    const match = /^(\d+)\/(\d+)$/.exec(value.trim());
    if (!match) throw new AnalysisValidationError(`${label} phải có dạng numerator/denominator.`);
    value = { numerator: Number(match[1]), denominator: Number(match[2]) };
  }
  const timeBase = requireObject(value, label);
  onlyFields(timeBase, ["numerator", "denominator"], label);
  if (
    !Number.isSafeInteger(timeBase.numerator) ||
    timeBase.numerator <= 0 ||
    !Number.isSafeInteger(timeBase.denominator) ||
    timeBase.denominator <= 0
  ) {
    throw new AnalysisValidationError(`${label} phải chứa hai số nguyên dương an toàn.`);
  }
  return { numerator: timeBase.numerator, denominator: timeBase.denominator };
}

export function ptsToSourceSeconds(pts, timeBase, streamStartSeconds = 0) {
  if (!Number.isSafeInteger(pts)) {
    throw new AnalysisValidationError("pts phải là số nguyên an toàn.");
  }
  const normalized = normalizeTimeBase(timeBase);
  if (!Number.isFinite(streamStartSeconds)) {
    throw new AnalysisValidationError("streamStartSeconds phải là số hữu hạn.");
  }
  const seconds = pts * normalized.numerator / normalized.denominator - streamStartSeconds;
  if (!Number.isFinite(seconds)) throw new AnalysisValidationError("Timestamp nguồn không hữu hạn.");
  return Object.is(seconds, -0) ? 0 : seconds;
}

function canonicalValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AnalysisValidationError(`${path} chứa số không hữu hạn.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (!isPlainObject(value)) throw new AnalysisValidationError(`${path} chứa giá trị không thể canonical hóa.`);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new AnalysisValidationError(`${path}.${key} không được là undefined.`);
    output[key] = canonicalValue(value[key], `${path}.${key}`);
  }
  return output;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, "value"));
}

function normalizeCoverage(value) {
  const coverage = requireObject(value, "analysis result data.coverage");
  onlyFields(coverage, ["startSeconds", "endSeconds", "mode", "intervals"], "analysis result data.coverage");
  const mode = requireText(coverage.mode, "analysis result data.coverage.mode");
  if (!["continuous", "sampled", "metadata", "full_image"].includes(mode)) {
    throw new AnalysisValidationError(`analysis result data.coverage.mode không được hỗ trợ: ${mode}.`);
  }
  const hasStart = coverage.startSeconds !== undefined;
  const hasEnd = coverage.endSeconds !== undefined;
  if (hasStart !== hasEnd) {
    throw new AnalysisValidationError("analysis result data.coverage phải có cả startSeconds và endSeconds.");
  }
  const range = hasStart
    ? normalizeTimeRange({ startSeconds: coverage.startSeconds, endSeconds: coverage.endSeconds }, "analysis result data.coverage", { nullable: false })
    : null;
  if (mode === "continuous" && !range) {
    throw new AnalysisValidationError("Coverage continuous cần một time range.");
  }
  const intervals = coverage.intervals === undefined
    ? []
    : (() => {
        if (!Array.isArray(coverage.intervals)) {
          throw new AnalysisValidationError("analysis result data.coverage.intervals phải là array.");
        }
        return coverage.intervals.map((entry, index) =>
          normalizeTimeRange(entry, `analysis result data.coverage.intervals[${index}]`, { nullable: false })
        );
      })();
  return { ...(range ?? {}), mode, ...(intervals.length ? { intervals } : {}) };
}

function normalizeCounts(value) {
  const counts = requireObject(value, "analysis result data.counts");
  const normalized = {};
  for (const [key, count] of Object.entries(counts)) {
    if (!ID_PATTERN.test(key) || !Number.isSafeInteger(count) || count < 0) {
      throw new AnalysisValidationError(`analysis result data.counts.${key} không hợp lệ.`);
    }
    normalized[key] = count;
  }
  return normalized;
}

function normalizeDatasets(value) {
  if (!Array.isArray(value)) throw new AnalysisValidationError("analysis result data.datasets phải là array.");
  return value.map((entry, index) => {
    const label = `analysis result data.datasets[${index}]`;
    const dataset = requireObject(entry, label);
    onlyFields(dataset, ["kind", "fileId", "indexFileId", "checksum"], label);
    return {
      kind: requireId(dataset.kind, `${label}.kind`),
      fileId: requireId(dataset.fileId, `${label}.fileId`),
      ...(dataset.indexFileId === undefined ? {} : { indexFileId: requireId(dataset.indexFileId, `${label}.indexFileId`) }),
      ...(dataset.checksum === undefined ? {} : { checksum: requireHash(dataset.checksum, `${label}.checksum`) })
    };
  });
}

function assertJsonSafe(value, label) {
  canonicalValue(value, label);
  return structuredClone(value);
}

export function isAnalysisResultType(type) {
  return Object.hasOwn(ANALYSIS_RESULT_OPERATION, type);
}

export function analysisOperationForResultType(type) {
  return ANALYSIS_RESULT_OPERATION[type] ?? null;
}

export function validateAnalysisResultData(value, { maxBytes = 32 * 1024, resultType = null } = {}) {
  const data = requireObject(value, "analysis result data");
  onlyFields(
    data,
    [
      "schemaVersion", "source", "sourceKey", "sourceVersion", "operation",
      "analysisJobId", "unitId", "fingerprint", "coverage", "method", "outcome",
      "emptyReason", "counts", "datasets", "warnings", "contentReview", "details"
    ],
    "analysis result data"
  );
  if (data.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new AnalysisValidationError(`analysis result data.schemaVersion phải là ${ANALYSIS_SCHEMA_VERSION}.`);
  }
  const operation = requireText(data.operation, "analysis result data.operation");
  if (!ANALYSIS_OPERATIONS.includes(operation)) {
    throw new AnalysisValidationError(`analysis result data.operation không được hỗ trợ: ${operation}.`);
  }
  if (resultType !== null) {
    const expectedOperation = analysisOperationForResultType(resultType);
    if (!expectedOperation) {
      throw new AnalysisValidationError(`Analysis Result type không được hỗ trợ: ${resultType}.`);
    }
    if (operation !== expectedOperation) {
      throw new AnalysisValidationError(
        `Analysis Result type ${resultType} yêu cầu operation ${expectedOperation}, không phải ${operation}.`
      );
    }
  }
  const outcome = requireText(data.outcome, "analysis result data.outcome");
  if (!["produced", "empty"].includes(outcome)) {
    throw new AnalysisValidationError("analysis result data.outcome phải là produced hoặc empty.");
  }
  const emptyReason = data.emptyReason === undefined || data.emptyReason === null
    ? null
    : requireText(data.emptyReason, "analysis result data.emptyReason");
  if ((outcome === "empty") !== Boolean(emptyReason)) {
    throw new AnalysisValidationError("Result empty cần emptyReason và Result produced không được có emptyReason.");
  }
  const method = assertJsonSafe(requireObject(data.method, "analysis result data.method"), "analysis result data.method");
  if (Object.keys(method).length === 0) throw new AnalysisValidationError("analysis result data.method không được rỗng.");
  const warnings = data.warnings ?? [];
  if (!Array.isArray(warnings)) throw new AnalysisValidationError("analysis result data.warnings phải là array.");
  const contentReview = requireText(data.contentReview, "analysis result data.contentReview");
  if (contentReview !== "not_performed") {
    throw new AnalysisValidationError("Result kỹ thuật không được tự tuyên bố đã review nội dung.");
  }
  const normalized = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    source: normalizeSourceReference(data.source, "analysis result data.source"),
    sourceKey: requireHash(data.sourceKey, "analysis result data.sourceKey"),
    sourceVersion: requireHash(data.sourceVersion, "analysis result data.sourceVersion"),
    operation,
    analysisJobId: optionalId(data.analysisJobId, "analysis result data.analysisJobId"),
    unitId: optionalId(data.unitId, "analysis result data.unitId"),
    fingerprint: requireHash(data.fingerprint, "analysis result data.fingerprint"),
    coverage: normalizeCoverage(data.coverage),
    method,
    outcome,
    ...(emptyReason ? { emptyReason } : {}),
    counts: normalizeCounts(data.counts ?? {}),
    datasets: normalizeDatasets(data.datasets ?? []),
    warnings: warnings.map((warning, index) => assertJsonSafe(warning, `analysis result data.warnings[${index}]`)),
    contentReview,
    ...(data.details === undefined ? {} : { details: assertJsonSafe(data.details, "analysis result data.details") })
  };
  const byteLength = Buffer.byteLength(canonicalJson(normalized), "utf8");
  if (byteLength > maxBytes) {
    throw new AnalysisValidationError(`Metadata Result phân tích vượt giới hạn ${maxBytes} bytes; hãy chuyển payload lớn sang dataset file.`);
  }
  return normalized;
}

export function normalizeAnalysisRequest(value) {
  const request = requireObject(value, "analysis request");
  onlyFields(
    request,
    ["version", "sources", "resourceFolders", "operations", "profiles", "language", "reuse", "ranges", "tracks", "options"],
    "analysis request"
  );
  if (request.version !== ANALYSIS_SCHEMA_VERSION) {
    throw new AnalysisValidationError(`analysis request.version phải là ${ANALYSIS_SCHEMA_VERSION}.`);
  }
  const sources = request.sources ?? [];
  if (!Array.isArray(sources)) throw new AnalysisValidationError("analysis request.sources phải là array.");
  const normalizedSources = sources.map((source, index) => normalizeSourceReference(source, `analysis request.sources[${index}]`));
  const resourceFolders = request.resourceFolders ?? [];
  if (!Array.isArray(resourceFolders)) throw new AnalysisValidationError("analysis request.resourceFolders phải là array.");
  const normalizedFolders = resourceFolders.map((id, index) => requireId(id, `analysis request.resourceFolders[${index}]`));
  if (normalizedSources.length === 0 && normalizedFolders.length === 0) {
    throw new AnalysisValidationError("analysis request cần ít nhất một source hoặc resource folder.");
  }
  if (!Array.isArray(request.operations) || request.operations.length === 0) {
    throw new AnalysisValidationError("analysis request.operations phải có ít nhất một operation rõ ràng.");
  }
  const operations = request.operations.map((operation, index) => requireText(operation, `analysis request.operations[${index}]`));
  const unsupported = operations.filter((operation) => !ANALYSIS_OPERATIONS.includes(operation));
  if (unsupported.length) throw new AnalysisValidationError(`Operation chưa được hỗ trợ: ${unsupported.join(", ")}.`);
  if (new Set(operations).size !== operations.length) throw new AnalysisValidationError("analysis request.operations không được trùng.");
  const reuse = request.reuse ?? "verified";
  if (!["verified", "never"].includes(reuse)) throw new AnalysisValidationError("analysis request.reuse phải là verified hoặc never.");
  const profiles = request.profiles ?? {};
  const ranges = request.ranges ?? {};
  const tracks = request.tracks ?? {};
  const options = request.options ?? {};
  for (const [entry, label] of [[profiles, "profiles"], [ranges, "ranges"], [tracks, "tracks"], [options, "options"]]) {
    requireObject(entry, `analysis request.${label}`);
    assertJsonSafe(entry, `analysis request.${label}`);
  }
  const profileGroups = new Set(["probe", "visual", "audio", "asr", "preview"]);
  const normalizedProfiles = {};
  for (const [key, profileId] of Object.entries(profiles)) {
    if (!profileGroups.has(key)) {
      throw new AnalysisValidationError(`analysis request.profiles chứa nhóm không hỗ trợ: ${key}.`);
    }
    normalizedProfiles[key] = requireText(profileId, `analysis request.profiles.${key}`);
  }
  normalizeOverrideMap(ranges, "analysis request.ranges", (entry, label) =>
    normalizeTimeRange(entry, label, { nullable: false })
  );
  normalizeOverrideMap(tracks, "analysis request.tracks", (entry, label) => {
    if (!Number.isSafeInteger(entry) || entry < 0) {
      throw new AnalysisValidationError(`${label} phải là stream index không âm.`);
    }
    return entry;
  });
  normalizeOverrideMap(options, "analysis request.options", (entry, label) => {
    requireObject(entry, label);
    return assertJsonSafe(entry, label);
  });
  return {
    version: ANALYSIS_SCHEMA_VERSION,
    sources: normalizedSources,
    resourceFolders: normalizedFolders,
    operations,
    profiles: normalizedProfiles,
    language: request.language === undefined || request.language === null
      ? null
      : requireText(request.language, "analysis request.language"),
    reuse,
    ranges: structuredClone(ranges),
    tracks: structuredClone(tracks),
    options: structuredClone(options)
  };
}

function normalizeOverrideMap(value, label, normalizeLeaf) {
  for (const [key, entry] of Object.entries(value)) {
    if (ANALYSIS_OPERATIONS.includes(key)) {
      normalizeLeaf(entry, `${label}.${key}`);
      continue;
    }
    const combined = /^([a-f0-9]{64}):([a-z-]+)$/.exec(key);
    if (combined) {
      if (!ANALYSIS_OPERATIONS.includes(combined[2])) {
        throw new AnalysisValidationError(`${label} chứa operation không hợp lệ: ${combined[2]}.`);
      }
      normalizeLeaf(entry, `${label}.${key}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(key) || !isPlainObject(entry)) {
      throw new AnalysisValidationError(`${label} chứa override key không hợp lệ: ${key}.`);
    }
    for (const [operation, nested] of Object.entries(entry)) {
      if (!ANALYSIS_OPERATIONS.includes(operation)) {
        throw new AnalysisValidationError(`${label}.${key} chứa operation không hợp lệ: ${operation}.`);
      }
      normalizeLeaf(nested, `${label}.${key}.${operation}`);
    }
  }
}

export function assertSha256(value, label) {
  return requireHash(value, label);
}
