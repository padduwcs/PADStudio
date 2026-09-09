import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AnalysisStore } from "./analysis-store.js";
import {
  ANALYSIS_SCHEMA_VERSION,
  isAnalysisResultType,
  normalizeAnalysisQuery
} from "./contracts.js";
import {
  analysisFingerprint,
  resolveAnalysisSource,
  sha256File
} from "./source-identity.js";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { projectDirectory } from "../project/project-paths.js";
import {
  SOURCE_ASSESSMENT_TYPE,
  TRANSCRIPT_EDIT_TYPE
} from "../intelligence/source-artifacts.js";

const VIEW_OPERATION = Object.freeze({
  transcript: "transcript",
  scenes: "scenes",
  frames: "frames",
  audio: "audio"
});
const VIEW_DATASET = Object.freeze({
  transcript: "transcript",
  scenes: "scenes",
  frames: "frames",
  audio: "audio-analysis"
});

export class AnalysisReaderError extends Error {
  constructor(message, { code = "analysis_read_failed", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisReaderError";
    this.code = code;
  }
}

function indexPaths(rootDir, projectId) {
  const directory = join(projectDirectory(rootDir, projectId), "analysis", "indexes");
  return {
    directory,
    search: join(directory, "search-v1.jsonl"),
    searchMetadata: join(directory, "search-v1.json"),
    verification: join(directory, "verification-v1.json")
  };
}

function overlaps(row, range) {
  if (!range) return true;
  const start = Number(row.startSeconds ?? row.actualTime);
  const end = Number(row.endSeconds ?? (Number.isFinite(start) ? start + 0.001 : NaN));
  return Number.isFinite(start) && Number.isFinite(end) && start < range.endSeconds && end > range.startSeconds;
}

function normalizeSearchText(value, insensitive) {
  const normalized = String(value ?? "").normalize("NFC").toLocaleLowerCase("vi-VN");
  return insensitive ? normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : normalized;
}

function cursorPayload(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const { signature, ...payload } = value;
    if (signature !== analysisFingerprint(payload)) throw new Error("signature");
    return payload;
  } catch (error) {
    throw new AnalysisReaderError("Cursor is invalid or stale.", { code: "cursor_stale", cause: error });
  }
}

function makeCursor(payload) {
  return Buffer.from(JSON.stringify({ ...payload, signature: analysisFingerprint(payload) }), "utf8").toString("base64url");
}

function cursorPosition(query, identity) {
  if (!query.cursor) return 0;
  const payload = cursorPayload(query.cursor);
  const queryIdentity = analysisFingerprint({
    view: query.view,
    sourceKey: query.sourceKey,
    resultId: query.resultId,
    range: query.range,
    text: query.text,
    diacriticInsensitive: query.diacriticInsensitive,
    transcriptMode: query.transcriptMode
  });
  if (payload.identity !== identity || payload.queryIdentity !== queryIdentity || !Number.isSafeInteger(payload.position)) {
    throw new AnalysisReaderError("Cursor no longer matches this dataset or query.", { code: "cursor_stale" });
  }
  return payload.position;
}

function nextCursor(query, identity, position) {
  return makeCursor({
    version: ANALYSIS_SCHEMA_VERSION,
    identity,
    position,
    queryIdentity: analysisFingerprint({
      view: query.view,
      sourceKey: query.sourceKey,
      resultId: query.resultId,
      range: query.range,
      text: query.text,
      diacriticInsensitive: query.diacriticInsensitive,
      transcriptMode: query.transcriptMode
    })
  });
}

async function readOptionalJson(path, fallback) {
  try { return await readJson(path); } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function streamJsonLines(path, visit) {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (error) {
      throw new AnalysisReaderError("Analysis dataset contains invalid JSONL at row " + lineNumber + ".", {
        code: "invalid_dataset", cause: error
      });
    }
    const keepGoing = await visit(row, lineNumber++);
    if (keepGoing === false) break;
  }
}

