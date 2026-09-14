import { renderProduction, clearProduction } from "./production-view.js";
import { renderSourceAnalysis, clearSourceAnalysis } from "./source-analysis-view.js";
import { renderCreativeDirection, clearCreativeDirection } from "./creative-direction-view.js";
import { renderDelivery, clearDelivery } from "./delivery-view.js";
import { renderHealth, clearHealth } from "./health-view.js";
import { renderAnimation, clearAnimation } from "./animation-view.js";

const elements = {
  production: document.querySelector("#production-view"),
  animation: document.querySelector("#animation-view"),
  delivery: document.querySelector("#delivery-view"),
  health: document.querySelector("#health-view"),
  creativeDirection: document.querySelector("#creative-direction-view"),
  sourceAnalysis: document.querySelector("#source-analysis-view"),
  title: document.querySelector("#project-title"),
  projectId: document.querySelector("#project-id"),
  checkpoint: document.querySelector("#checkpoint"),
  workflow: document.querySelector("#workflow-view"),
  artifactList: document.querySelector("#artifact-list"),
  reviewList: document.querySelector("#review-list"),
  projectList: document.querySelector("#project-list"),
  resourceList: document.querySelector("#resource-list"),
  inputPreview: document.querySelector("#input-preview"),
  resultList: document.querySelector("#result-list"),
  runList: document.querySelector("#run-list")
};

let selectedProjectId = new URLSearchParams(window.location.search).get("project");
let selectedItemPath = null;
let renderedPreviewKey = null;
let renderedResultsKey = null;

function renderProjectList(projects) {
  elements.projectList.replaceChildren(
    ...projects.map((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = project.id === selectedProjectId ? "project-button is-active" : "project-button";
      const title = document.createElement("span");
      title.textContent = project.title;
      const id = document.createElement("span");
      id.className = "input-meta";
      id.textContent = project.id;
      button.append(title, id);
      button.addEventListener("click", () => {
        if (project.id === selectedProjectId) return;
        selectedProjectId = project.id;
        const location = new URL(window.location.href);
        location.searchParams.set("project", project.id);
        window.history.replaceState(null, "", location);
        selectedItemPath = null;
        renderedPreviewKey = null;
        renderProjectList([...projectsById.values()]);
        loadSelectedProject(project.generation).catch((error) => {
          if (error.name !== "AbortError") showError(error);
        });
      });
      return button;
    })
  );
}

function showError(error) {
  elements.checkpoint.textContent = error.message;
}

function inputUrl(projectId, item) {
  const inputPath = item.path.startsWith("inputs/") ? item.path.slice(7) : item.path;
  const encodedPath = inputPath.split("/").map(encodeURIComponent).join("/");
  return `/project-inputs/${encodeURIComponent(projectId)}/${encodedPath}?v=${encodeURIComponent(item.modifiedAt)}`;
}

function formatSize(size) {
  if (!Number.isFinite(size)) return "không rõ dung lượng";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "chưa kết thúc";
  return new Intl.DateTimeFormat("vi", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "không rõ";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} giây`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(0).padStart(2, "0")}`;
}

function formatBitRate(value) {
  if (!Number.isFinite(value)) return "không rõ";
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(value / 1000)} kbps`;
}

function formatRunDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return null;
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} giây`;
}

function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.actual)) return null;
  return cost.actual === 0 ? "Miễn phí" : `${cost.actual.toFixed(4)} ${cost.currency}`;
}

function labelValue(label, value) {
  const item = document.createElement("div");
  item.className = "result-fact";
  const term = document.createElement("span");
  term.textContent = label;
  const detail = document.createElement("strong");
  detail.textContent = value;
  item.append(term, detail);
  return item;
}

