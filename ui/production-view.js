let lastSignature = null;
const choices = new Map();
const selectedSequences = new Map();
const chapterListeners = new WeakMap();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function createBrandArtwork() {
  const image = node("img", undefined, "brand-art");
  image.src = "/brand/padstudio-emblem-transparent.png";
  image.width = 1254;
  image.height = 1254;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
}
function fileUrl(projectId, resultId, fileId) {
  return "/project-results/" + [projectId, resultId, fileId].map(encodeURIComponent).join("/");
}
export function productionRenderOptions(revisions) {
  return revisions.flatMap(sequence => sequence.renders.map(render => ({
    artifactId: sequence.artifactId, revision: sequence.revision,
    resultId: render.resultId, createdAt: render.createdAt
  })));
}
export function feedbackForSegment(render, segmentId = null) {
  return (render?.decisions ?? []).filter(decision => segmentId === null
    ? !decision.feedbackTarget?.segmentId : decision.feedbackTarget?.segmentId === segmentId);
}
export function creativeReviewStatus(render) {
  return (render?.reviews ?? []).some(review => ["creative", "combined"].includes(review.perspective)
    && ["passed", "passed_with_notes"].includes(review.verdict)) ? "reviewed" : "missing";
}
export function viewerProjectState(summary, activity = null) {
  const runs = [...(activity?.runs ?? [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const recovery = new Set((activity?.runRecovery?.pendingFinalizations ?? [])
    .filter(entry => entry.recoverable).map(entry => entry.runId));
  const running = runs.find(run => ["in_progress", "running"].includes(run.status) && !recovery.has(run.id));
  if (running) {
    const capability = running.capability ?? "";
    let label = "Đang thực hiện";
    if (capability === "video.export-delivery") label = "Đang chuẩn bị bản tải xuống";
    else if (/^(video\.(render|concat|reformat|trim)|animation\.(render|preview))/.test(capability)) label = "Đang dựng video";
    else if (capability === "tts.synthesize" || capability.startsWith("audio.tts")) label = "Đang tạo giọng đọc";
    else if (/^(video\.inspect|animation\.(validate|preflight))/.test(capability)) label = "Đang kiểm tra video";
    else if (capability.startsWith("animation.")) label = "Đang dựng hoạt họa";
    else if (/^(source\.|media\.|audio\.|video\.(detect|thumbnail))/.test(capability)) label = "Đang chuẩn bị tư liệu";
    return { kind: "working", label };
  }
  const current = summary?.intelligence?.currentWorkItems ?? [];
  if (current.some(item => item.status === "in_progress")) return { kind: "working", label: "Đang thực hiện" };
  if (summary?.intelligence?.pendingApprovals?.length) return { kind: "waiting", label: "Chờ bạn xem" };
  if (current.some(item => item.status === "blocked") || runs.some(run => recovery.has(run.id))) {
    return { kind: "waiting", label: "Chờ tiếp tục" };
  }
  if (current.some(item => item.status === "awaiting_review")) return { kind: "waiting", label: "Chờ kiểm tra" };
  return null;
}

export function defaultVideoRevision(revisions) {
  const playable = sequence => sequence.renders.some(render => render.files?.some(file => file.id === "primary" && file.available));
  const active = revisions.find(sequence => sequence.active) ?? revisions.at(-1);
  return (active && playable(active) ? active : [...revisions].reverse().find(playable)) ?? active;
}

export function defaultVideoRender(sequence) {
  return [...sequence.renders].reverse().find(render => render.files?.some(file => file.id === "primary" && file.available)) ?? sequence.renders.at(-1);
}
function clock(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
}
function revisionPanel(context, sequence, render, comparison = false, chapterHost = null, includeChapters = true, players = new Map()) {
  const panel = node("article", undefined, "sequence-panel");
  const stage = node("div", undefined, "screening-stage");
  stage.style.setProperty("--video-ratio", sequence.format.width / sequence.format.height);
  stage.classList.toggle("is-portrait", sequence.format.height > sequence.format.width);
  const primary = render?.files.find(file => file.id === "primary" && file.available);
  let video = null;
  if (primary) {
    const url = fileUrl(context.project.id, render.resultId, primary.id);
    video = players.get(url) ?? node("video", undefined, "result-video");
    players.delete(url);
    video.controls = true; video.preload = "metadata"; video.playsInline = true;
    video.setAttribute("aria-label", sequence.name + " · Bản " + sequence.revision);
    if (video.getAttribute("src") !== url) video.src = url;
    const previousListener = chapterListeners.get(video);
    if (previousListener) video.removeEventListener("timeupdate", previousListener);
    const poster = render.files.find(file => file.id === render.segments?.[0]?.frameFileId && file.available);
    if (poster) video.poster = fileUrl(context.project.id, render.resultId, poster.id);
    stage.append(video);
  } else if (!render) {
    stage.className = "screening-empty";
    stage.append(createBrandArtwork(), node("h3", "Chưa có video"));
  } else stage.append(node("p", "Video không còn khả dụng.", "empty-note"));
  panel.append(stage);
  if (comparison) panel.prepend(node("h3", "Bản " + sequence.revision, "comparison-caption"));
  const latest = feedbackForSegment(render).at(-1);
  if (latest?.note && ["changes_requested", "rejected"].includes(latest.outcome)) {
    panel.append(node("p", latest.note, "viewer-feedback"));
  }
  if (sequence.segments.length > 1 && video && includeChapters) {
    const scenes = node("nav", undefined, "chapter-strip");
    scenes.setAttribute("aria-label", "Các đoạn trong video");
    let elapsed = 0;
    for (const segment of sequence.segments) {
      const range = sequence.timeline?.find(item => item.track === "Hình" && item.segmentId === segment.id);
      const start = range?.startSeconds ?? elapsed;
      elapsed += segment.durationSeconds;
      const button = node("button", undefined, "chapter-button");
      button.type = "button"; button.dataset.startSeconds = String(start);
      button.setAttribute("aria-label", segment.title + " · " + clock(start));
      const frame = render.files.find(file => file.id === render.segments?.find(item => item.id === segment.id)?.frameFileId && file.available);
      if (frame) {
        const image = node("img"); image.loading = "lazy"; image.alt = "";
        image.src = fileUrl(context.project.id, render.resultId, frame.id); button.append(image);
      }
      button.append(node("span", clock(start), "chapter-time"), node("span", segment.title, "chapter-title"));
      button.addEventListener("click", () => { video.currentTime = start; });
      scenes.append(button);
    }
    const chapters = [...scenes.children];
    let currentChapter = null;
    const markCurrentChapter = () => {
      const current = chapters.findLast(button => Number(button.dataset.startSeconds) <= video.currentTime);
      if (current === currentChapter) return;
      currentChapter?.classList.remove("is-active");
      currentChapter?.removeAttribute("aria-current");
      current?.classList.add("is-active");
      current?.setAttribute("aria-current", "true");
      currentChapter = current;
    };
    video.addEventListener("timeupdate", markCurrentChapter);
    chapterListeners.set(video, markCurrentChapter);
    markCurrentChapter();
    if (chapterHost) {
      const details = node("details", undefined, "viewer-disclosure chapter-menu");
      details.append(node("summary", "Các đoạn"), scenes);
      chapterHost.append(details);
    } else panel.append(scenes);
  }
  return panel;
}

export function renderProduction(container, context, toolbar = null, chapterHost = null) {
  const signature = JSON.stringify([context.project.id, context.production]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  const playersBySequence = new Map([...container.querySelectorAll(".sequence-group")].map(group =>
    [group.dataset.sequenceKey, new Map([...group.querySelectorAll("video")].map(video => [video.getAttribute("src"), video]))]));
  container.replaceChildren();
  const sequences = context.production?.sequences ?? [];
  if (!sequences.length) return;
  toolbar?.replaceChildren();
  chapterHost?.replaceChildren();
  const keys = [...new Set(sequences.map(sequence => sequence.key))].sort((left, right) =>
    Number(sequences.some(sequence => sequence.key === right && sequence.role === "current")) -
    Number(sequences.some(sequence => sequence.key === left && sequence.role === "current")));
  const groups = [];
  for (const key of keys) {
    const players = playersBySequence.get(key) ?? new Map();
    const revisions = sequences.filter(sequence => sequence.key === key).sort((left, right) => left.revision - right.revision);
    const options = productionRenderOptions(revisions);
    const storageKey = context.project.id + ":" + key;
    const saved = choices.get(storageKey) ?? {};
    const group = node("section", undefined, "sequence-group"); group.dataset.sequenceKey = key;
    const controls = node("div", undefined, "sequence-controls"); controls.dataset.sequenceKey = key;
    const revisionSelect = node("select"); revisionSelect.setAttribute("aria-label", "Chọn bản video");
    const resultSelect = node("select"); resultSelect.setAttribute("aria-label", "Chọn lần dựng");
    const compareSelect = node("select"); compareSelect.setAttribute("aria-label", "Chọn bản so sánh");
    const date = value => new Intl.DateTimeFormat("vi", {day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit"}).format(new Date(value));
    for (const revision of revisions) revisionSelect.append(new Option("Bản " + revision.revision, revision.artifactId));
    compareSelect.append(new Option("So sánh…", ""));
    for (const option of options) compareSelect.append(new Option("Bản " + option.revision + " · " + date(option.createdAt), option.resultId));
    revisionSelect.value = saved.manualRevision && revisions.some(sequence => sequence.artifactId === saved.selected) ? saved.selected
      : defaultVideoRevision(revisions).artifactId;
    function populateResults() {
      const chosen = revisions.find(sequence => sequence.artifactId === revisionSelect.value);
      resultSelect.replaceChildren();
      resultSelect.disabled = !chosen.renders.length;
      if (!chosen.renders.length) resultSelect.append(new Option("Chưa có video", ""));
      for (const [index, render] of chosen.renders.entries()) resultSelect.append(new Option("Lần " + (index + 1) + " · " + date(render.createdAt), render.resultId));
      if (chosen.renders.length) resultSelect.value = saved.manualResult && chosen.renders.some(render => render.resultId === saved.resultId)
        ? saved.resultId : defaultVideoRender(chosen).resultId;
      resultSelect.hidden = chosen.renders.length < 2;
    }
    compareSelect.className = "comparison-select";
    compareSelect.hidden = options.length < 2;
    const status = node("span", undefined, "viewer-status");
    controls.append(revisionSelect, resultSelect, compareSelect, status);
    const panels = node("div", undefined, "sequence-panels");
    const chapterSection = node("div", undefined, "sequence-chapters");
    chapterSection.dataset.sequenceKey = key;
    chapterHost?.append(chapterSection);
    function refresh() {
      const chosen = revisions.find(sequence => sequence.artifactId === revisionSelect.value);
      const render = chosen.renders.find(candidate => candidate.resultId === resultSelect.value) ?? null;
      const comparisonOption = options.find(option => option.resultId === compareSelect.value && option.resultId !== render?.resultId);
      const baseline = comparisonOption ? revisions.find(sequence => sequence.artifactId === comparisonOption.artifactId) : null;
      const baselineRender = baseline?.renders.find(candidate => candidate.resultId === comparisonOption.resultId);
      choices.set(storageKey, {selected: revisionSelect.value, resultId: render?.resultId ?? null, compareResultId: baselineRender?.resultId ?? null,
        manualRevision: !!saved.manualRevision, manualResult: !!saved.manualResult});
      const decision = feedbackForSegment(render).at(-1);
      status.textContent = {accepted: "Đã duyệt", changes_requested: "Cần sửa", rejected: "Đã loại"}[decision?.outcome] ?? "";
      status.hidden = !status.textContent;
      status.classList.toggle("is-warning", decision?.outcome !== "accepted");
      chapterSection.replaceChildren();
      const availablePlayers = new Map([...players, ...[...panels.querySelectorAll("video")].map(video => [video.getAttribute("src"), video])]);
      panels.replaceChildren(revisionPanel(context, chosen, render, !!baselineRender, chapterHost ? chapterSection : null, true, availablePlayers));
      if (baselineRender) panels.append(revisionPanel(context, baseline, baselineRender, true, null, false, availablePlayers));
      for (const video of availablePlayers.values()) video.pause();
      players.clear();
      container.dispatchEvent(new CustomEvent("viewerchange", {bubbles: true}));
    }
    revisionSelect.addEventListener("change", () => { saved.manualRevision = true; saved.manualResult = false; saved.resultId = null; populateResults(); refresh(); });
    resultSelect.addEventListener("change", () => { saved.manualRevision = saved.manualResult = true; saved.resultId = resultSelect.value; refresh(); });
    compareSelect.addEventListener("change", refresh);
    populateResults(); compareSelect.value = options.some(option => option.resultId === saved.compareResultId) ? saved.compareResultId : "";
    if (toolbar) toolbar.append(controls); else group.append(controls);
    group.append(panels); container.append(group); refresh();
    groups.push({key, group, controls, chapters: chapterSection, name: revisions.at(-1).name});
  }
  const select = node("select"); select.setAttribute("aria-label", "Chọn video trong dự án");
  for (const item of groups) select.append(new Option(item.name, item.key));
  const savedKey = selectedSequences.get(context.project.id);
  select.value = keys.includes(savedKey) ? savedKey : keys[0];
  const switchSequence = () => {
    selectedSequences.set(context.project.id, select.value);
    for (const item of groups) {
      item.group.hidden = item.controls.hidden = item.chapters.hidden = item.key !== select.value;
      if (item.group.hidden) for (const video of item.group.querySelectorAll("video")) video.pause();
    }
    container.dispatchEvent(new CustomEvent("viewerchange", {bubbles: true}));
  };
  select.addEventListener("change", switchSequence);
  if (groups.length > 1) {
    const switcher = node("div", undefined, "film-switcher"); switcher.append(select);
    (toolbar ?? container).prepend(switcher);
  }
  switchSequence();
}
export function clearProduction(container, toolbar = null, chapterHost = null) {
  lastSignature = null; container.replaceChildren(); toolbar?.replaceChildren(); chapterHost?.replaceChildren();
}
