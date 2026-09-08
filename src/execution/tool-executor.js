export class ToolExecutorError extends Error {
  constructor(message, { code = "execution_failed", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ToolExecutorError";
    this.code = code;
  }
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolExecutorError("Yêu cầu chạy tool phải là một object.", {
      code: "invalid_request"
    });
  }
  const unknown = Object.keys(value).filter(
    (field) => !["capability", "tool", "purpose", "inputs"].includes(field)
  );
  if (unknown.length) {
    throw new ToolExecutorError(
      "Yêu cầu chạy tool chứa field không được hỗ trợ: " + unknown.join(", "),
      { code: "invalid_request" }
    );
  }
  for (const field of ["capability", "tool", "purpose"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new ToolExecutorError("Yêu cầu chạy tool thiếu " + field + ".", {
        code: "invalid_request"
      });
    }
  }
  if (!value.inputs || typeof value.inputs !== "object" || Array.isArray(value.inputs)) {
    throw new ToolExecutorError("inputs của yêu cầu chạy tool không hợp lệ.", {
      code: "invalid_request"
    });
  }
  return {
    capability: value.capability.trim(),
    tool: value.tool.trim(),
    purpose: value.purpose.trim(),
    inputs: value.inputs
  };
}

function toolReference(tool) {
  return {
    name: tool.name,
    version: tool.version,
    provider: tool.provider
  };
}

function executionError(error) {
  if (error instanceof ToolExecutorError) return error;
  if (error?.name === "AbortError") {
    return new ToolExecutorError(error?.message || "Analysis unit đã bị hủy.", {
      code: "analysis_cancelled",
      cause: error
    });
  }
  return new ToolExecutorError(error?.message || "Không thể chạy công cụ.", {
    code: error?.code || "execution_failed",
    cause: error
  });
}

function validateInternalOptions(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolExecutorError("Tùy chọn nội bộ của Executor không hợp lệ.", { code: "invalid_internal_options" });
  }
  const unknown = Object.keys(value).filter(
    (field) => !["onRunStarted", "beforeResultCommit", "decorateResult", "signal"].includes(field)
  );
  if (unknown.length) {
    throw new ToolExecutorError("Tùy chọn nội bộ không được hỗ trợ: " + unknown.join(", "), {
      code: "invalid_internal_options"
    });
  }
  for (const hook of ["onRunStarted", "beforeResultCommit", "decorateResult"]) {
    if (value[hook] !== undefined && typeof value[hook] !== "function") {
      throw new ToolExecutorError(`${hook} phải là function.`, { code: "invalid_internal_options" });
    }
  }
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
    throw new ToolExecutorError("signal phải là AbortSignal.", { code: "invalid_internal_options" });
  }
  return value;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new ToolExecutorError("Analysis unit đã bị hủy.", { code: "analysis_cancelled" });
}

export class ToolExecutor {
  constructor({ store, registry }) {
    if (!store || !registry) {
      throw new ToolExecutorError("Bộ thực thi cần project store và tool registry.");
    }
    this.store = store;
    this.registry = registry;
  }

  async describeCapabilities() {
    return this.registry.describeCapabilities();
  }

