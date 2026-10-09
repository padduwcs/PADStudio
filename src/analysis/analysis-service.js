import { randomUUID } from "node:crypto";
import {
  ANALYSIS_OPERATIONS,
  ANALYSIS_SCHEMA_VERSION,
  AnalysisValidationError,
  canonicalJson,
  normalizeAnalysisRequest,
  validateAnalysisResultData
} from "./contracts.js";
import {
  SourceIdentityError,
  analysisFingerprint,
  resolveAnalysisSource,
  sha256File
} from "./source-identity.js";

const OPERATION_DEFINITIONS = Object.freeze({
  probe: {
    capability: "source.probe",
    tool: "ffprobe-source",
    resultType: "source.metadata",
    dependencies: [],
    profileGroup: "probe"
  },
  scenes: {
    capability: "video.detect-scenes",
    tool: "pyscenedetect-scenes",
    resultType: "source.scenes",
    dependencies: ["probe"],
    profileGroup: "visual"
  },
  frames: {
    capability: "source.extract-frames",
    tool: "ffmpeg-source-frames",
    resultType: "source.frames",
    dependencies: ["probe", "scenes"],
    profileGroup: "visual"
  },
  audio: {
    capability: "audio.analyze",
    tool: "ffmpeg-audio-analysis",
    resultType: "source.audio-analysis",
    dependencies: ["probe"],
    profileGroup: "audio"
  },
  transcript: {
    capability: "audio.transcribe",
    tool: "faster-whisper-transcribe",
    resultType: "source.transcript",
    dependencies: ["probe"],
    profileGroup: "asr"
  },
  preview: {
    capability: "source.preview",
    tool: "ffmpeg-source-preview",
    resultType: "source.preview",
    dependencies: ["probe"],
    profileGroup: "preview"
  }
});

const SUCCESS_STATES = new Set(["succeeded", "reused", "not_applicable"]);
const PROBLEM_STATES = new Set(["blocked", "failed", "cancelled"]);

export class AnalysisServiceError extends Error {
  constructor(message, { code = "analysis_failed", cause, job = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisServiceError";
    this.code = code;
    this.job = job;
  }
}

function unitId(fingerprint) {
  return `unit-${fingerprint.slice(0, 24)}`;
}

function attemptId() {
  return `attempt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function jobId() {
  return `analysis-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function withoutRuntimePath(snapshot) {
  const { filePath: _filePath, ...stored } = snapshot;
  return stored;
}

function selectedValue(container, sourceKey, operation) {
  return container[`${sourceKey}:${operation}`]
    ?? container[sourceKey]?.[operation]
    ?? container[operation]
    ?? null;
}

function profileFor(request, definition) {
  const value = request.profiles[definition.profileGroup];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AnalysisValidationError(`profiles.${definition.profileGroup} phải là chuỗi không rỗng.`);
  }
  return value.trim();
}

function operationsWithDependencies(requested, definitions) {
  const selected = new Set();
  const visiting = new Set();
  function visit(operation) {
    if (selected.has(operation)) return;
    if (visiting.has(operation)) {
      throw new AnalysisServiceError(`Dependency cycle tại operation ${operation}.`, { code: "invalid_operation_dependencies" });
    }
    const definition = definitions[operation];
    if (!definition) {
      throw new AnalysisServiceError(`Chưa có định nghĩa operation: ${operation}`, { code: "operation_not_configured" });
    }
    visiting.add(operation);
    for (const dependency of definition.dependencies ?? []) visit(dependency);
    visiting.delete(operation);
    selected.add(operation);
  }
  for (const operation of requested) visit(operation);
  return ANALYSIS_OPERATIONS.filter((operation) => selected.has(operation));
}

function availabilityIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "invalid" };
  const allowed = [
    "status", "executableVersion", "modelRevision", "helperVersion", "libraryVersions",
    "device", "computeType", "pythonVersion", "profileVersion", "profileDigest", "modelLockDigest",
    "protocolVersion"
  ];
  return Object.fromEntries(allowed.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
}

function runtimeError(error) {
  if (error instanceof AnalysisServiceError) return error;
  return new AnalysisServiceError(error?.message || "Analysis job thất bại.", {
    code: error?.code || (error?.name === "ToolRegistryError" ? "tool_unavailable" : "analysis_failed"),
    cause: error
  });
}

