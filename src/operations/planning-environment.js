import { USER_SERVICE_CATEGORIES } from "../config/local-config.js";

export const TOOLS_PAGE_PATH = "/?panel=tools";

// What the user said they can use outside PADStudio, from the observer's Tools page. The Agent never sees an
// API key; it only learns which integrated providers are configured through the normal tool availability.
function userServices(localSettings) {
  const guidance = "Ask the user to open the observer Tools page (" + TOOLS_PAGE_PATH + ", e.g. http://127.0.0.1:7603" + TOOLS_PAGE_PATH +
    ") to add API keys or say which outside services they have. Never ask for, accept or repeat an API key in chat.";
  if (!localSettings) return { declared: [], note: null, settingsPage: TOOLS_PAGE_PATH, guidance };
  if (localSettings.error) return { declared: [], note: null, settingsPage: TOOLS_PAGE_PATH, error: localSettings.error, guidance };
  const declared = USER_SERVICE_CATEGORIES
    .filter((category) => localSettings.services?.available?.includes(category.id))
    .map((category) => ({ id: category.id, label: category.label }));
  return {
    declared,
    note: localSettings.services?.note ?? null,
    settingsPage: TOOLS_PAGE_PATH,
    guidance: guidance + (declared.length
      ? " PADStudio does not call these services: use one only when it fits the brief, agree with the user who operates it (the Agent host or the user), and register every file it produces with media.register-generated, including provider, prompt and rights."
      : "")
  };
}

function toolStatus(tool) {
  return tool?.availability?.status === "available";
}

function gib(bytes) {
  return Number.isFinite(bytes) ? Math.round((bytes / 1024 ** 3) * 10) / 10 : null;
}

function runtimeEntry(tools, names) {
  const matches = tools.filter((tool) => names.some((name) => tool.name === name || tool.name.startsWith(name)));
  const available = matches.filter(toolStatus);
  return {
    available: available.length > 0,
    tools: available.map((tool) => tool.name),
    versions: [...new Set(available.map((tool) => tool.availability?.executableVersion).filter(Boolean))].slice(0, 2),
    reason: available.length ? null : matches.map((tool) => tool.availability?.reason).find(Boolean) ?? "not_registered",
  };
}

function setupOffers(capabilities) {
  const seen = new Set();
  const offers = [];
  for (const capability of capabilities) {
    for (const tool of capability.tools ?? []) {
      if (toolStatus(tool) || !tool.setup?.instructions || tool.setup.kind === "tool_reported" || seen.has(tool.setup.instructions)) continue;
      seen.add(tool.setup.instructions);
      offers.push({
        capability: capability.id,
        tool: tool.name,
        kind: tool.setup.kind,
        instructions: tool.setup.instructions,
        configKeys: tool.setup.configKeys ?? [],
      });
    }
  }
  return offers.slice(0, 6);
}

function resourceRisks(machine, tools) {
  const totalRamMb = (machine.memory?.totalBytes ?? 0) / 1024 ** 2;
  const freeDiskMb = (machine.storage?.freeBytes ?? Infinity) / 1024 ** 2;
  const knownVramMb = Math.max(0, ...(machine.gpu?.adapters ?? []).map((adapter) => (adapter.memoryBytes ?? 0) / 1024 ** 2));
  const risks = [];
  for (const tool of tools.filter(toolStatus)) {
    const profile = tool.resourceProfile;
    if (!profile) continue;
    const reasons = [];
    if (profile.cpuCores > (machine.cpu?.logicalCores ?? 0)) reasons.push(`benefits from about ${profile.cpuCores} logical CPU cores`);
    if (profile.ramMb > totalRamMb) reasons.push(`needs about ${profile.ramMb} MiB RAM`);
    if (profile.workingDiskMb > freeDiskMb) reasons.push(`needs about ${profile.workingDiskMb} MiB working disk`);
    if (profile.vramMb > 0 && machine.gpu?.status === "detected" && profile.vramMb > knownVramMb) reasons.push(`needs about ${profile.vramMb} MiB VRAM`);
    if (profile.vramMb > 0 && machine.gpu?.status !== "detected") reasons.push("requires GPU/VRAM that was not confirmed");
    if (reasons.length) risks.push({ tool: tool.name, capability: tool.capability, reasons, confidence: profile.confidence });
  }
  return risks.slice(0, 10);
}

