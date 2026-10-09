import { ICONS, formatSize, inputUrl, node, resultFileUrl, searchKey, svgIcon } from "./dom.js";

const KINDS = Object.freeze({ video: "Video", audio: "Âm thanh", image: "Hình ảnh" });
const state = { projectId: null, selectedPath: null, query: "", signature: null, previewKey: null };
const SEARCH_FROM = 9;

const kindOf = (item) => String(item.mediaType ?? "").split("/")[0];
const isMedia = (item) => ["video", "audio", "image"].includes(kindOf(item));

/**
 * The project's materials as a viewer thinks of them: files the user supplied plus pictures, clips, narration and
 * music that were fetched or are used by the current film. Anything that is not playable media stays out.
 */
export function collectSources({ resources = [], results = [], production = null }) {
  const items = resources.flatMap((resource) => resource.items.map((item) => ({
    ...item, displayName: resource.items.length === 1 ? resource.name : item.name
  })));
  const used = new Map();
  const collect = (value, title) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "result" && typeof value.id === "string") used.set(value.id, title);
    else for (const child of Object.values(value)) collect(child, title);
  };
  for (const sequence of production?.sequences ?? []) {
    if (!sequence.active) continue;
    for (const segment of sequence.segments) collect(segment, segment.title);
    collect(sequence.music, "Nhạc nền");
    collect(sequence.audio, "Âm thanh");
  }
  for (const result of results) {
    if (result.type !== "media.acquired" && !used.has(result.id)) continue;
    const file = result.files?.find((entry) => entry.id === "primary");
    const kind = file?.mediaType?.split("/")[0];
    if (!file || !["image", "video", "audio"].includes(kind)) continue;
    items.push({
      path: "result:" + result.id + ":" + file.id, name: file.name,
      displayName: result.type === "audio.tts" ? `Lời đọc · ${used.get(result.id) ?? result.name}` : result.name, mediaType: kind,
      available: file.available !== false, modifiedAt: result.createdAt, sizeBytes: file.sizeBytes ?? null,
      resultId: result.id, fileId: file.id
    });
  }
  return items.filter(isMedia);
}

function itemUrl(projectId, item) {
  return item.resultId ? resultFileUrl(projectId, item.resultId, item.fileId) : inputUrl(projectId, item);
}

function thumbnail(projectId, item) {
  const box = node("span", undefined, "source-thumb");
  box.setAttribute("aria-hidden", "true");
  if (item.available && kindOf(item) === "image") {
    const image = node("img"); image.alt = ""; image.loading = "lazy"; image.src = itemUrl(projectId, item);
    box.append(image);
  } else {
    box.append(svgIcon(kindOf(item) === "video" ? ICONS.film : kindOf(item) === "audio" ? ICONS.audio : ICONS.file, { size: 20 }));
  }
  return box;
}

function preview(host, projectId, item) {
  const key = item ? `${projectId}:${item.path}:${item.modifiedAt}` : "empty";
  if (key === state.previewKey) return;
  state.previewKey = key;
  host.replaceChildren();
  if (!item) {
    host.append(node("p", "Chọn một tư liệu để xem.", "empty-note"));
    return;
  }
  const url = itemUrl(projectId, item);
  const head = node("header", undefined, "source-preview-head");
  const title = node("div");
  title.append(node("h2", item.displayName ?? item.name));
  title.append(node("p", [KINDS[kindOf(item)] ?? "Tệp", formatSize(item.sizeBytes)].filter(Boolean).join(" · "), "rail-note"));
  const download = node("a", undefined, "button button-quiet");
  download.href = url; download.download = item.name;
  download.append(svgIcon(ICONS.download, { size: 17 }), node("span", "Tải về"));
  head.append(title, download);
  const body = node("div", undefined, "source-preview-body");
  host.append(head, body);
  const kind = kindOf(item);
  if (kind === "image") {
    const image = node("img"); image.src = url; image.alt = item.name; body.append(image);
  } else if (kind === "video" || kind === "audio") {
    const media = document.createElement(kind);
    media.src = url; media.controls = true; media.preload = "metadata"; media.playsInline = true;
    body.append(media);
  }
}