function errorState(error) {
  if (error?.code === "analysis_cancelled" || error?.name === "AbortError") return "cancelled";
  if (
    ["tool_unavailable", "approval_required", "not_applicable"].includes(error?.code) ||
    error?.name === "ToolRegistryError"
  ) return error?.code === "not_applicable" ? "not_applicable" : "blocked";
  return "failed";
}

function requestForUnit(definition, snapshot, operation, request, range, track, profileId, options) {
  return {
    capability: definition.capability,
    tool: definition.tool,
    purpose: `Thu thập bằng chứng ${operation} cho ${snapshot.itemName}`,
    inputs: {
      source: snapshot.source,
      analysis: {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        sourceKey: snapshot.sourceKey,
        sourceVersion: snapshot.sourceVersion,
        operation,
        range,
        track,
        profileId,
        language: request.language,
        options
      }
    }
  };
}

function analysisDataFor({ unit, snapshot, resultValue, dependencyResultIds }) {
  if (!resultValue || typeof resultValue !== "object" || Array.isArray(resultValue)) {
    throw new AnalysisServiceError("Tool không trả Result object.", { code: "invalid_tool_result" });
  }
  const data = resultValue.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AnalysisServiceError("Tool phân tích không trả data object.", { code: "invalid_tool_result" });
  }
  if (resultValue.type !== unit.expectedResultType) {
    throw new AnalysisServiceError(
      `Tool trả Result type ${resultValue.type ?? "<missing>"}, cần ${unit.expectedResultType}.`,
      { code: "invalid_tool_result" }
    );
  }
  const authoritative = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    source: snapshot.source,
    sourceKey: snapshot.sourceKey,
    sourceVersion: snapshot.sourceVersion,
    operation: unit.operation,
    analysisJobId: unit.analysisJobId,
    unitId: unit.id,
    fingerprint: unit.fingerprint,
    method: unit.method
  };
  for (const [field, value] of Object.entries(authoritative)) {
    if (data[field] !== undefined && canonicalJson(data[field]) !== canonicalJson(value)) {
      throw new AnalysisServiceError(`Tool trả provenance không khớp tại data.${field}.`, {
        code: "invalid_tool_result"
      });
    }
  }
  const coverage = data.coverage ?? (unit.range
    ? { ...unit.range, mode: "continuous" }
    : unit.operation === "probe"
      ? { mode: "metadata" }
      : null);
  if (!coverage) {
    throw new AnalysisServiceError("Tool phân tích phải khai báo coverage thực tế.", {
      code: "invalid_tool_result"
    });
  }
  const normalized = validateAnalysisResultData({
    ...data,
    ...authoritative,
    coverage,
    method: unit.method,
    outcome: data.outcome ?? "produced",
    counts: data.counts ?? {},
    datasets: data.datasets ?? [],
    warnings: data.warnings ?? [],
    contentReview: data.contentReview ?? "not_performed"
  }, { resultType: resultValue.type });
  const inputResults = [...new Set([
    ...snapshot.inputResults,
    ...dependencyResultIds,
    ...(resultValue.inputResults ?? [])
  ])];
  return {
    ...resultValue,
    inputResources: [...snapshot.inputResources],
    inputResults,
    data: normalized
  };
}

function finalJobState(job) {
  if (job.cancelRequestedAt || job.units.some((unit) => unit.state === "cancelled")) return "cancelled";
  if (job.units.every((unit) => SUCCESS_STATES.has(unit.state))) return "completed";
  const hasEvidence = job.units.some((unit) => ["succeeded", "reused"].includes(unit.state));
  if (hasEvidence && job.units.some((unit) => PROBLEM_STATES.has(unit.state))) return "partial";
  return "failed";
}

function publicResult(job) {
  return {
    version: ANALYSIS_SCHEMA_VERSION,
    projectId: job.projectId,
    analysisJobId: job.id,
    state: job.state,
    revision: job.revision,
    counts: Object.fromEntries(
      [...new Set(job.units.map((unit) => unit.state))].map((state) => [
        state,
        job.units.filter((unit) => unit.state === state).length
      ])
    ),
    job
  };
}