function publicResult(result) {
  return {
    id: result.id,
    type: result.type,
    name: result.name,
    createdAt: result.createdAt,
    source: result.data.source,
    sourceKey: result.data.sourceKey,
    sourceVersion: result.data.sourceVersion,
    operation: result.data.operation,
    coverage: result.data.coverage,
    method: result.data.method,
    outcome: result.data.outcome,
    emptyReason: result.data.emptyReason ?? null,
    counts: result.data.counts,
    warnings: result.data.warnings,
    verification: result.verification
  };
}

function latestByKey(artifacts, type) {
  const latest = new Map();
  for (const artifact of artifacts.filter((entry) => entry.type === type)) {
    const current = latest.get(artifact.key);
    if (!current || artifact.revision > current.revision) latest.set(artifact.key, artifact);
  }
  return [...latest.values()].filter((artifact) => artifact.status === "active");
}

function analysisGeneration(results, artifacts) {
  return analysisFingerprint({
    results: results.map((result) => [result.id, result.data.sourceVersion, result.files.map((file) => [file.id, file.sha256])]),
    artifacts: artifacts.filter((artifact) => [SOURCE_ASSESSMENT_TYPE, TRANSCRIPT_EDIT_TYPE].includes(artifact.type))
      .map((artifact) => [artifact.id, artifact.revision, artifact.status])
  });
}

function correctionsByResult(artifacts) {
  const grouped = new Map();
  const edits = latestByKey(artifacts, TRANSCRIPT_EDIT_TYPE)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const artifact of edits) {
    for (const resultId of artifact.data.baseResultIds) {
      const corrections = grouped.get(resultId) ?? new Map();
      for (const correction of artifact.data.corrections) {
        corrections.set(correction.segmentId, { ...correction, artifactId: artifact.id });
      }
      grouped.set(resultId, corrections);
    }
  }
  return grouped;
}

export class AnalysisReader {
  constructor({ rootDir, projectStore, analysisStore = null }) {
    if (!rootDir || !projectStore) throw new AnalysisReaderError("AnalysisReader requires rootDir and projectStore.");
    this.rootDir = rootDir;
    this.projectStore = projectStore;
    this.analysisStore = analysisStore ?? new AnalysisStore({ rootDir, projectStore });
  }

  async query(projectId, queryValue = {}) {
    const query = normalizeAnalysisQuery(queryValue);
    await this.projectStore.readProject(projectId);
    if (query.view === "summary") return this.summary(projectId, query);
    if (query.view === "job") {
      return { version: ANALYSIS_SCHEMA_VERSION, view: "job", job: await this.analysisStore.readJob(projectId, query.jobId) };
    }
    if (query.view === "assessment") return this.#assessments(projectId, query);
    if (query.view === "search") return this.#search(projectId, query);
    return this.#dataset(projectId, query);
  }