/** Draw the materials gallery into `host`. Selection and search text survive the refreshes caused by polling. */
export function renderSources(host, { projectId, resources, results, production }) {
  const visible = collectSources({ resources, results, production });
  // Only what the gallery shows decides whether to redraw, so unrelated project activity never restarts a
  // preview the viewer is watching.
  const signature = JSON.stringify([projectId, visible.map((item) =>
    [item.path, item.displayName, item.available, item.modifiedAt, item.sizeBytes])]);
  if (signature === state.signature) return;
  state.signature = signature;
  if (state.projectId !== projectId) Object.assign(state, { projectId, selectedPath: null, query: "" });
  state.previewKey = null;

  if (!visible.some((item) => item.path === state.selectedPath && item.available)) {
    state.selectedPath = (visible.find((item) => item.available && kindOf(item) === "video")
      ?? visible.find((item) => item.available))?.path ?? null;
  }

  host.replaceChildren();
  if (!visible.length) {
    host.append(node("p", "Dự án chưa có tư liệu. Tư liệu bạn gửi trong cuộc trò chuyện sẽ hiện ở đây.", "empty-note"));
    return;
  }

  const layout = node("div", undefined, "sources");
  const side = node("div", undefined, "sources-side");
  const label = node("label", undefined, "search");
  label.hidden = visible.length < SEARCH_FROM;
  label.append(svgIcon(ICONS.search, { size: 16 }));
  const search = node("input"); search.type = "search"; search.placeholder = "Tìm tư liệu…"; search.value = state.query;
  search.setAttribute("aria-label", "Tìm tư liệu"); search.autocomplete = "off"; search.id = "source-search";
  label.append(search);
  const list = node("div", undefined, "source-list");
  list.setAttribute("role", "list");
  const previewHost = node("div", undefined, "source-preview");

  const rows = new Map();
  for (const item of visible) {
    const row = node("button", undefined, "source-row");
    row.type = "button"; row.dataset.ui = "source"; row.dataset.path = item.path; row.disabled = !item.available;
    row.setAttribute("role", "listitem");
    const text = node("span", undefined, "source-text");
    text.append(node("span", item.displayName ?? item.name, "source-name"),
      node("span", item.available ? [KINDS[kindOf(item)] ?? "Tệp", formatSize(item.sizeBytes)].filter(Boolean).join(" · ") : "Thiếu tệp", "source-meta"));
    row.append(thumbnail(projectId, item), text);
    row.classList.toggle("is-active", item.path === state.selectedPath);
    row.addEventListener("click", () => {
      state.selectedPath = item.path;
      for (const [, candidate] of rows) candidate.classList.toggle("is-active", candidate === row);
      preview(previewHost, projectId, item);
    });
    rows.set(item.path, row);
    list.append(row);
  }
  const none = node("p", "Không tìm thấy tư liệu.", "empty-note");
  none.hidden = true;
  list.append(none);
  const filter = () => {
    state.query = search.value;
    const query = searchKey(search.value);
    let shown = 0;
    for (const item of visible) {
      const match = searchKey(item.displayName ?? item.name).includes(query);
      rows.get(item.path).hidden = !match;
      if (match) shown += 1;
    }
    none.hidden = shown > 0;
  };
  search.addEventListener("input", filter);
  side.append(label, list);
  layout.append(side, previewHost);
  host.append(layout);
  filter();
  preview(previewHost, projectId, visible.find((item) => item.path === state.selectedPath) ?? null);
}

export function clearSources(host) {
  state.signature = null;
  state.projectId = null;
  state.previewKey = null;
  host.replaceChildren();
}
