import { ICONS, clock, formatDateTime, formatSize, node, orientationLabel, relativeTime, resultFileUrl, svgIcon } from "./dom.js";
import { previewClipDescription } from "./animation-view.js";

// Which revision/render the viewer chose for each film, remembered while the page stays open.
const choices = new Map();
const selectedFilm = new Map();
const chapterListeners = new WeakMap();
let lastSignature = null;

export function createBrandArtwork() {
  const image = node("img", undefined, "brand-art");
  image.src = "/brand/padstudio-mark-large.webp";
  image.width = 640;
  image.height = 335;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
}

/* ------------------------------------------------------------------------------------------------ */
/* Pure helpers (also used by tests)                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export function productionRenderOptions(revisions) {
  return revisions.flatMap((sequence) => sequence.renders.map((render) => ({
    artifactId: sequence.artifactId, revision: sequence.revision,
    resultId: render.resultId, createdAt: render.createdAt
  })));
}

export function feedbackForSegment(render, segmentId = null) {
  return (render?.decisions ?? []).filter((decision) => segmentId === null
    ? !decision.feedbackTarget?.segmentId : decision.feedbackTarget?.segmentId === segmentId);
}

export function creativeReviewStatus(render) {
  return (render?.reviews ?? []).some((review) => ["creative", "combined"].includes(review.perspective)
    && ["passed", "passed_with_notes"].includes(review.verdict)) ? "reviewed" : "missing";
}

const playable = (render) => render.files?.some((file) => file.id === "primary" && file.available);

export function defaultVideoRevision(revisions) {
  const hasVideo = (sequence) => sequence.renders.some(playable);
  const active = revisions.find((sequence) => sequence.active) ?? revisions.at(-1);
  return (active && hasVideo(active) ? active : [...revisions].reverse().find(hasVideo)) ?? active;
}

export function defaultVideoRender(sequence) {
  return [...sequence.renders].reverse().find(playable) ?? sequence.renders.at(-1);
}

function timecode(seconds) {
  return Number(seconds).toFixed(3);
}

// The segment of the exact timeline whose picture track covers `seconds`; the last segment owns its end.
export function segmentAtTime(sequence, seconds) {
  const rows = (sequence?.timeline ?? []).filter((item) => item.track === "Hình" && item.segmentId);
  if (!rows.length || !Number.isFinite(seconds) || seconds < 0) return null;
  const row = rows.find((item) => seconds >= item.startSeconds && seconds < item.endSeconds) ??
    (seconds <= rows.at(-1).endSeconds ? rows.at(-1) : null);
  if (!row) return null;
  const segment = (sequence.segments ?? []).find((item) => item.id === row.segmentId);
  return { id: row.segmentId, title: segment?.title ?? row.segmentId, startSeconds: row.startSeconds, endSeconds: row.endSeconds };
}

// Text a user pastes into the Agent chat to point at an exact Result, and optionally a moment in it.
// `segment`/`time` give the segment range; `at` is the playhead inside that range.
export function feedbackAnchorText({ projectId, sequence, render, currentTime = 0 }) {
  const parts = [
    "project=" + projectId, "result=" + render.resultId,
    "artifact=" + sequence.artifactId, "revision=" + sequence.revision
  ];
  const duration = Number(sequence.durationSeconds);
  const at = Number.isFinite(currentTime) && currentTime > 0
    ? (Number.isFinite(duration) && duration > 0 ? Math.min(currentTime, duration) : currentTime) : 0;
  if (at > 0) {
    const segment = segmentAtTime(sequence, at);
    if (segment) parts.push("segment=" + segment.id, "time=" + timecode(segment.startSeconds) + "-" + timecode(segment.endSeconds));
    parts.push("at=" + timecode(at));
  }
  return parts.join(" · ");
}

const OUTCOME_LABELS = Object.freeze({ accepted: "Đã duyệt", changes_requested: "Cần sửa", rejected: "Đã loại" });

/**
 * What the viewer should read as "feedback" for the shown render: every decision about it, newest first, with
 * change requests marked resolved when a later acceptance (of any render of the film) resolved them.
 */
