export class ToolRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolRegistryError(label + " không hợp lệ.");
  }
  return value.trim();
}

function validateTool(tool) {
  if (!tool || typeof tool !== "object") {
    throw new ToolRegistryError("Công cụ không hợp lệ.");
  }
  for (const field of [
    "name",
    "version",
    "provider",
    "capability",
    "description",
    "runtime",
    "executionMode",
    "outputDescription"
  ]) {
    requireText(tool[field], "Thuộc tính " + field + " của công cụ");
  }
  for (const method of ["checkAvailability", "prepare", "execute", "createResult"]) {
    if (typeof tool[method] !== "function") {
      throw new ToolRegistryError("Công cụ " + tool.name + " thiếu hàm " + method + ".");
    }
  }
  if (
    !tool.cost ||
    tool.cost.currency !== "USD" ||
    !(tool.cost.estimated === null || Number.isFinite(tool.cost.estimated)) ||
    (tool.cost.estimated !== null && tool.cost.estimated < 0)
  ) {
    throw new ToolRegistryError("Chi phí của công cụ " + tool.name + " không hợp lệ.");
  }
  if (!Array.isArray(tool.sideEffects)) {
    throw new ToolRegistryError("sideEffects của công cụ " + tool.name + " không hợp lệ.");
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
    throw new ToolRegistryError("inputSchema của công cụ " + tool.name + " không hợp lệ.");
  }
  if (typeof tool.approvalRequired !== "boolean") {
    throw new ToolRegistryError("approvalRequired của công cụ " + tool.name + " không hợp lệ.");
  }
  if (tool.approvalRequired && typeof tool.estimateUsage !== "function") {
    throw new ToolRegistryError("Paid tools must declare estimateUsage: " + tool.name);
  }
  if (tool.cost.estimated > 0 && !tool.approvalRequired) {
    throw new ToolRegistryError("Tools with estimated USD cost must require exact approval: " + tool.name);
  }
  for (const field of ["bestFor", "limitations", "skillIds"]) {
    if (tool[field] !== undefined && (!Array.isArray(tool[field]) || tool[field].some((item) => typeof item !== "string" || !item.trim()))) {
      throw new ToolRegistryError(`${field} của công cụ ${tool.name} không hợp lệ.`);
    }
  }
  if (tool.setup !== undefined && (!tool.setup || typeof tool.setup !== "object" || Array.isArray(tool.setup) || typeof tool.setup.kind !== "string" || typeof tool.setup.instructions !== "string" || !Array.isArray(tool.setup.configKeys))) {
    throw new ToolRegistryError(`setup của công cụ ${tool.name} không hợp lệ.`);
  }
  if (tool.selectionProfile !== undefined) {
    const dimensions = ["quality", "control", "reliability", "costEfficiency", "latency", "privacy"];
    if (!tool.selectionProfile || dimensions.some((key) => !Number.isFinite(tool.selectionProfile[key]) || tool.selectionProfile[key] < 1 || tool.selectionProfile[key] > 5)) {
      throw new ToolRegistryError(`selectionProfile của công cụ ${tool.name} không hợp lệ.`);
    }
  }
  if (tool.resourceProfile !== undefined) {
    const profile = tool.resourceProfile;
    const numericFields = ["cpuCores", "ramMb", "vramMb", "workingDiskMb"];
    if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
        !["light", "standard", "heavy", "provider"].includes(profile.class) ||
        numericFields.some((key) => !Number.isFinite(profile[key]) || profile[key] < 0) ||
        typeof profile.networkRequired !== "boolean" || !["declared", "catalog_estimate"].includes(profile.confidence)) {
      throw new ToolRegistryError(`resourceProfile của công cụ ${tool.name} không hợp lệ.`);
    }
  }
  return tool;
}

function publicToolInfo(tool, availability) {
  const resourceProfile = tool.resourceProfile ? structuredClone(tool.resourceProfile) : null;
  // A tool discovered in CPU mode must not retain a catalog VRAM estimate
  // that belongs to its optional accelerated path.
  if (resourceProfile && availability?.device === "cpu") resourceProfile.vramMb = 0;
  return {
    name: tool.name,
    version: tool.version,
    provider: tool.provider,
    capability: tool.capability,
    description: tool.description,
    runtime: tool.runtime,
    executionMode: tool.executionMode,
    inputSchema: tool.inputSchema,
    outputDescription: tool.outputDescription,
    sideEffects: [...tool.sideEffects],
    cost: { ...tool.cost },
    approvalRequired: Boolean(tool.approvalRequired),
    producesFiles: Boolean(tool.producesFiles),
    bestFor: [...(tool.bestFor ?? [])], limitations: [...(tool.limitations ?? [])],
    skillIds: [...(tool.skillIds ?? [])], setup: tool.setup ? structuredClone(tool.setup) : null,
    usage: tool.usage ? structuredClone(tool.usage) : null,
    selectionProfile: tool.selectionProfile ? structuredClone(tool.selectionProfile) : null,
    resourceProfile,
    availability
  };
}

export class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    for (const tool of tools) this.register(tool);
  }

  register(tool) {
    const validTool = validateTool(tool);
    if (this.tools.has(validTool.name)) {
      throw new ToolRegistryError("Tên công cụ đã được đăng ký: " + validTool.name);
    }
    this.tools.set(validTool.name, validTool);
    return this;
  }

  get(toolName, capability) {
    const normalizedName = requireText(toolName, "Tên công cụ");
    const normalizedCapability = requireText(capability, "Capability");
    const tool = this.tools.get(normalizedName);
    if (!tool) {
      throw new ToolRegistryError("Không tìm thấy công cụ: " + normalizedName);
    }
    if (tool.capability !== normalizedCapability) {
      throw new ToolRegistryError(
        "Công cụ " + normalizedName + " không cung cấp capability " + normalizedCapability + "."
      );
    }
    return tool;
  }

  async describeCapabilities() {
    const descriptions = await Promise.all(
      [...this.tools.values()].map(async (tool) => {
        let availability;
        try {
          availability = await tool.checkAvailability();
        } catch (error) {
          availability = {
            status: "unavailable",
            reason: error?.message || "Không thể kiểm tra công cụ."
          };
        }
        if (!availability || !["available", "unavailable"].includes(availability.status)) {
          throw new ToolRegistryError("Công cụ " + tool.name + " trả trạng thái không hợp lệ.");
        }
        return publicToolInfo(tool, availability);
      })
    );

    const grouped = new Map();
    for (const tool of descriptions) {
      const capability = grouped.get(tool.capability) ?? { id: tool.capability, tools: [] };
      capability.tools.push(tool);
      grouped.set(tool.capability, capability);
    }
    for (const entry of grouped.values()) {
      const names = entry.tools.map((tool) => tool.name);
      for (const tool of entry.tools) tool.alternatives = names.filter((name) => name !== tool.name);
    }
    return {
      capabilities: [...grouped.values()]
        .map((entry) => ({
          ...entry,
          available: entry.tools.some((tool) => tool.availability.status === "available")
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    };
  }
}
