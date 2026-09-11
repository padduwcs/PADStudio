import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalConfig } from "../config/local-config.js";
import { command, fileEvidence, number, object, primaryFile, probe, text, workspace } from "./asset-tool-common.js";

const DEFAULT_MODEL = "vi_VN-vais1000-medium";

function modelId(value, fallback) {
  const actual = value === undefined ? fallback : value;
  if (typeof actual !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(actual)) {
    const error = new Error("model must be a Piper voice id, not a path.");
    error.code = "invalid_input";
    throw error;
  }
  return actual;
}

function parseInputs(inputs, fallbackModel) {
  object(inputs, ["text", "model", "speakerId", "lengthScale", "sentenceSilence"], "inputs");
  return {
    text: text(inputs.text, "text", 10000),
    model: modelId(inputs.model, fallbackModel),
    speakerId: Math.trunc(number(inputs.speakerId, "speakerId", 0, 1000, 0)),
    lengthScale: number(inputs.lengthScale, "lengthScale", 0.5, 2, 1),
    sentenceSilence: number(inputs.sentenceSilence, "sentenceSilence", 0, 2, 0.2)
  };
}

export function createPiperTts({
  loadConfig = loadLocalConfig,
  executeCommand = command,
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe"
} = {}) {
  async function configured() {
    const config = await loadConfig();
    return {
      pythonCommand: config.piper?.pythonCommand || "python",
      modelDirectory: config.piper?.modelDirectory || null,
      defaultModel: config.piper?.defaultModel || DEFAULT_MODEL
    };
  }
  return {
    name: "piper-local",
    version: "1.0.0",
    provider: "Piper",
    capability: "tts.synthesize",
    description: "Generate local narration with Piper without network access or credits.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object", required: ["text"], additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        model: { type: "string", default: DEFAULT_MODEL },
        speakerId: { type: "integer", minimum: 0, default: 0 },
        lengthScale: { type: "number", minimum: 0.5, maximum: 2, default: 1 },
        sentenceSilence: { type: "number", minimum: 0, maximum: 2, default: 0.2 }
      }
    },
    outputDescription: "A previewable audio.tts WAV Result reusable in video production.",
    sideEffects: ["Creates a WAV in project outputs; never downloads a model automatically."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,
    async checkAvailability() {
      let config;
      try { config = await configured(); }
      catch { return { status: "unavailable", reason: "Local configuration is invalid." }; }
      if (!config.modelDirectory) {
        return { status: "unavailable", reason: "Configure piper.modelDirectory in padstudio.local.json." };
      }
      const model = config.defaultModel;
      try {
        await Promise.all([
          access(join(config.modelDirectory, model + ".onnx")),
          access(join(config.modelDirectory, model + ".onnx.json")),
          executeCommand(config.pythonCommand, ["-m", "piper", "--help"], { timeout: 10000 })
        ]);
        return { status: "available", model, language: "vi-VN", runtime: "python -m piper" };
      } catch {
        return {
          status: "unavailable",
          reason: "Install piper-tts and place both configured .onnx and .onnx.json voice files in piper.modelDirectory."
        };
      }
    },
    async prepare({ inputs, outputWorkspace }) {
      const config = await configured();
      const spec = parseInputs(inputs, config.defaultModel);
      const target = workspace(outputWorkspace);
      const modelPath = join(config.modelDirectory, spec.model + ".onnx");
      const modelConfigPath = modelPath + ".json";
      try { await Promise.all([access(modelPath), access(modelConfigPath)]); }
      catch {
        const error = new Error("Configured Piper model files are unavailable.");
        error.code = "tool_unavailable";
        throw error;
      }
      const inputPath = join(target.temporaryDirectory, "input.txt");
      await writeFile(inputPath, spec.text, "utf8");
      return {
        runtime: {
          pythonCommand: config.pythonCommand, modelPath, inputPath,
          outputPath: join(target.temporaryDirectory, "speech.wav"), spec
        },
        trace: { directory: target.projectRelativeDirectory, spec }
      };
    },
    async execute({ pythonCommand, modelPath, inputPath, outputPath, spec, availability, signal }) {
      await executeCommand(pythonCommand, [
        "-m", "piper", "--model", modelPath, "--input-file", inputPath,
        "--output-file", outputPath, "--speaker", String(spec.speakerId),
        "--length-scale", String(spec.lengthScale), "--sentence-silence", String(spec.sentenceSilence)
      ], { signal, timeout: 120000 });
      const file = await fileEvidence(outputPath);
      const metadata = await probe(outputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const audio = metadata.streams.find((entry) => entry.codec_type === "audio");
      const durationSeconds = Number(metadata.format.duration);
      if (audio?.codec_name !== "pcm_s16le" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        const error = new Error("Piper output failed audio verification.");
        error.code = "invalid_output";
        throw error;
      }
      return {
        file, durationSeconds, sampleRate: Number(audio.sample_rate), actualCostUsd: 0,
        actualUsage: null,
        verification: {
          status: "passed",
          checks: ["pcm_s16le_audio_stream", "positive_duration", "output_sha256"],
          details: { model: spec.model, runtime: availability.runtime, listeningReview: "not_performed" }
        }
      };
    },
    createResult({ prepared, execution }) {
      return {
        type: "audio.tts",
        name: "Piper TTS: " + prepared.trace.spec.model,
        inputResources: [], inputResults: [],
        files: [primaryFile(prepared, execution, "speech.wav", "audio")],
        data: {
          engine: "piper", language: "vi-VN", model: prepared.trace.spec.model,
          speakerId: prepared.trace.spec.speakerId, lengthScale: prepared.trace.spec.lengthScale,
          sentenceSilence: prepared.trace.spec.sentenceSilence,
          textLength: [...prepared.trace.spec.text].length,
          durationSeconds: execution.durationSeconds, sampleRate: execution.sampleRate,
          contentReview: "not_performed"
        },
        verification: execution.verification
      };
    }
  };
}
