export class ToolDiscoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolDiscoveryError";
  }
}

const USAGE = "Cách dùng: npm run tool:list -- [--view summary|full] [--capability <id>] [--tool <name>]";

function capabilitiesOf(description) {
  if (!description || !Array.isArray(description.capabilities)) {
    throw new ToolDiscoveryError("Mô tả capability không hợp lệ.");
  }
  return description.capabilities;
}

export function parseToolListArgs(args) {
  const options = { view: "summary" };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || !["--view", "--capability", "--tool"].includes(option) || seen.has(option)) {
      throw new ToolDiscoveryError(USAGE);
    }
    seen.add(option);
    if (option === "--view") {
      if (!["summary", "full"].includes(value)) throw new ToolDiscoveryError(USAGE);
      options.view = value;
    } else if (option === "--capability") {
      options.capability = value;
    } else {
      options.tool = value;
    }
  }
  return options;
}

export function filterToolDescription(description, filters = {}) {
  const capabilities = capabilitiesOf(description);
  const capabilityId = filters.capability ?? null;
  const toolName = filters.tool ?? null;

  if (capabilityId && !capabilities.some((entry) => entry.id === capabilityId)) {
    throw new ToolDiscoveryError(`Không tìm thấy capability: ${capabilityId}`);
  }

  const matchingTool = toolName
    ? capabilities.flatMap((entry) => entry.tools).find((tool) => tool.name === toolName)
    : null;
  if (toolName && !matchingTool) {
    throw new ToolDiscoveryError(`Không tìm thấy công cụ: ${toolName}`);
  }
  if (capabilityId && matchingTool && matchingTool.capability !== capabilityId) {
    throw new ToolDiscoveryError(
      `Công cụ ${toolName} không cung cấp capability ${capabilityId}.`
    );
  }

  const selected = capabilities
    .filter((entry) => !capabilityId || entry.id === capabilityId)
    .map((entry) => ({
      ...entry,
      tools: entry.tools.filter((tool) => !toolName || tool.name === toolName)
    }))
    .filter((entry) => entry.tools.length > 0)
    .map((entry) => ({
      ...entry,
      available: entry.tools.some((tool) => tool.availability.status === "available")
    }));

  return { capabilities: selected };
}

function summarizeTool(tool) {
  return {
    name: tool.name,
    provider: tool.provider,
    description: tool.description,
    requiredInputs: Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [],
    available: tool.availability.status === "available",
    availability: tool.availability,
    runtime: tool.runtime,
    executionMode: tool.executionMode,
    outputDescription: tool.outputDescription,
    producesFiles: tool.producesFiles,
    sideEffects: tool.sideEffects,
    cost: tool.cost,
    approvalRequired: tool.approvalRequired,
    bestFor: tool.bestFor,
    limitations: tool.limitations,
    skillIds: tool.skillIds,
    setup: tool.setup,
    usage: tool.usage,
    alternatives: tool.alternatives
  };
}

export function summarizeToolDescription(description) {
  const capabilities = capabilitiesOf(description).map((capability) => ({
    id: capability.id,
    available: capability.available,
    toolCount: capability.tools.length,
    availableToolCount: capability.tools.filter(
      (tool) => tool.availability.status === "available"
    ).length,
    tools: capability.tools.map(summarizeTool)
  }));
  const tools = capabilities.flatMap((capability) => capability.tools);

  return {
    view: "summary",
    totals: {
      capabilities: capabilities.length,
      availableCapabilities: capabilities.filter((capability) => capability.available).length,
      tools: tools.length,
      availableTools: tools.filter((tool) => tool.available).length,
      unavailableTools: tools.filter((tool) => !tool.available).length
    },
    capabilities
  };
}

export function createToolDiscoveryView(description, options = {}) {
  const filtered = filterToolDescription(description, options);
  return options.view === "full" ? filtered : summarizeToolDescription(filtered);
}