function renderPreview(projectId, item) {
  const previewKey = item ? `${projectId}:${item.path}:${item.modifiedAt}` : "empty";
  if (previewKey === renderedPreviewKey) return;
  renderedPreviewKey = previewKey;
  elements.inputPreview.replaceChildren();
  if (!item) {
    elements.inputPreview.textContent = "Chọn một file để xem preview.";
    return;
  }

  const url = inputUrl(projectId, item);
  if (item.mediaType === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.name;
    elements.inputPreview.append(image);
    return;
  }
  if (item.mediaType === "video" || item.mediaType === "audio") {
    const media = document.createElement(item.mediaType === "video" ? "video" : "audio");
    media.src = url;
    media.controls = true;
    media.preload = "metadata";
    elements.inputPreview.append(media);
    return;
  }
  elements.inputPreview.textContent = "Trình duyệt chưa có preview cho loại file này.";
}

function renderCheckpoint(context) {
  const checkpoint = context.checkpoint;
  elements.checkpoint.replaceChildren();
  if (!checkpoint) {
    elements.checkpoint.textContent = "Agent chưa ghi checkpoint cho project này.";
    return;
  }

  if (context.checkpointFreshness?.status === "stale") {
    const warning = document.createElement("div");
    warning.className = "checkpoint-warning";
    const kinds = context.checkpointFreshness.newerActivityKinds.join(", ");
    warning.textContent =
      `Checkpoint có thể đã cũ: có ${context.checkpointFreshness.newerActivityCount} ` +
      `hoạt động mới hơn${kinds ? ` (${kinds})` : ""}. Agent cần đọc lại context trước khi tiếp tục.`;
    elements.checkpoint.append(warning);
  }

  const goal = document.createElement("p");
  goal.className = "context-goal";
  goal.textContent = checkpoint.goal;
  elements.checkpoint.append(goal);

  const groups = [
    ["Ràng buộc", checkpoint.constraints],
    ["Đang chờ", checkpoint.pending],
    ["Tiếp theo", checkpoint.next ? [checkpoint.next] : []]
  ];
  for (const [label, values] of groups) {
    if (!values.length) continue;
    const group = document.createElement("div");
    group.className = "context-group";
    const heading = document.createElement("strong");
    heading.textContent = label;
    const list = document.createElement("ul");
    list.replaceChildren(...values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }));
    group.append(heading, list);
    elements.checkpoint.append(group);
  }
}

function renderWorkflow(context) {
  const workflow = context.intelligence?.activeWorkflow;
  if (!workflow) {
    elements.workflow.textContent = "No active workflow yet.";
    return;
  }

  const header = document.createElement("div");
  header.className = "workflow-header";
  const identity = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = workflow.name;
  const meta = document.createElement("span");
  meta.className = "input-meta";
  meta.textContent = `revision ${workflow.revision} · ${workflow.status} · ${workflow.changeReason}`;
  identity.append(name, meta);
  const purpose = document.createElement("p");
  purpose.textContent = workflow.purpose;
  header.append(identity, purpose);

  const items = document.createElement("div");
  items.className = "workflow-items";
  items.replaceChildren(...workflow.items.map((item) => {
    const card = document.createElement("article");
    card.className = `work-item work-${item.status}`;
    const top = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const status = document.createElement("span");
    status.className = "work-status";
    status.textContent = item.status.replaceAll("_", " ");
    top.append(title, status);
    const detail = document.createElement("p");
    detail.textContent = item.purpose;
    const flags = document.createElement("span");
    flags.className = "input-meta";
    flags.textContent = [
      item.dependsOn.length ? `after: ${item.dependsOn.join(", ")}` : "entry",
      item.skillIds.length ? `skills: ${item.skillIds.join(", ")}` : null,
      item.review.required ? `${item.review.perspective} review` : null,
      item.approval !== "auto" ? `approval: ${item.approval}` : null
    ].filter(Boolean).join(" · ");
    card.append(top, detail, flags);
    return card;
  }));
  elements.workflow.replaceChildren(header, items);
}

