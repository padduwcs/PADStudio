import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSequence } from "../src/production/video-sequence.js";
import {
  assessSequenceVisualQuality,
  contrastRatio,
  graphemeLength,
  wrapCaptionLines,
} from "../src/production/visual-quality.js";
import { normalizeGraphic } from "../src/tools/graphic-layout.js";
import { createStyledAss } from "../src/tools/sequence-compositor.js";

const sequence = (caption, overlays = []) => normalizeSequence({
  version: "1.1",
  changeReason: "Review visual quality before rendering",
  format: { width: 1080, height: 1920, fps: 30 },
  captionStyle: {},
  segments: [{
    id: "opening",
    title: "Opening",
    intent: "Make the message readable",
    durationSeconds: 2,
    visual: null,
    captions: [caption],
    overlays,
    references: [],
  }],
});

test("contrast calculation uses WCAG relative luminance", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.ok(contrastRatio("#777777", "#FFFFFF") < 4.5);
});

test("caption wrapping counts user-perceived graphemes without splitting emoji", () => {
  assert.equal(graphemeLength("e\u0301"), 1);
  assert.equal(graphemeLength("👨‍👩‍👧‍👦"), 1);
  const style = { fontSize: 10, margin: 0.1 };
  assert.deepEqual(wrapCaptionLines("👨‍👩‍👧‍👦 abcdef", style, 100), ["👨‍👩‍👧‍👦 abcdef"]);
  const ass = createStyledAss([{
    text: "👨‍👩‍👧‍👦 abcdef",
    startSeconds: 0,
    endSeconds: 1,
    style: { ...style, font: "Arial", color: "#FFFFFF", background: null, bold: false, outline: 2, position: "bottom", lineSpacing: 1.2 },
    animation: null,
  }], { width: 100, height: 100 });
  assert.match(ass, /👨‍👩‍👧‍👦 abcdef/);
});

test("sequence visual quality distinguishes actionable heuristics from hard invisibility", () => {
  const reviewed = sequence({
    text: "Đây là một caption tiếng Việt quá dài để người xem có thể đọc kịp trong thời gian ngắn",
    startSeconds: 0,
    endSeconds: 1,
    style: { fontSize: 40, margin: 0.02, color: "#FFFFFF", background: "#F8F8F8", outline: 2 },
  }, [{
    id: "badge",
    source: { kind: "resource", id: "resource-badge" },
    startSeconds: 0,
    endSeconds: 1,
    x: 0,
    y: 0,
    width: 0.02,
    height: 0.02,
  }]);
  const findings = assessSequenceVisualQuality(reviewed);
  const codes = new Set(findings.map((entry) => entry.code));
  for (const code of [
    "caption_font_too_small",
    "caption_reading_speed_high",
    "caption_line_count_high",
    "caption_safe_margin_small",
    "caption_contrast_low",
    "overlay_very_small",
    "overlay_outside_action_safe_zone",
  ]) assert.ok(codes.has(code), `missing ${code}`);
  assert.ok(findings.every((entry) => entry.severity === "warning" && entry.proposedChange && entry.target.segmentId === "opening"));

  assert.throws(() => sequence({
    text: "Invisible",
    startSeconds: 0,
    endSeconds: 1,
    style: { color: "#FFFFFF", background: "#ffffff", outline: 0 },
  }), /invisible/i);
  assert.throws(() => sequence({
    text: "An outline cannot rescue identical ASS text and box colors",
    startSeconds: 0,
    endSeconds: 1,
    style: { color: "#FFFFFF", background: "#ffffff", outline: 3 },
  }), /invisible/i);
});

test("unknown video pixels produce a warning, while protected captions remain clean", () => {
  const unprotected = assessSequenceVisualQuality(sequence({
    text: "Short",
    startSeconds: 0,
    endSeconds: 2,
    style: { fontSize: 64, margin: 0.06, outline: 0 },
  }));
  assert.ok(unprotected.some((entry) => entry.code === "caption_contrast_unprotected"));
  const protectedCaption = assessSequenceVisualQuality(sequence({
    text: "Short",
    startSeconds: 0,
    endSeconds: 2,
    style: { fontSize: 64, margin: 0.06, outline: 3 },
  }));
  assert.deepEqual(protectedCaption, []);
});

test("graphic normalization reports low accent contrast without rejecting a valid layout", () => {
  const { qualityFindings } = normalizeGraphic({
    kind: "steps",
    title: "Các bước",
    steps: ["Một", "Hai"],
    width: 1080,
    height: 1920,
    theme: "light",
    accent: "#EDF2F5",
  });
  assert.equal(qualityFindings[0].code, "graphic_accent_contrast_low");
  assert.equal(qualityFindings[0].severity, "warning");
});
