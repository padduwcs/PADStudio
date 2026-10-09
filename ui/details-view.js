import { ICONS, clock, formatDateTime, formatSize, node, resultFileUrl, svgIcon } from "./dom.js";
import { reviewInspectionLabel } from "./review-inspection.js";
import { renderAnimation, clearAnimation } from "./animation-view.js";
import { renderCreativeDirection, clearCreativeDirection, hasCreativeContent } from "./creative-direction-view.js";
import { renderHealth, clearHealth } from "./health-view.js";

const WORK_STATUS = Object.freeze({
  planned: "Dự kiến", ready: "Sẵn sàng", in_progress: "Đang làm", completed: "Hoàn tất", blocked: "Đang chờ",
  awaiting_review: "Chờ kiểm tra", awaiting_approval: "Chờ duyệt", skipped: "Bỏ qua", cancelled: "Đã hủy"
});
const RUN_STATUS = Object.freeze({
  completed: "Hoàn tất", succeeded: "Hoàn tất", failed: "Có lỗi", running: "Đang chạy", in_progress: "Đang chạy",
  queued: "Đang chờ", cancelled: "Đã hủy", finalization_pending: "Chờ hoàn tất"
});
const DECISION_LABELS = Object.freeze({ accepted: "Đã chấp nhận", changes_requested: "Cần sửa", rejected: "Đã loại" });

function fact(label, value) {
  const item = node("div", undefined, "fact");
  item.append(node("span", label), node("strong", value));
  return item;
}

function formatRunDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return null;
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} giây`;
}

function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.actual)) return null;
  return cost.actual === 0 ? "Miễn phí" : `${cost.actual.toFixed(4)} ${cost.currency}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* Overview: the one-glance answer to "where are we?"                                                */
/* ------------------------------------------------------------------------------------------------ */

function renderOverview(host, summary) {
  host.replaceChildren();
  const checkpoint = summary.checkpoint;
  const current = summary.intelligence?.currentWorkItems ?? [];
  const active = current.find((item) => item.status === "in_progress") ?? current.find((item) => item.status === "awaiting_approval");
  const approvals = summary.intelligence?.pendingApprovals ?? [];
  const stale = summary.checkpointFreshness?.status === "stale";
  const rows = [];
  rows.push(["Mục tiêu", checkpoint?.goal ?? "Ý tưởng, tư liệu và bản dựng được lưu cùng dự án."]);
  if (active) rows.push(["Đang làm", active.title]);
  if (approvals.length) rows.push(["Cần bạn xem", `${approvals.length} nội dung đang chờ quyết định.`]);
  else if (!stale && checkpoint?.pending?.length) rows.push(["Cần bạn xem", checkpoint.pending[0]]);
  if (!stale && checkpoint?.next) rows.push(["Tiếp theo", checkpoint.next]);
  const list = node("dl", undefined, "overview");
  for (const [term, value] of rows) list.append(node("dt", term), node("dd", value));
  host.append(list);
  if (checkpoint?.constraints?.length) {
    const details = node("details", undefined, "disclosure");
    details.append(node("summary", `Ràng buộc (${checkpoint.constraints.length})`));
    const constraints = node("ul");
    constraints.append(...checkpoint.constraints.map((item) => node("li", item)));
    details.append(constraints);
    host.append(details);
  }
  if (stale) host.append(node("p", "Dự án đã có hoạt động mới sau bản tổng quan này.", "notice"));
}

/* ------------------------------------------------------------------------------------------------ */
/* Progress, documents, runs                                                                         */
/* ------------------------------------------------------------------------------------------------ */

function renderWorkflow(host, workflow) {
  host.replaceChildren();
  const head = node("div", undefined, "workflow-head");
  head.append(node("strong", workflow.name), node("span", `Phiên bản ${workflow.revision}`, "rail-note"));
  head.lastChild.title = workflow.changeReason ?? "";
  host.append(head, node("p", workflow.purpose, "muted"));
  const steps = node("ol", undefined, "steps");
  for (const item of workflow.items) {
    const step = node("li", undefined, `step is-${item.status}`);
    const row = node("div", undefined, "step-head");
    row.append(node("strong", item.title), node("span", WORK_STATUS[item.status] ?? item.status, "step-status"));
    step.append(row, node("p", item.purpose, "muted"));
    const technical = node("details", undefined, "disclosure");
    technical.append(node("summary", "Chi tiết"), node("p", [
      item.dependsOn.length ? `sau: ${item.dependsOn.join(", ")}` : "bước đầu",
      item.skillIds.length ? `skill: ${item.skillIds.join(", ")}` : null,
      item.review.required ? `kiểm tra ${item.review.perspective}` : null,
      item.approval !== "auto" ? `duyệt: ${item.approval}` : null
    ].filter(Boolean).join(" · "), "rail-note"));
    step.append(technical);
    steps.append(step);
  }
  host.append(steps);
}

