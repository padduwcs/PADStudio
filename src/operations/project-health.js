function issue(code, severity, ids, message, remediation) {
  return { code, severity, count: ids.length, ids, message, remediation };
}

export function buildProjectHealth({ context, production, checkpointFreshness, pendingFeedback }) {
  const issues = [];
  const missingResources = context.resources.filter((resource) =>
    resource.available === false || resource.items?.some((item) => item.available === false)
  ).map((resource) => resource.id);
  if (missingResources.length) {
    issues.push(issue(
      "missing_resources", "attention", missingResources,
      "Một số resource hoặc file con không còn khả dụng.",
      "Khôi phục file nguồn đúng vị trí hoặc import lại thành resource mới rồi rebase phần đang dùng."
    ));
  }
  const missingResults = context.results.filter((result) =>
    result.files?.some((file) => file.available === false)
  ).map((result) => result.id);
  if (missingResults.length) {
    issues.push(issue(
      "missing_result_files", "attention", missingResults,
      "Một số Result lịch sử thiếu file hoặc sai kích thước.",
      "Không sửa Result cũ; khôi phục bytes từ backup hoặc chạy lại từ nguồn đã đăng ký."
    ));
  }
  const pendingFinalizations = context.runRecovery?.pendingFinalizations ?? [];
  const recoverable = pendingFinalizations.filter((entry) => entry.recoverable).map((entry) => entry.runId);
  const unrecoverable = pendingFinalizations.filter((entry) => !entry.recoverable).map((entry) => entry.runId);
  if (recoverable.length) {
    issues.push(issue(
      "recoverable_finalizations", "attention", recoverable,
      "Có run đã giữ được Result/output nhưng chưa hoàn tất trạng thái.",
      "Chạy project:recover ở chế độ plan, sau đó --apply nếu action vẫn recoverable."
    ));
  }
  if (unrecoverable.length) {
    issues.push(issue(
      "unrecoverable_finalizations", "blocked", unrecoverable,
      "Có run in_progress không đủ bằng chứng để tự hoàn tất an toàn.",
      "Kiểm tra Result/output/authorization; không chạy lại paid provider cho đến khi rõ receipt."
    ));
  }
  const feedbackIds = (pendingFeedback ?? []).map((entry) => entry.id);
  if (feedbackIds.length) {
    issues.push(issue(
      "pending_feedback", "attention", feedbackIds,
      "Có feedback changes_requested chưa được resolve tường minh.",
      "Tạo bản thay thế, review, rồi record accepted Decision với resolvesDecisionIds."
    ));
  }
  const activeSequences = production.sequences.filter((sequence) => sequence.active);
  const blockedSequences = activeSequences.filter((sequence) =>
    sequence.reasons.length || sequence.segments.some((segment) =>
      segment.blockers.length || segment.reasons.length)
  ).map((sequence) => sequence.artifactId);
  if (blockedSequences.length) {
    issues.push(issue(
      "blocked_active_production", "blocked", blockedSequences,
      "Sequence hiện hành có dependency stale, missing hoặc unresolved media.",
      "Đọc Production reasons, khôi phục nguồn hoặc tạo revision mới; không sửa lịch sử."
    ));
  }
  const claimedAuthorizations = (context.authorizations ?? [])
    .filter((authorization) => authorization.status === "claimed")
    .map((authorization) => authorization.id);
  if (claimedAuthorizations.length) {
    issues.push(issue(
      "claimed_authorizations", "blocked", claimedAuthorizations,
      "Có authorization trả phí đang claimed và chưa settle.",
      "Đối chiếu provider receipt và run trước khi recover; không phát lại request."
    ));
  }
  if (checkpointFreshness?.status === "stale") {
    issues.push(issue(
      "stale_checkpoint", "attention", [],
      "Checkpoint cũ hơn hoạt động bền vững mới nhất.",
      "Sau khi xác nhận trạng thái, ghi checkpoint mới với next step và blocker còn thật."
    ));
  }
  const status = issues.some((entry) => entry.severity === "blocked")
    ? "blocked"
    : issues.length ? "attention" : "ready";
  return {
    version: "1.0",
    status,
    issues,
    counts: {
      resources: context.resources.length,
      results: context.results.length,
      runs: context.runs.length,
      deliveries: context.results.filter((result) => result.type === "delivery.bundle").length,
      pendingFinalizations: pendingFinalizations.length,
      pendingFeedback: feedbackIds.length
    }
  };
}
