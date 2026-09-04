const elements = {
  title: document.querySelector("#project-title"),
  projectId: document.querySelector("#project-id"),
  checkpoint: document.querySelector("#checkpoint"),
  projectList: document.querySelector("#project-list"),
  resourceList: document.querySelector("#resource-list"),
  inputPreview: document.querySelector("#input-preview"),
  resultList: document.querySelector("#result-list"),
  runList: document.querySelector("#run-list")
};

let selectedProjectId = null;
let selectedItemPath = null;
let renderedPreviewKey = null;

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
        selectedProjectId = project.id;
        selectedItemPath = null;
        renderedPreviewKey = null;
        loadProjects().catch(showError);
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

function renderVideoClip(result, body) {
  const primary = result.files?.find((file) => file.id === "primary");
  if (!primary) return false;
  if (primary.available) {
    const video = document.createElement("video");
    video.className = "result-video";
    video.controls = true;
    video.preload = "metadata";
    video.src = resultFileUrl(result.projectId, result.id, primary.id);
    body.append(video);
  } else {
    const missing = document.createElement("p");
    missing.className = "empty-note";
    missing.textContent = "File video đầu ra không còn khả dụng.";
    body.append(missing);
  }
  const facts = document.createElement("div");
  facts.className = "result-facts";
  facts.append(
    labelValue(
      "Đoạn cắt",
      formatDuration(result.data.startSeconds) + " → " + formatDuration(result.data.endSeconds)
    ),
    labelValue("Thời lượng", formatDuration(result.data.durationSeconds)),
    labelValue("Chế độ", result.data.cutMode === "accurate" ? "Cắt chính xác" : result.data.cutMode),
    labelValue("Dung lượng", formatSize(primary.sizeBytes))
  );
  body.append(facts);
  return true;
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
      (result.type === "video.clip" && renderVideoClip(result, body));
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
  elements.runList.replaceChildren(...context.runs.slice(0, 20).map((run) => {
    const card = document.createElement("article");
    card.className = "run-card";
    const top = document.createElement("div");
    const capability = document.createElement("strong");
    capability.textContent = run.capability;
    const status = document.createElement("span");
    status.className = `run-status status-${run.status}`;
    status.textContent = run.status;
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
    if (run.error) {
      const error = document.createElement("p");
      error.className = "run-error";
      error.textContent = run.error;
      card.append(error);
    }
    return card;
  }));
}

function renderContext(context) {
  elements.title.textContent = context.project.title;
  elements.projectId.textContent = context.project.id;
  renderCheckpoint(context);
  renderResources(context);
  renderResults(context);
  renderRuns(context);
}

function renderEmpty() {
  elements.title.textContent = "Chưa chọn project";
  elements.projectId.textContent = "";
  elements.checkpoint.textContent = "Chưa có project nào để quan sát.";
  elements.resourceList.textContent = "Chưa có tư liệu.";
  elements.resultList.textContent = "Chưa có kết quả nào.";
  elements.runList.textContent = "Chưa có lần chạy nào.";
  renderPreview("", null);
}

async function loadContext() {
  if (!selectedProjectId) return renderEmpty();
  const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Không thể đọc project.");
  renderContext(body.context);
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Không thể đọc danh sách project.");
  if (!body.projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = body.projects[0]?.id ?? null;
    selectedItemPath = null;
    renderedPreviewKey = null;
  }
  renderProjectList(body.projects);
  await loadContext();
}

loadProjects().catch(showError);
window.setInterval(() => loadProjects().catch(() => {}), 2_000);