function renderDocuments(host, summary) {
  host.replaceChildren();
  const artifacts = summary.intelligence?.activeArtifacts ?? [];
  const reviews = summary.intelligence?.latestReviews ?? [];
  if (!artifacts.length && !reviews.length) {
    host.append(node("p", "Chưa có tài liệu hay đánh giá.", "empty-note"));
    return;
  }
  const grid = node("div", undefined, "doc-grid");
  for (const artifact of artifacts) {
    const card = node("article", undefined, "doc");
    card.append(node("strong", artifact.name), node("span", `Phiên bản ${artifact.revision}`, "rail-note"), node("p", artifact.summary, "muted"));
    card.children[1].title = artifact.type;
    grid.append(card);
  }
  host.append(grid);
  if (reviews.length) {
    const list = node("ul", undefined, "review-list");
    for (const review of reviews) list.append(node("li", `${review.perspective} · ${review.verdict}${reviewInspectionLabel(review)} — ${review.summary}`));
    host.append(node("h3", "Đánh giá gần nhất", "subheading"), list);
  }
}

function renderRuns(host, activity) {
  host.replaceChildren();
  if (!activity.runs.length) {
    host.append(node("p", "Chưa có lần chạy nào.", "empty-note"));
    return;
  }
  const recovery = new Map((activity.runRecovery?.pendingFinalizations ?? []).map((entry) => [entry.runId, entry]));
  const cards = activity.runs.slice(0, 30).map((run) => {
    const card = node("article", undefined, "run");
    const pending = recovery.get(run.id);
    const status = pending?.recoverable ? "finalization_pending" : run.status;
    const head = node("div", undefined, "run-head");
    const title = node("strong", run.purpose || run.capability); title.title = run.capability;
    head.append(title, node("span", RUN_STATUS[status] ?? status, `run-status is-${status}`));
    card.append(head, node("span", formatDateTime(run.startedAt), "rail-note"));
    if (pending?.recoverable) card.append(node("p", "Kết quả đã được bảo toàn; lần chạy đang chờ hoàn tất.", "notice"));
    const detail = node("details", undefined, "disclosure");
    detail.append(node("summary", "Chi tiết lần chạy"));
    const parts = [
      run.tool ? [run.tool.provider, run.tool.name, run.tool.version].filter(Boolean).join(" · ") : null,
      formatRunDuration(run.durationMs), formatCost(run.cost), run.outputs?.length ? `${run.outputs.length} kết quả` : null
    ].filter(Boolean);
    if (parts.length) detail.append(node("p", parts.join(" · "), "rail-note"));
    detail.append(node("p", `${formatDateTime(run.startedAt)} → ${run.finishedAt ? formatDateTime(run.finishedAt) : "chưa kết thúc"}`, "rail-note"));
    if (run.error) detail.append(node("p", run.error, "notice is-error"));
    card.append(detail);
    return card;
  });
  host.append(...cards.slice(0, 6));
  if (cards.length > 6) {
    const more = node("details", undefined, "disclosure");
    more.append(node("summary", `Hoạt động trước đó (${cards.length - 6})`), ...cards.slice(6));
    host.append(more);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Results                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

function streamSummary(stream) {
  if (stream.type === "video") {
    return [stream.codec, Number.isFinite(stream.width) && Number.isFinite(stream.height) ? `${stream.width}×${stream.height}` : null,
      stream.frameRate ? `${stream.frameRate} fps` : null, stream.pixelFormat].filter(Boolean).join(" · ");
  }
  if (stream.type === "audio") {
    return [stream.codec, Number.isFinite(stream.sampleRate) ? `${stream.sampleRate / 1000} kHz` : null,
      Number.isFinite(stream.channels) ? `${stream.channels} kênh` : null, stream.channelLayout].filter(Boolean).join(" · ");
  }
  return [stream.type, stream.codec].filter(Boolean).join(" · ") || "Stream khác";
}

function durationText(seconds) {
  if (!Number.isFinite(seconds)) return "không rõ";
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 2 : 1)} giây` : clock(seconds);
}

function metadataFacts(result, body) {
  const media = result.data?.media;
  if (!media?.format || !Array.isArray(media.streams)) return false;
  const facts = node("div", undefined, "facts");
  facts.append(
    fact("Thời lượng", durationText(media.format.durationSeconds)),
    fact("Định dạng", media.format.longName || media.format.name || "không rõ"),
    fact("Dung lượng", formatSize(media.format.sizeBytes) || "không rõ"),
    fact("Bitrate", Number.isFinite(media.format.bitRate)
      ? (media.format.bitRate >= 1_000_000 ? `${(media.format.bitRate / 1_000_000).toFixed(2)} Mbps` : `${Math.round(media.format.bitRate / 1000)} kbps`) : "không rõ")
  );
  body.append(facts);
  if (media.streams.length) {
    const streams = node("div", undefined, "streams");
    media.streams.forEach((stream, index) => {
      const row = node("div", undefined, "stream");
      row.append(node("strong", stream.type === "video" ? "Video" : stream.type === "audio" ? "Audio" : `Stream ${index + 1}`), node("span", streamSummary(stream)));
      streams.append(row);
    });
    body.append(streams);
  }
  return true;
}

function mediaFacts(data, primary) {
  const facts = node("div", undefined, "facts");
  const add = (label, value) => facts.append(fact(label, value));
  if (Number.isFinite(data.startSeconds) && Number.isFinite(data.endSeconds)) add("Đoạn cắt", `${durationText(data.startSeconds)} → ${durationText(data.endSeconds)}`);
  if (data.atSeconds !== undefined) add("Tại giây", durationText(data.atSeconds));
  if (Number.isFinite(data.durationSeconds)) add("Thời lượng", durationText(data.durationSeconds));
  if (data.cutMode) add("Chế độ", data.cutMode === "accurate" ? "Cắt chính xác" : data.cutMode);
  if (data.transition) add("Chuyển cảnh", data.transition === "cut" ? "Cắt cứng" : data.transition);
  if (data.fit) add("Khung hình", data.fit === "pad" ? "Giữ nguyên, thêm viền" : "Lấp đầy, có thể mất mép");
  if (data.targetResolution) add("Độ phân giải", `${data.targetResolution.width}×${data.targetResolution.height}`);
  if (typeof data.duckApplied === "boolean") add("Ducking", data.duckApplied ? "Đã áp dụng" : "Không áp dụng");
  if (Number.isInteger(data.cueCount)) add("Số dòng phụ đề", String(data.cueCount));
  if (data.motion) add("Chuyển động", data.motion === "static" ? "Giữ nguyên khung hình" : data.motion);
  if (data.graphic) add("Đồ họa", ({ card: "Thẻ chữ", "bar-chart": "Biểu đồ cột", steps: "Sơ đồ bước" })[data.graphic.kind] || data.graphic.kind);
  if (data.resolution) add("Kích thước", `${data.resolution.width}×${data.resolution.height}`);
  if (Number.isFinite(data.loudnessTargetLufs)) add("Loudness mục tiêu", `${data.loudnessTargetLufs} LUFS`);
  if (data.acquisition) {
    add("Nguồn tải", data.acquisition.finalUrl);
    add("Tác giả", data.acquisition.attribution?.creator || "Chưa có");
    add("Giấy phép đã khai báo", data.acquisition.attribution?.license || "Chưa có");
    add("Kiểm tra quyền sử dụng", "Thông tin do người gọi cung cấp; chưa xác minh");
  }
  add("Dung lượng", formatSize(primary.sizeBytes) || "không rõ");
  return facts;
}

function mediaResult(result, body) {
  const primary = result.files?.find((file) => file.id === "primary");
  if (!primary || !["video", "image", "audio"].includes(primary.mediaType)) return false;
  if (primary.available) {
    const url = resultFileUrl(result.projectId, result.id, primary.id);
    if (primary.mediaType === "image") {
      const image = node("img", undefined, "result-media"); image.src = url; image.alt = result.name; image.loading = "lazy"; body.append(image);
    } else {
      const media = node(primary.mediaType, undefined, "result-media"); media.controls = true; media.preload = "none"; media.src = url; body.append(media);
    }
  } else {
    body.append(node("p", "File đầu ra không còn khả dụng.", "empty-note"));
  }
  body.append(mediaFacts(result.data || {}, primary));
  return true;
}

function decisionBlock(decisions) {
  const block = node("div", undefined, "result-decision");
  if (!decisions.length) {
    block.append(node("span", "Chưa có quyết định. Phản hồi với Agent trong chat khi kết quả này cần được chọn hoặc sửa.", "rail-note"));
    return block;
  }
  const latest = decisions.at(-1);
  block.classList.add(`is-${latest.outcome}`);
  block.append(node("strong", DECISION_LABELS[latest.outcome] || latest.outcome), node("span", " · " + formatDateTime(latest.createdAt), "rail-note"));
  if (latest.note) block.append(node("p", latest.note));
  if (decisions.length > 1) {
    const history = node("details", undefined, "disclosure");
    history.append(node("summary", `Lịch sử quyết định (${decisions.length})`));
    const list = node("ol");
    for (const decision of [...decisions].reverse()) {
      list.append(node("li", `${formatDateTime(decision.createdAt)} · ${DECISION_LABELS[decision.outcome] || decision.outcome}${decision.note ? " — " + decision.note : ""}`));
    }
    history.append(list);
    block.append(history);
  }
  return block;
}

const RESULT_PAGE = 12;

function renderResults(host, activity, shown = RESULT_PAGE) {
  host.replaceChildren();
  const results = Array.isArray(activity.results) ? activity.results : [];
  if (!results.length) {
    host.append(node("p", "Chưa có kết quả nào.", "empty-note"));
    return;
  }
  const resources = new Map(activity.resources.map((resource) => [resource.id, resource]));
  const names = new Map(results.map((result) => [result.id, result.name]));
  const runs = new Map(activity.runs.map((run) => [run.id, run]));
  const decisionsByResult = new Map();
  for (const decision of activity.decisions ?? []) {
    if (!decision.resultId) continue;
    decisionsByResult.set(decision.resultId, [...(decisionsByResult.get(decision.resultId) ?? []), decision]);
  }
  const newestFirst = [...results].reverse();
  for (const result of newestFirst.slice(0, shown)) {
    const card = node("article", undefined, "result");
    const head = node("header", undefined, "result-head");
    const identity = node("div");
    identity.append(node("strong", result.name), node("span", result.type, "rail-note"));
    head.append(identity, node("span", result.verification?.status === "passed" ? "Đã kiểm tra" : "Chưa rõ", "result-check"));
    const body = node("div", undefined, "result-body");
    const known = (result.type === "media.metadata" && metadataFacts(result, body)) || mediaResult(result, body);
    if (!known) {
      const raw = node("details", undefined, "disclosure");
      raw.append(node("summary", "Xem dữ liệu kết quả"), node("pre", JSON.stringify(result.data, null, 2)));
      body.append(raw);
    }
    const run = runs.get(result.createdByRun);
    const sources = [...result.inputResources.map((id) => resources.get(id)?.name || id), ...(result.inputResults || []).map((id) => names.get(id) || id)].join(", ");
    const trace = node("div", undefined, "facts");
    trace.append(
      fact("Nguồn", sources || "Không có"),
      fact("Công cụ", [result.tool?.provider, result.tool?.name, result.tool?.version].filter(Boolean).join(" · ") || "không rõ"),
      fact("Run", run?.purpose || result.createdByRun),
      fact("Tạo lúc", formatDateTime(result.createdAt))
    );
    const evidence = node("details", undefined, "disclosure");
    evidence.append(node("summary", "Bằng chứng và liên kết"),
      node("p", `Result ${result.id} · Run ${result.createdByRun} · Kiểm tra: ${result.verification?.checks?.join(", ") || "không có"}`, "rail-note"));
    card.append(head, body, decisionBlock(decisionsByResult.get(result.id) || []), trace, evidence);
    host.append(card);
  }
  if (newestFirst.length > shown) {
    const more = node("button", `Hiện thêm (${newestFirst.length - shown})`, "button button-quiet");
    more.type = "button";
    more.addEventListener("click", () => renderResults(host, activity, shown + RESULT_PAGE));
    host.append(more);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* The Details tab                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

function section(id, title, { open = false } = {}) {
  const details = node("details", undefined, "panel");
  details.id = "details-" + id;
  details.open = open;
  const summary = node("summary");
  const label = node("span", title, "panel-title");
  const meta = node("span", undefined, "panel-meta");
  summary.append(label, meta, svgIcon(ICONS.chevron, { size: 18 }));
  const body = node("div", undefined, "panel-body");
  details.append(summary, body);
  return { details, body, meta };
}

/**
 * The Details tab: a short overview on top, then collapsible sections. Sections with nothing to show are
 * hidden rather than rendered empty, and heavy ones (results) are only drawn when opened.
 */
export function createDetails(host) {
  host.replaceChildren();
  const overview = node("div", undefined, "details-overview");
  const parts = {
    progress: section("progress", "Tiến độ công việc", { open: true }),
    ideas: section("ideas", "Ý tưởng và lời thoại"),
    animation: section("animation", "Kế hoạch hoạt họa"),
    runs: section("runs", "Hoạt động gần đây"),
    results: section("results", "Kho kết quả"),
    documents: section("documents", "Tài liệu và đánh giá"),
    health: section("health", "Vận hành")
  };
  for (const part of Object.values(parts)) part.details.hidden = true;
  host.append(overview, ...Object.values(parts).map((part) => part.details));

  let data = { summary: null, activity: null, creative: null, animation: null, health: null };
  const signatures = new Map();
  const changed = (key, value) => {
    const signature = JSON.stringify(value);
    if (signatures.get(key) === signature) return false;
    signatures.set(key, signature);
    return true;
  };
  const drawResults = () => {
    if (data.activity && parts.results.details.open && changed("results-open", [data.activity.results, data.activity.runs, data.activity.decisions, data.activity.resources])) {
      renderResults(parts.results.body, data.activity);
    }
  };
  parts.results.details.addEventListener("toggle", () => { signatures.delete("results-open"); drawResults(); });

  return {
    update(next) {
      data = { ...data, ...next };
      const { summary, activity, creative, animation, health } = data;
      if (summary && changed("summary", [summary.checkpoint, summary.checkpointFreshness, summary.intelligence])) {
        renderOverview(overview, summary);
        const workflow = summary.intelligence?.activeWorkflow;
        parts.progress.details.hidden = !workflow;
        if (workflow) {
          renderWorkflow(parts.progress.body, workflow);
          const done = workflow.items.filter((item) => item.status === "completed").length;
          parts.progress.meta.textContent = `${done}/${workflow.items.length}`;
        }
        const artifacts = summary.intelligence?.activeArtifacts ?? [];
        const reviews = summary.intelligence?.latestReviews ?? [];
        parts.documents.details.hidden = !artifacts.length && !reviews.length;
        renderDocuments(parts.documents.body, summary);
        parts.documents.meta.textContent = artifacts.length ? String(artifacts.length) : "";
      }
      if (activity) {
        if (changed("runs", [activity.runs, activity.runRecovery])) {
          parts.runs.details.hidden = !activity.runs.length;
          renderRuns(parts.runs.body, activity);
          parts.runs.meta.textContent = String(activity.runs.length);
        }
        parts.results.details.hidden = !(activity.results ?? []).length;
        parts.results.meta.textContent = String((activity.results ?? []).length);
        drawResults();
      }
      if (creative && changed("creative", creative.artifacts)) {
        const visible = hasCreativeContent(creative);
        parts.ideas.details.hidden = !visible;
        if (visible) renderCreativeDirection(parts.ideas.body, creative); else clearCreativeDirection(parts.ideas.body);
      }
      if (animation && changed("animation", animation.animation)) {
        const items = (animation.animation?.compositions?.length ?? 0) + (animation.animation?.choreographies?.length ?? 0);
        parts.animation.details.hidden = !items;
        if (items) renderAnimation(parts.animation.body, animation); else clearAnimation(parts.animation.body);
        parts.animation.meta.textContent = items ? String(items) : "";
      }
      if (health && changed("health", health.health)) {
        renderHealth(parts.health.body, health);
        parts.health.details.hidden = false;
        const status = health.health?.status;
        parts.health.meta.textContent = status === "ready" ? "Sẵn sàng" : status === "attention" ? "Cần chú ý" : status === "blocked" ? "Bị chặn" : "";
        parts.health.details.dataset.status = status ?? "";
      }
    },
    clear() {
      signatures.clear();
      data = { summary: null, activity: null, creative: null, animation: null, health: null };
      clearAnimation(parts.animation.body); clearCreativeDirection(parts.ideas.body); clearHealth(parts.health.body);
      for (const part of Object.values(parts)) { part.details.hidden = true; part.body.replaceChildren(); part.meta.textContent = ""; }
      overview.replaceChildren();
    }
  };
}

