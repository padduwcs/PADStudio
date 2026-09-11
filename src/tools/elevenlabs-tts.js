import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalConfig } from "../config/local-config.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { fileEvidence, number, object, primaryFile, probe, text, workspace, command } from "./asset-tool-common.js";

function identifier(value, label) {
  return text(value, label, 100);
}

function parseInputs(inputs) {
  object(inputs, ["text", "modelId", "voiceId", "outputFormat", "stability", "similarityBoost", "style", "speed", "useSpeakerBoost", "seed"], "inputs");
  const outputFormat = inputs.outputFormat === undefined ? "mp3_44100_128" : identifier(inputs.outputFormat, "outputFormat");
  if (outputFormat !== "mp3_44100_128") {
    const error = new Error("This integration currently requires outputFormat mp3_44100_128.");
    error.code = "invalid_input";
    throw error;
  }
  if (inputs.useSpeakerBoost !== undefined && typeof inputs.useSpeakerBoost !== "boolean") {
    const error = new Error("useSpeakerBoost must be boolean.");
    error.code = "invalid_input";
    throw error;
  }
  const seed = inputs.seed === undefined ? null : Math.trunc(number(inputs.seed, "seed", 0, 4294967295));
  return {
    text: text(inputs.text, "text", 10000),
    modelId: identifier(inputs.modelId, "modelId"),
    voiceId: identifier(inputs.voiceId, "voiceId"),
    outputFormat,
    seed,
    voiceSettings: {
      stability: number(inputs.stability, "stability", 0, 1, 0.5),
      similarity_boost: number(inputs.similarityBoost, "similarityBoost", 0, 1, 0.75),
      style: number(inputs.style, "style", 0, 1, 0),
      speed: number(inputs.speed, "speed", 0.7, 1.2, 1),
      use_speaker_boost: inputs.useSpeakerBoost ?? true
    }
  };
}

export function createElevenLabsTts({
  loadConfig = loadLocalConfig,
  fetchImpl = globalThis.fetch,
  baseUrl = "https://api.elevenlabs.io",
  executeCommand = command,
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe"
} = {}) {
  async function client() {
    const config = await loadConfig();
    return new ElevenLabsClient({ apiKey: config.elevenLabs?.apiKey, fetchImpl, baseUrl });
  }
  return {
    name: "elevenlabs",
    version: "1.0.0",
    provider: "ElevenLabs",
    capability: "tts.synthesize",
    description: "Generate cloud narration with an explicitly selected ElevenLabs model and voice.",
    runtime: "cloud",
    executionMode: "sync",
    inputSchema: {
      type: "object", required: ["text", "modelId", "voiceId"], additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        modelId: { type: "string" }, voiceId: { type: "string" },
        outputFormat: { const: "mp3_44100_128", default: "mp3_44100_128" },
        stability: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        similarityBoost: { type: "number", minimum: 0, maximum: 1, default: 0.75 },
        style: { type: "number", minimum: 0, maximum: 1, default: 0 },
        speed: { type: "number", minimum: 0.7, maximum: 1.2, default: 1 },
        useSpeakerBoost: { type: "boolean", default: true },
        seed: { type: ["integer", "null"], minimum: 0, maximum: 4294967295 }
      }
    },
    outputDescription: "A previewable audio.tts MP3 Result reusable in video production.",
    sideEffects: ["Sends text to ElevenLabs and consumes credits only after single-use authorization."],
    cost: { currency: "USD", estimated: null },
    approvalRequired: true,
    producesFiles: true,
    async checkAvailability() {
      try {
        await client();
        return {
          status: "available", credentialConfigured: true,
          connection: "unchecked", connectionCheck: "npm run tts:inspect"
        };
      } catch {
        return {
          status: "unavailable", credentialConfigured: false,
          reason: "Set elevenLabs.apiKey in ignored padstudio.local.json; the key is never read from project inputs."
        };
      }
    },
    async inspect({ language = "vi", signal } = {}) {
      return (await client()).inspect({ language, signal });
    },
    async estimateUsage({ inputs, signal }) {
      const spec = parseInputs(inputs);
      const estimate = await (await client()).estimate({ text: spec.text, modelId: spec.modelId, signal });
      return estimate.usage;
    },
    async prepare({ inputs, outputWorkspace }) {
      const spec = parseInputs(inputs);
      const target = workspace(outputWorkspace);
      return {
        runtime: { client: await client(), spec, outputPath: join(target.temporaryDirectory, "speech.mp3") },
        trace: { directory: target.projectRelativeDirectory, spec }
      };
    },
    async execute({ client, spec, outputPath, signal }) {
      const response = await client.synthesize({ ...spec, signal });
      await writeFile(outputPath, response.bytes);
      const file = await fileEvidence(outputPath);
      const metadata = await probe(outputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const audio = metadata.streams.find((entry) => entry.codec_type === "audio");
      const durationSeconds = Number(metadata.format.duration);
      if (audio?.codec_name !== "mp3" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        const error = new Error("ElevenLabs output failed audio verification.");
        error.code = "invalid_output";
        error.requestSubmitted = true;
        throw error;
      }
      const actualCredits = Number.isFinite(response.actualCredits) && response.actualCredits >= 0 ?
        response.actualCredits : null;
      return {
        file, durationSeconds, actualCostUsd: null,
        actualUsage: actualCredits === null ? null : { unit: "credits", amount: actualCredits, basis: "character-cost response header" },
        providerRequestId: response.providerRequestId, traceId: response.traceId,
        verification: {
          status: "passed", checks: ["mp3_audio_stream", "positive_duration", "output_sha256"],
          details: { modelId: spec.modelId, voiceId: spec.voiceId, providerRequestId: response.providerRequestId, listeningReview: "not_performed" }
        }
      };
    },
    createResult({ prepared, execution }) {
      return {
        type: "audio.tts",
        name: "ElevenLabs TTS: " + prepared.trace.spec.voiceId,
        inputResources: [], inputResults: [],
        files: [primaryFile(prepared, execution, "speech.mp3", "audio")],
        data: {
          engine: "elevenlabs", language: "vi", modelId: prepared.trace.spec.modelId,
          voiceId: prepared.trace.spec.voiceId, outputFormat: prepared.trace.spec.outputFormat,
          voiceSettings: prepared.trace.spec.voiceSettings,
          textLength: [...prepared.trace.spec.text].length,
          durationSeconds: execution.durationSeconds, providerRequestId: execution.providerRequestId,
          traceId: execution.traceId, contentReview: "not_performed"
        },
        verification: execution.verification
      };
    }
  };
}
