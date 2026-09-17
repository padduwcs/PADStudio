import assert from "node:assert/strict";
import test from "node:test";
import {
  createToolDiscoveryView,
  filterToolDescription,
  parseToolListArgs,
  summarizeToolDescription,
  ToolDiscoveryError
} from "../src/execution/tool-discovery.js";

function tool(name, capability, status = "available") {
  return {
    name,
    version: "1.0.0",
    provider: "local",
    capability,
    description: `Run ${name}`,
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source"] },
    outputDescription: "A durable result",
    sideEffects: ["writes-file"],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,
    resourceProfile: { class: "standard", cpuCores: 2, ramMb: 2048, vramMb: 0,
      workingDiskMb: 1024, networkRequired: false, confidence: "catalog_estimate" },
    availability: status === "available"
      ? { status, executableVersion: "1.2.3" }
      : { status, reason: "missing dependency" }
  };
}

const description = {
  capabilities: [
    {
      id: "media.inspect",
      available: true,
      tools: [tool("probe-a", "media.inspect"), tool("probe-b", "media.inspect", "unavailable")]
    },
    {
      id: "video.trim",
      available: true,
      tools: [tool("trim-a", "video.trim")]
    }
  ]
};

test("tool discovery summary keeps choice-critical fields and omits full schemas", () => {
  const summary = summarizeToolDescription(description);
  assert.deepEqual(summary.totals, {
    capabilities: 2,
    availableCapabilities: 2,
    tools: 3,
    availableTools: 2,
    unavailableTools: 1
  });
  assert.equal(summary.capabilities[0].availableToolCount, 1);
  assert.deepEqual(summary.capabilities[0].tools[1].availability, {
    status: "unavailable",
    reason: "missing dependency"
  });
  assert.equal(summary.capabilities[0].tools[0].provider, "local");
  assert.equal(summary.capabilities[0].tools[0].approvalRequired, false);
  assert.equal(summary.capabilities[0].tools[0].resourceProfile.class, "standard");
  assert.deepEqual(summary.capabilities[0].tools[0].requiredInputs, ["source"]);
  assert.equal("inputSchema" in summary.capabilities[0].tools[0], false);
  assert.equal("version" in summary.capabilities[0].tools[0], false);
});

test("tool discovery applies exact capability and tool filters without fallback", () => {
  const byCapability = filterToolDescription(description, { capability: "media.inspect" });
  assert.deepEqual(byCapability.capabilities.map((entry) => entry.id), ["media.inspect"]);

  const byTool = createToolDiscoveryView(description, { tool: "trim-a" });
  assert.equal(byTool.totals.capabilities, 1);
  assert.equal(byTool.totals.tools, 1);
  assert.equal(byTool.capabilities[0].tools[0].name, "trim-a");

  assert.throws(
    () => filterToolDescription(description, { capability: "MEDIA.INSPECT" }),
    (error) => error instanceof ToolDiscoveryError && /Không tìm thấy capability/.test(error.message)
  );
  assert.throws(() => filterToolDescription(description, { tool: "Probe-A" }), /Không tìm thấy công cụ/);
  assert.throws(
    () => filterToolDescription(description, { capability: "video.trim", tool: "probe-a" }),
    /không cung cấp capability/
  );
});

test("full discovery view preserves the registry contract after filtering", () => {
  const full = createToolDiscoveryView(description, { view: "full", tool: "probe-a" });
  assert.equal(full.view, undefined);
  assert.deepEqual(full.capabilities[0].tools[0].inputSchema, {
    type: "object",
    required: ["source"]
  });
});

test("tool list arguments default to summary and reject ambiguous input", () => {
  assert.deepEqual(parseToolListArgs([]), { view: "summary" });
  assert.deepEqual(
    parseToolListArgs(["--view", "full", "--capability", "media.inspect", "--tool", "probe-a"]),
    { view: "full", capability: "media.inspect", tool: "probe-a" }
  );
  assert.throws(() => parseToolListArgs(["--view", "raw"]), /Cách dùng/);
  assert.throws(() => parseToolListArgs(["--tool"]), /Cách dùng/);
  assert.throws(() => parseToolListArgs(["--tool", "probe-a", "--tool", "probe-b"]), /Cách dùng/);
});
