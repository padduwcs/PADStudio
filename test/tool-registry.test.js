import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry, ToolRegistryError } from "../src/execution/tool-registry.js";

function fakeTool(overrides = {}) {
  return {
    name: "probe-a",
    version: "1.0.0",
    provider: "local",
    capability: "media.inspect",
    description: "Probe media",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object" },
    outputDescription: "Metadata",
    sideEffects: [],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    async checkAvailability() {
      return { status: "available", executableVersion: "1.2.3" };
    },
    async prepare() {},
    async execute() {},
    createResult() {},
    ...overrides
  };
}

test("registry reports tools by capability and their real availability", async () => {
  const registry = new ToolRegistry([
    fakeTool(),
    fakeTool({
      name: "probe-b",
      async checkAvailability() {
        return { status: "unavailable", reason: "missing binary" };
      }
    })
  ]);
  const description = await registry.describeCapabilities();
  assert.equal(description.capabilities.length, 1);
  assert.equal(description.capabilities[0].id, "media.inspect");
  assert.equal(description.capabilities[0].available, true);
  assert.deepEqual(
    description.capabilities[0].tools.map((tool) => [tool.name, tool.availability.status]),
    [["probe-a", "available"], ["probe-b", "unavailable"]]
  );
});

test("registry rejects duplicate tools and never substitutes a different capability", () => {
  const registry = new ToolRegistry([fakeTool()]);
  assert.throws(() => registry.register(fakeTool()), /đã được đăng ký/);
  assert.throws(
    () => registry.get("probe-a", "media.render"),
    (error) => error instanceof ToolRegistryError && /không cung cấp/.test(error.message)
  );
  assert.throws(() => registry.get("missing", "media.inspect"), /Không tìm thấy công cụ/);
});

test("registry turns a failed availability check into an unavailable status", async () => {
  const registry = new ToolRegistry([
    fakeTool({
      async checkAvailability() {
        throw new Error("dependency check crashed");
      }
    })
  ]);
  const description = await registry.describeCapabilities();
  assert.equal(description.capabilities[0].available, false);
  assert.deepEqual(description.capabilities[0].tools[0].availability, {
    status: "unavailable",
    reason: "dependency check crashed"
  });
});

test("registry rejects tools with incomplete public contracts", () => {
  assert.throws(
    () => new ToolRegistry([fakeTool({ inputSchema: null })]),
    /inputSchema/
  );
  assert.throws(
    () => new ToolRegistry([fakeTool({ outputDescription: "" })]),
    /outputDescription/
  );
  assert.throws(
    () => new ToolRegistry([fakeTool({ resourceProfile: { class: "heavy" } })]),
    /resourceProfile/
  );
});

test("registry exposes a valid planning resource profile", async () => {
  const resourceProfile = { class: "standard", cpuCores: 2, ramMb: 2048, vramMb: 0,
    workingDiskMb: 1024, networkRequired: false, confidence: "declared" };
  const registry = new ToolRegistry([fakeTool({ resourceProfile })]);
  assert.deepEqual((await registry.describeCapabilities()).capabilities[0].tools[0].resourceProfile, resourceProfile);
});

test("registry removes optional VRAM demand when a tool is discovered in CPU mode", async () => {
  const resourceProfile = { class: "heavy", cpuCores: 4, ramMb: 8192, vramMb: 6144,
    workingDiskMb: 4096, networkRequired: false, confidence: "catalog_estimate" };
  const registry = new ToolRegistry([fakeTool({
    resourceProfile,
    async checkAvailability() {
      return { status: "available", device: "cpu" };
    },
  })]);
  const reported = (await registry.describeCapabilities()).capabilities[0].tools[0].resourceProfile;
  assert.equal(reported.vramMb, 0);
  assert.equal(resourceProfile.vramMb, 6144);
});
