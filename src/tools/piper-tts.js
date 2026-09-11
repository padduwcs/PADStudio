import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalConfig } from "../config/local-config.js";
import { command, fileEvidence, number, object, primaryFile, probe, text, workspace } from "./asset-tool-common.js";

const DEFAULT_MODEL = "vi_VN-vais1000-medium";

function fail(message, code = "invalid_input") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function modelId(value, fallback) {
  const actual = value === undefined ? fallback : value;
  if (typeof actual !== "string" || !/^vi_VN-[A-Za-z0-9_-]{1,90}$/.test(actual)) {
    fail("model must be a Vietnamese Piper voice id beginning with vi_VN-, not a path.");
  }
  return actual;
}

function integer(value, label, minimum, maximum, fallback) {
  const actual = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(actual) || actual < minimum || actual > maximum) {
    fail(label + " must be an integer from " + minimum + " to " + maximum + ".");
  }
  return actual;
}

async function readVoiceMetadata(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("Configured Piper voice metadata is not valid JSON.", "tool_unavailable");
  }
  const languageCode = value?.language?.code;
  const sampleRate = value?.audio?.sample_rate;
  const numSpeakers = value?.num_speakers;
  if (languageCode !== "vi_VN" || !Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(numSpeakers) || numSpeakers < 1) {
    fail("Configured Piper metadata must describe a vi_VN voice with a valid sample rate and speaker count.", "tool_unavailable");
  }
  return { languageCode, sampleRate, numSpeakers };
}

function parseInputs(inputs, fallbackModel) {
  object(inputs, ["text", "model", "speakerId", "lengthScale", "sentenceSilence"], "inputs");
  return {
    text: text(inputs.text, "text", 10000),
    model: modelId(inputs.model, fallbackModel),
    speakerId: integer(inputs.speakerId, "speakerId", 0, 1000, 0),
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

  async function resolveVoice(config, model) {
    if (!config.modelDirectory) fail("Configure piper.modelDirectory in padstudio.local.json.", "tool_unavailable");
    const modelPath = join(config.modelDirectory, model + ".onnx");
    const modelConfigPath = modelPath + ".json";
    try {
      await Promise.all([access(modelPath), access(modelConfigPath)]);
    } catch {
      fail("Configured Piper model files are unavailable.", "tool_unavailable");
    }
    return { modelPath, metadata: await readVoiceMetadata(modelConfigPath) };
  }

  return {
    name: "piper-local",
    version: "1.1.0",
    provider: "Piper",
    capability: "tts.synthesize",
    description: "Generate local Vietnamese narration with Piper without network access or credits.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: {
      type: "object", required: ["text"], additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        model: { type: "string", pattern: "^vi_VN-", default: DEFAULT_MODEL },
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
      try {
        const model = modelId(config.defaultModel, DEFAULT_MODEL);
        const voice = await resolveVoice(config, model);
        await executeCommand(config.pythonCommand, ["-m", "piper", "--help"], { timeout: 10000 });
        return {
          status: "available", model, language: voice.metadata.languageCode.replace("_", "-"),
          sampleRate: voice.metadata.sampleRate, numSpeakers: voice.metadata.numSpeakers,
          runtime: "python -m piper"
        };
      } catch (error) {
        return {
          status: "unavailable",
          reason: error?.code === "tool_unavailable" ? error.message :
            "Install piper-tts and place both configured .onnx and .onnx.json voice files in piper.modelDirectory."
        };
      }
    },
    async prepare({ inputs, outputWorkspace }) {
      const config = await configured();
      const spec = parseInputs(inputs, config.defaultModel);
      const target = workspace(outputWorkspace);
      const voice = await resolveVoice(config, spec.model);
      if (spec.speakerId >= voice.metadata.numSpeakers) {
        fail("speakerId is outside the configured Piper voice speaker range.");
      }
      const inputPath = join(target.temporaryDirectory, "input.txt");
      await writeFile(inputPath, spec.text, "utf8");
      return {
        runtime: {
          pythonCommand: config.pythonCommand, modelPath: voice.modelPath, metadata: voice.metadata, inputPath,
          outputPath: join(target.temporaryDirectory, "speech.wav"), spec
        },
        trace: { directory: target.projectRelativeDirectory, spec, voice: voice.metadata }
      };
    },
    async execute({ pythonCommand, modelPath, metadata: voice, inputPath, outputPath, spec, availability, signal }) {
      await executeCommand(pythonCommand, [
        "-m", "piper", "--model", modelPath, "--input-file", inputPath,
        "--output-file", outputPath, "--speaker", String(spec.speakerId),
        "--length-scale", String(spec.lengthScale), "--sentence-silence", String(spec.sentenceSilence)
      ], { signal, timeout: 120000 });
      await rm(inputPath);
      const file = await fileEvidence(outputPath);
      const metadata = await probe(outputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const audioStreams = metadata.streams.filter((entry) => entry.codec_type === "audio");
      const audio = audioStreams[0];
      const durationSeconds = Number(metadata.format.duration);
      const sampleRate = Number(audio?.sample_rate);
      if (audioStreams.length !== 1 || audio?.codec_name !== "pcm_s16le" ||
          sampleRate !== voice.sampleRate || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        fail("Piper output failed audio verification.", "invalid_output");
      }
      return {
        file, durationSeconds, sampleRate, actualCostUsd: 0,
        actualUsage: null,
        verification: {
          status: "passed",
          checks: ["single_pcm_s16le_audio_stream", "voice_sample_rate", "positive_duration", "output_sha256"],
          details: { model: spec.model, language: voice.languageCode.replace("_", "-"), runtime: availability.runtime, listeningReview: "not_performed" }
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
          engine: "piper", language: prepared.trace.voice.languageCode.replace("_", "-"), model: prepared.trace.spec.model,
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
