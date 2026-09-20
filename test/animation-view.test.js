import assert from "node:assert/strict";
import test from "node:test";
import { renderAnimation, clearAnimation } from "../ui/animation-view.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.textContent = "";
    this.className = "";
    this.children = [];
    this.dataset = {};
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get childElementCount() { return this.children.length; }
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

function context(communicationMode, narrationDuplicateCount = 0) {
  return {
    project: { id: "demo" },
    animation: {
      compositions: [],
      choreographies: [{
        artifactId: "plan-1", revision: 1, role: "current", name: "Visual proof",
        purpose: "Explain by showing an operation.", durationSeconds: 2, fps: 24,
        objectCount: 1, semanticBeatCount: 1,
        continuity: { contractVersion: "1.3", relationshipCounts: { establish: 1 } },
        direction: { visualThesis: "Show the transformation.", variationIntent: "Follow meaning.", sampleIntent: "Preview the operation." },
        presentation: { narrationMode: "voice-led" },
        communication: { communicationMode, totalTextElementCount: 1, textlessBeatCount: 0,
          roleCounts: { caption: 1 }, narrationDuplicateCount },
        beats: [{ startSeconds: 0, endSeconds: 2, message: "A value changes.", actions: [{}],
          stateBefore: "Before", stateAfter: "After", relationToPrevious: "establish",
          audienceInsight: "The change is visible.", visualProof: "The object changes shape.",
          textElements: [{ role: "caption", text: "<script>not markup</script>", purpose: "A deliberate text sample." }] }],
      }],
    },
  };
}

test("animation observer shows visual proof and exact text as inert text", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  const container = new Element("div");
  try {
    renderAnimation(container, context("visual-first"));
    const nodes = descendants(container);
    assert.ok(nodes.some((item) => item.textContent.includes("minh chứng hình: The object changes shape.")));
    assert.ok(nodes.some((item) => item.tagName === "summary" && item.textContent === "Chữ trên hình (1)"));
    assert.ok(nodes.some((item) => item.tagName === "li"
      && item.textContent.includes("<script>not markup</script>” — A deliberate text sample.")));
    assert.ok(!nodes.some((item) => item.tagName === "script"));
  } finally {
    clearAnimation(container);
    globalThis.document = originalDocument;
  }
});

test("type-led narration repetition is not flagged as a visual-first warning", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  const container = new Element("div");
  try {
    renderAnimation(container, context("type-led", 1));
    const communication = descendants(container).find((item) => item.textContent.startsWith("Giao tiếp type-led"));
    assert.equal(communication?.className, "result-verification");
    clearAnimation(container);
    renderAnimation(container, context("visual-first", 1));
    const visualFirst = descendants(container).find((item) => item.textContent.startsWith("Giao tiếp visual-first"));
    assert.equal(visualFirst?.className, "sequence-warning");
  } finally {
    clearAnimation(container);
    globalThis.document = originalDocument;
  }
});
