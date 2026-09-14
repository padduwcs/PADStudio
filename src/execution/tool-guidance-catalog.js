const DEFAULT_PROFILE = Object.freeze({ quality: 3, control: 4, reliability: 4, costEfficiency: 5, latency: 4, privacy: 5 });

function group(capability) {
  if (capability.startsWith("source.") || ["audio.transcribe", "audio.analyze", "video.detect-scenes"].includes(capability)) return ["Evidence-backed source understanding.", "Machine evidence requires review.", "source-understanding"];
  if (["audio.prepare", "graphic.render", "media.acquire", "media.search-stock", "tts.synthesize"].includes(capability)) return ["Traceable reusable project assets.", "Does not approve creative quality or usage rights.", "asset-preparation"];
  if (["video.render-sequence", "video.export-delivery"].includes(capability)) return ["Exact revision rendering and delivery.", "Does not approve on behalf of the Agent or user.", "video-sequence-planning"];
  if (["media.inspect", "video.inspect-output"].includes(capability)) return ["Technical media inspection.", "Does not replace content or aesthetic review.", "result-review"];
  return ["Deterministic media operation.", "Does not choose creative direction.", "video-editing-craft"];
}

function setup(tool) {
  if (tool.name === "elevenlabs") return { kind: "provider_account", instructions: "Configure elevenLabs.apiKey in padstudio.local.json.", configKeys: ["elevenLabs.apiKey"] };
  if (tool.name === "piper-local") return { kind: "local_model", instructions: "Install the pinned Piper model and configure its directory when needed.", configKeys: ["piper.modelDirectory", "piper.defaultModel"] };
  if (tool.name === "wikimedia-stock") return { kind: "network", instructions: "Requires HTTPS access to Wikimedia Commons; no API key.", configKeys: [] };
  return { kind: "tool_reported", instructions: "Use live tool availability and setup hints.", configKeys: [] };
}

export function applyToolGuidance(tool) {
  const info = group(tool.capability);
  const profile = tool.name === "elevenlabs"
    ? { quality: 5, control: 4, reliability: 4, costEfficiency: 2, latency: 3, privacy: 2 }
    : tool.name === "piper-local"
      ? { quality: 3, control: 3, reliability: 5, costEfficiency: 5, latency: 5, privacy: 5 }
      : DEFAULT_PROFILE;
  const skillIds = tool.name === "wikimedia-stock" ? ["stock-sourcing", "asset-preparation"]
    : tool.name === "external-generated-media" ? ["asset-preparation", "tool-selection"]
    : tool.name === "local-output-quality" ? ["result-review", "human-release-review"]
    : [info[2]];
  return { ...tool, bestFor: [info[0]], limitations: [info[1]], skillIds, setup: setup(tool),
    usage: { unit: tool.cost?.estimated === 0 ? "run" : (tool.approvalRequired ? "provider_usage" : "unknown"), estimate: tool.cost?.estimated ?? null },
    selectionProfile: profile };
}
