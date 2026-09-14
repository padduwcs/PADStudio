const DIMENSIONS = ["quality", "control", "reliability", "costEfficiency", "latency", "privacy"];

export function rankToolChoices(description, request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("recommendation must be an object.");
  const unsupported = Object.keys(request).filter((key) => !["capability", "preferredTool", "priorities"].includes(key));
  if (unsupported.length) throw new Error(`Unsupported recommendation fields: ${unsupported.join(", ")}.`);
  if (typeof request.capability !== "string" || !request.capability.trim()) throw new Error("recommendation.capability is required.");
  if (request.preferredTool !== undefined && (typeof request.preferredTool !== "string" || !request.preferredTool.trim())) {
    throw new Error("recommendation.preferredTool must be a non-empty string.");
  }
  const capability = description.capabilities.find((item) => item.id === request.capability);
  if (!capability) throw new Error(`Unknown capability: ${request.capability}.`);
  const priorities = request.priorities ?? {};
  if (!priorities || typeof priorities !== "object" || Array.isArray(priorities)) throw new Error("recommendation.priorities must be an object.");
  const unknown = Object.keys(priorities).filter((key) => !DIMENSIONS.includes(key));
  if (unknown.length) throw new Error(`Unsupported priorities: ${unknown.join(", ")}.`);
  for (const [key, value] of Object.entries(priorities)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`recommendation.priorities.${key} must be a non-negative number.`);
  }
  const weights = Object.fromEntries(DIMENSIONS.map((key) => [key, priorities[key] ?? 1]));
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const choices = capability.tools.map((tool) => {
    const profile = tool.selectionProfile ?? {};
    const score = DIMENSIONS.reduce((sum, key) => sum + (profile[key] ?? 0) * weights[key], 0) / total;
    return { tool: tool.name, provider: tool.provider, available: tool.availability.status === "available",
      score: Math.round(score * 100) / 100, preferred: request.preferredTool === tool.name,
      bestFor: tool.bestFor, limitations: tool.limitations, setup: tool.setup, skillIds: tool.skillIds,
      cost: tool.cost, availability: tool.availability };
  }).sort((a, b) => Number(b.available) - Number(a.available) || Number(b.preferred) - Number(a.preferred) || b.score - a.score || a.tool.localeCompare(b.tool));
  return { version: "1.0", capability: capability.id, advisoryOnly: true,
    note: "The Agent or user must still choose an exact tool; PADStudio never silently falls back.", choices };
}
