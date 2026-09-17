const DEFAULT_PROFILE = Object.freeze({ quality: 3, control: 4, reliability: 4, costEfficiency: 5, latency: 4, privacy: 5 });

function group(capability) {
  if (capability.startsWith("animation.")) return ["Project-native, revisioned code animation.", "Generated code executes locally after exact static validation; validation is not a sandbox.", "code-animation"];
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
  if (tool.name.startsWith("manim-")) return { kind: "local_runtime", instructions: "Install and pin Manim Community plus FFmpeg, or configure PADSTUDIO_MANIM_PATH.", configKeys: ["PADSTUDIO_MANIM_PATH"] };
  if (tool.name.startsWith("remotion-")) return { kind: "local_runtime", instructions: "Install a pinned Remotion CLI/runtime plus Chrome for Testing or Chrome Headless Shell under .runtime-tools, or configure PADSTUDIO_REMOTION_PATH and PADSTUDIO_CHROME_PATH explicitly. PADStudio never invokes npx or downloads a browser. It does not auto-select branded Chrome 136+ because remote-debugging policy can reject automation profiles.", configKeys: ["PADSTUDIO_REMOTION_PATH", "PADSTUDIO_CHROME_PATH"] };
  if (tool.name.startsWith("hyperframes-")) return { kind: "local_runtime", instructions: "Install a pinned HyperFrames CLI in .runtime-tools/code-animation-node or configure PADSTUDIO_HYPERFRAMES_PATH. PADStudio uses an existing Chrome/Edge installation (or PADSTUDIO_CHROME_PATH) and never invokes npx to auto-install it.", configKeys: ["PADSTUDIO_HYPERFRAMES_PATH", "PADSTUDIO_CHROME_PATH"] };
  return { kind: "tool_reported", instructions: "Use live tool availability and setup hints.", configKeys: [] };
}

function resourceProfile(tool) {
  const networkRequired = ["network", "cloud"].includes(tool.runtime) || ["elevenlabs", "wikimedia-stock", "https-media"].includes(tool.name);
  if (tool.name.startsWith("manim-")) return { class: "standard", cpuCores: 2, ramMb: 2048, vramMb: 0, workingDiskMb: 2048, networkRequired: false, confidence: "catalog_estimate" };
  if (tool.name.startsWith("remotion-")) return { class: "standard", cpuCores: 4, ramMb: 4096, vramMb: 0, workingDiskMb: 2048, networkRequired: false, confidence: "catalog_estimate" };
  if (tool.name.startsWith("hyperframes-")) return { class: "standard", cpuCores: 4, ramMb: 3072, vramMb: 0, workingDiskMb: 2048, networkRequired: false, confidence: "catalog_estimate" };
  if (tool.name.startsWith("faster-whisper")) return { class: "heavy", cpuCores: 4, ramMb: 8192, vramMb: 6000, workingDiskMb: 4096, networkRequired: false, confidence: "catalog_estimate" };
  if (tool.name === "piper-local") return { class: "standard", cpuCores: 2, ramMb: 2048, vramMb: 0, workingDiskMb: 1024, networkRequired: false, confidence: "catalog_estimate" };
  if (tool.runtime.startsWith("local")) return { class: "standard", cpuCores: 2, ramMb: 2048, vramMb: 0, workingDiskMb: 4096, networkRequired: false, confidence: "catalog_estimate" };
  return { class: "provider", cpuCores: 1, ramMb: 512, vramMb: 0, workingDiskMb: 1024, networkRequired, confidence: "catalog_estimate" };
}

export function applyToolGuidance(tool) {
  const info = group(tool.capability);
  const profile = tool.name === "elevenlabs"
    ? { quality: 5, control: 4, reliability: 4, costEfficiency: 2, latency: 3, privacy: 2 }
    : tool.name === "piper-local"
      ? { quality: 3, control: 3, reliability: 5, costEfficiency: 5, latency: 5, privacy: 5 }
      : DEFAULT_PROFILE;
  const runtimeSkill = tool.name.startsWith("remotion-") ? "remotion-animation"
    : tool.name.startsWith("hyperframes-") ? "hyperframes-animation"
      : tool.name.startsWith("manim-") ? "manim-animation" : null;
  const animationReview = ["animation.preview", "animation.render"].includes(tool.capability) ? ["code-animation-review"] : [];
  const skillIds = tool.capability.startsWith("animation.") ? ["code-animation", ...(runtimeSkill ? [runtimeSkill] : []), ...animationReview]
    : tool.name === "wikimedia-stock" ? ["stock-sourcing", "asset-preparation"]
    : tool.name === "external-generated-media" ? ["asset-preparation", "tool-selection"]
    : tool.name === "local-output-quality" ? ["result-review", "human-release-review"]
    : [info[2]];
  return { ...tool, bestFor: [info[0]], limitations: [info[1]], skillIds, setup: setup(tool),
    usage: { unit: tool.cost?.estimated === 0 ? "run" : (tool.approvalRequired ? "provider_usage" : "unknown"), estimate: tool.cost?.estimated ?? null },
    selectionProfile: profile, resourceProfile: resourceProfile(tool) };
}
