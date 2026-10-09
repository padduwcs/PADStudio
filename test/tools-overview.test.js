import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { buildToolsOverview } from "../src/web/tools-overview.js";

function tool(name, available, extra = {}) {
  return { name, provider: extra.provider ?? "fixture",
    availability: available ? { status: "available" } : { status: "unavailable", reason: extra.reason ?? "missing", ...extra.availability } };
}

function description(capabilities) {
  return { capabilities: Object.entries(capabilities).map(([id, tools]) => ({ id, tools, available: tools.some((entry) => entry.availability.status === "available") })) };
}

test("the Tools page groups tools by what they are for and says what is missing", () => {
  const overview = buildToolsOverview(description({
    "tts.synthesize": [tool("piper-local", true), tool("elevenlabs", false, { availability: { credentialConfigured: false } })],
    "animation.render": [tool("manim-ce", true), tool("remotion-local", true), tool("hyperframes-local", false, { reason: "HyperFrames CLI not found" })],
    "animation.preview": [tool("remotion-preview", false, { reason: "Chrome Headless Shell missing" }), tool("hyperframes-preview", false)],
    "animation.source": [tool("code-animation-source", true)],
    "video.detect-scenes": [tool("pyscenedetect-scenes", false, { reason: "python not found" })],
    "video.render-sequence": [tool("ffmpeg-sequence", true)],
    "media.brand-new": [tool("future-tool", true, { provider: "Future" })]
  }), { checkedAt: "2026-10-09T12:00:00.000Z" });

  const items = Object.fromEntries(overview.groups.flatMap((group) => group.items.map((item) => [item.id, item])));
  assert.deepEqual(overview.groups.map((group) => group.id), ["voice", "animation", "understanding", "editing", "other"]);
  assert.equal(items.piper.status, "ready");
  assert.equal(items.piper.setup, null);
  assert.equal(items.elevenlabs.status, "needs_key");
  assert.equal(items.elevenlabs.setting, "elevenLabs.apiKey");
  assert.equal(items.elevenlabs.costLabel, "Trả phí · qua mạng");
  assert.equal(items.manim.status, "ready");
  assert.equal(items.remotion.status, "partial");
  assert.deepEqual(items.remotion.missing, [{ name: "remotion-preview", reason: "Chrome Headless Shell missing" }]);
  assert.equal(items.hyperframes.status, "needs_setup");
  assert.match(items["scene-detection"].setup, /eval\/source-understanding\/README\.md/);
  // Bookkeeping tools are not shown; a tool the table does not know yet still is.
  assert.equal(Object.values(items).some((item) => item.tools.includes("code-animation-source")), false);
  assert.equal(items["tool:future-tool"].group, "other");
  assert.deepEqual(overview.summary, { ready: 4, total: 8 });
  assert.equal(overview.checkedAt, "2026-10-09T12:00:00.000Z");
});

test("every tool in the default registry lands in a named group", () => {
  const registry = createDefaultToolRegistry();
  const capabilities = new Map();
  for (const entry of registry.tools.values()) {
    const list = capabilities.get(entry.capability) ?? [];
    list.push(tool(entry.name, true));
    capabilities.set(entry.capability, list);
  }
  const overview = buildToolsOverview(description(Object.fromEntries(capabilities)));
  assert.deepEqual(overview.groups.find((group) => group.id === "other"), undefined,
    "a registered tool is missing from the Tools page table");
  assert.equal(overview.summary.ready, overview.summary.total);
});
