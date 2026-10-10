import {
  claimExecutionAuthorization,
  createExecutionAuthorization,
  executionRequestHash,
  recordExecutionAuthorizationReceipt,
  settleExecutionAuthorization
} from "./execution-authorizations.js";
import { projectBudgetSnapshot, startBudgetedRun } from "./project-budget.js";
import { assertCreditBudget, CreditBudgetError, creditBudgetSnapshot, withCreditBudgetLock } from "./credit-budget.js";

function creditBudgetFailure(error) {
  return error instanceof CreditBudgetError
    ? new ToolExecutorError(error.message, { code: error.code === "credit_budget_exceeded" ? "credit_budget_exceeded" : "invalid_request", cause: error })
    : error;
}

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
    (field) => !["capability", "tool", "purpose", "inputs", "authorizationId"].includes(field)
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
  const authorizationId = value.authorizationId === undefined ? null : value.authorizationId;
  if (authorizationId !== null &&
      (typeof authorizationId !== "string" || !/^authorization-[a-z0-9-]+$/.test(authorizationId))) {
    throw new ToolExecutorError("authorizationId is invalid.", { code: "invalid_request" });
  }
  return {
    capability: value.capability.trim(),
    tool: value.tool.trim(),
    purpose: value.purpose.trim(),
    inputs: value.inputs,
    authorizationId
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
    const wrapped = new ToolExecutorError(error?.message || "Analysis unit đã bị hủy.", {
      code: "analysis_cancelled",
      cause: error
    });
    wrapped.requestSubmitted = Boolean(error?.requestSubmitted);
    return wrapped;
  }
  const wrapped = new ToolExecutorError(error?.message || "Không thể chạy công cụ.", {
    code: error?.code || "execution_failed",
    cause: error
  });
  wrapped.requestSubmitted = Boolean(error?.requestSubmitted);
  return wrapped;
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

  async plan(projectId, requestValue) {
    await this.store.readProject(projectId);
    const request = validateRequest(requestValue);
    const tool = this.registry.get(request.tool, request.capability);
    const availability = await tool.checkAvailability();
    if (availability?.status !== "available") {
      throw new ToolExecutorError(availability?.reason || "Tool is unavailable.", { code: "tool_unavailable" });
    }
    const estimatedUsage = tool.approvalRequired ? await tool.estimateUsage({ inputs: request.inputs }) : null;
    const budget = await projectBudgetSnapshot(this.store, projectId);
    const creditBudget = tool.approvalRequired ? await creditBudgetSnapshot(this.store, projectId) : null;
    const budgetApprovalRequired = tool.cost.estimated !== null && tool.cost.estimated > (budget.policy?.singleActionApprovalUsd ?? Infinity);
    return { projectId, requestHash: executionRequestHash(request), tool: toolReference(tool),
      approvalRequired: tool.approvalRequired, providerApprovalRequired: tool.approvalRequired,
      budgetApprovalRequired, estimatedUsage, estimatedCostUsd: tool.cost.estimated, budget, creditBudget };
  }

  async authorize(projectId, requestValue, approval) {
    const plan = await this.plan(projectId, requestValue);
    if (!plan.approvalRequired) {
      throw new ToolExecutorError("This tool does not require credit approval.", { code: "approval_not_required" });
    }
    try {
      assertCreditBudget(plan.creditBudget, plan.estimatedUsage.amount);
    } catch (error) {
      throw creditBudgetFailure(error);
    }
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      throw new ToolExecutorError("Approval must be an object.", { code: "invalid_request" });
    }
    const unknown = Object.keys(approval).filter((key) => !["approvedBy", "maxCredits", "reason"].includes(key));
    if (unknown.length) {
      throw new ToolExecutorError("Approval has unsupported fields: " + unknown.join(", "), { code: "invalid_request" });
    }
    return createExecutionAuthorization(this.store, projectId, {
      requestHash: plan.requestHash, tool: plan.tool, estimatedUsage: plan.estimatedUsage,
      approvedBy: approval.approvedBy, maxCredits: approval.maxCredits, reason: approval.reason
    });
  }

  async execute(projectId, requestValue, internalValue) {
    const request = validateRequest(requestValue);
    const internal = validateInternalOptions(internalValue);
    const tool = this.registry.get(request.tool, request.capability);
    const reference = toolReference(tool);
    if (!tool.approvalRequired && request.authorizationId) {
      throw new ToolExecutorError("This tool does not accept credit authorization.", { code: "approval_not_required" });
    }
    const started = Date.now();
    const run = await startBudgetedRun(this.store, projectId, {
      capability: request.capability,
      purpose: request.purpose,
      tool: reference,
      inputs: request.inputs,
      estimatedCostUsd: tool.cost.estimated,
      authorizationId: request.authorizationId
    }, { approved: Boolean(request.authorizationId) });
    let result = null;
    let outputWorkspace = null;
    let authorization = null;
    let execution = null;
    let resultValue = null;
    let runCompletion = null;
    let paidResultStaged = false;
    let outputCommitted = false;

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
      const analysis = request.inputs?.analysis;
      const availability = await tool.checkAvailability({
        ...(analysis && typeof analysis === "object" && !Array.isArray(analysis) ? {
          profileId: analysis.profileId,
          language: analysis.language,
          track: analysis.track,
          options: analysis.options
        } : {}),
        signal: internal.signal
      });
      if (availability?.status !== "available") {
        throw new ToolExecutorError(
          availability?.reason || "Công cụ " + tool.name + " hiện không dùng được.",
          { code: "tool_unavailable" }
        );
      }
      if (tool.approvalRequired) {
        if (!request.authorizationId) {
          throw new ToolExecutorError("Tool requires an exact, single-use credit authorization.", { code: "approval_required" });
        }
        const currentUsage = await tool.estimateUsage({ inputs: request.inputs, signal: internal.signal });
        // The cap is checked and the authorization claimed under one lock, so two requests cannot both fit the same credits.
        authorization = await withCreditBudgetLock(this.store, projectId, async () => {
          try {
            assertCreditBudget(await creditBudgetSnapshot(this.store, projectId), currentUsage.amount);
          } catch (error) {
            throw creditBudgetFailure(error);
          }
          return claimExecutionAuthorization(this.store, projectId, request.authorizationId, {
            requestHash: executionRequestHash(request), tool: reference, runId: run.id, currentUsage
          });
        });
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
      execution = await tool.execute({
        ...prepared.runtime,
        availability,
        signal: internal.signal,
        onProviderResponse: authorization ? async (receipt) => {
          authorization = await recordExecutionAuthorizationReceipt(
            this.store, projectId, authorization.id, receipt
          );
        } : undefined
      });
      throwIfAborted(internal.signal);
      resultValue = await tool.createResult({ prepared, execution });
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
      runCompletion = {
        durationMs: Date.now() - started,
        actualCostUsd: execution.actualCostUsd ?? null
      };
      if (authorization) {
        await this.store.stageRunResult(projectId, run.id, {
          capability: request.capability,
          tool: reference,
          ...resultValue,
          runCompletion
        });
        paidResultStaged = true;
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
        await this.#sweepUnregistered(outputWorkspace, resultValue);
        await this.store.commitRunOutputWorkspace(outputWorkspace);
        outputCommitted = true;
      }
      if (authorization?.status === "claimed") {
        authorization = await settleExecutionAuthorization(this.store, projectId, authorization.id, {
          status: "consumed",
          actualUsage: execution.actualUsage,
          providerRequestId: execution.providerRequestId,
          traceId: execution.traceId
        });
      }
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
      if (paidResultStaged) {
        try {
          if (outputWorkspace && !outputCommitted) {
            await this.#sweepUnregistered(outputWorkspace, resultValue);
            await this.store.commitRunOutputWorkspace(outputWorkspace);
            outputCommitted = true;
          }
          if (authorization?.status === "claimed") {
            authorization = await settleExecutionAuthorization(this.store, projectId, authorization.id, {
              status: "consumed",
              actualUsage: execution?.actualUsage,
              providerRequestId: execution?.providerRequestId,
              traceId: execution?.traceId
            });
          }
          this.#releaseCommittedWorkspace(outputWorkspace);
          return {
            projectId,
            runId: run.id,
            resultId: result?.id ?? null,
            status: "finalization_pending",
            warning: "Paid output was preserved and can be recovered without calling the provider again.",
            result
          };
        } catch (preservationError) {
          throw new ToolExecutorError("Paid output could not be preserved for recovery.", {
            code: "paid_output_preservation_failed",
            cause: preservationError
          });
        }
      }
      let settlementFailure = null;
      if (authorization?.status === "claimed") {
        try {
          const responseReceived = Boolean(authorization.providerResponseReceivedAt);
          authorization = await settleExecutionAuthorization(this.store, projectId, authorization.id, {
            status: responseReceived ? "consumed" :
              failure.requestSubmitted ? "usage_unknown" : "released",
            actualUsage: responseReceived ? authorization.actualUsage : null,
            providerRequestId: responseReceived ? authorization.providerRequestId : null,
            traceId: responseReceived ? authorization.traceId : null
          });
        } catch (error) {
          settlementFailure = error;
        }
      }
      await this.#recordFailure(
        projectId,
        run.id,
        result?.id ?? null,
        outputWorkspace,
        failure,
        started
      );
      if (settlementFailure) {
        throw new ToolExecutorError("Execution failed and credit authorization could not be settled.", {
          code: "authorization_settlement_failed", cause: settlementFailure
        });
      }
      throw failure;
    }
  }

  // Keep a Run's output to exactly what its Result registers, so scratch such as a copied source
  // workspace or a bundler cache never becomes permanent project data. This is best effort: a file
  // that cannot be removed now stays visible to `project:usage` and can be removed by `project:prune`.
  async #sweepUnregistered(outputWorkspace, resultValue) {
    try {
      await this.store.sweepRunOutputWorkspace(outputWorkspace, resultValue?.files);
    } catch {
      // Never let cleanup turn a verified Result into a failed Run.
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