export function feedbackItems(sequences, render) {
  const resolved = new Set(sequences.flatMap((sequence) => sequence.renders)
    .flatMap((candidate) => candidate.decisions ?? []).flatMap((decision) => decision.resolvesDecisionIds ?? []));
  return [...(render?.decisions ?? [])].reverse().map((decision) => ({
    id: decision.id,
    outcome: decision.outcome,
    label: OUTCOME_LABELS[decision.outcome] ?? decision.outcome,
    note: decision.note ?? "",
    createdAt: decision.createdAt,
    segmentId: decision.feedbackTarget?.segmentId ?? null,
    startSeconds: decision.feedbackTarget?.timeRange?.startSeconds ?? null,
    endSeconds: decision.feedbackTarget?.timeRange?.endSeconds ?? null,
    pending: decision.outcome === "changes_requested" && !resolved.has(decision.id)
  }));
}

/** Download links for the newest delivery bundle: the exact approved video (and audio) it holds. */
export function deliveryDownloads(delivery, projectId) {
  const bundle = [...(delivery?.bundles ?? [])].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!bundle) return [];
  return bundle.files
    .filter((file) => file.available !== false &&
      (["video", "audio"].includes(file.mediaType?.split("/")[0]) || /\.(mp4|webm|mov|m4v|mp3|wav)$/i.test(file.name)))
    .map((file) => ({
      label: /\.(mp3|wav)$/i.test(file.name) || file.mediaType?.startsWith("audio") ? "Tải âm thanh đã duyệt" : "Tải bản đã duyệt",
      url: resultFileUrl(projectId, bundle.id, file.id),
      name: file.name,
      sizeBytes: file.sizeBytes ?? null,
      sourceResultId: bundle.data?.sourceResultId ?? null,
      createdAt: bundle.createdAt
    }));
}