export function buildPlanningEnvironment({ machine, capabilityDescription, onboarding = false, localSettings = null }) {
  const capabilities = capabilityDescription?.capabilities ?? [];
  const tools = capabilities.flatMap((capability) => capability.tools ?? []);
  const unavailable = capabilities.filter((capability) => !capability.available).map((capability) => capability.id);
  const compositionRuntimes = {
    manim: runtimeEntry(tools, ["manim-ce"]),
    remotion: runtimeEntry(tools, ["remotion-local"]),
    hyperframes: runtimeEntry(tools, ["hyperframes-local"]),
    ffmpeg: runtimeEntry(tools, ["ffmpeg-sequence"]),
  };
  const warnings = [];
  const encoderCandidates = machine.mediaAcceleration?.ffmpegEncoderCandidates ?? [];
  if (machine.gpu?.status === "unavailable") warnings.push("GPU/VRAM could not be confirmed; do not plan GPU-dependent local generation from this profile alone.");
  if (!machine.mediaAcceleration?.ffmpegDetected) warnings.push("FFmpeg encoder inventory could not be read.");
  if ((machine.memory?.totalBytes ?? 0) > 0 && machine.memory.totalBytes < 8 * 1024 ** 3) warnings.push("System RAM is below 8 GiB; prefer bounded previews and low concurrency.");
  for (const [runtime, status] of Object.entries(compositionRuntimes)) {
    if (!status.available) warnings.push(`${runtime} composition is unavailable: ${status.reason}`);
  }
  const availableRuntimes = Object.entries(compositionRuntimes).filter(([, value]) => value.available).map(([name]) => name);
  return {
    version: "1.0",
    checkedAt: machine.checkedAt,
    mode: onboarding ? "onboarding" : "refresh",
    machine: {
      platform: machine.operatingSystem.platform,
      architecture: machine.operatingSystem.architecture,
      cpuLogicalCores: machine.cpu?.logicalCores ?? 0,
      cpuModels: machine.cpu?.models ?? [],
      memoryTotalGiB: gib(machine.memory?.totalBytes),
      memoryFreeGiB: gib(machine.memory?.freeBytes),
      storageFreeGiB: gib(machine.storage?.freeBytes),
      gpu: machine.gpu,
      ffmpegEncoderCandidates: encoderCandidates,
    },
    capabilitySummary: {
      total: capabilities.length,
      available: capabilities.length - unavailable.length,
      unavailable,
    },
    capabilityMenu: capabilities.map((capability) => ({
      id: capability.id,
      configured: (capability.tools ?? []).filter(toolStatus).length,
      total: (capability.tools ?? []).length,
      availableTools: (capability.tools ?? []).filter(toolStatus).map((tool) => tool.name),
    })),
    compositionRuntimes,
    setupOffers: setupOffers(capabilities),
    userServices: userServices(localSettings),
    resourceRisks: resourceRisks(machine, tools),
    warnings,
    planningHints: [
      availableRuntimes.length
        ? `Choose among the available composition runtimes (${availableRuntimes.join(", ")}) from the visual idea; do not silently substitute one.`
        : "No composition runtime is currently available; resolve setup before planning a rendered video.",
      encoderCandidates.length
        ? "FFmpeg exposes hardware-encoder candidates, but matching hardware usability must be verified before planning around acceleration."
        : "FFmpeg exposes no hardware-encoder candidate; plan conservatively around software encoding.",
      "This is a planning profile, not a benchmark; validate the exact tool before expensive or long execution.",
    ],
    privacy: machine.privacy,
  };
}