  async summary(projectId, query = {}) {
    let [results, jobs, artifacts, verification] = await Promise.all([
      this.#analysisResults(projectId),
      this.analysisStore.listJobs(projectId),
      this.projectStore.readArtifacts(projectId),
      readOptionalJson(indexPaths(this.rootDir, projectId).verification, { sources: {}, results: {} })
    ]);
    if (query.sourceKey) {
      results = results.filter((result) => result.data.sourceKey === query.sourceKey);
      artifacts = artifacts.filter((artifact) => artifact.data?.sourceKey === query.sourceKey);
    }
    if (query.resultId) results = results.filter((result) => result.id === query.resultId);
    if (query.jobId) {
      results = results.filter((result) => result.data.analysisJobId === query.jobId);
      jobs = jobs.filter((job) => job.id === query.jobId);
    }
    if (query.range) results = results.filter((result) => overlaps(result.data.coverage, query.range));
    const sources = new Map();
    for (const result of results) {
      const data = result.data;
      const source = sources.get(data.sourceKey) ?? {
        sourceKey: data.sourceKey,
        source: data.source,
        versions: new Set(),
        operations: {},
        resultSets: new Map(),
        warnings: [],
        freshness: "unchecked",
        verifiedAt: null
      };
      source.versions.add(data.sourceVersion);
      const groupKey = analysisFingerprint({
        sourceVersion: data.sourceVersion,
        operation: data.operation,
        profileId: data.method.profileId,
        coverage: data.coverage
      });
      const grouped = source.resultSets.get(groupKey);
      if (!grouped || result.createdAt > grouped.createdAt) {
        source.resultSets.set(groupKey, {
          ...publicResult(result),
          freshness: verification.results?.[result.id]?.status ?? "unchecked",
          verifiedAt: verification.results?.[result.id]?.verifiedAt ?? null
        });
      }
      const existing = source.operations[data.operation];
      if (!existing || result.createdAt > existing.createdAt) {
        source.operations[data.operation] = {
          ...publicResult(result),
          freshness: verification.results?.[result.id]?.status ?? "unchecked",
          verifiedAt: verification.results?.[result.id]?.verifiedAt ?? null
        };
      }
      source.warnings.push(...data.warnings);
      const cached = verification.sources?.[data.sourceKey];
      if (cached) {
        source.freshness = cached.sourceVersion === null
          ? "missing"
          : cached.sourceVersion === data.sourceVersion ? "verified_current" : "stale";
        source.verifiedAt = cached.verifiedAt;
      }
      sources.set(data.sourceKey, source);
    }
    const assessments = latestByKey(artifacts, SOURCE_ASSESSMENT_TYPE);
    for (const source of sources.values()) {
      source.versions = [...source.versions];
      source.resultSets = [...source.resultSets.values()];
      source.assessments = assessments.filter((artifact) => artifact.data.sourceKey === source.sourceKey).map((artifact) => ({
        id: artifact.id, revision: artifact.revision, purpose: artifact.data.purpose,
        summary: artifact.data.summary, sourceVersion: artifact.data.sourceVersion,
        freshness: source.freshness === "missing"
          ? "missing"
          : artifact.data.sourceVersion === verification.sources?.[source.sourceKey]?.sourceVersion
            ? "verified_current" : source.freshness === "unchecked" ? "unchecked" : "stale"
      }));
    }
    const jobStates = {};
    for (const job of jobs) jobStates[job.state] = (jobStates[job.state] ?? 0) + 1;
    return {
      version: ANALYSIS_SCHEMA_VERSION,
      view: "summary",
      counts: { sources: sources.size, results: results.length, jobs: jobs.length, assessments: assessments.length },
      jobStates,
      jobs: jobs.map((job) => ({ id: job.id, state: job.state, revision: job.revision, createdAt: job.createdAt, updatedAt: job.updatedAt })),
      sources: [...sources.values()]
    };
  }

  async verify(projectId, queryValue = {}) {
    const query = normalizeAnalysisQuery({ ...queryValue, view: queryValue.view ?? "summary" });
    let results = await this.#analysisResults(projectId);
    if (query.sourceKey) results = results.filter((result) => result.data.sourceKey === query.sourceKey);
    if (query.resultId) results = results.filter((result) => result.id === query.resultId);
    if ((query.sourceKey || query.resultId) && results.length === 0) {
      throw new AnalysisReaderError("No matching analysis Result.", { code: "result_not_found" });
    }
    const previousCache = await readOptionalJson(indexPaths(this.rootDir, projectId).verification, { sources: {}, results: {} });
    const cache = {
      version: ANALYSIS_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      sources: { ...(previousCache.sources ?? {}) },
      results: { ...(previousCache.results ?? {}) }
    };
    const groups = new Map();
    for (const result of results) {
      const group = groups.get(result.data.sourceKey) ?? [];
      group.push(result);
      groups.set(result.data.sourceKey, group);
    }
    for (const group of groups.values()) {
      const representative = group.at(-1);
      try {
        const current = await resolveAnalysisSource({ store: this.projectStore, projectId, source: representative.data.source });
        cache.sources[representative.data.sourceKey] = {
          sourceVersion: current.sourceVersion,
          verifiedAt: cache.updatedAt
        };
      } catch (error) {
        cache.sources[representative.data.sourceKey] = {
          sourceVersion: null,
          verifiedAt: cache.updatedAt,
          error: error.code ?? "source_missing"
        };
      }
    }
    for (const result of results) {
      let status = cache.sources[result.data.sourceKey].sourceVersion === result.data.sourceVersion
        ? "verified_current"
        : cache.sources[result.data.sourceKey].sourceVersion === null ? "missing" : "stale";
      const files = [];
      for (const expected of result.files) {
        try {
          const file = await this.projectStore.resolveResultFile(projectId, result.id, expected.id);
          const checksum = await sha256File(file.filePath);
          const fileStatus = checksum === expected.sha256 ? "verified_current" : "stale";
          if (fileStatus !== "verified_current" && status === "verified_current") status = "stale";
          files.push({ id: expected.id, status: fileStatus, sha256: checksum });
        } catch (error) {
          status = "missing";
          files.push({ id: expected.id, status: "missing", error: error.code ?? "file_missing" });
        }
      }
      cache.results[result.id] = { status, verifiedAt: cache.updatedAt, files };
    }
    const paths = indexPaths(this.rootDir, projectId);
    await mkdir(paths.directory, { recursive: true });
    await writeJsonAtomic(paths.verification, cache);
    const index = await this.#buildSearchIndex(projectId);
    return {
      version: ANALYSIS_SCHEMA_VERSION,
      verifiedAt: cache.updatedAt,
      sources: cache.sources,
      results: cache.results,
      searchIndex: index
    };
  }