/* ------------------------------------------------------------------------------------------------ */
/* Building blocks                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

function rail(title, ...children) {
  const section = node("section", undefined, "rail-block");
  if (title) section.append(node("h2", title, "rail-title"));
  section.append(...children);
  return section;
}

function button(label, className, icon = null) {
  const element = node("button", undefined, className);
  element.type = "button";
  if (icon) element.append(svgIcon(icon, { size: 17 }));
  element.append(node("span", label));
  return element;
}

function option(label, value, selected = false) {
  const element = new Option(label, value);
  element.selected = selected;
  return element;
}

function stageFor(sequence, render, context, { players, caption = null, working = false }) {
  const holder = node("figure", undefined, "stage-holder");
  const stage = node("div", undefined, "stage");
  stage.style.setProperty("--ratio", String(sequence.format.width / sequence.format.height));
  const primary = render?.files.find((file) => file.id === "primary" && file.available);
  let video = null;
  if (primary) {
    const url = resultFileUrl(context.projectId, render.resultId, primary.id);
    video = players.get(url) ?? node("video", undefined, "stage-video");
    players.delete(url);
    video.controls = true; video.preload = "metadata"; video.playsInline = true;
    video.dataset.ui = "video";
    video.setAttribute("aria-label", `${sequence.name} · Bản ${sequence.revision}`);
    if (video.getAttribute("src") !== url) video.src = url;
    const poster = render.files.find((file) => file.id === render.segments?.[0]?.frameFileId && file.available);
    if (poster) video.poster = resultFileUrl(context.projectId, render.resultId, poster.id);
    stage.append(video);
  } else if (render) {
    stage.classList.add("is-unavailable");
    stage.append(node("p", "Video này không còn khả dụng.", "stage-note"));
  } else {
    stage.classList.add("is-unavailable");
    if (working) stage.classList.add("is-working");
    stage.append(createBrandArtwork(), node("p", working ? "Video đang thành hình…" : "Phiên bản này chưa có bản dựng.", "stage-note"));
  }
  holder.append(stage);
  if (caption) holder.append(node("figcaption", caption, "stage-caption"));
  return { holder, video };
}

function anchorControl(context, sequence, render, video) {
  const box = node("div", undefined, "anchor");
  const copy = button("Sao chép mốc phản hồi", "button button-quiet", ICONS.copy);
  copy.dataset.ui = "anchor";
  copy.title = "Sao chép vị trí đang xem của đúng bản này để gửi cho Agent trong cuộc trò chuyện";
  const status = node("span", undefined, "anchor-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  box.append(copy, status);
  copy.addEventListener("click", async () => {
    const at = video.currentTime;
    const value = feedbackAnchorText({ projectId: context.projectId, sequence, render, currentTime: at });
    const segment = at > 0 ? segmentAtTime(sequence, at) : null;
    const where = at > 0 ? " tại " + clock(at) + (segment ? " · " + segment.title : "") : " cho cả video";
    box.querySelector(".anchor-fallback")?.remove();
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = "Đã sao chép mốc" + where + ". Dán vào cuộc trò chuyện với Agent.";
    } catch {
      const field = node("input", undefined, "anchor-fallback");
      field.readOnly = true; field.value = value; field.setAttribute("aria-label", "Mốc phản hồi");
      box.append(field); field.focus(); field.select();
      status.textContent = "Không tự sao chép được. Hãy sao chép mã bên dưới.";
    }
  });
  return box;
}

function chapterList(context, sequence, render, video) {
  const list = node("ol", undefined, "chapters");
  list.setAttribute("aria-label", "Các đoạn trong video");
  const items = [];
  let elapsed = 0;
  for (const segment of sequence.segments) {
    const row = sequence.timeline?.find((item) => item.track === "Hình" && item.segmentId === segment.id);
    const start = row?.startSeconds ?? elapsed;
    elapsed += segment.durationSeconds;
    const item = node("li");
    const open = node("button", undefined, "chapter");
    open.type = "button"; open.dataset.ui = "chapter"; open.dataset.startSeconds = String(start);
    open.setAttribute("aria-label", `${segment.title} · ${clock(start)}`);
    const frame = render.files.find((file) => file.id === render.segments?.find((entry) => entry.id === segment.id)?.frameFileId && file.available);
    const thumb = node("span", undefined, "chapter-thumb");
    if (frame) {
      const image = node("img"); image.loading = "lazy"; image.alt = "";
      image.src = resultFileUrl(context.projectId, render.resultId, frame.id);
      thumb.append(image);
    }
    open.append(thumb, node("span", segment.title, "chapter-title"), node("span", clock(start), "chapter-time"));
    open.addEventListener("click", () => {
      video.currentTime = start;
      video.play().catch(() => {});
    });
    item.append(open);
    list.append(item);
    items.push(open);
  }
  let current = null;
  const mark = () => {
    const next = items.findLast((entry) => Number(entry.dataset.startSeconds) <= video.currentTime + 0.05);
    if (next === current) return;
    current?.classList.remove("is-active"); current?.removeAttribute("aria-current");
    next?.classList.add("is-active"); next?.setAttribute("aria-current", "true");
    current = next;
  };
  const previous = chapterListeners.get(video);
  if (previous) video.removeEventListener("timeupdate", previous);
  video.addEventListener("timeupdate", mark);
  chapterListeners.set(video, mark);
  mark();
  return list;
}

function feedbackList(items, video) {
  const list = node("ul", undefined, "feedback-list");
  for (const entry of items) {
    const row = node("li", undefined, `feedback-item is-${entry.outcome}${entry.pending ? " is-pending" : ""}`);
    const head = node("div", undefined, "feedback-head");
    head.append(node("strong", entry.label));
    if (entry.pending) head.append(node("span", "Chờ xử lý", "feedback-flag"));
    else if (entry.outcome === "changes_requested") head.append(node("span", "Đã xử lý", "feedback-flag is-done"));
    head.append(node("time", relativeTime(entry.createdAt), "feedback-time"));
    head.lastChild.title = formatDateTime(entry.createdAt);
    row.append(head);
    if (entry.note) row.append(node("p", entry.note, "feedback-note"));
    if (Number.isFinite(entry.startSeconds) && video) {
      const jump = node("button", `Đến ${clock(entry.startSeconds)}`, "feedback-jump");
      jump.type = "button";
      jump.addEventListener("click", () => { video.currentTime = entry.startSeconds; video.play().catch(() => {}); });
      row.append(jump);
    }
    list.append(row);
  }
  return list;
}

/* ------------------------------------------------------------------------------------------------ */
/* The theatre                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

function emptyTheatre(status, hasSources, onOpenSources) {
  const box = node("div", undefined, "theatre-empty");
  box.append(createBrandArtwork());
  const working = status?.kind === "working";
  box.append(node("h2", working ? "Video đang thành hình" : "Chưa có video"));
  box.append(node("p", working
    ? "Bản xem thử sẽ xuất hiện ở đây ngay khi dựng xong."
    : "Khi Agent dựng xong một bản xem thử, bạn sẽ xem nó ở đây."));
  if (working) box.classList.add("is-working");
  if (hasSources) {
    const open = button("Xem tư liệu", "button button-soft");
    open.addEventListener("click", onOpenSources);
    box.append(open);
  }
  return box;
}

function animationTheatre(context) {
  const compositions = [...(context.animation?.compositions ?? [])]
    .sort((left, right) => Number(right.role === "current") - Number(left.role === "current") || right.revision - left.revision);
  let selection = null;
  for (const composition of compositions) {
    const render = [...(composition.renders ?? [])].reverse().find((result) => result.files.some((file) => file.id === "primary" && file.available));
    const preview = [...(composition.previews ?? [])].reverse().find((result) => result.files.some((file) => file.available && file.mediaType === "video"));
    const result = render ?? preview;
    const file = result?.files.find((entry) => entry.available && (entry.id === "primary" || entry.mediaType === "video"));
    if (file) { selection = { composition, result, file, isPreview: !render }; break; }
  }
  if (!selection) return null;
  const { composition, result, file, isPreview } = selection;
  const theatre = node("div", undefined, "theatre");
  theatre.classList.add(composition.format.height > composition.format.width ? "is-portrait" : composition.format.height < composition.format.width ? "is-landscape" : "is-square");
  const holder = node("figure", undefined, "stage-holder");
  const stage = node("div", undefined, "stage");
  stage.style.setProperty("--ratio", String(composition.format.width / composition.format.height));
  const video = node("video", undefined, "stage-video");
  video.controls = true; video.playsInline = true; video.preload = "metadata"; video.dataset.ui = "video";
  video.setAttribute("aria-label", composition.name);
  video.src = resultFileUrl(context.projectId, result.resultId, file.id);
  const poster = result.files.find((entry) => entry.available && entry.mediaType?.split("/")[0] === "image");
  if (poster) video.poster = resultFileUrl(context.projectId, result.resultId, poster.id);
  stage.append(video);
  holder.append(stage);
  const side = node("aside", undefined, "theatre-rail");
  const info = rail(null, node("p", isPreview ? "Bản xem thử hoạt họa" : "Bản dựng hoạt họa", "rail-kicker"),
    node("p", `Bản ${composition.revision} · ${composition.runtime}`, "rail-line"));
  if (isPreview) {
    info.append(node("p", previewClipDescription(result), "rail-note"));
    const label = node("label", undefined, "toggle");
    const loop = node("input"); loop.type = "checkbox";
    loop.addEventListener("change", () => { video.loop = loop.checked; });
    label.append(loop, node("span", "Lặp đoạn xem thử để so hình với tiếng"));
    info.append(label);
  }
  side.append(info);
  theatre.append(holder, side);
  return theatre;
}

function filmTheatre(container, context, extras) {
  const sequences = context.production?.sequences ?? [];
  const keys = [...new Set(sequences.map((sequence) => sequence.key))].sort((left, right) =>
    Number(sequences.some((sequence) => sequence.key === right && sequence.role === "current")) -
    Number(sequences.some((sequence) => sequence.key === left && sequence.role === "current")));
  const chosenKey = keys.includes(selectedFilm.get(context.projectId)) ? selectedFilm.get(context.projectId) : keys[0];
  const revisions = sequences.filter((sequence) => sequence.key === chosenKey).sort((left, right) => left.revision - right.revision);
  const storageKey = context.projectId + ":" + chosenKey;
  const saved = choices.get(storageKey) ?? {};
  const downloads = deliveryDownloads(context.delivery, context.projectId);

  function draw(focusControl = null) {
    const players = new Map([...container.querySelectorAll("video.stage-video")].map((video) => [video.getAttribute("src"), video]));
    const revision = (saved.manualRevision && revisions.find((sequence) => sequence.artifactId === saved.revisionId))
      || defaultVideoRevision(revisions);
    const render = (saved.manualResult && revision.renders.find((candidate) => candidate.resultId === saved.resultId))
      || (revision.renders.length ? defaultVideoRender(revision) : null);
    const options = productionRenderOptions(revisions);
    const comparison = options.find((entry) => entry.resultId === saved.compareResultId && entry.resultId !== render?.resultId);
    const baseline = comparison ? revisions.find((sequence) => sequence.artifactId === comparison.artifactId) : null;
    const baselineRender = baseline?.renders.find((candidate) => candidate.resultId === comparison.resultId) ?? null;

    const theatre = node("div", undefined, "theatre");
    theatre.classList.add(revision.format.height > revision.format.width ? "is-portrait" : revision.format.height < revision.format.width ? "is-landscape" : "is-square");
    if (baselineRender) theatre.classList.add("is-comparing");

    const stages = node("div", undefined, "theatre-stages");
    const main = stageFor(revision, render, { ...context }, { players, working: extras.status?.kind === "working", caption: baselineRender ? `Bản ${revision.revision}` : null });
    stages.append(main.holder);
    let other = null;
    if (baselineRender) {
      other = stageFor(baseline, baselineRender, { ...context }, { players, caption: `Bản ${baseline.revision} · để so sánh` });
      stages.append(other.holder);
      for (const pair of [[main, revision, render], [other, baseline, baselineRender]]) {
        if (pair[0].video) pair[0].holder.append(anchorControl(context, pair[1], pair[2], pair[0].video));
      }
    }
    for (const video of players.values()) video.pause();

    const side = node("aside", undefined, "theatre-rail");

    if (keys.length > 1) {
      const film = node("select", undefined, "select");
      film.setAttribute("aria-label", "Chọn video trong dự án"); film.dataset.control = "film";
      for (const key of keys) film.append(option(sequences.findLast((sequence) => sequence.key === key).name, key, key === chosenKey));
      film.addEventListener("change", () => { selectedFilm.set(context.projectId, film.value); lastSignature = null; render_(container, context, extras); });
      side.append(rail("Video", film));
    }

    // Versions -----------------------------------------------------------------------------------
    const versions = node("div", undefined, "versions");
    const revisionSelect = node("select", undefined, "select");
    revisionSelect.setAttribute("aria-label", "Chọn bản video"); revisionSelect.dataset.control = "revision";
    for (const entry of revisions) {
      const label = `Bản ${entry.revision}${entry.active ? " · hiện hành" : entry.role === "candidate" ? " · đề xuất" : ""}`;
      revisionSelect.append(option(label, entry.artifactId, entry.artifactId === revision.artifactId));
    }
    revisionSelect.disabled = revisions.length < 2;
    revisionSelect.addEventListener("change", () => {
      saved.manualRevision = true; saved.manualResult = false; saved.resultId = null; saved.revisionId = revisionSelect.value;
      choices.set(storageKey, saved); draw("revision");
    });
    versions.append(revisionSelect);
    if (revision.renders.length > 1) {
      const renderSelect = node("select", undefined, "select");
      renderSelect.setAttribute("aria-label", "Chọn lần dựng"); renderSelect.dataset.control = "render";
      revision.renders.forEach((entry, index) => renderSelect.append(
        option(`Lần dựng ${index + 1} · ${relativeTime(entry.createdAt)}`, entry.resultId, entry.resultId === render?.resultId)));
      renderSelect.addEventListener("change", () => {
        saved.manualRevision = saved.manualResult = true; saved.revisionId = revision.artifactId; saved.resultId = renderSelect.value;
        choices.set(storageKey, saved); draw("render");
      });
      versions.append(renderSelect);
    }
    if (options.length > 1) {
      const compare = node("select", undefined, "select select-quiet");
      compare.setAttribute("aria-label", "Chọn bản so sánh"); compare.dataset.control = "compare";
      compare.append(option("So sánh với…", "", !baselineRender));
      for (const entry of options.filter((candidate) => candidate.resultId !== render?.resultId)) {
        compare.append(option(`Bản ${entry.revision} · ${relativeTime(entry.createdAt)}`, entry.resultId, entry.resultId === baselineRender?.resultId));
      }
      compare.addEventListener("change", () => { saved.compareResultId = compare.value || null; choices.set(storageKey, saved); draw("compare"); });
      versions.append(compare);
    }
    side.append(rail("Phiên bản", versions));

    // Status and download ------------------------------------------------------------------------
    const state = node("div", undefined, "state");
    const latest = [...(render?.decisions ?? [])].at(-1) ?? null;
    const meta = [clock(revision.durationSeconds), orientationLabel(revision.format.width, revision.format.height)].filter(Boolean).join(" · ");
    state.append(node("p", meta, "rail-line"));
    if (latest) {
      const verdict = node("p", undefined, "verdict is-" + latest.outcome);
      verdict.append(node("strong", OUTCOME_LABELS[latest.outcome] ?? latest.outcome), node("span", " · " + relativeTime(latest.createdAt)));
      state.append(verdict);
    } else if (render) {
      state.append(node("p", "Chưa có phản hồi cho bản này.", "rail-note"));
    }
    for (const entry of downloads) {
      const link = node("a", undefined, "button button-primary");
      link.dataset.ui = "download";
      link.href = entry.url; link.download = entry.name;
      link.append(svgIcon(ICONS.download, { size: 17 }), node("span", entry.label));
      if (entry.sizeBytes) link.append(node("span", formatSize(entry.sizeBytes), "button-meta"));
      link.title = entry.sourceResultId && entry.sourceResultId !== render?.resultId
        ? "Bản đã duyệt thuộc một lần dựng khác của video này" : "Bản đã được bạn duyệt";
      state.append(link);
    }
    side.append(rail("Trạng thái", state));

    // Chapters -----------------------------------------------------------------------------------
    if (main.video && revision.segments.length > 1) side.append(rail("Các đoạn", chapterList(context, revision, render, main.video)));

    // Feedback -----------------------------------------------------------------------------------
    const feedback = rail("Phản hồi");
    const items = feedbackItems(sequences, render);
    if (main.video && !baselineRender) feedback.append(anchorControl(context, revision, render, main.video));
    if (items.length) feedback.append(feedbackList(items, main.video));
    else feedback.append(node("p", main.video
      ? "Dừng video ở đúng chỗ cần sửa, bấm “Sao chép mốc phản hồi” rồi dán vào cuộc trò chuyện với Agent."
      : "Phản hồi sẽ hiện ở đây khi video có bản dựng.", "rail-note"));
    side.append(feedback);

    theatre.append(stages, side);
    container.replaceChildren(theatre);
    if (focusControl) container.querySelector(`[data-control="${focusControl}"]`)?.focus();
    container.dispatchEvent(new CustomEvent("viewerchange", { bubbles: true }));
  }
  draw();
}

function render_(container, context, extras) {
  renderTheatre(container, context, extras);
}

/**
 * Draw the Video tab: the film (a sequence's renders) when there is one, otherwise a code-animation render or
 * preview, otherwise a calm empty state. Playing <video> elements are kept across updates so a poll never
 * restarts what the viewer is watching.
 */
export function renderTheatre(container, context, extras = {}) {
  const signature = JSON.stringify([context.projectId, context.production?.sequences, context.animation?.compositions,
    context.delivery?.bundles, extras.status, extras.hasSources]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  if ((context.production?.sequences ?? []).length) { filmTheatre(container, context, extras); return; }
  const featured = animationTheatre(context);
  container.replaceChildren(featured ?? emptyTheatre(extras.status, extras.hasSources, extras.onOpenSources ?? (() => {})));
  container.dispatchEvent(new CustomEvent("viewerchange", { bubbles: true }));
}

export function clearTheatre(container) {
  lastSignature = null;
  container.replaceChildren();
}

/** The video element currently shown first on the Video tab, if any. */
export function activeVideo(container) {
  return container.querySelector("video.stage-video");
}