function renderIntelligence(context) {
  const artifacts = context.intelligence?.activeArtifacts ?? [];
  if (!artifacts.length) {
    elements.artifactList.textContent = "No active understanding artifact yet.";
  } else {
    elements.artifactList.replaceChildren(...artifacts.map((artifact) => {
      const card = document.createElement("article");
      card.className = "intelligence-card";
      const name = document.createElement("strong");
      name.textContent = artifact.name;
      const type = document.createElement("span");
      type.className = "input-meta";
      type.textContent = `${artifact.type} · revision ${artifact.revision}`;
      const summary = document.createElement("p");
      summary.textContent = artifact.summary;
      card.append(name, type, summary);
      return card;
    }));
  }
  const reviews = context.intelligence?.latestReviews ?? [];
  const skills = context.intelligence?.relevantSkills ?? [];
  const blocks = [];
  if (reviews.length) {
    const block = document.createElement("div");
    block.className = "intelligence-card";
    const heading = document.createElement("strong");
    heading.textContent = "Latest reviews";
    const list = document.createElement("ul");
    list.replaceChildren(...reviews.map((review) => {
      const item = document.createElement("li");
      const coverage = review.attestation ? ` · watched full · ${review.attestation.listenedFull === true ? "listened full" : "audio n/a"}` : "";
      item.textContent = `${review.perspective} · ${review.verdict}${coverage} — ${review.summary}`;
      return item;
    }));
    block.append(heading, list);
    blocks.push(block);
  }
  if (skills.length) {
    const block = document.createElement("div");
    block.className = "intelligence-card";
    const heading = document.createElement("strong");
    heading.textContent = "Skills relevant now";
    const text = document.createElement("p");
    text.textContent = skills.map((skill) => skill.name).join(" · ");
    block.append(heading, text);
    blocks.push(block);
  }
  elements.reviewList.replaceChildren(...blocks);
}

function renderResources(context) {
  const allItems = context.resources.flatMap((resource) => resource.items);
  if (!allItems.some((item) => item.path === selectedItemPath)) selectedItemPath = null;
  if (!context.resources.length) {
    elements.resourceList.textContent = "Chưa có tư liệu.";
    renderPreview(context.project.id, null);
    return;
  }

  elements.resourceList.replaceChildren(...context.resources.map((resource) => {
    const card = document.createElement("article");
    card.className = "resource-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    name.textContent = resource.name;
    const meta = document.createElement("span");
    meta.className = "input-meta";
    meta.textContent = `${resource.kind} · nguồn: ${resource.source.name} · ${resource.items.length} file${resource.available ? "" : " · thiếu dữ liệu"}`;
    header.append(name, meta);
    card.append(header);

    if (!resource.items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "Folder rỗng.";
      card.append(empty);
      return card;
    }

    const items = document.createElement("div");
    items.className = "resource-items";
    items.replaceChildren(...resource.items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.path === selectedItemPath ? "input-button is-active" : "input-button";
      const path = document.createElement("span");
      path.className = "input-name";
      path.textContent = item.relativePath;
      const itemMeta = document.createElement("span");
      itemMeta.className = "input-meta";
      itemMeta.textContent = `${item.mediaType} · ${formatSize(item.sizeBytes)}${item.available ? "" : " · thiếu file"}`;
      button.disabled = !item.available;
      button.append(path, itemMeta);
      button.addEventListener("click", () => {
        selectedItemPath = item.path;
        renderedPreviewKey = null;
        renderResources(context);
      });
      return button;
    }));
    card.append(items);
    return card;
  }));

  renderPreview(context.project.id, allItems.find((item) => item.path === selectedItemPath));
}

function streamSummary(stream) {
  if (stream.type === "video") {
    return [
      stream.codec,
      Number.isFinite(stream.width) && Number.isFinite(stream.height)
        ? `${stream.width}×${stream.height}`
        : null,
      stream.frameRate ? `${stream.frameRate} fps` : null,
      stream.pixelFormat
    ].filter(Boolean).join(" · ");
  }
  if (stream.type === "audio") {
    return [
      stream.codec,
      Number.isFinite(stream.sampleRate) ? `${stream.sampleRate / 1000} kHz` : null,
      Number.isFinite(stream.channels) ? `${stream.channels} kênh` : null,
      stream.channelLayout
    ].filter(Boolean).join(" · ");
  }
  return [stream.type, stream.codec].filter(Boolean).join(" · ") || "Stream khác";
}

