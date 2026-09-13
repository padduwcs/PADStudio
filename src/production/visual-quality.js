const segmenter = typeof Intl?.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function splitGraphemes(value) {
  const text = String(value ?? "");
  return segmenter ? [...segmenter.segment(text)].map((entry) => entry.segment) : Array.from(text);
}

export function graphemeLength(value) {
  return splitGraphemes(value).length;
}

export function wrapCaptionLines(text, style, width) {
  const max = Math.max(1, Math.floor(width * (1 - 2 * style.margin) / style.fontSize));
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = "";
    let lineLength = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wordLength = graphemeLength(word);
      if (wordLength > max) throw new Error("Caption contains a word too wide for the safe area.");
      if (line && lineLength + wordLength + 1 > max) {
        lines.push(line);
        line = "";
        lineLength = 0;
      }
      line += (line ? " " : "") + word;
      lineLength += (lineLength ? 1 : 0) + wordLength;
    }
    lines.push(line);
  }
  return lines;
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function finding(code, message, target, proposedChange) {
  return { severity: "warning", code, message, target, proposedChange };
}

export function assessSequenceVisualQuality(sequence) {
  const findings = [];
  const { width, height } = sequence.format;
  for (const segment of sequence.segments) {
    segment.captions.forEach((cue, captionIndex) => {
      const target = { segmentId: segment.id, captionIndex };
      const style = cue.style ?? { fontSize: 48, margin: 0.06, color: "#FFFFFF", background: null, outline: 2 };
      const duration = cue.endSeconds - cue.startSeconds;
      const characters = graphemeLength(cue.text.replace(/\s/g, ""));
      const charactersPerSecond = characters / duration;
      let lines = [];
      try { lines = wrapCaptionLines(cue.text, style, width); } catch { /* Render validation reports an over-wide token as a hard error. */ }
      if (style.fontSize / height < 0.03) findings.push(finding("caption_font_too_small",
        `Caption font is ${(style.fontSize / height * 100).toFixed(1)}% of frame height; review at delivery size.`, target,
        `Use at least ${Math.ceil(height * 0.03)}px or verify readability on the target device.`));
      if (charactersPerSecond > 21) findings.push(finding("caption_reading_speed_high",
        `Caption requires ${charactersPerSecond.toFixed(1)} graphemes/second.`, target,
        "Shorten the cue or extend its display time to 21 graphemes/second or less."));
      if (lines.length > 2) findings.push(finding("caption_line_count_high",
        `Caption is estimated to occupy ${lines.length} lines.`, target,
        "Split or shorten the cue so it occupies at most two lines."));
      if (style.margin < 0.05) findings.push(finding("caption_safe_margin_small",
        `Caption margin is ${(style.margin * 100).toFixed(1)}% of frame width.`, target,
        "Use a margin of at least 5% unless an exact output profile proves a smaller safe zone."));
      if (style.background && contrastRatio(style.color, style.background) < 4.5) findings.push(finding("caption_contrast_low",
        `Caption text/background contrast is ${contrastRatio(style.color, style.background).toFixed(2)}:1.`, target,
        "Choose text/background colors with at least 4.5:1 contrast or verify a sufficiently strong outline on representative frames."));
      if (!style.background && style.outline < 2) findings.push(finding("caption_contrast_unprotected",
        "Caption has neither a background nor a robust outline, so contrast depends on unknown video pixels.", target,
        "Add a background or an outline of at least 2px, then inspect representative frames."));
    });
    for (const overlay of segment.overlays ?? []) {
      const target = { segmentId: segment.id, overlayId: overlay.id };
      const small = overlay.width * width < 24 || overlay.height * height < 24;
      if (small) findings.push(finding("overlay_very_small", "Overlay is under 24px on at least one axis.", target,
        "Increase the overlay dimensions or verify that it remains intentionally visible at delivery size."));
      const contained = overlay.x >= 0.05 && overlay.y >= 0.05 && overlay.x + overlay.width <= 0.95 && overlay.y + overlay.height <= 0.95;
      const nearFullFrame = overlay.width >= 0.9 && overlay.height >= 0.9;
      if (!contained && !nearFullFrame) findings.push(finding("overlay_outside_action_safe_zone",
        "Overlay extends beyond the generic 5% action-safe inset.", target,
        "Move important overlay content inside the inset, or validate it against the exact output profile."));
    }
  }
  return findings;
}

export function assessGraphicVisualQuality(spec) {
  const background = spec.theme === "dark" ? "#141D29" : "#FFFFFF";
  const surface = spec.theme === "dark" ? "#233044" : "#EDF2F5";
  const foreground = spec.theme === "dark" ? "#F4F6F8" : "#17212B";
  const findings = [];
  const textRatio = contrastRatio(foreground, background);
  if (textRatio < 4.5) findings.push(finding("graphic_text_contrast_low", `Graphic text/background contrast is ${textRatio.toFixed(2)}:1.`,
    { element: "primary-text" }, "Use theme colors with at least 4.5:1 contrast."));
  const accentBackdrop = spec.kind === "steps" ? surface : background;
  const accentRatio = contrastRatio(spec.accent, accentBackdrop);
  if (accentRatio < 3) findings.push(finding("graphic_accent_contrast_low", `Graphic accent contrast is ${accentRatio.toFixed(2)}:1.`,
    { element: "accent" }, "Choose an accent with at least 3:1 contrast against its rendered backdrop."));
  return findings;
}
