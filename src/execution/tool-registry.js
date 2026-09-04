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
    !Number.isFinite(tool.cost.estimated) ||
    tool.cost.estimated < 0
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
  return tool;
}

function publicToolInfo(tool, availability) {
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