function renderMediaMetadata(result, body) {
  const media = result.data?.media;
  if (!media?.format || !Array.isArray(media.streams)) return false;

  const facts = document.createElement("div");
  facts.className = "result-facts";
  facts.append(
    labelValue("Thời lượng", formatDuration(media.format.durationSeconds)),
    labelValue("Định dạng", media.format.longName || media.format.name || "không rõ"),
    labelValue("Dung lượng", formatSize(media.format.sizeBytes)),
    labelValue("Bitrate", formatBitRate(media.format.bitRate))
  );
  body.append(facts);

  if (media.streams.length) {
    const streams = document.createElement("div");
    streams.className = "stream-list";
    streams.replaceChildren(...media.streams.map((stream, index) => {
      const row = document.createElement("div");
      row.className = "stream-row";
      const label = document.createElement("strong");
      label.textContent = stream.type === "video"
        ? "Video"
        : stream.type === "audio" ? "Audio" : `Stream ${index + 1}`;
      const summary = document.createElement("span");
      summary.textContent = streamSummary(stream);
      row.append(label, summary);
      return row;
    }));
    body.append(streams);
  }
  return true;
}

function renderRawResult(result, body) {
  const details = document.createElement("details");
  details.className = "result-raw";
  const summary = document.createElement("summary");
  summary.textContent = "Xem dữ liệu kết quả";
  const contents = document.createElement("pre");
  contents.textContent = JSON.stringify(result.data, null, 2);
  details.append(summary, contents);
  body.append(details);
}

function resultFileUrl(projectId, resultId, fileId) {
  return [
    "/project-results",
    encodeURIComponent(projectId),
    encodeURIComponent(resultId),
    encodeURIComponent(fileId)
  ].join("/");
}

// Handles every tool that outputs a single "primary" file (trim, concat,
// reformat, audio overlay, subtitle burn, image-to-video, thumbnail) instead
// of gating on result.type: several of those tools intentionally share the
// "video.clip" type, and each has a different shape of result.data, so the
// facts panel below only renders a field when it actually finds it rather
// than assuming one tool's fields (e.g. video.trim's startSeconds/cutMode).
function renderMediaResult(result, body) {
  const primary = result.files?.find((file) => file.id === "primary");
  if (!primary || !["video", "image", "audio"].includes(primary.mediaType)) return false;

  if (primary.available) {
    const media = document.createElement(primary.mediaType === "image" ? "img" : primary.mediaType);
    media.className = primary.mediaType === "image" ? "result-image" : primary.mediaType === "audio" ? "result-audio" : "result-video";
    if (primary.mediaType !== "image") {
      media.controls = true;
      media.preload = "metadata";
      media.src = resultFileUrl(result.projectId, result.id, primary.id);
    } else {
      media.src = resultFileUrl(result.projectId, result.id, primary.id);
      media.alt = result.name;
    }
    body.append(media);
  } else {
    const missing = document.createElement("p");
    missing.className = "empty-note";
    missing.textContent = `File ${primary.mediaType === "video" ? "video" : primary.mediaType === "audio" ? "audio" : "ảnh"} đầu ra không còn khả dụng.`;
    body.append(missing);
  }
  body.append(mediaResultFacts(result.data || {}, primary));
  return true;
}

