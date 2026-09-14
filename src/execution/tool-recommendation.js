const DIMENSIONS = ["quality", "control", "reliability", "costEfficiency", "latency", "privacy"];

export function rankToolChoices(description, request) {
  if (!request || typeof request.capability !== "string") throw new Error("recommendation.capability is required.");
  const capability = description.capabilities.find((item) => item.id === request.capability);
  if (!capability) throw new Error(`Unknown capability: ${request.capability}.`);
  const priorities = request.priorities ?? {};
  const unknown = Object.keys(priorities).filter((key) => !DIMENSIONS.includes(key));
  if (unknown.length) throw new Error(`Unsupported priorities: ${unknown.join(", ")}.`);
  const weights = Object.fromEntries(DIMENSIONS.map((key) => [key, Number.isFinite(priorities[key]) && priorities[key] >= 0 ? priorities[key] : 1]));
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
