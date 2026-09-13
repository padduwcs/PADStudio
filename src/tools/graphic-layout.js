import { object, number, text, fail } from "./asset-tool-common.js";
import { assessGraphicVisualQuality } from "../production/visual-quality.js";

export function normalizeGraphic(inputs) {
  object(inputs, ["kind", "title", "body", "items", "steps", "width", "height", "theme", "accent", "footer", "artifactIds", "typography"]);
  if (!["card", "bar-chart", "steps"].includes(inputs.kind)) fail("kind must be card, bar-chart or steps.");
  const width = number(inputs.width, "width", 320, 3840, 1280);
  const height = number(inputs.height, "height", 320, 3840, 720);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2) fail("Dimensions must be even integers.");
  const theme = inputs.theme ?? "dark";
  if (!["dark", "light"].includes(theme)) fail("theme must be dark or light.");
  const accent = inputs.accent ?? (theme === "dark" ? "#63D3C4" : "#126A63");
  if (typeof accent !== "string" || !/^#[0-9a-f]{6}$/i.test(accent)) fail("accent must be a six-digit hex color.");
  const result = { kind: inputs.kind, title: text(inputs.title, "title", 240), width, height, theme, accent,
    footer: inputs.footer === undefined ? "" : text(inputs.footer, "footer", 240) };
  if (inputs.kind === "card") {
    if (inputs.items !== undefined || inputs.steps !== undefined) fail("Card accepts body only.");
    result.body = text(inputs.body, "body", 1800);
  } else if (inputs.kind === "bar-chart") {
    if (inputs.body !== undefined || inputs.steps !== undefined) fail("Bar chart accepts items only.");
    if (!Array.isArray(inputs.items) || inputs.items.length < 1 || inputs.items.length > 8) fail("Chart requires 1–8 items.");
    result.items = inputs.items.map((item) => {
      object(item, ["label", "value"], "item");
      return { label: text(item.label, "item.label", 100), value: number(item.value, "item.value", -1e12, 1e12) };
    });
    if (new Set(result.items.map((item) => item.label)).size !== result.items.length) fail("Chart labels must be unique.");
  } else {
    if (inputs.body !== undefined || inputs.items !== undefined) fail("Steps graphic accepts steps only.");
    if (!Array.isArray(inputs.steps) || inputs.steps.length < 2 || inputs.steps.length > 6) fail("Steps graphic requires 2–6 labels.");
    result.steps = inputs.steps.map((item) => text(item, "step", 240));
  }
  if (inputs.typography !== undefined) {
    object(inputs.typography, ["font", "titleWeight", "lineSpacing"], "typography");
    const font = inputs.typography.font ?? "Segoe UI";
    if (!["Segoe UI", "Arial", "Tahoma", "Verdana"].includes(font)) fail("Unsupported typography font.");
    const titleWeight = inputs.typography.titleWeight ?? 600;
    if (![400, 500, 600, 700].includes(titleWeight)) fail("Unsupported title weight.");
    result.typography = { font, titleWeight, lineSpacing: number(inputs.typography.lineSpacing, "lineSpacing", 1, 2, 1.4) };
  }
  const artifactIds = inputs.artifactIds ?? [];
  if (!Array.isArray(artifactIds) || artifactIds.length > 20 || artifactIds.some((id) => typeof id !== "string" || !/^artifact-[a-z0-9-]+$/i.test(id)) ||
      new Set(artifactIds).size !== artifactIds.length) fail("artifactIds must be up to 20 unique registered IDs.");
  return { spec: result, artifactIds, qualityFindings: assessGraphicVisualQuality(result) };
}