function mediaResultFacts(data, primary) {
  const facts = document.createElement("div");
  facts.className = "result-facts";
  const entries = [];
  if (Number.isFinite(data.startSeconds) && Number.isFinite(data.endSeconds)) {
    entries.push(labelValue("Đoạn cắt", formatDuration(data.startSeconds) + " → " + formatDuration(data.endSeconds)));
  }
  if (data.atSeconds !== undefined) {
    entries.push(labelValue("Tại giây", formatDuration(data.atSeconds)));
  }
  if (Number.isFinite(data.durationSeconds)) {
    entries.push(labelValue("Thời lượng", formatDuration(data.durationSeconds)));
  }
  if (data.cutMode) {
    entries.push(labelValue("Chế độ", data.cutMode === "accurate" ? "Cắt chính xác" : data.cutMode));
  }
  if (data.transition) {
    entries.push(labelValue("Chuyển cảnh", data.transition === "cut" ? "Cắt cứng" : data.transition));
  }
  if (data.fit) {
    entries.push(labelValue("Khung hình", data.fit === "pad" ? "Giữ nguyên, thêm viền" : "Lấp đầy, có thể mất mép"));
  }
  if (data.targetResolution) {
    entries.push(labelValue("Độ phân giải", `${data.targetResolution.width}x${data.targetResolution.height}`));
  }
  if (typeof data.duckApplied === "boolean") {
    entries.push(labelValue("Ducking", data.duckApplied ? "Đã áp dụng" : "Không áp dụng"));
  }
  if (Number.isInteger(data.cueCount)) {
    entries.push(labelValue("Số dòng phụ đề", String(data.cueCount)));
  }
  if (data.motion) {
    entries.push(labelValue("Chuyển động", data.motion === "static" ? "Giữ nguyên khung hình" : data.motion));
  }
  if (data.graphic) entries.push(labelValue("Đồ họa", ({ card: "Thẻ chữ", "bar-chart": "Biểu đồ cột", steps: "Sơ đồ bước" })[data.graphic.kind] || data.graphic.kind));
  if (data.resolution) entries.push(labelValue("Kích thước", data.resolution.width + "×" + data.resolution.height));
  if (Number.isFinite(data.loudnessTargetLufs)) entries.push(labelValue("Loudness mục tiêu", data.loudnessTargetLufs + " LUFS"));
  if (data.acquisition) {
    entries.push(labelValue("Nguồn tải", data.acquisition.finalUrl));
    entries.push(labelValue("Tác giả", data.acquisition.attribution?.creator || "Chưa có"));
    entries.push(labelValue("Giấy phép đã khai báo", data.acquisition.attribution?.license || "Chưa có"));
    entries.push(labelValue("Kiểm tra quyền sử dụng", "Thông tin do người gọi cung cấp; chưa xác minh"));
  }
  entries.push(labelValue("Dung lượng", formatSize(primary.sizeBytes)));
  facts.append(...entries);
  return facts;
}

const decisionLabels = {
  accepted: "Đã chấp nhận",
  changes_requested: "Cần sửa",
  rejected: "Đã loại"
};

