import { renderProduction, clearProduction, viewerProjectState, createBrandArtwork } from "./production-view.js";
import { renderSourceAnalysis, clearSourceAnalysis } from "./source-analysis-view.js";
import { renderCreativeDirection, clearCreativeDirection } from "./creative-direction-view.js";
import { renderDelivery, clearDelivery } from "./delivery-view.js";
import { renderHealth, clearHealth } from "./health-view.js";
import { renderAnimation, clearAnimation, previewClipDescription } from "./animation-view.js";
import { reviewInspectionLabel } from "./review-inspection.js";

const elements = {
  search: document.querySelector("#project-search"),
  projectCount: document.querySelector("#project-count"),
  projectState: document.querySelector("#project-state"),
  featuredVideo: document.querySelector("#video-overview"),
  connection: document.querySelector("#connection-status"),
  error: document.querySelector("#app-error"),
  production: document.querySelector("#production-view"),
  videoControls: document.querySelector("#video-controls"),
  videoChapters: document.querySelector("#video-chapters"),
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
if (!selectedProjectId) {
  try { selectedProjectId = localStorage.getItem("padstudio-project"); } catch { /* Optional UI preference. */ }
}
let selectedItemPath = null;
let renderedPreviewKey = null;
let renderedResultsKey = null;
const viewLabels = { video: "Video", sources: "Tư liệu", content: "Nội dung", activity: "Chi tiết dự án" };
const viewSections = { video: ["animation", "production", "delivery"], sources: ["source", "activity"], content: ["creative", "animation"], activity: ["activity", "health"] };
let currentView = new URLSearchParams(window.location.search).get("view") || "video";
if (!viewLabels[currentView]) currentView = "video";
let featuredSignature = null;
let animationContext = null;
let productionContext = null;
let activityContext = null;
let summaryContext = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function setConnection(connected) {
  elements.connection.classList.toggle("is-connected", connected);
  elements.connection.classList.toggle("is-disconnected", !connected);
  elements.connection.lastElementChild.textContent = connected ? "Đã đồng bộ" : "Mất kết nối";
}

function closeSidebar({ restoreFocus = false } = {}) {
  document.body.classList.remove("sidebar-open");
  document.querySelector("#sidebar-backdrop").hidden = true;
  document.querySelector("#sidebar-toggle").setAttribute("aria-expanded", "false");
  document.querySelector("#main-content").inert = false;
  document.querySelector("#project-pane").inert = true;
  document.querySelector("#project-pane").hidden = true;
  if (restoreFocus) document.querySelector("#sidebar-toggle").focus();
}

function setView(view, { updateUrl = true, focus = false } = {}) {
  if (!viewLabels[view]) view = "video";
  currentView = view;
  document.body.dataset.workspaceView = view;
  document.querySelector(view === "video" ? "#video-heading-slot" : "#page-heading-slot")
    .append(document.querySelector(".project-heading"));
  for (const button of document.querySelectorAll(".workspace-tab")) {
    const selected = button.dataset.view === view;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected || (["activity", "content"].includes(view) && button.dataset.view === "video") ? 0 : -1;
    if (selected && focus) button.focus();
  }
  for (const panel of document.querySelectorAll(".view-panel")) panel.hidden = panel.id !== "view-" + view;
  document.querySelector("#project-menu").open = false;
  if (view === "activity") document.querySelector("#project-details-heading").focus();
  if (view === "content") elements.title.focus();
  document.querySelector("#view-label").textContent = viewLabels[view];
  for (const media of document.querySelectorAll(".view-panel[hidden] video, .view-panel[hidden] audio")) media.pause();
  if (view === "sources" && activityContext) {
    clearSectionPlaceholder(elements.resourceList);
    renderResources(activityContext);
  }
  if (view === "activity" && activityContext) renderRuns(activityContext);
  if (updateUrl) {
    const location = new URL(window.location.href);
    location.searchParams.set("view", view);
    window.history.replaceState(null, "", location);
  }
  if (selectedProjectId) {
    const generation = projectsById.get(selectedProjectId)?.generation;
    if (generation) Promise.all(viewSections[view].map((section) => loadSection(section, generation))).catch((error) => {
      if (error.name !== "AbortError") showError(error);
    });
  }
}

const watchedPlayers = new WeakSet();
function activeViewer() {
  return document.querySelector('#production-view .sequence-group:not([hidden]) video') ??
    document.querySelector('#video-overview:not([hidden]) video');
}
function syncViewer() {
  const player = activeViewer();
  const button = document.querySelector("#watch-button");
  button.disabled = !player || !!player.error;
  const playing = player && !player.paused && !player.ended;
  button.querySelector("span").textContent = playing ? "Tạm dừng" : "Phát video";
  button.querySelector("path").setAttribute("d", playing ? "M8 5v14M16 5v14" : "m9 5 11 7-11 7z");
  button.classList.toggle("is-playing", !!playing);
  const layout = document.querySelector(".viewer-layout");
  layout.classList.toggle("is-empty", !player);
  layout.classList.toggle("is-wide", !!player && !player.closest(".screening-stage")?.classList.contains("is-portrait"));
  layout.classList.toggle("is-comparing", document.querySelectorAll('.sequence-group:not([hidden]) .sequence-panel').length > 1);
  document.querySelector("#video-versions").hidden = !elements.videoControls.childElementCount;
  const revision = elements.videoControls.querySelector('.sequence-controls:not([hidden]) select[aria-label="Chọn bản video"]');
  const label = revision?.selectedOptions[0]?.textContent ?? elements.videoControls.querySelector(".featured-caption > div > span")?.textContent ?? "";
  document.querySelector("#video-version-label").textContent = label;
  syncProjectState();
  if (player && !watchedPlayers.has(player)) {
    watchedPlayers.add(player);
    for (const event of ["play", "pause", "ended", "error"]) player.addEventListener(event, syncViewer);
  }
}

function syncProjectState() {
  const state = viewerProjectState(summaryContext, activityContext);
  const label = state?.label ?? "";
  elements.projectState.hidden = !state;
  elements.projectState.dataset.state = state?.kind ?? "";
  if (elements.projectState.textContent !== label) elements.projectState.textContent = label;
  if (!selectedProjectId) return;
  const working = state?.kind === "working";
  for (const empty of document.querySelectorAll("#view-video .screening-empty")) {
    empty.classList.toggle("is-working", working);
    empty.querySelector("h3").textContent = working ? "Video đang thành hình" : "Chưa có video";
    let message = empty.querySelector(".screening-message");
    if (working && !message) {
      message = node("p", "Bản xem thử sẽ xuất hiện ở đây.", "screening-message");
      empty.querySelector("h3").after(message);
    }
    if (message) message.hidden = !working;
  }
}
document.querySelector("#production-view").addEventListener("viewerchange", syncViewer);
document.querySelector("#watch-button").addEventListener("click", async () => {
  const player = activeViewer();
  if (!player) return;
  if (!player.paused && !player.ended) player.pause();
  else { try { await player.play(); } catch { showError(new Error("Không thể phát video. Hãy thử mở lại dự án.")); } }
});

function renderFeaturedVideo() {
  const sequences = productionContext?.production?.sequences ?? [];
  elements.production.hidden = sequences.length === 0;
  elements.featuredVideo.hidden = sequences.length > 0;
  if (sequences.length) { syncViewer(); return; }
  const compositions = animationContext?.animation?.compositions ?? [];
  const ordered = [...compositions].sort((a, b) =>
    Number(b.role === "current") - Number(a.role === "current") || b.revision - a.revision);
  let selection = null;
  for (const composition of ordered) {
    const render = [...(composition.renders ?? [])].reverse().find((result) => result.files.some((file) => file.id === "primary" && file.available));
    const preview = [...(composition.previews ?? [])].reverse().find((result) => result.files.some((file) => file.available && file.mediaType === "video"));
    const result = render ?? preview;
    const file = result?.files.find((file) => file.available && (file.id === "primary" || file.mediaType === "video"));
    if (file) { selection = { composition, result, file, preview: !render }; break; }
  }
  const signature = JSON.stringify([selectedProjectId, selection?.result.resultId, selection?.file.id]);
  if (signature === featuredSignature) return;
  featuredSignature = signature;
  elements.featuredVideo.replaceChildren();
  elements.videoControls.replaceChildren();
  if (!selection) {
    const empty = node("div", undefined, "screening-empty");
    empty.append(createBrandArtwork(), node("h3", selectedProjectId ? "Chưa có video" : "Chưa có dự án"));
    if (!selectedProjectId) empty.append(node("p", "Tạo dự án trong cuộc trò chuyện để bắt đầu."));
    const browse = node("button", "Xem tư liệu", "soft-button");
    browse.type = "button";
    browse.addEventListener("click", () => setView("sources", { focus: true }));
    if (selectedProjectId) empty.append(browse);
    elements.featuredVideo.append(empty);
    syncViewer();
    return;
  }
  const { composition, result, file, preview } = selection;
  const card = node("article", undefined, "featured-film");
  const stage = node("div", undefined, "screening-stage");
  stage.style.setProperty("--video-ratio", composition.format.width / composition.format.height);
  stage.classList.toggle("is-portrait", composition.format.height > composition.format.width);
  const video = node("video", undefined, "featured-player");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.style.aspectRatio = composition.format.width + " / " + composition.format.height;
  video.setAttribute("aria-label", composition.name);
  video.src = resultFileUrl(selectedProjectId, result.resultId, file.id);
  const poster = result.files.find((file) => file.available && file.mediaType?.split("/")[0] === "image");
  if (poster) video.poster = resultFileUrl(selectedProjectId, result.resultId, poster.id);
  stage.append(video);
  card.append(stage);
  const caption = node("div", undefined, "featured-caption");
  const title = node("div");
  title.append(node("span", "Bản " + composition.revision));
  if (preview) title.append(node("p", previewClipDescription(result), "input-meta"));
  caption.append(title);
  elements.videoControls.replaceChildren(caption);
  if (preview) {
    const loopLabel = node("label", undefined, "animation-loop-control");
    const loop = node("input"); loop.type = "checkbox";
    loop.addEventListener("change", () => { video.loop = loop.checked; });
    loopLabel.append(loop, document.createTextNode(" Lặp đoạn xem thử"));
    caption.append(loopLabel);
  }
  elements.featuredVideo.append(card);
  syncViewer();
}

function renderProjectList(projects) {
  elements.projectCount.textContent = projects.length;
  const searchKey = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
  const query = searchKey(elements.search.value);
  const filtered = projects.filter((project) => searchKey(project.title).includes(query)).sort((left, right) =>
    Number(right.id === selectedProjectId) - Number(left.id === selectedProjectId) ||
    (Date.parse(right.updatedAt ?? right.createdAt) || 0) - (Date.parse(left.updatedAt ?? left.createdAt) || 0) ||
    left.title.localeCompare(right.title, "vi")
  );
  elements.projectList.replaceChildren(
    ...filtered.map((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = project.id === selectedProjectId ? "project-button is-active" : "project-button";
      button.dataset.projectId = project.id;
      if (project.id === selectedProjectId) button.setAttribute("aria-current", "true");
      button.title = project.title;
      const mark = node("span", undefined, "project-cover");
      mark.setAttribute("aria-hidden", "true");
      mark.append(node("span", project.title.slice(0, 1).toUpperCase(), "cover-letter"));
      const cover = projectCovers.get(project.id);
      if (cover?.generation === project.generation && cover.url) appendCover(mark, cover.url);
      const info = node("span", undefined, "project-button-info");
      const title = document.createElement("span");
      title.textContent = project.title;
      info.append(title);
      button.append(mark, info);
      button.addEventListener("click", () => {
        if (project.id === selectedProjectId) { closeSidebar({ restoreFocus: true }); return; }
        selectedProjectId = project.id;
        try { localStorage.setItem("padstudio-project", selectedProjectId); } catch { /* Optional UI preference. */ }
        const location = new URL(window.location.href);
        location.searchParams.set("project", project.id);
        window.history.replaceState(null, "", location);
        selectedItemPath = null;
        renderedPreviewKey = null;
        closeSidebar({ restoreFocus: true });
        renderProjectList([...projectsById.values()]);
        loadSelectedProject(project.generation).catch((error) => {
          if (error.name !== "AbortError") showError(error);
        });
      });
      return button;
    })
  );
  coverObserver.disconnect();
  for (const button of elements.projectList.querySelectorAll(".project-button")) coverObserver.observe(button);
  if (!filtered.length) elements.projectList.append(node("p", projects.length ? "Không tìm thấy dự án." : "Chưa có dự án.", "sidebar-empty"));
}

const projectCovers = new Map();
const coverQueue = [];
const queuedCovers = new Set();
let coverRequests = 0;
function appendCover(host, url) {
  if (host.querySelector("img")) return;
  const image = node("img"); image.alt = ""; image.loading = "lazy"; image.src = url;
  image.addEventListener("error", () => image.remove(), {once: true});
  host.append(image);
}
async function projectCover(project) {
  const read = async section => {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/observer/${section}`);
    if (!response.ok) return null;
    return (await response.json()).context;
  };
  const production = await read("production");
  const sequences = [...(production?.production?.sequences ?? [])].sort((a, b) =>
    Number(b.active) - Number(a.active) || b.revision - a.revision);
  for (const sequence of sequences) for (const render of [...sequence.renders].reverse()) {
    const mainSegment = [...sequence.segments].sort((a, b) => b.durationSeconds - a.durationSeconds)
      .find(segment => render.segments?.some(frame => frame.id === segment.id && frame.frameFileId));
    const frameId = render.segments?.find(frame => frame.id === mainSegment?.id)?.frameFileId;
    const file = render.files.find(file => file.available && file.id === frameId) ??
      render.files.find(file => file.available && file.mediaType?.split("/")[0] === "image");
    if (file) return resultFileUrl(project.id, render.resultId, file.id);
  }
  const animation = await read("animation");
  const compositions = [...(animation?.animation?.compositions ?? [])].sort((a, b) =>
    Number(b.role === "current") - Number(a.role === "current") || b.revision - a.revision);
  for (const composition of compositions) for (const result of [...(composition.renders ?? []), ...(composition.previews ?? [])].reverse()) {
    const file = result.files.find(file => file.available && file.mediaType?.split("/")[0] === "image");
    if (file) return resultFileUrl(project.id, result.resultId, file.id);
  }
  return null;
}
function drainCoverQueue() {
  while (coverRequests < 2 && coverQueue.length && document.body.classList.contains("sidebar-open")) {
    const project = coverQueue.shift();
    coverRequests++;
    projectCover(project).then(url => {
      projectCovers.set(project.id, {generation: project.generation, url});
      if (projectsById.get(project.id)?.generation !== project.generation) return;
      for (const button of elements.projectList.querySelectorAll(".project-button")) {
        if (button.dataset.projectId === project.id && url) appendCover(button.querySelector(".project-cover"), url);
      }
    }).catch(() => {}).finally(() => {
      coverRequests--; queuedCovers.delete(project.id); drainCoverQueue();
    });
  }
}
const coverObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const project = projectsById.get(entry.target.dataset.projectId);
    if (!project || queuedCovers.has(project.id) || projectCovers.get(project.id)?.generation === project.generation) continue;
    queuedCovers.add(project.id); coverQueue.push(project);
  }
  drainCoverQueue();
}, {root: elements.projectList, rootMargin: "100px"});

function showError(error) {
  elements.error.hidden = false;
  elements.error.querySelector("span").textContent = error.message;
  setConnection(false);
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
    elements.inputPreview.append(node("p", "Chưa có tư liệu.", "empty-note"));
    return;
  }

  const url = item.resultId ? resultFileUrl(projectId, item.resultId, item.fileId) : inputUrl(projectId, item);
  const heading = node("header", undefined, "asset-heading");
  const download = node("a", "Tải tư liệu", "asset-download");
  download.href = url; download.download = item.name;
  heading.append(node("h2", item.displayName ?? item.name), download);
  const host = node("div", undefined, "asset-media");
  elements.inputPreview.append(heading, host);
  const kind = item.mediaType?.split("/")[0];
  if (kind === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.name;
    host.append(image);
    return;
  }
  if (kind === "video" || kind === "audio") {
    const media = document.createElement(kind);
    media.src = url;
    media.controls = true;
    media.preload = "metadata";
    media.playsInline = true;
    host.append(media);
    return;
  }
  if (/\.(txt|md|srt|vtt)$/i.test(item.name)) {
    host.classList.add("asset-document");
    fetch(url).then(response => { if (!response.ok) throw new Error(); return response.text(); }).then(text => {
      if (renderedPreviewKey === previewKey) host.append(node("pre", text));
    }).catch(() => { if (renderedPreviewKey === previewKey) host.append(node("p", "Không thể mở file này.")); });
  } else if (/\.pdf$/i.test(item.name)) {
    const frame = node("iframe"); frame.src = url; frame.title = item.name; host.append(frame);
  } else host.append(node("span", item.name.split(".").at(-1).toUpperCase(), "asset-file-symbol"));
}

function renderCheckpoint(context) {
  const checkpoint = context.checkpoint;
  const expanded = elements.checkpoint.querySelector(".project-overview")?.open ?? false;
  elements.checkpoint.replaceChildren();
  const current = context.intelligence?.currentWorkItems ?? [];
  const active = current.find((item) => item.status === "in_progress") ?? current.find((item) => item.status === "awaiting_approval");
  const summary = node("div", undefined, "context-summary");
  summary.append(node("span", active ? "Đang thực hiện" : "Mục tiêu dự án", "context-label"), node("p", active?.title ?? checkpoint?.goal ?? "Ý tưởng, tư liệu và bản dựng được lưu cùng dự án của bạn.", "context-goal"));
  const pending = checkpoint?.pending ?? [];
  const next = node("div", undefined, "context-next");
  const stale = context.checkpointFreshness?.status === "stale";
  const approvals = context.intelligence?.pendingApprovals ?? [];
  if (approvals.length || (!stale && pending.length)) {
    next.append(node("span", "Cần bạn xem", "context-label"), node("p", !stale && pending[0] ? pending[0] : `${approvals.length} nội dung đang chờ quyết định.`));
    next.classList.add("is-waiting");
  } else if (checkpoint?.next && !stale) {
    next.append(node("span", "Tiếp theo", "context-label"), node("p", checkpoint.next));
  } else {
    next.append(node("span", "Không gian của bạn", "context-label"), node("p", "Xem bản dựng, khám phá tư liệu và theo dõi tiến độ."));
  }
  if (checkpoint) {
    const details = node("details", undefined, "context-details");
    details.append(node("summary", "Xem tổng quan"));
    if (stale) details.append(node("p", "Dự án đã có hoạt động mới sau bản tổng quan này.", "checkpoint-warning"));
    if (checkpoint.goal) details.append(node("p", checkpoint.goal));
    for (const [label, values] of [["Ràng buộc", checkpoint.constraints ?? []], ["Đang chờ", pending], ["Tiếp theo", checkpoint.next ? [checkpoint.next] : []]]) {
      if (!values.length) continue;
      const group = node("div", undefined, "context-group");
      const list = node("ul");
      list.append(...values.map((value) => node("li", value)));
      group.append(node("strong", label), list);
      details.append(group);
    }
    next.append(details);
  }
  const overview = node("details", undefined, "project-overview");
  overview.open = expanded;
  const heading = node("summary");
  const preview = node("span", approvals.length ? `${approvals.length} nội dung đang chờ bạn xem` : active?.title ?? checkpoint?.goal ?? "Ý tưởng, tư liệu và bản dựng của bạn.", "overview-preview");
  heading.append(node("strong", "Tổng quan dự án"), preview);
  overview.append(heading);
  const body = node("div", undefined, "overview-body");
  body.append(summary, next);
  overview.append(body);
  elements.checkpoint.append(overview);
}

function renderWorkflow(context) {
  const workflow = context.intelligence?.activeWorkflow;
  elements.workflow.closest("section").hidden = !workflow;
  if (!workflow) {
    elements.workflow.textContent = "Chưa có kế hoạch công việc.";
    return;
  }

  const header = document.createElement("div");
  header.className = "workflow-header";
  const identity = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = workflow.name;
  const meta = document.createElement("span");
  meta.className = "input-meta";
  meta.textContent = `Phiên bản ${workflow.revision}`;
  meta.title = workflow.changeReason;
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
    status.textContent = { planned: "Dự kiến", ready: "Sẵn sàng", in_progress: "Đang làm", completed: "Hoàn tất", blocked: "Đang chờ", awaiting_approval: "Chờ duyệt", skipped: "Bỏ qua", cancelled: "Đã hủy" }[item.status] ?? item.status;
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
    const technical = node("details", undefined, "work-details");
    technical.append(node("summary", "Chi tiết"), flags);
    card.append(top, detail, technical);
    return card;
  }));
  elements.workflow.replaceChildren(header, items);
}

function renderIntelligence(context) {
  const artifacts = context.intelligence?.activeArtifacts ?? [];
  if (!artifacts.length) {
    elements.artifactList.textContent = "Chưa có tài liệu.";
  } else {
    elements.artifactList.replaceChildren(...artifacts.map((artifact) => {
      const card = document.createElement("article");
      card.className = "intelligence-card";
      const name = document.createElement("strong");
      name.textContent = artifact.name;
      const type = document.createElement("span");
      type.className = "input-meta";
      type.textContent = `Phiên bản ${artifact.revision}`;
      type.title = artifact.type;
      const summary = document.createElement("p");
      summary.textContent = artifact.summary;
      card.append(name, type, summary);
      return card;
    }));
  }
  const reviews = context.intelligence?.latestReviews ?? [];
  const blocks = [];
  if (reviews.length) {
    const block = document.createElement("div");
    block.className = "intelligence-card";
    const heading = document.createElement("strong");
    heading.textContent = "Đánh giá gần nhất";
    const list = document.createElement("ul");
    list.replaceChildren(...reviews.map((review) => {
      const item = document.createElement("li");
      const coverage = reviewInspectionLabel(review);
      item.textContent = `${review.perspective} · ${review.verdict}${coverage} — ${review.summary}`;
      return item;
    }));
    block.append(heading, list);
    blocks.push(block);
  }
  elements.reviewList.replaceChildren(...blocks);
}

function renderResources(context) {
  const allItems = context.resources.flatMap(resource => resource.items.map(item => ({...item,
    displayName: resource.items.length === 1 ? resource.name : item.name
  })));
  const usedResults = new Map();
  const collect = (value, title) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "result" && typeof value.id === "string") usedResults.set(value.id, title);
    else for (const child of Object.values(value)) collect(child, title);
  };
  if (productionContext?.project.id === context.project.id) {
    for (const sequence of productionContext.production?.sequences ?? []) {
      if (!sequence.active) continue;
      for (const segment of sequence.segments) collect(segment, segment.title);
      collect(sequence.music, "Nhạc nền"); collect(sequence.audio, "Âm thanh");
    }
  }
  for (const result of context.results ?? []) {
    if (result.type !== "media.acquired" && !usedResults.has(result.id)) continue;
    if (result.type === "audio.tts") continue;
    const file = result.files?.find(file => file.id === "primary");
    const kind = file?.mediaType?.split("/")[0];
    if (!file || !["image", "video", "audio"].includes(kind)) continue;
    allItems.push({path: "result:" + result.id + ":" + file.id, name: file.name,
      displayName: result.type === "audio.tts" ? usedResults.get(result.id) + " — lời đọc" : result.name,
      mediaType: kind, available: file.available !== false, modifiedAt: result.createdAt,
      resultId: result.id, fileId: file.id});
  }
  if (!allItems.some(item => item.path === selectedItemPath && item.available)) {
    selectedItemPath = (allItems.find(item => item.available && ["video", "image", "audio"].includes(item.mediaType?.split("/")[0]))
      ?? allItems.find(item => item.available))?.path ?? null;
  }
  document.querySelector("#all-resources").classList.toggle("is-empty", !allItems.length);
  elements.resourceList.replaceChildren();
  for (const item of allItems) {
    const button = node("button", undefined, "input-button");
    button.type = "button"; button.disabled = !item.available;
    button.dataset.path = item.path; button.dataset.searchText = item.displayName;
    const mark = node("span", {video: "▶", audio: "♪", image: "▧"}[item.mediaType?.split("/")[0]] ?? "≡", "asset-thumb");
    mark.setAttribute("aria-hidden", "true");
    if (item.available && item.mediaType?.split("/")[0] === "image") {
      const image = node("img"); image.alt = ""; image.loading = "lazy";
      image.src = item.resultId ? resultFileUrl(context.project.id, item.resultId, item.fileId) : inputUrl(context.project.id, item);
      mark.replaceChildren(image);
    }
    button.append(mark, node("span", item.displayName, "input-name"));
    if (!item.available) button.append(node("span", "Thiếu file", "input-meta"));
    button.classList.toggle("is-active", item.path === selectedItemPath);
    button.addEventListener("click", () => {
      selectedItemPath = item.path;
      for (const candidate of elements.resourceList.querySelectorAll("button")) candidate.classList.toggle("is-active", candidate === button);
      renderPreview(context.project.id, item);
    });
    elements.resourceList.append(button);
  }
  const empty = node("p", "Không tìm thấy tư liệu.", "asset-filter-empty");
  elements.resourceList.append(empty);
  const search = document.querySelector("#asset-search");
  const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
  search.oninput = () => {
    const query = normalize(search.value);
    for (const button of elements.resourceList.querySelectorAll("button")) button.hidden = !normalize(button.dataset.searchText).includes(query);
    empty.hidden = !!elements.resourceList.querySelector("button:not([hidden])");
  };
  search.oninput();
  renderPreview(context.project.id, allItems.find(item => item.path === selectedItemPath));
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
  const cards = context.runs.slice(0, 20).map((run) => {
    const card = document.createElement("article");
    card.className = "run-card";
    const top = document.createElement("div");
    const capability = document.createElement("strong");
    capability.textContent = run.purpose || run.capability;
    capability.title = run.capability;
    const status = document.createElement("span");
    const recovery = pendingFinalizations.get(run.id);
    const displayedStatus = recovery?.recoverable ? "finalization_pending" : run.status;
    status.className = `run-status status-${displayedStatus}`;
    status.textContent = { completed: "Hoàn tất", succeeded: "Hoàn tất", failed: "Có lỗi", running: "Đang chạy", in_progress: "Đang chạy", queued: "Đang chờ", cancelled: "Đã hủy", finalization_pending: "Chờ hoàn tất" }[displayedStatus] ?? displayedStatus;
    top.append(capability, status);
    const time = document.createElement("span");
    time.className = "input-meta";
    time.textContent = formatDate(run.startedAt);
    card.append(top);
    card.append(time);
    const technical = node("details", undefined, "run-details");
    technical.append(node("summary", "Chi tiết lần chạy"));
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
      technical.append(details);
    }
    technical.append(node("p", `${formatDate(run.startedAt)} → ${formatDate(run.finishedAt)}`, "input-meta"));
    if (recovery?.recoverable) {
      const recoveryNote = document.createElement("p");
      recoveryNote.className = "run-warning";
      recoveryNote.textContent =
        "Kết quả đã được bảo toàn; lần chạy đang chờ hoàn tất.";
      card.append(recoveryNote);
    }
    if (run.error) {
      const error = document.createElement("p");
      error.className = "run-error";
      error.textContent = run.error;
      technical.append(error);
    }
    card.append(technical);
    return card;
  });
  elements.runList.replaceChildren(...cards.slice(0, 5));
  if (cards.length > 5) {
    const history = node("details", undefined, "run-history");
    history.append(node("summary", "Hoạt động trước đó · " + (cards.length - 5)), ...cards.slice(5));
    elements.runList.append(history);
  }
}

function renderSummary(context) {
  summaryContext = context;
  elements.title.textContent = context.project.title;
  document.title = context.project.title + " · PADStudio";
  elements.projectId.textContent = context.project.updatedAt ? "Cập nhật " + formatDate(context.project.updatedAt) : "";
  elements.projectId.title = context.project.id;
  syncProjectState();
  renderCheckpoint(context);
  renderWorkflow(context);
  renderIntelligence(context);
}

function sectionPlaceholder(element, label) {
  element.textContent = "Đang tải…";
  element.classList.add("observer-placeholder");
}

function clearSectionPlaceholder(element) {
  element.classList.remove("observer-placeholder");
}

function renderObserverSection(section, context) {
  if (section === "source") {
    clearSectionPlaceholder(elements.sourceAnalysis);
    renderSourceAnalysis(elements.sourceAnalysis, context);
    document.querySelector("#source-insights").hidden = !context.analysis?.sources?.length;
  } else if (section === "creative") {
    clearSectionPlaceholder(elements.creativeDirection);
    renderCreativeDirection(elements.creativeDirection, context);
  } else if (section === "production") {
    productionContext = context;
    clearSectionPlaceholder(elements.production);
    renderProduction(elements.production, context, elements.videoControls, elements.videoChapters);
    renderFeaturedVideo();
    if (currentView === "sources" && activityContext?.project.id === context.project.id) renderResources(activityContext);
  } else if (section === "animation") {
    animationContext = context;
    clearSectionPlaceholder(elements.animation);
    renderAnimation(elements.animation, context);
    renderFeaturedVideo();
  } else if (section === "delivery") {
    clearSectionPlaceholder(elements.delivery);
    renderDelivery(elements.delivery, context);
    document.querySelector("#delivery-section").hidden = !(context.delivery?.bundles?.length);
  } else if (section === "health") {
    clearSectionPlaceholder(elements.health);
    renderHealth(elements.health, context);
  } else if (section === "activity") {
    activityContext = context;
    syncProjectState();
    if (currentView === "sources") {
      clearSectionPlaceholder(elements.resourceList);
      renderResources(context);
    }
    if (document.querySelector("#result-details").open) renderResults(context);
    if (currentView === "activity") renderRuns(context);
  }
}

function renderEmpty() {
  clearProduction(elements.production, elements.videoControls, elements.videoChapters);
  clearDelivery(elements.delivery);
  clearHealth(elements.health);
  clearSourceAnalysis(elements.sourceAnalysis);
  clearCreativeDirection(elements.creativeDirection);
  clearAnimation(elements.animation);
  elements.title.textContent = "Chào mừng đến PADStudio";
  document.title = "PADStudio";
  elements.projectId.textContent = "";
  elements.projectState.hidden = true;
  elements.checkpoint.textContent = "Bắt đầu một dự án trong cuộc trò chuyện của bạn. Tư liệu và bản dựng sẽ có mặt ở đây.";
  elements.workflow.textContent = "Chưa có kế hoạch công việc.";
  elements.artifactList.textContent = "Chưa có tài liệu.";
  elements.reviewList.replaceChildren();
  elements.resourceList.textContent = "Chưa có tư liệu.";
  document.querySelector("#all-resources").classList.add("is-empty");
  document.querySelector("#source-insights").hidden = true;
  elements.resultList.textContent = "Chưa có kết quả nào.";
  elements.runList.textContent = "Chưa có lần chạy nào.";
  renderPreview("", null);
  document.querySelector("#delivery-section").hidden = true;
  animationContext = null;
  productionContext = null;
  activityContext = null;
  summaryContext = null;
  featuredSignature = null;
  renderFeaturedVideo();
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
const loadedSections = new Set();

function resetProjectSections() {
  document.querySelector("#asset-search").value = "";
  loadedSections.clear();
  animationContext = null;
  productionContext = null;
  activityContext = null;
  summaryContext = null;
  featuredSignature = null;
  elements.featuredVideo.replaceChildren();
  elements.featuredVideo.hidden = false;
  elements.production.hidden = false;
  elements.title.textContent = projectsById.get(selectedProjectId)?.title ?? "Đang mở dự án…";
  elements.projectId.textContent = "";
  elements.projectState.hidden = true;
  elements.checkpoint.replaceChildren();
  elements.workflow.replaceChildren();
  elements.artifactList.replaceChildren();
  elements.reviewList.replaceChildren();
  renderedResultsKey = null;
  document.querySelector("#delivery-section").hidden = true;
  for (const controller of sectionControllers.values()) controller.abort();
  sectionControllers.clear();
  sectionEtags.clear();
  sectionGenerations.clear();
  sectionLoads.clear();
  clearProduction(elements.production, elements.videoControls, elements.videoChapters);
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
  elements.resultList.textContent = "Đang tải…";
  elements.runList.textContent = "Đang tải…";
  elements.inputPreview.replaceChildren();
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
  const sections = new Set(["summary", "animation", "production", "delivery", "activity", ...viewSections[currentView], ...loadedSections]);
  await Promise.all([...sections].map((section) => loadSection(section, generation)));
}

async function loadProjects() {
  if (listRequestRunning) return;
  listRequestRunning = true;
  try {
    const headers = {};
    if (projectsEtag) headers["If-None-Match"] = projectsEtag;
    const response = await fetch("/api/projects", { headers });
    if (response.status === 304) { setConnection(true); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Không thể đọc danh sách project.");
    setConnection(true);
    elements.error.hidden = true;
    projectsEtag = response.headers.get("etag");
    projectsById = new Map(body.projects.map((project) => [project.id, project]));
    if (!projectsById.has(selectedProjectId)) {
      selectedProjectId = [...body.projects].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id ?? null;
      selectedItemPath = null;
      renderedPreviewKey = null;
    }
    renderProjectList(body.projects);
    if (!selectedProjectId) return renderEmpty();
    try { localStorage.setItem("padstudio-project", selectedProjectId); } catch { /* Optional UI preference. */ }
    await loadSelectedProject(projectsById.get(selectedProjectId).generation);
  } finally {
    listRequestRunning = false;
  }
}

elements.search.addEventListener("input", () => renderProjectList([...projectsById.values()]));
for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => setView(button.dataset.view));
  button.addEventListener("keydown", (event) => {
    const views = [...document.querySelectorAll(".workspace-tab")].map(tab => tab.dataset.view);
    const index = views.indexOf(currentView);
    let next;
    if (event.key === "ArrowRight") next = views[(index + 1) % views.length];
    if (event.key === "ArrowLeft") next = views[(index + views.length - 1) % views.length];
    if (event.key === "Home") next = views[0];
    if (event.key === "End") next = views.at(-1);
    if (next) { event.preventDefault(); setView(next, { focus: true }); }
  });
}
document.querySelector("#sidebar-toggle").addEventListener("click", () => {
  if (document.body.classList.contains("sidebar-open")) { closeSidebar(); return; }
  document.body.classList.add("sidebar-open");
  document.querySelector("#main-content").inert = true;
  document.querySelector("#project-pane").inert = false;
  document.querySelector("#project-pane").hidden = false;
  document.querySelector("#sidebar-backdrop").hidden = false;
  document.querySelector("#sidebar-toggle").setAttribute("aria-expanded", "true");
  elements.search.focus();
  drainCoverQueue();
});
document.querySelector(".brand").addEventListener("click", event => {
  event.preventDefault(); document.querySelector("#sidebar-toggle").click();
});
document.querySelector("#sidebar-backdrop").addEventListener("click", () => {
  closeSidebar({ restoreFocus: true });
});
document.querySelector("#project-picker-close").addEventListener("click", () => closeSidebar({ restoreFocus: true }));
document.addEventListener("click", event => {
  const menu = document.querySelector("#project-menu");
  if (!menu.contains(event.target)) menu.open = false;
});
document.querySelector("#result-details").addEventListener("toggle", (event) => {
  if (event.target.open && activityContext) renderResults(activityContext);
});
document.addEventListener("toggle", (event) => {
  if (event.target instanceof HTMLDetailsElement && !event.target.open) {
    for (const media of event.target.querySelectorAll("video, audio")) media.pause();
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector("#project-menu").open) {
    document.querySelector("#project-menu").open = false;
    document.querySelector("#project-menu summary").focus();
  }
  if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) {
    closeSidebar({ restoreFocus: true });
  }
  if (event.key === "Tab" && document.body.classList.contains("sidebar-open")) {
    const focusable = [...document.querySelectorAll('#project-pane button:not(:disabled), #project-pane input')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
closeSidebar();
const themeButton = document.querySelector("#theme-toggle");
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  themeButton.setAttribute("aria-label", theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối");
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#171817" : "#f7f7f5";
}
try { applyTheme(localStorage.getItem("padstudio-theme") === "dark" ? "dark" : "light"); }
catch { applyTheme("light"); }
themeButton.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try { localStorage.setItem("padstudio-theme", theme); } catch { /* Optional browser preference. */ }
});
async function refresh() {
  const button = document.querySelector("#refresh-button");
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add("is-refreshing");
  elements.error.hidden = true;
  try {
    await loadProjects();
    if (selectedProjectId) await Promise.all(["summary", "activity", ...new Set([...viewSections.video, ...viewSections[currentView]])].map((section) => {
      sectionGenerations.delete(`${selectedProjectId}:${section}`);
      return loadSection(section);
    }));
    setConnection(true);
  } catch (error) { if (error.name !== "AbortError") showError(error); }
  finally { button.disabled = false; button.classList.remove("is-refreshing"); }
}
document.querySelector("#refresh-button").addEventListener("click", refresh);
document.querySelector("#retry-button").addEventListener("click", refresh);
setView(currentView, { updateUrl: false });
loadProjects().catch(showError);
window.setInterval(() => loadProjects().catch((error) => { if (error.name !== "AbortError") showError(error); }), 2_000);