  async #analysisResults(projectId) {
    return (await this.projectStore.readResults(projectId))
      .filter((result) => isAnalysisResultType(result.type))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async #selectResult(projectId, query) {
    let results = (await this.#analysisResults(projectId)).filter((result) => result.data.operation === VIEW_OPERATION[query.view]);
    if (query.resultId) results = results.filter((result) => result.id === query.resultId);
    if (query.sourceKey) results = results.filter((result) => result.data.sourceKey === query.sourceKey);
    if (query.jobId) results = results.filter((result) => result.data.analysisJobId === query.jobId);
    if (query.range) results = results.filter((result) => overlaps(result.data.coverage, query.range));
    if (results.length === 0) {
      throw new AnalysisReaderError("No matching analysis dataset Result.", { code: "result_not_found" });
    }
    if (!query.resultId && results.length > 1) {
      const groups = new Set(results.map((result) => analysisFingerprint({
        sourceVersion: result.data.sourceVersion,
        operation: result.data.operation,
        profileId: result.data.method.profileId,
        coverage: result.data.coverage
      })));
      if (groups.size > 1) {
        throw new AnalysisReaderError(
          "Multiple analysis Results match this source/range; select a resultId from summary.resultSets.",
          { code: "ambiguous_result" }
        );
      }
    }
    return results.at(-1);
  }

  async #dataset(projectId, query) {
    const result = await this.#selectResult(projectId, query);
    const dataset = result.data.datasets.find((entry) => entry.kind === VIEW_DATASET[query.view]);
    if (!dataset) {
      return { version: ANALYSIS_SCHEMA_VERSION, view: query.view, result: publicResult(result), rows: [], nextCursor: null };
    }
    const file = await this.projectStore.resolveResultFile(projectId, result.id, dataset.fileId);
    if (file.sha256 && await sha256File(file.filePath) !== file.sha256) {
      throw new AnalysisReaderError("Analysis dataset checksum no longer matches its Result.", { code: "dataset_stale" });
    }
    const identity = result.id + ":" + dataset.fileId + ":" + file.sha256;
    const position = cursorPosition(query, identity);
    const corrections = query.view === "transcript" ? await this.#corrections(projectId, result) : new Map();
    const rows = [];
    let matched = 0;
    let hasMore = false;
    await streamJsonLines(file.filePath, (raw) => {
      if (!overlaps(raw, query.range)) return true;
      if (matched++ < position) return true;
      if (rows.length >= query.limit) {
        hasMore = true;
        return false;
      }
      rows.push(this.#applyCorrection(raw, corrections.get(raw.id), query.transcriptMode));
      return true;
    });
    return {
      version: ANALYSIS_SCHEMA_VERSION,
      view: query.view,
      result: publicResult(result),
      rows,
      nextCursor: hasMore ? nextCursor(query, identity, position + rows.length) : null
    };
  }