function renderResultDecision(decisions) {
  const section = document.createElement("section");
  section.className = "result-decision";
  if (!decisions.length) {
    section.classList.add("is-undecided");
    const status = document.createElement("strong");
    status.textContent = "Chưa có quyết định";
    const hint = document.createElement("span");
    hint.textContent = "Phản hồi với Agent trong chat khi kết quả này cần được chọn hoặc sửa.";
    section.append(status, hint);
    return section;
  }

  const latest = decisions.at(-1);
  section.classList.add(`is-${latest.outcome}`);
  const heading = document.createElement("div");
  const status = document.createElement("strong");
  status.textContent = decisionLabels[latest.outcome] || latest.outcome;
  const time = document.createElement("span");
  time.textContent = formatDate(latest.createdAt);
  heading.append(status, time);
  section.append(heading);
  if (latest.note) {
    const note = document.createElement("p");
    note.textContent = latest.note;
    section.append(note);
  }

  if (decisions.length > 1) {
    const history = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Lịch sử quyết định (${decisions.length})`;
    const list = document.createElement("ol");
    list.append(...[...decisions].reverse().map((decision) => {
      const item = document.createElement("li");
      const label = decisionLabels[decision.outcome] || decision.outcome;
      item.textContent = `${formatDate(decision.createdAt)} · ${label}`;
      if (decision.note) item.textContent += ` — ${decision.note}`;
      return item;
    }));
    history.append(summary, list);
    section.append(history);
  }
  return section;
}

function renderResults(context) {
  const key = JSON.stringify([context.project.id, context.results, context.runs, context.decisions, context.resources, context.artifacts]);
  if (key === renderedResultsKey) return;
  renderedResultsKey = key;
  const results = Array.isArray(context.results) ? context.results : [];
  if (!results.length) {
    elements.resultList.textContent = "Chưa có kết quả nào.";
    return;
  }

  const resources = new Map(context.resources.map((resource) => [resource.id, resource]));
  const resultNames = new Map(results.map((result) => [result.id, result.name]));
  const runs = new Map(context.runs.map((run) => [run.id, run]));
  const decisionsByResult = new Map();
  for (const decision of Array.isArray(context.decisions) ? context.decisions : []) {
    const decisions = decisionsByResult.get(decision.resultId) || [];
    decisions.push(decision);
    decisionsByResult.set(decision.resultId, decisions);
  }
  elements.resultList.replaceChildren(...[...results].reverse().map((result) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const header = document.createElement("header");
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = result.name;
    const type = document.createElement("span");
    type.className = "input-meta";
    type.textContent = result.type;
    identity.append(name, type);
    const verification = document.createElement("span");
    verification.className = "result-verification";
    verification.textContent = result.verification?.status === "passed" ? "Đã kiểm tra" : "Chưa rõ";
    header.append(identity, verification);

    const body = document.createElement("div");
    body.className = "result-body";
    const renderedKnownType =
      (result.type === "media.metadata" && renderMediaMetadata(result, body)) ||
      renderMediaResult(result, body);
    if (!renderedKnownType) {
      renderRawResult(result, body);
    }

    const run = runs.get(result.createdByRun);
    const sourceNames = [
      ...result.inputResources.map((id) => resources.get(id)?.name || id),
      ...(result.inputResults || []).map((id) => resultNames.get(id) || id)
    ]
      .join(", ");
    const trace = document.createElement("div");
    trace.className = "result-trace";
    trace.append(
      labelValue("Nguồn", sourceNames || "Không có"),
      labelValue(
        "Công cụ",
        [result.tool?.provider, result.tool?.name, result.tool?.version]
          .filter(Boolean)
          .join(" · ") || "không rõ"
      ),
      labelValue("Run", run?.purpose || result.createdByRun),
      labelValue("Tạo lúc", formatDate(result.createdAt))
    );

    const evidence = document.createElement("details");
    evidence.className = "result-evidence";
    const summary = document.createElement("summary");
    summary.textContent = "Bằng chứng và liên kết";
    const evidenceText = document.createElement("p");
    const checks = result.verification?.checks?.join(", ") || "không có";
    evidenceText.textContent =
      `Result ${result.id} · Run ${result.createdByRun} · Kiểm tra: ${checks}`;
    evidence.append(summary, evidenceText);

    card.append(
      header,
      body,
      renderResultDecision(decisionsByResult.get(result.id) || []),
      trace,
      evidence
    );
    return card;
  }));
}

function renderRuns(context) {
  if (!context.runs.length) {
    elements.runList.textContent = "Chưa có lần chạy nào.";
    return;
  }
  const pendingFinalizations = new Map(
    (context.runRecovery?.pendingFinalizations ?? []).map((entry) => [entry.runId, entry])
  );
  elements.runList.replaceChildren(...context.runs.slice(0, 20).map((run) => {
    const card = document.createElement("article");
    card.className = "run-card";
    const top = document.createElement("div");
    const capability = document.createElement("strong");
    capability.textContent = run.capability;
    const status = document.createElement("span");
    const recovery = pendingFinalizations.get(run.id);
    const displayedStatus = recovery?.recoverable ? "finalization_pending" : run.status;
    status.className = `run-status status-${displayedStatus}`;
    status.textContent = displayedStatus;
    top.append(capability, status);
    const time = document.createElement("span");
    time.className = "input-meta";
    time.textContent = `${formatDate(run.startedAt)} → ${formatDate(run.finishedAt)}`;
    card.append(top);
    if (run.purpose) {
      const purpose = document.createElement("p");
      purpose.className = "run-purpose";
      purpose.textContent = run.purpose;
      card.append(purpose);
    }
    const detailParts = [
      run.tool ? [run.tool.provider, run.tool.name, run.tool.version].filter(Boolean).join(" · ") : null,
      formatRunDuration(run.durationMs),
      formatCost(run.cost),
      run.outputs?.length ? `${run.outputs.length} kết quả` : null
    ].filter(Boolean);
    if (detailParts.length) {
      const details = document.createElement("span");
      details.className = "input-meta";
      details.textContent = detailParts.join(" · ");
      card.append(details);
    }
    card.append(time);
    if (recovery?.recoverable) {
      const recoveryNote = document.createElement("p");
      recoveryNote.className = "run-warning";
      recoveryNote.textContent =
        "Kết quả đã được bảo toàn; cần hoàn tất lại dấu vết run bằng CLI phục hồi.";
      card.append(recoveryNote);
    }
    if (run.error) {
      const error = document.createElement("p");
      error.className = "run-error";
      error.textContent = run.error;
      card.append(error);
    }
    return card;
  }));
}

function renderSummary(context) {
  elements.title.textContent = context.project.title;
  elements.projectId.textContent = context.project.id;
  renderCheckpoint(context);
  renderWorkflow(context);
  renderIntelligence(context);
}

function sectionPlaceholder(element, label) {
  element.textContent = `Đang chờ tải ${label} khi cần xem.`;
  element.classList.add("observer-placeholder");
}

function clearSectionPlaceholder(element) {
  element.classList.remove("observer-placeholder");
}

function renderObserverSection(section, context) {
  if (section === "source") {
    clearSectionPlaceholder(elements.sourceAnalysis);
    renderSourceAnalysis(elements.sourceAnalysis, context);
  } else if (section === "creative") {
    clearSectionPlaceholder(elements.creativeDirection);
    renderCreativeDirection(elements.creativeDirection, context);
  } else if (section === "production") {
    clearSectionPlaceholder(elements.production);
    renderProduction(elements.production, context);
  } else if (section === "animation") {
    clearSectionPlaceholder(elements.animation);
    renderAnimation(elements.animation, context);
  } else if (section === "delivery") {
    clearSectionPlaceholder(elements.delivery);
    renderDelivery(elements.delivery, context);
  } else if (section === "health") {
    clearSectionPlaceholder(elements.health);
    renderHealth(elements.health, context);
  } else if (section === "activity") {
    clearSectionPlaceholder(elements.resourceList);
    renderResources(context);
    renderResults(context);
    renderRuns(context);
  }
}

function renderEmpty() {
  clearProduction(elements.production);
  clearDelivery(elements.delivery);
  clearHealth(elements.health);
  clearSourceAnalysis(elements.sourceAnalysis);
  clearCreativeDirection(elements.creativeDirection);
  clearAnimation(elements.animation);
  elements.title.textContent = "Chưa chọn project";
  elements.projectId.textContent = "";
  elements.checkpoint.textContent = "Chưa có project nào để quan sát.";
  elements.workflow.textContent = "No active workflow yet.";
  elements.artifactList.textContent = "No active understanding artifact yet.";
  elements.reviewList.replaceChildren();
  elements.resourceList.textContent = "Chưa có tư liệu.";
  elements.resultList.textContent = "Chưa có kết quả nào.";
  elements.runList.textContent = "Chưa có lần chạy nào.";
  renderPreview("", null);
}

let projectsEtag = null;
let projectsById = new Map();
let renderedProjectId = null;
let renderedGeneration = null;
let listRequestRunning = false;
const sectionEtags = new Map();
const sectionGenerations = new Map();
const sectionLoads = new Map();
const sectionControllers = new Map();
const loadedSections = new Set(["production", "delivery", "health"]);

function resetProjectSections() {
  for (const controller of sectionControllers.values()) controller.abort();
  sectionControllers.clear();
  sectionEtags.clear();
  sectionGenerations.clear();
  sectionLoads.clear();
  clearProduction(elements.production);
  clearDelivery(elements.delivery);
  clearHealth(elements.health);
  clearSourceAnalysis(elements.sourceAnalysis);
  clearCreativeDirection(elements.creativeDirection);
  clearAnimation(elements.animation);
  sectionPlaceholder(elements.sourceAnalysis, "khảo sát tư liệu");
  sectionPlaceholder(elements.creativeDirection, "định hướng sáng tạo");
  sectionPlaceholder(elements.animation, "hoạt họa bằng code");
  sectionPlaceholder(elements.production, "các phiên bản video");
  sectionPlaceholder(elements.delivery, "các bundle giao");
  sectionPlaceholder(elements.health, "trạng thái vận hành");
  sectionPlaceholder(elements.resourceList, "resources, results và runs");
  elements.resultList.textContent = "Dữ liệu chi tiết sẽ được tải cùng khu vực Resources.";
  elements.runList.textContent = "Dữ liệu chi tiết sẽ được tải cùng khu vực Resources.";
}

async function loadSection(section, requestedGeneration = null) {
  if (!selectedProjectId) return;
  const projectId = selectedProjectId;
  const key = `${projectId}:${section}`;
  const generation = requestedGeneration ?? projectsById.get(projectId)?.generation ?? null;
  if (generation && sectionGenerations.get(key) === generation) {
    loadedSections.add(section);
    return;
  }
  const loadKey = `${key}:${generation ?? "current"}`;
  if (sectionLoads.has(loadKey)) return sectionLoads.get(loadKey);

  sectionControllers.get(section)?.abort();
  const controller = new AbortController();
  sectionControllers.set(section, controller);
  const promise = (async () => {
    const headers = {};
    if (sectionEtags.has(key)) headers["If-None-Match"] = sectionEtags.get(key);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/observer/${section}`, {
      headers,
      signal: controller.signal
    });
    if (response.status === 304) {
      if (generation) sectionGenerations.set(key, generation);
      loadedSections.add(section);
      return;
    }
    const body = await response.json();
    if (selectedProjectId !== projectId) return;
    if (!response.ok) throw new Error(body.error || `Không thể đọc khu vực ${section}.`);
    sectionEtags.set(key, response.headers.get("etag"));
    sectionGenerations.set(key, body.context.generation);
    loadedSections.add(section);
    renderedGeneration = body.context.generation;
    if (section === "summary") renderSummary(body.context);
    else renderObserverSection(section, body.context);
  })();
  sectionLoads.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    if (sectionLoads.get(loadKey) === promise) sectionLoads.delete(loadKey);
  }
}
async function loadSelectedProject(generation) {
  if (!selectedProjectId) return renderEmpty();
  const changedProject = renderedProjectId !== selectedProjectId;
  const changedGeneration = renderedGeneration !== generation;
  if (!changedProject && !changedGeneration) return;
  if (changedProject) {
    renderedProjectId = selectedProjectId;
    renderedGeneration = null;
    resetProjectSections();
  }
  const sections = new Set(["summary", "animation", "production", "delivery", "health", ...loadedSections]);
  await Promise.all([...sections].map((section) => loadSection(section, generation)));
}