  async execute(projectId, requestValue, internalValue) {
    const request = validateRequest(requestValue);
    const internal = validateInternalOptions(internalValue);
    const tool = this.registry.get(request.tool, request.capability);
    const reference = toolReference(tool);
    const started = Date.now();
    const run = await this.store.startRun(projectId, {
      capability: request.capability,
      purpose: request.purpose,
      tool: reference,
      inputs: request.inputs,
      estimatedCostUsd: tool.cost.estimated
    });
    let result = null;
    let outputWorkspace = null;

    try {
      throwIfAborted(internal.signal);
      if (internal.onRunStarted) {
        try {
          await internal.onRunStarted({ projectId, run, request, tool: reference });
        } catch (error) {
          throw new ToolExecutorError("Không thể đăng ký Run vào owner trước khi chạy tool.", {
            code: "run_start_hook_failed",
            cause: error
          });
        }
      }
      throwIfAborted(internal.signal);
      const availability = await tool.checkAvailability({ signal: internal.signal });
      if (availability?.status !== "available") {
        throw new ToolExecutorError(
          availability?.reason || "Công cụ " + tool.name + " hiện không dùng được.",
          { code: "tool_unavailable" }
        );
      }
      if (tool.approvalRequired) {
        throw new ToolExecutorError(
          "Công cụ " + tool.name + " cần phê duyệt nhưng lát cắt hiện tại chưa hỗ trợ xác nhận.",
          { code: "approval_required" }
        );
      }
      if (tool.producesFiles) {
        outputWorkspace = await this.store.createRunOutputWorkspace(projectId, run.id);
      }
      const prepared = await tool.prepare({
        store: this.store,
        projectId,
        inputs: request.inputs,
        runId: run.id,
        signal: internal.signal,
        outputWorkspace: outputWorkspace && {
          temporaryDirectory: outputWorkspace.temporaryDirectory,
          projectRelativeDirectory: outputWorkspace.projectRelativeDirectory
        }
      });
      const execution = await tool.execute({
        ...prepared.runtime,
        availability,
        signal: internal.signal
      });
      throwIfAborted(internal.signal);
      let resultValue = tool.createResult({ prepared, execution });
      if (internal.decorateResult) {
        resultValue = await internal.decorateResult({
          projectId,
          run,
          request,
          tool: reference,
          availability,
          prepared,
          execution,
          resultValue
        });
      }
      const declaredFiles = resultValue?.files;
      if (tool.producesFiles && (!Array.isArray(declaredFiles) || declaredFiles.length === 0)) {
        throw new ToolExecutorError("Công cụ tạo file nhưng không khai báo file kết quả.", {
          code: "invalid_tool_result"
        });
      }
      if (!tool.producesFiles && Array.isArray(declaredFiles) && declaredFiles.length > 0) {
        throw new ToolExecutorError("Công cụ chưa khai báo quyền tạo file kết quả.", {
          code: "invalid_tool_result"
        });
      }
      throwIfAborted(internal.signal);
      if (internal.beforeResultCommit) {
        await internal.beforeResultCommit({
          projectId,
          run,
          request,
          tool: reference,
          availability,
          prepared,
          execution,
          resultValue
        });
      }
      throwIfAborted(internal.signal);
      if (outputWorkspace) {
        await this.store.commitRunOutputWorkspace(outputWorkspace);
      }
      const runCompletion = {
        durationMs: Date.now() - started,
        actualCostUsd: execution.actualCostUsd ?? null
      };
      result = await this.store.addResult(projectId, {
        runId: run.id,
        capability: request.capability,
        tool: reference,
        ...resultValue,
        runCompletion
      });
      try {
        await this.store.finishRun(projectId, run.id, {
          status: "completed",
          outputs: [result.id],
          durationMs: runCompletion.durationMs,
          actualCostUsd: runCompletion.actualCostUsd
        });
      } catch (finalizationError) {
        this.#releaseCommittedWorkspace(outputWorkspace);
        return {
          projectId,
          runId: run.id,
          resultId: result.id,
          status: "finalization_pending",
          warning:
            "Kết quả đã được bảo toàn nhưng trạng thái run chưa thể hoàn tất: " +
            (finalizationError?.message || "lỗi không xác định"),
          result
        };
      }
      this.#releaseCommittedWorkspace(outputWorkspace);
      return {
        projectId,
        runId: run.id,
        resultId: result.id,
        status: "completed",
        result
      };
    } catch (error) {
      const failure = executionError(error);
      await this.#recordFailure(
        projectId,
        run.id,
        result?.id ?? null,
        outputWorkspace,
        failure,
        started
      );
      throw failure;
    }
  }

  #releaseCommittedWorkspace(outputWorkspace) {
    if (!outputWorkspace) return;
    try {
      this.store.releaseRunOutputWorkspace(outputWorkspace);
    } catch {
      // Output and result are already durable. In-memory cleanup must never delete them.
    }
  }

  async #recordFailure(projectId, runId, resultId, outputWorkspace, failure, started) {
    let rollbackError = null;
    if (resultId) {
      try {
        await this.store.discardResult(projectId, resultId, runId);
      } catch (error) {
        rollbackError = error;
      }
    }
    if (outputWorkspace) {
      try {
        await this.store.discardRunOutputWorkspace(outputWorkspace);
      } catch (error) {
        rollbackError ??= error;
      }
    }

    try {
      const currentRun = await this.store.readRun(projectId, runId);
      if (currentRun.status === "in_progress") {
        await this.store.finishRun(projectId, runId, {
          status: "failed",
          error: failure.message,
          durationMs: Date.now() - started
        });
      }
    } catch (recordError) {
      throw new ToolExecutorError(
        "Công cụ thất bại và không thể ghi đầy đủ trạng thái run: " + recordError.message,
        { code: "trace_write_failed", cause: failure }
      );
    }

    if (rollbackError) {
      throw new ToolExecutorError(
        "Run thất bại và không thể thu hồi dữ liệu chưa hoàn tất: " + rollbackError.message,
        { code: "result_rollback_failed", cause: failure }
      );
    }
  }
}