export class AnalysisService {
  constructor({
    store,
    analysisStore,
    executor,
    operationDefinitions = OPERATION_DEFINITIONS,
    cancellationPollMs = 250,
    heartbeatIntervalMs = 5_000
  }) {
    if (!store || !analysisStore || !executor) {
      throw new AnalysisServiceError("AnalysisService cần ProjectStore, AnalysisStore và ToolExecutor.");
    }
    this.store = store;
    this.analysisStore = analysisStore;
    this.executor = executor;
    this.operationDefinitions = operationDefinitions;
    this.cancellationPollMs = cancellationPollMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.activeControllers = new Map();
  }

  async createAndRun(projectId, requestValue) {
    const request = normalizeAnalysisRequest(requestValue);
    const lease = await this.analysisStore.acquireLease(projectId);
    let job = null;
    try {
      const snapshots = await this.#snapshotRequestedSources(projectId, request);
      job = await this.#createJob(projectId, request, snapshots, lease);
      job = await this.analysisStore.updateJob(projectId, job.id, (draft) => {
        draft.state = "running";
      }, { lease });
      job = await this.#runOwned(projectId, job, lease);
      return publicResult(job);
    } catch (error) {
      throw new AnalysisServiceError(error?.message || "Không thể tạo analysis job.", {
        code: error?.code || "analysis_failed",
        cause: error,
        job
      });
    } finally {
      await this.#releaseLease(projectId, lease, job?.id).catch(() => {});
    }
  }

  async resume(projectId, analysisJobId) {
    const existing = await this.analysisStore.readJob(projectId, analysisJobId);
    if (["completed", "cancelled"].includes(existing.state)) return publicResult(existing);
    const lease = await this.analysisStore.acquireLease(projectId);
    let job = existing;
    try {
      job = await this.analysisStore.updateJob(projectId, job.id, (draft) => {
        draft.state = "running";
        draft.cancelRequestedAt = null;
      }, { expectedRevision: existing.revision, lease });
      await this.analysisStore.clearCancellation(projectId, job.id, { lease });
      job = await this.#runOwned(projectId, job, lease);
      return publicResult(job);
    } catch (error) {
      throw new AnalysisServiceError(error?.message || "Không thể resume analysis job.", {
        code: error?.code || "analysis_failed",
        cause: error,
        job
      });
    } finally {
      await this.#releaseLease(projectId, lease, job?.id).catch(() => {});
    }
  }

  async cancel(projectId, analysisJobId) {
    const request = await this.analysisStore.requestCancellation(projectId, analysisJobId);
    this.activeControllers.get(`${projectId}:${analysisJobId}`)?.abort();
    return request;
  }