async function loadProjects() {
  if (listRequestRunning) return;
  listRequestRunning = true;
  try {
    const headers = {};
    if (projectsEtag) headers["If-None-Match"] = projectsEtag;
    const response = await fetch("/api/projects", { headers });
    if (response.status === 304) return;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Không thể đọc danh sách project.");
    projectsEtag = response.headers.get("etag");
    projectsById = new Map(body.projects.map((project) => [project.id, project]));
    if (!projectsById.has(selectedProjectId)) {
      selectedProjectId = body.projects[0]?.id ?? null;
      selectedItemPath = null;
      renderedPreviewKey = null;
    }
    renderProjectList(body.projects);
    if (!selectedProjectId) return renderEmpty();
    await loadSelectedProject(projectsById.get(selectedProjectId).generation);
  } finally {
    listRequestRunning = false;
  }
}

const lazySections = [
  ["source", elements.sourceAnalysis.closest(".inputs-section")],
  ["creative", elements.creativeDirection.closest(".inputs-section")],
  ["activity", elements.resourceList.closest(".inputs-section")],
];
const lazyObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting || !selectedProjectId) continue;
    const generation = projectsById.get(selectedProjectId)?.generation;
    if (!generation) continue;
    const match = lazySections.find(([, target]) => target === entry.target);
    if (!match) continue;
    loadSection(match[0], generation).catch((error) => {
      if (error.name !== "AbortError") showError(error);
    });
  }
}, { rootMargin: "300px 0px" });
loadProjects().then(() => {
  for (const [, target] of lazySections) lazyObserver.observe(target);
  window.setInterval(() => loadProjects().catch(() => {}), 2_000);
}).catch(showError);