  async #corrections(projectId, result) {
    const artifacts = latestByKey(await this.projectStore.readArtifacts(projectId), TRANSCRIPT_EDIT_TYPE)
      .filter((artifact) => artifact.data.sourceKey === result.data.sourceKey && artifact.data.sourceVersion === result.data.sourceVersion)
      .filter((artifact) => artifact.data.baseResultIds.includes(result.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const corrections = new Map();
    for (const artifact of artifacts) {
      for (const correction of artifact.data.corrections) corrections.set(correction.segmentId, { ...correction, artifactId: artifact.id });
    }
    return corrections;
  }

  #applyCorrection(raw, correction, mode) {
    if (!correction || mode === "raw") return raw;
    if (mode === "both") return { ...raw, rawText: raw.text, correctedText: correction.correctedText, correction };
    return {
      ...raw,
      rawText: raw.text,
      text: correction.correctedText,
      ...(correction.timing ? correction.timing : {}),
      correction
    };
  }

  async #assessments(projectId, query) {
    let artifacts = latestByKey(await this.projectStore.readArtifacts(projectId), SOURCE_ASSESSMENT_TYPE);
    if (query.sourceKey) artifacts = artifacts.filter((artifact) => artifact.data.sourceKey === query.sourceKey);
    const identity = analysisFingerprint(artifacts.map((artifact) => [artifact.id, artifact.revision]));
    const position = cursorPosition(query, identity);
    const rows = artifacts.slice(position, position + query.limit);
    return {
      version: ANALYSIS_SCHEMA_VERSION,
      view: "assessment",
      rows,
      nextCursor: position + rows.length < artifacts.length ? nextCursor(query, identity, position + rows.length) : null
    };
  }

  async #generation(projectId) {
    const [results, artifacts] = await Promise.all([this.#analysisResults(projectId), this.projectStore.readArtifacts(projectId)]);
    return analysisGeneration(results, artifacts);
  }

  async #buildSearchIndex(projectId) {
    const [results, artifacts] = await Promise.all([
      this.#analysisResults(projectId), this.projectStore.readArtifacts(projectId)
    ]);
    const generation = analysisGeneration(results, artifacts);
    const warnings = [];
    const paths = indexPaths(this.rootDir, projectId);
    await mkdir(paths.directory, { recursive: true });
    const temporaryPath = join(paths.directory, `.${basename(paths.search)}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx");
    let rowCount = 0;
    const writeRow = async (row) => {
      await handle.write(JSON.stringify(row) + "\n", null, "utf8");
      rowCount += 1;
    };
    const corrections = correctionsByResult(artifacts);
    try {
      for (const result of results.filter((entry) => entry.type === "source.transcript")) {
        const dataset = result.data.datasets.find((entry) => entry.kind === "transcript");
        if (!dataset) continue;
        let file;
        try {
          file = await this.projectStore.resolveResultFile(projectId, result.id, dataset.fileId);
          if (file.sha256 && await sha256File(file.filePath) !== file.sha256) {
            warnings.push({ code: "dataset_stale", resultId: result.id });
            continue;
          }
        } catch (error) {
          warnings.push({ code: "dataset_missing", resultId: result.id, detail: error.code ?? "missing" });
          continue;
        }
        const resultCorrections = corrections.get(result.id) ?? new Map();
        await streamJsonLines(file.filePath, async (row) => {
          const correction = resultCorrections.get(row.id);
          await writeRow({
            kind: "transcript", text: row.text,
            ...(correction ? { correctedText: correction.correctedText, correctionArtifactId: correction.artifactId } : {}),
            source: result.data.source,
            sourceKey: result.data.sourceKey, sourceVersion: result.data.sourceVersion,
            resultId: result.id, analysisJobId: result.data.analysisJobId, itemId: row.id,
            startSeconds: row.startSeconds, endSeconds: row.endSeconds
          });
        });
      }
      for (const artifact of latestByKey(artifacts, SOURCE_ASSESSMENT_TYPE)) {
        await writeRow({
          kind: "assessment", text: artifact.data.summary, source: artifact.data.source,
          sourceKey: artifact.data.sourceKey, sourceVersion: artifact.data.sourceVersion,
          artifactId: artifact.id, itemId: "summary"
        });
        for (const finding of artifact.data.findings) await writeRow({
          kind: "finding", text: finding.statement, source: artifact.data.source,
          sourceKey: artifact.data.sourceKey, sourceVersion: artifact.data.sourceVersion,
          artifactId: artifact.id, itemId: finding.id,
          startSeconds: finding.evidence.find((entry) => entry.range)?.range?.startSeconds ?? null,
          endSeconds: finding.evidence.find((entry) => entry.range)?.range?.endSeconds ?? null,
          basis: finding.basis, certainty: finding.certainty
        });
      }
      await handle.close();
      await rename(temporaryPath, paths.search);
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    const checksum = await sha256File(paths.search);
    const metadata = {
      version: ANALYSIS_SCHEMA_VERSION, generation, checksum,
      rowCount, warnings, builtAt: new Date().toISOString()
    };
    await writeJsonAtomic(paths.searchMetadata, metadata);
    return metadata;
  }

  async #search(projectId, query) {
    const paths = indexPaths(this.rootDir, projectId);
    let metadata;
    try { metadata = await readJson(paths.searchMetadata); } catch (error) {
      if (error?.code === "ENOENT") throw new AnalysisReaderError("Search index is not ready; run analysis:verify.", { code: "index_not_ready" });
      throw error;
    }
    const generation = await this.#generation(projectId);
    let checksum;
    try { checksum = await sha256File(paths.search); } catch (error) {
      throw new AnalysisReaderError("Search index is missing; run analysis:verify.", { code: "index_not_ready", cause: error });
    }
    if (metadata.generation !== generation || metadata.checksum !== checksum) {
      throw new AnalysisReaderError("Search index is stale; run analysis:verify.", { code: "index_not_ready" });
    }
    const identity = generation + ":" + checksum;
    const verification = await readOptionalJson(paths.verification, { sources: {}, results: {} });
    const position = cursorPosition(query, identity);
    const needle = normalizeSearchText(query.text, query.diacriticInsensitive);
    const rows = [];
    let matched = 0;
    let hasMore = false;
    await streamJsonLines(paths.search, (row) => {
      if (query.sourceKey && row.sourceKey !== query.sourceKey) return true;
      if (query.resultId && row.resultId !== query.resultId) return true;
      if (query.jobId && row.analysisJobId !== query.jobId) return true;
      if (!overlaps(row, query.range)) return true;
      const searchableText = query.transcriptMode === "corrected"
        ? (row.correctedText ?? row.text)
        : query.transcriptMode === "both" ? [row.text, row.correctedText].filter(Boolean).join("\n") : row.text;
      const haystack = normalizeSearchText(searchableText, query.diacriticInsensitive);
      const at = haystack.indexOf(needle);
      if (at < 0) return true;
      if (matched++ < position) return true;
      if (rows.length >= query.limit) {
        hasMore = true;
        return false;
      }
      rows.push({
        ...row,
        freshness: row.resultId
          ? verification.results?.[row.resultId]?.status ?? "unchecked"
          : verification.sources?.[row.sourceKey]?.sourceVersion === row.sourceVersion ? "verified_current" : "unchecked",
        verifiedAt: row.resultId
          ? verification.results?.[row.resultId]?.verifiedAt ?? null
          : verification.sources?.[row.sourceKey]?.verifiedAt ?? null,
        match: { field: "text", query: query.text, index: at },
        snippet: searchableText.length <= 180
          ? searchableText
          : searchableText.slice(Math.max(0, at - 60), at + needle.length + 120)
      });
      return true;
    });
    return {
      version: ANALYSIS_SCHEMA_VERSION,
      view: "search",
      generation,
      indexBuiltAt: metadata.builtAt,
      warnings: metadata.warnings ?? [],
      rows,
      nextCursor: hasMore ? nextCursor(query, identity, position + rows.length) : null
    };
  }
}

export function createAnalysisReader({ rootDir, projectStore }) {
  return new AnalysisReader({ rootDir, projectStore });
}