// Runs in an isolated local browser page. It draws only normalized data on canvas:
// no arbitrary HTML, URLs, scripts, font downloads or provider calls.
export function paintGraphic(spec) {
  const canvas = document.querySelector("canvas");
  canvas.width = spec.width; canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  const w = spec.width, h = spec.height, scale = Math.min(w, h) / 720;
  const margin = Math.round(Math.min(w, h) * 0.075);
  const foreground = spec.theme === "dark" ? "#F4F6F8" : "#17212B";
  const muted = spec.theme === "dark" ? "#CBD3DE" : "#3B4856";
  const background = spec.theme === "dark" ? "#141D29" : "#FFFFFF";
  const surface = spec.theme === "dark" ? "#233044" : "#EDF2F5";
  const blocks = [];
  ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "top";
  function drawText(text, x, y, width, height, maximum, minimum, color, weight = 400) {
    for (let size = Math.round(maximum); size >= Math.ceil(minimum); size--) {
      ctx.font = weight + " " + size + 'px "' + (spec.typography?.font ?? "Segoe UI") + '", Arial, sans-serif';
      const lines = [];
      for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          if (!word) continue;
          if (ctx.measureText(word).width > width) { line = null; break; }
          const next = line ? line + " " + word : word;
          if (ctx.measureText(next).width <= width) line = next;
          else { lines.push(line); line = word; }
        }
        if (line === null) { lines.length = 0; break; }
        lines.push(line);
      }
      const lineHeight = size * (spec.typography?.lineSpacing ?? 1.32);
      if (!lines.length || lines.length * lineHeight > height) continue;
      ctx.fillStyle = color;
      lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
      blocks.push({ text, fontSize: size, lines: lines.length, x, y, width, height });
      return;
    }
    throw new Error("Text does not fit at readable size; shorten text or enlarge the graphic.");
  }
  drawText(spec.title, margin, margin, w - margin * 2, h * 0.19, 52 * scale, 28 * scale, foreground, spec.typography?.titleWeight ?? 700);
  const top = margin + h * 0.22;
  const footerHeight = spec.footer ? Math.max(48 * scale, h * 0.065) : 0;
  const bottom = h - margin - footerHeight;
  const areaHeight = bottom - top, areaWidth = w - margin * 2;
  if (spec.kind === "card") {
    ctx.fillStyle = spec.accent; ctx.fillRect(margin, top - 20 * scale, Math.min(areaWidth, 120 * scale), 5 * scale);
    drawText(spec.body, margin, top + 16 * scale, areaWidth, areaHeight - 16 * scale, 40 * scale, 25 * scale, foreground);
  } else if (spec.kind === "steps") {
    const gap = 24 * scale;
    const boxHeight = (areaHeight - gap * (spec.steps.length - 1)) / spec.steps.length;
    for (let i = 0; i < spec.steps.length; i++) {
      const y = top + i * (boxHeight + gap);
      ctx.fillStyle = surface; ctx.fillRect(margin, y, areaWidth, boxHeight);
      const inset = 15 * scale;
      drawText(String(i + 1), margin + inset, y + inset, 44 * scale, boxHeight - inset * 2, 30 * scale, 19 * scale, spec.accent, 700);
      drawText(spec.steps[i], margin + 66 * scale, y + inset, areaWidth - 80 * scale, boxHeight - inset * 2, 32 * scale, 20 * scale, foreground);
      if (i < spec.steps.length - 1) {
        ctx.strokeStyle = spec.accent; ctx.lineWidth = 2 * scale;
        const x = w / 2, yy = y + boxHeight;
        ctx.beginPath(); ctx.moveTo(x, yy + 3 * scale); ctx.lineTo(x, yy + gap - 4 * scale);
        ctx.moveTo(x - 4 * scale, yy + gap - 9 * scale); ctx.lineTo(x, yy + gap - 4 * scale); ctx.lineTo(x + 4 * scale, yy + gap - 9 * scale); ctx.stroke();
      }
    }
  } else {
    const minimum = Math.min(0, ...spec.items.map((item) => item.value));
    const maximum = Math.max(0, ...spec.items.map((item) => item.value));
    const span = maximum - minimum || 1;
    const labelWidth = areaWidth * 0.29, valueWidth = areaWidth * 0.20;
    const chartLeft = margin + labelWidth + 12 * scale, chartWidth = areaWidth - labelWidth - valueWidth - 30 * scale;
    const zero = chartLeft + (-minimum / span) * chartWidth;
    const rowHeight = areaHeight / spec.items.length;
    ctx.strokeStyle = muted; ctx.lineWidth = scale;
    ctx.beginPath(); ctx.moveTo(zero, top); ctx.lineTo(zero, bottom); ctx.stroke();
    spec.items.forEach((item, i) => {
      const y = top + i * rowHeight;
      drawText(item.label, margin, y + rowHeight * 0.14, labelWidth, rowHeight * 0.78, 28 * scale, 18 * scale, foreground);
      const end = chartLeft + ((item.value - minimum) / span) * chartWidth;
      ctx.fillStyle = spec.accent;
      if (item.value !== 0) ctx.fillRect(Math.min(zero, end), y + rowHeight * 0.20, Math.abs(end - zero), rowHeight * 0.52);
      drawText(String(item.value), chartLeft + chartWidth + 15 * scale,
        y + rowHeight * 0.23, valueWidth, rowHeight * 0.70, 28 * scale, 17 * scale, foreground, 600);
    });
  }
  if (spec.footer) drawText(spec.footer, margin, bottom + 12 * scale, areaWidth, footerHeight - 12 * scale, 21 * scale, 15 * scale, muted);
  return { status: "passed", width: w, height: h, blocks, fontFamily: (spec.typography?.font ?? "Segoe UI") + ", Arial, sans-serif" };
}

export function graphicHtml(spec) {
  const encoded = Buffer.from(JSON.stringify(spec)).toString("base64");
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><meta name="padstudio-render" content=""><style>*{margin:0;padding:0}html,body{overflow:hidden}canvas{display:block}</style></head><body><canvas></canvas><script>' +
    'const spec=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("' + encoded + '"),c=>c.charCodeAt(0))));' +
    'try {const result=(' + paintGraphic.toString() + ')(spec);document.querySelector("meta[name=padstudio-render]").content=btoa(unescape(encodeURIComponent(JSON.stringify(result))));}' +
    'catch(error){document.querySelector("meta[name=padstudio-render]").content=btoa(JSON.stringify({status:"failed",error:error.message}));}' +
    '</script></body></html>';
}
