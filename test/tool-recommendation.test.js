import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { rankToolChoices } from "../src/execution/tool-recommendation.js";

test("default tools expose actionable guidance and explicit alternatives", async () => {
  const description = await createDefaultToolRegistry({
    elevenLabsTts: { apiKey: null }, piperTts: { discoverModels: async () => [] }
  }).describeCapabilities();
  const tools = description.capabilities.flatMap((entry) => entry.tools);
  assert.ok(tools.length >= 22);
  for (const tool of tools) {
    assert.ok(tool.bestFor.length > 0);
    assert.ok(tool.limitations.length > 0);
    assert.ok(tool.skillIds.length > 0);
    assert.ok(tool.setup.instructions);
    assert.equal(Object.keys(tool.selectionProfile).length, 6);
  }
  const tts = description.capabilities.find((entry) => entry.id === "tts.synthesize");
  assert.deepEqual(tts.tools.find((tool) => tool.name === "piper-local").alternatives, ["elevenlabs"]);
});

test("recommendation ranks available and preferred tools but stays advisory", () => {
  const description = { capabilities: [{ id: "demo", tools: [
    { name: "local", provider: "local", availability: { status: "available" }, selectionProfile: { quality: 3, control: 3, reliability: 5, costEfficiency: 5, latency: 5, privacy: 5 }, bestFor: [], limitations: [], skillIds: [], setup: {}, cost: {} },
    { name: "cloud", provider: "cloud", availability: { status: "unavailable" }, selectionProfile: { quality: 5, control: 5, reliability: 5, costEfficiency: 1, latency: 3, privacy: 1 }, bestFor: [], limitations: [], skillIds: [], setup: {}, cost: {} }
  ] }] };
  const result = rankToolChoices(description, { capability: "demo", preferredTool: "cloud", priorities: { quality: 5 } });
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.choices[0].tool, "local");
  assert.equal(result.choices[1].preferred, true);
});
