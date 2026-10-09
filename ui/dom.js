// Small helpers shared by the observer's views. The interface builds its DOM with textContent only, never
// innerHTML, so project text (titles, notes, transcripts) can never be interpreted as markup.

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function svgIcon(path, { size = 18, stroke = 1.8 } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(stroke));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

export const ICONS = Object.freeze({
  download: "M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3",
  copy: "M9 9h10v11H9zM5 15V4h10",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  chevron: "m8 10 4 4 4-4",
  close: "m6 6 12 12M18 6 6 18",
  search: "M16 16l4 4M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z",
  play: "M8 5v14l11-7z",
  moon: "M20.5 13a8.5 8.5 0 1 1-9.5-9.5A6.5 6.5 0 0 0 20.5 13Z",
  sun: "M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4",
  image: "M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z",
  file: "M7 3h7l5 5v13H7zM14 3v5h5"
});

const WITHOUT_MARKS = /[̀-ͯ]/g;
// Case- and accent-insensitive key, so "dang lam" finds "Đang làm" and "duong" finds "đường".
export function searchKey(value) {
  return String(value ?? "").normalize("NFD").replace(WITHOUT_MARKS, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
}

const formatterDate = new Intl.DateTimeFormat("vi", { day: "numeric", month: "numeric", year: "numeric" });
const formatterDateTime = new Intl.DateTimeFormat("vi", { dateStyle: "short", timeStyle: "short" });
const formatterTime = new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" });

export function formatDateTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? formatterDateTime.format(new Date(time)) : "";
}

// "Vừa xong", "5 phút trước", "Hôm qua", "3 ngày trước", otherwise a short date.
export function relativeTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "Vừa xong";
  if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + " phút trước";
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (time >= today) return "Hôm nay " + formatterTime.format(new Date(time));
  if (time >= today - 86_400_000) return "Hôm qua";
  const days = Math.floor((today - time) / 86_400_000) + 1;
  if (days < 7) return days + " ngày trước";
  return formatterDate.format(new Date(time));
}

// m:ss (or h:mm:ss) for positions in a video.
export function clock(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "không rõ";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} giây`;
  return clock(seconds);
}

export function formatSize(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(size < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

export function resultFileUrl(projectId, resultId, fileId) {
  return ["/project-results", projectId, resultId, fileId].map((part, index) => index ? encodeURIComponent(part) : part).join("/");
}

export function inputUrl(projectId, item) {
  const path = item.path.startsWith("inputs/") ? item.path.slice(7) : item.path;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/project-inputs/${encodeURIComponent(projectId)}/${encoded}?v=${encodeURIComponent(item.modifiedAt ?? "")}`;
}

export function orientationLabel(width, height) {
  if (!width || !height) return "";
  const shape = height > width ? "Dọc" : height < width ? "Ngang" : "Vuông";
  return `${shape} ${width}×${height}`;
}

export const STATUS_KINDS = Object.freeze(["working", "waiting", "feedback", "draft", "accepted", "delivered", "empty"]);

// A small, consistent status chip; `kind` selects the colour, the label is the card's plain-language text.
export function statusChip(status) {
  const kind = STATUS_KINDS.includes(status?.kind) ? status.kind : "empty";
  const chip = node("span", undefined, "chip chip-" + kind);
  chip.append(node("span", undefined, "chip-dot"), node("span", status?.label ?? ""));
  return chip;
}