  async #snapshotRequestedSources(projectId, request) {
    const references = [...request.sources];
    if (request.resourceFolders.length) {
      const resources = await this.store.readResources(projectId);
      for (const resourceId of request.resourceFolders) {
        const resource = resources.find((item) => item.id === resourceId);
        if (!resource) throw new AnalysisServiceError(`Không tìm thấy resource folder: ${resourceId}`, { code: "invalid_source" });
        if (resource.kind !== "folder") {
          throw new AnalysisServiceError(`${resourceId} không phải resource folder.`, { code: "invalid_source" });
        }
        for (const item of resource.items) {
          references.push({ kind: "resource", id: resource.id, itemPath: item.relativePath });
        }
      }
    }
    const unique = new Map(references.map((source) => [canonicalJson(source), source]));
    const snapshots = [];
    for (const source of unique.values()) {
      snapshots.push(await resolveAnalysisSource({ store: this.store, projectId, source }));
    }
    return snapshots;
  }

  async #resolveMethod(definition, { profileId, language, track, options }) {
    const expectedTool = {
      name: definition.tool,
      capability: definition.capability,
      contractVersion: ANALYSIS_SCHEMA_VERSION
    };
    let tool;
    try {
      tool = this.executor.registry.get(definition.tool, definition.capability);
    } catch {
      return {
        profileId,
        language,
        track,
        options,
        tool: expectedTool,
        availability: { status: "not_registered" }
      };
    }
    let availability;
    try {
      availability = availabilityIdentity(await tool.checkAvailability({
        profileId,
        language,
        track,
        options
      }));
    } catch {
      availability = { status: "check_failed" };
    }
    return {
      profileId,
      language,
      track,
      options,
      tool: {
        name: tool.name,
        version: tool.version,
        provider: tool.provider,
        capability: tool.capability,
        runtime: tool.runtime,
        executionMode: tool.executionMode
      },
      availability
    };
  }

  async #createJob(projectId, request, snapshots, lease) {
    const id = jobId();
    const units = [];
    const bySourceAndOperation = new Map();
    const requestedOperations = operationsWithDependencies(request.operations, this.operationDefinitions);
    for (const snapshot of snapshots) {
      for (const operation of requestedOperations) {
        const definition = this.operationDefinitions[operation];
        if (!definition) {
          throw new AnalysisServiceError(`Chưa có định nghĩa operation: ${operation}`, { code: "operation_not_configured" });
        }
        const range = selectedValue(request.ranges, snapshot.sourceKey, operation);
        const track = selectedValue(request.tracks, snapshot.sourceKey, operation);
        const options = selectedValue(request.options, snapshot.sourceKey, operation) ?? {};
        const profileId = profileFor(request, definition);
        const method = await this.#resolveMethod(definition, {
          profileId,
          language: request.language,
          track,
          options
        });
        const planFingerprint = analysisFingerprint({
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          sourceKey: snapshot.sourceKey,
          sourceVersion: snapshot.sourceVersion,
          operation,
          range,
          track,
          profileId,
          language: request.language,
          options,
          method
        });
        const fingerprint = analysisFingerprint({ planFingerprint, upstream: [] });
        const executorRequest = requestForUnit(
          definition,
          snapshot,
          operation,
          request,
          range,
          track,
          profileId,
          options
        );
        executorRequest.inputs.analysis.method = method;
        executorRequest.inputs.analysis.fingerprint = fingerprint;
        const unit = {
          id: unitId(planFingerprint),
          analysisJobId: id,
          sourceKey: snapshot.sourceKey,
          operation,
          state: "pending",
          dependencies: [],
          planFingerprint,
          fingerprint,
          method,
          profileId,
          range,
          executorRequest,
          expectedResultType: definition.resultType,
          attempts: [],
          runId: null,
          resultId: null,
          error: null,
          notApplicableReason: null
        };
        unit.executorRequest.inputs.analysis.analysisJobId = id;
        unit.executorRequest.inputs.analysis.unitId = unit.id;
        units.push(unit);
        bySourceAndOperation.set(`${snapshot.sourceKey}:${operation}`, unit);
      }
    }
    for (const unit of units) {
      const definition = this.operationDefinitions[unit.operation];
      unit.dependencies = definition.dependencies
        .filter((operation) => requestedOperations.includes(operation))
        .map((operation) => bySourceAndOperation.get(`${unit.sourceKey}:${operation}`).id);
    }
    const storedUnits = units.map(({ analysisJobId: _job, expectedResultType: _result, ...unit }) => unit);
    const createdAt = this.analysisStore.now();
    return this.analysisStore.createJob(projectId, {
      version: ANALYSIS_SCHEMA_VERSION,
      id,
      projectId,
      revision: 1,
      state: "planned",
      createdAt,
      updatedAt: createdAt,
      request,
      sourceSnapshots: snapshots.map(withoutRuntimePath),
      units: storedUnits,
      warnings: [],
      ownerLease: {
        token: lease.token,
        pid: lease.pid,
        processStartIdentity: lease.processStartIdentity,
        acquiredAt: lease.acquiredAt,
        heartbeatAt: lease.heartbeatAt
      },
      cancelRequestedAt: null
    }, { lease });
  }

  async #runOwned(projectId, initialJob, lease) {
    let job = await this.#reconcile(projectId, initialJob, lease);
    job = await this.#revalidateSuccessfulUnits(projectId, job, lease);
    for (const plannedUnit of job.units) {
      job = await this.analysisStore.readJob(projectId, job.id);
      const cancellation = await this.analysisStore.readCancellation(projectId, job.id);
      if (cancellation) {
        job = await this.#markCancelled(projectId, job, cancellation.requestedAt, lease);
        break;
      }
      const unit = job.units.find((candidate) => candidate.id === plannedUnit.id);
      if (SUCCESS_STATES.has(unit.state)) continue;
      const blockedBy = unit.dependencies.filter((dependencyId) => {
        const dependency = job.units.find((candidate) => candidate.id === dependencyId);
        return !SUCCESS_STATES.has(dependency?.state);
      });
      if (blockedBy.length) {
        job = await this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
          draft.state = "blocked";
          draft.error = `Dependency chưa thành công: ${blockedBy.join(", ")}`;
        });
        continue;
      }
      job = await this.#refreshUnitFingerprint(projectId, job, unit.id, lease);
      job = await this.#runUnit(projectId, job, unit.id, lease);
      if (job.cancelRequestedAt) break;
    }
    const finalCancellation = await this.analysisStore.readCancellation(projectId, job.id);
    if (finalCancellation && !job.cancelRequestedAt) {
      job = await this.#markCancelled(projectId, job, finalCancellation.requestedAt, lease);
    }
    job = await this.analysisStore.updateJob(projectId, job.id, (draft) => {
      draft.state = finalJobState(draft);
    }, { expectedRevision: job.revision, lease, releaseOwnership: true });
    if (job.state === "cancelled") await this.analysisStore.clearCancellation(projectId, job.id, { lease });
    return job;
  }

  async #runUnit(projectId, job, unitIdValue, lease) {
    let unit = job.units.find((candidate) => candidate.id === unitIdValue);
    const snapshot = job.sourceSnapshots.find((candidate) => candidate.sourceKey === unit.sourceKey);
    const definition = this.operationDefinitions[unit.operation];
    try {
      await this.#assertCurrentSource(projectId, snapshot);
    } catch (originalError) {
      const error = runtimeError(originalError);
      const state = errorState(error);
      return this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
        const time = this.analysisStore.now();
        draft.state = state;
        draft.error = error.message;
        draft.attempts.push({
          id: attemptId(),
          number: draft.attempts.length + 1,
          state,
          startedAt: time,
          finishedAt: time,
          runId: null,
          resultId: null,
          error: error.message
        });
      });
    }
    if (job.request.reuse === "verified") {
      const reusable = await this.#findReusableResult(projectId, unit, snapshot, definition);
      if (reusable) {
        return this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
          const time = this.analysisStore.now();
          draft.state = "reused";
          draft.runId = reusable.createdByRun;
          draft.resultId = reusable.id;
          draft.attempts.push({
            id: attemptId(),
            number: draft.attempts.length + 1,
            state: "reused",
            startedAt: time,
            finishedAt: time,
            runId: reusable.createdByRun,
            resultId: reusable.id,
            error: null
          });
        });
      }
    }
    const newAttemptId = attemptId();
    job = await this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
      draft.state = "running";
      draft.error = null;
      draft.attempts.push({
        id: newAttemptId,
        number: draft.attempts.length + 1,
        state: "running",
        startedAt: this.analysisStore.now(),
        finishedAt: null,
        runId: null,
        resultId: null,
        error: null
      });
    });
    unit = job.units.find((candidate) => candidate.id === unitIdValue);
    const controller = new AbortController();
    let startedRunId = null;
    let leaseFailure = null;
    const controllerKey = `${projectId}:${job.id}`;
    this.activeControllers.set(controllerKey, controller);
    const cancellationTimer = setInterval(async () => {
      try {
        if (await this.analysisStore.readCancellation(projectId, job.id)) controller.abort();
      } catch {
        // The coordinator records storage errors through the normal unit path.
      }
    }, this.cancellationPollMs);
    cancellationTimer.unref?.();
    const heartbeatTimer = setInterval(async () => {
      try {
        await this.analysisStore.heartbeat(projectId, lease);
      } catch (error) {
        leaseFailure = error;
        controller.abort();
      }
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    try {
      const dependencyResultIds = unit.dependencies
        .map((dependencyId) => job.units.find((candidate) => candidate.id === dependencyId)?.resultId)
        .filter(Boolean);
      const executorRequest = structuredClone(unit.executorRequest);
      executorRequest.inputs.analysis.dependencyResultIds = dependencyResultIds;
      const response = await this.executor.execute(projectId, executorRequest, {
        signal: controller.signal,
        onRunStarted: async ({ run }) => {
          startedRunId = run.id;
          job = await this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
            const attempt = draft.attempts.find((candidate) => candidate.id === newAttemptId);
            attempt.runId = run.id;
            draft.runId = run.id;
          });
          await this.analysisStore.heartbeat(projectId, lease);
        },
        decorateResult: ({ resultValue, availability }) => {
          const actualAvailability = availabilityIdentity(availability);
          if (canonicalJson(actualAvailability) !== canonicalJson(unit.method.availability)) {
            throw new AnalysisServiceError(
              "Môi trường tool đã đổi sau khi lập kế hoạch; unit cần được lập kế hoạch lại.",
              { code: "tool_environment_changed" }
            );
          }
          return analysisDataFor({
            unit: { ...unit, analysisJobId: job.id, expectedResultType: definition.resultType },
            snapshot,
            resultValue,
            dependencyResultIds
          });
        },
        beforeResultCommit: () => this.#assertCurrentSource(projectId, snapshot)
      });
      if (response.status === "finalization_pending") {
        await this.store.recoverRunFinalization(projectId, response.runId);
      }
      job = await this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
        const attempt = draft.attempts.find((candidate) => candidate.id === newAttemptId);
        attempt.state = "succeeded";
        attempt.finishedAt = this.analysisStore.now();
        attempt.runId = response.runId;
        attempt.resultId = response.resultId;
        draft.state = "succeeded";
        draft.runId = response.runId;
        draft.resultId = response.resultId;
      });
    } catch (originalError) {
      const error = runtimeError(leaseFailure ?? originalError);
      const cancellation = await this.analysisStore.readCancellation(projectId, job.id).catch(() => null);
      const state = cancellation ? "cancelled" : errorState(error);
      job = await this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
        const attempt = draft.attempts.find((candidate) => candidate.id === newAttemptId);
        attempt.state = state;
        attempt.finishedAt = this.analysisStore.now();
        attempt.runId ??= startedRunId;
        attempt.error = error.message;
        draft.state = state;
        draft.runId ??= startedRunId;
        draft.error = error.message;
        if (state === "not_applicable") draft.notApplicableReason = error.message;
      });
      if (cancellation) job = await this.#markCancelled(projectId, job, cancellation.requestedAt, lease);
    } finally {
      clearInterval(cancellationTimer);
      clearInterval(heartbeatTimer);
      this.activeControllers.delete(controllerKey);
    }
    return job;
  }

  async #resolveUnitFingerprint(projectId, job, unit) {
    const snapshot = job.sourceSnapshots.find((candidate) => candidate.sourceKey === unit.sourceKey);
    const definition = this.operationDefinitions[unit.operation];
    const analysisInput = unit.executorRequest.inputs.analysis;
    const method = await this.#resolveMethod(definition, {
      profileId: unit.profileId,
      language: analysisInput.language,
      track: analysisInput.track,
      options: analysisInput.options
    });
    const planFingerprint = analysisFingerprint({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      sourceKey: snapshot.sourceKey,
      sourceVersion: snapshot.sourceVersion,
      operation: unit.operation,
      range: unit.range,
      track: analysisInput.track,
      profileId: unit.profileId,
      language: analysisInput.language,
      options: analysisInput.options,
      method
    });
    const upstream = [];
    for (const dependencyId of unit.dependencies) {
      const dependency = job.units.find((candidate) => candidate.id === dependencyId);
      if (!dependency.resultId) {
        upstream.push({ unitId: dependency.id, state: dependency.state });
        continue;
      }
      const result = await this.store.readResult(projectId, dependency.resultId);
      upstream.push({
        unitId: dependency.id,
        resultId: result.id,
        fingerprint: result.data?.fingerprint ?? null,
        files: result.files.map((file) => ({ id: file.id, sha256: file.sha256 ?? null }))
      });
    }
    const fingerprint = analysisFingerprint({ planFingerprint, upstream });
    return { method, planFingerprint, fingerprint };
  }

  async #refreshUnitFingerprint(projectId, job, unitIdValue, lease) {
    const unit = job.units.find((candidate) => candidate.id === unitIdValue);
    const { method, planFingerprint, fingerprint } = await this.#resolveUnitFingerprint(projectId, job, unit);
    if (
      unit.planFingerprint === planFingerprint &&
      unit.fingerprint === fingerprint &&
      canonicalJson(unit.method) === canonicalJson(method)
    ) return job;
    return this.#updateUnit(projectId, job, unit.id, lease, (draft) => {
      draft.planFingerprint = planFingerprint;
      draft.fingerprint = fingerprint;
      draft.method = method;
      draft.executorRequest.inputs.analysis.method = method;
      draft.executorRequest.inputs.analysis.fingerprint = fingerprint;
    });
  }

  #resultMatchesUnit(result, unit, snapshot, definition, {
    requireRun = true,
    requireCurrentJob = false,
    jobId = null
  } = {}) {
    if (
      result.type !== definition.resultType ||
      (requireRun && result.createdByRun !== unit.runId) ||
      result.data?.schemaVersion !== ANALYSIS_SCHEMA_VERSION ||
      result.data?.sourceKey !== unit.sourceKey ||
      result.data?.sourceVersion !== snapshot.sourceVersion ||
      result.data?.fingerprint !== unit.fingerprint ||
      result.data?.operation !== unit.operation ||
      canonicalJson(result.data?.source) !== canonicalJson(snapshot.source) ||
      canonicalJson(result.data?.method) !== canonicalJson(unit.method)
    ) return false;
    if (requireCurrentJob && (result.data?.analysisJobId !== jobId || result.data?.unitId !== unit.id)) {
      return false;
    }
    return true;
  }

  async #revalidateSuccessfulUnits(projectId, initialJob, lease) {
    let job = initialJob;
    const visited = new Set();
    const sourceChecks = new Map();
    const visit = async (unitIdValue) => {
      if (visited.has(unitIdValue)) return;
      let unit = job.units.find((candidate) => candidate.id === unitIdValue);
      for (const dependencyId of unit.dependencies) await visit(dependencyId);
      unit = job.units.find((candidate) => candidate.id === unitIdValue);
      if (!SUCCESS_STATES.has(unit.state)) {
        visited.add(unitIdValue);
        return;
      }
      const snapshot = job.sourceSnapshots.find((candidate) => candidate.sourceKey === unit.sourceKey);
      const definition = this.operationDefinitions[unit.operation];
      let invalidationReason = null;
      try {
        if (!sourceChecks.has(unit.sourceKey)) {
          sourceChecks.set(unit.sourceKey, this.#assertCurrentSource(projectId, snapshot));
        }
        await sourceChecks.get(unit.sourceKey);
        const current = await this.#resolveUnitFingerprint(projectId, job, unit);
        if (
          unit.planFingerprint !== current.planFingerprint ||
          unit.fingerprint !== current.fingerprint ||
          canonicalJson(unit.method) !== canonicalJson(current.method)
        ) {
          invalidationReason = "Method, options hoặc dependency hiện tại không còn khớp fingerprint đã lưu.";
        } else if (unit.state !== "not_applicable") {
          const result = await this.store.readResult(projectId, unit.resultId);
          if (!this.#resultMatchesUnit(result, unit, snapshot, definition)) {
            invalidationReason = "Result hiện tại không còn khớp provenance của unit.";
          } else if (!await this.#resultFilesCurrent(projectId, result)) {
            invalidationReason = "File bằng chứng của Result bị thiếu hoặc sai checksum.";
          }
        }
      } catch (error) {
        invalidationReason = error?.message || "Không thể xác minh bằng chứng hiện tại.";
      }
      if (invalidationReason) {
        const invalidatedResultId = unit.resultId;
        job = await this.analysisStore.updateJob(projectId, job.id, (draft) => {
          const invalidated = draft.units.find((candidate) => candidate.id === unit.id);
          invalidated.state = "pending";
          invalidated.runId = null;
          invalidated.resultId = null;
          invalidated.error = null;
          invalidated.notApplicableReason = null;
          draft.warnings.push({
            code: "analysis_evidence_invalidated",
            unitId: unit.id,
            resultId: invalidatedResultId,
            reason: invalidationReason,
            invalidatedAt: this.analysisStore.now()
          });
        }, { expectedRevision: job.revision, lease });
      }
      visited.add(unitIdValue);
    };
    for (const unit of job.units) await visit(unit.id);
    return job;
  }

  async #assertCurrentSource(projectId, snapshot) {
    const current = await resolveAnalysisSource({ store: this.store, projectId, source: snapshot.source });
    if (current.sourceKey !== snapshot.sourceKey || current.sourceVersion !== snapshot.sourceVersion) {
      throw new SourceIdentityError("Source bytes đã thay đổi từ lúc job được snapshot.", {
        code: "source_changed"
      });
    }
    return current;
  }

  async #findReusableResult(projectId, unit, snapshot, definition) {
    const results = await this.store.readResults(projectId);
    const candidates = results.filter((result) =>
      this.#resultMatchesUnit(
        result,
        unit,
        snapshot,
        definition,
        { requireRun: false }
      )
    );
    for (const result of candidates.reverse()) {
      if (await this.#resultFilesCurrent(projectId, result)) return result;
    }
    return null;
  }

  async #resultFilesCurrent(projectId, result) {
    for (const file of result.files) {
      if (!file.available || typeof file.sha256 !== "string") return false;
      try {
        const resolved = await this.store.resolveResultFile(projectId, result.id, file.id);
        if (await sha256File(resolved.filePath) !== file.sha256) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async #reconcile(projectId, job, lease) {
    const results = await this.store.readResults(projectId);
    for (const plannedUnit of job.units) {
      if (SUCCESS_STATES.has(plannedUnit.state)) continue;
      const snapshot = job.sourceSnapshots.find((candidate) => candidate.sourceKey === plannedUnit.sourceKey);
      const definition = this.operationDefinitions[plannedUnit.operation];
      const durable = results.find((result) => this.#resultMatchesUnit(
        result,
        plannedUnit,
        snapshot,
        definition,
        { requireCurrentJob: true, jobId: job.id }
      ));
      if (durable && await this.#resultFilesCurrent(projectId, durable)) {
        const run = await this.store.readRun(projectId, durable.createdByRun);
        if (run.status === "in_progress") await this.store.recoverRunFinalization(projectId, run.id);
        job = await this.#updateUnit(projectId, job, plannedUnit.id, lease, (unit) => {
          const attempt = unit.attempts.find((candidate) => candidate.runId === durable.createdByRun)
            ?? unit.attempts.at(-1);
          if (attempt) {
            attempt.state = "succeeded";
            attempt.finishedAt ??= this.analysisStore.now();
            attempt.runId = durable.createdByRun;
            attempt.resultId = durable.id;
            attempt.error = null;
          }
          unit.state = "succeeded";
          unit.runId = durable.createdByRun;
          unit.resultId = durable.id;
          unit.error = null;
        });
        continue;
      }
      if (plannedUnit.state === "running") {
        const attempt = plannedUnit.attempts.at(-1);
        if (attempt?.runId) {
          const run = await this.store.readRun(projectId, attempt.runId).catch(() => null);
          if (run?.status === "in_progress") {
            await this.store.finishRun(projectId, run.id, {
              status: "failed",
              error: "Analysis coordinator bị gián đoạn trước khi có Result bền vững."
            });
          }
        }
        job = await this.#updateUnit(projectId, job, plannedUnit.id, lease, (unit) => {
          const currentAttempt = unit.attempts.at(-1);
          if (currentAttempt?.state === "running") {
            currentAttempt.state = "interrupted";
            currentAttempt.finishedAt = this.analysisStore.now();
            currentAttempt.error = "Coordinator trước đã dừng bất thường.";
          }
          unit.state = "pending";
          unit.error = null;
        });
      }
    }
    return job;
  }

  async #updateUnit(projectId, job, unitIdValue, lease, mutate) {
    return this.analysisStore.updateJob(projectId, job.id, (draft) => {
      const unit = draft.units.find((candidate) => candidate.id === unitIdValue);
      if (!unit) throw new AnalysisServiceError(`Không tìm thấy unit: ${unitIdValue}`, { code: "unit_not_found" });
      return mutate(unit);
    }, { expectedRevision: job.revision, lease });
  }

  async #markCancelled(projectId, job, requestedAt, lease) {
    return this.analysisStore.updateJob(projectId, job.id, (draft) => {
      draft.cancelRequestedAt = requestedAt;
      for (const unit of draft.units) {
        if (!SUCCESS_STATES.has(unit.state) && unit.state !== "cancelled") {
          unit.state = "cancelled";
          unit.error = "Job đã nhận yêu cầu hủy.";
        }
      }
    }, { expectedRevision: job.revision, lease });
  }

  async #releaseLease(projectId, lease, analysisJobId) {
    if (analysisJobId) {
      const job = await this.analysisStore.readJob(projectId, analysisJobId).catch(() => null);
      if (job?.ownerLease) {
        await this.analysisStore.updateJob(projectId, analysisJobId, () => {}, {
          expectedRevision: job.revision,
          lease,
          releaseOwnership: true
        }).catch(() => {});
      }
    }
    await this.analysisStore.releaseLease(projectId, lease);
  }
}
