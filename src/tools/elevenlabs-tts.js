import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadLocalConfig } from "../config/local-config.js";
import { calibratedUsage, observedCreditRate } from "../execution/credit-calibration.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { command, fileEvidence, number, object, primaryFile, probe, text, workspace } from "./asset-tool-common.js";
import { reviewSpeechInputs, reviewSpeechText, summarizeSpeechReview } from "./speech-text-review.js";
import { buildSpeechTiming } from "./speech-timing.js";

const MAX_TIMING_FILE_BYTES = 8 * 1024 * 1024;

function identifier(value, label) {
  return text(value, label, 100);
}

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_input";
  throw error;
}

function parseInputs(inputs) {
  object(inputs, [
    "text", "modelId", "voiceId", "languageCode", "outputFormat", "stability",
    "similarityBoost", "style", "speed", "useSpeakerBoost", "seed", "withTimestamps"
  ], "inputs");
  const outputFormat = inputs.outputFormat === undefined ?
    "mp3_44100_128" : identifier(inputs.outputFormat, "outputFormat");
  if (outputFormat !== "mp3_44100_128") {
    invalid("This integration currently requires outputFormat mp3_44100_128.");
  }
  const languageCode = inputs.languageCode === undefined ? "vi" : inputs.languageCode;
  if (typeof languageCode !== "string" || !/^[a-z]{2}$/.test(languageCode)) {
    invalid("languageCode must be a lowercase ISO 639-1 code.");
  }
  if (inputs.useSpeakerBoost !== undefined && typeof inputs.useSpeakerBoost !== "boolean") {
    invalid("useSpeakerBoost must be boolean.");
  }
  if (inputs.withTimestamps !== undefined && typeof inputs.withTimestamps !== "boolean") {
    invalid("withTimestamps must be boolean.");
  }
  let seed = null;
  if (inputs.seed !== undefined && inputs.seed !== null) {
    seed = number(inputs.seed, "seed", 0, 4294967295);
    if (!Number.isSafeInteger(seed)) invalid("seed must be an integer.");
  }
  return {
    text: text(inputs.text, "text", 10000),
    modelId: identifier(inputs.modelId, "modelId"),
    voiceId: identifier(inputs.voiceId, "voiceId"),
    languageCode,
    outputFormat,
    seed,
    withTimestamps: inputs.withTimestamps === true,
    voiceSettings: {
      stability: number(inputs.stability, "stability", 0, 1, 0.5),
      similarity_boost: number(inputs.similarityBoost, "similarityBoost", 0, 1, 0.75),
      style: number(inputs.style, "style", 0, 1, 0),
      speed: number(inputs.speed, "speed", 0.7, 1.2, 1),
      use_speaker_boost: inputs.useSpeakerBoost ?? true
    }
  };
}

// Word timing is a bonus on top of audio that has already been paid for. Whatever goes wrong here must cost the audio
// nothing, so this never throws: a timing that cannot be trusted or stored is reported as unavailable, with the reason.
async function storeTiming({ spec, response, durationSeconds, outputPath }) {
  try {
    const built = buildSpeechTiming({
      text: spec.text, alignment: response.alignment, normalizedAlignment: response.normalizedAlignment,
      audioDurationSeconds: durationSeconds
    });
    if (!built.ok) return { available: false, reason: built.reason };
    const timingPath = join(dirname(outputPath), "timing.json");
    await writeFile(timingPath, JSON.stringify(built.document) + "\n", "utf8");
    return {
      available: true,
      file: await fileEvidence(timingPath, MAX_TIMING_FILE_BYTES),
      words: built.document.words.length,
      characters: built.document.alignment.characters.length,
      lastEndSeconds: built.document.checks.lastEndSeconds,
      endTimesAre: built.document.checks.endTimesAre,
      textMatchesRequest: built.document.checks.textMatchesRequest
    };
  } catch (error) {
    return { available: false, reason: "The timing file could not be written: " + (error?.message || "unknown error") };
  }
}

function timingSummary(timing) {
  if (!timing) return { requested: false };
  if (!timing.available) return { requested: true, available: false, reason: timing.reason };
  return {
    requested: true, available: true, fileId: "timing", words: timing.words, characters: timing.characters,
    lastEndSeconds: timing.lastEndSeconds, endTimesAre: timing.endTimesAre, textMatchesRequest: timing.textMatchesRequest
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
    version: "1.4.0",
    provider: "ElevenLabs",
    capability: "tts.synthesize",
    description: "Generate cloud narration with an explicitly selected ElevenLabs model and voice. " +
      "Set withTimestamps to receive when each word is spoken from the same request.",
    runtime: "cloud",
    executionMode: "sync",
    inputSchema: {
      type: "object",
      required: ["text", "modelId", "voiceId"],
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        modelId: { type: "string" },
        voiceId: { type: "string" },
        languageCode: { type: "string", pattern: "^[a-z]{2}$", default: "vi" },
        outputFormat: { const: "mp3_44100_128", default: "mp3_44100_128" },
        stability: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        similarityBoost: { type: "number", minimum: 0, maximum: 1, default: 0.75 },
        style: { type: "number", minimum: 0, maximum: 1, default: 0 },
        speed: { type: "number", minimum: 0.7, maximum: 1.2, default: 1 },
        useSpeakerBoost: { type: "boolean", default: true },
        seed: { type: ["integer", "null"], minimum: 0, maximum: 4294967295 },
        withTimestamps: {
          type: "boolean", default: false,
          description: "Use the provider's with-timestamps request and store word times as the Result file `timing`. " +
            "Opt-in: the plain request is the one proven against the live provider."
        }
      }
    },
    outputDescription: "A previewable audio.tts MP3 Result reusable in video production, with word timing when withTimestamps is set.",
    sideEffects: ["Sends text to ElevenLabs and consumes credits only after single-use authorization."],
    cost: { currency: "USD", estimated: null },
    approvalRequired: true,
    producesFiles: true,
    async checkAvailability() {
      try {
        await client();
      } catch {
        return {
          status: "unavailable",
          credentialConfigured: false,
          reason: "No ElevenLabs API key yet. The user adds it on the observer Tools page, Giọng đọc tab (/?panel=tools&tab=voice), which saves it to the git-ignored padstudio.local.json; the key is never read from project inputs."
        };
      }
      try {
        const ffprobe = await executeCommand(ffprobeCommand, ["-version"], { timeout: 5000 });
        return {
          status: "available",
          credentialConfigured: true,
          ffprobeVersion: ffprobe.stdout.split(/\r?\n/)[0] || "available",
          connection: "unchecked",
          connectionCheck: "npm run tts:inspect"
        };
      } catch {
        return {
          status: "unavailable",
          credentialConfigured: true,
          reason: "Install ffprobe or configure PADSTUDIO_FFPROBE_PATH before using ElevenLabs."
        };
      }
    },
    async inspect({ language = "vi", signal } = {}) {
      return (await client()).inspect({ language, signal });
    },
    async estimateUsage({ inputs, signal }) {
      const spec = parseInputs(inputs);
      const estimate = await (await client()).estimate({
        text: spec.text,
        modelId: spec.modelId,
        voiceId: spec.voiceId,
        language: spec.languageCode,
        voiceSettings: spec.voiceSettings,
        signal
      });
      return estimate.usage;
    },
    // For a voice with its own rate the listed estimate is only a minimum. Earlier paid requests of the same voice and
    // model in this project show what it really costs per character, so the estimate (and the ceiling approved from
    // it) is measured from them when they exist and agree.
    async refineUsage({ store, projectId, inputs, usage }) {
      if (!usage.uncertain) return usage;
      const spec = parseInputs(inputs);
      const observation = await observedCreditRate(store, projectId, {
        engine: "elevenlabs", voiceId: spec.voiceId, modelId: spec.modelId
      });
      return calibratedUsage(usage, observation, [...spec.text].length);
    },
    reviewInputs({ inputs }) {
      return reviewSpeechInputs(inputs);
    },
    async prepare({ inputs, outputWorkspace, signal }) {
      const spec = parseInputs(inputs);
      const target = workspace(outputWorkspace);
      await executeCommand(ffprobeCommand, ["-version"], { signal, timeout: 5000 });
      return {
        runtime: {
          client: await client(),
          spec,
          outputPath: join(target.temporaryDirectory, "speech.mp3")
        },
        trace: {
          directory: target.projectRelativeDirectory, spec,
          textReview: summarizeSpeechReview(reviewSpeechText(spec.text))
        }
      };
    },
    async execute({ client, spec, outputPath, signal, onProviderResponse }) {
      const usage = (credits) => credits === null ? null : {
        unit: "credits", amount: credits, basis: "character-cost response header"
      };
      const response = await client.synthesize({
        ...spec,
        signal,
        onProviderResponse: onProviderResponse ? (receipt) => onProviderResponse({
          actualUsage: usage(receipt.actualCredits),
          providerRequestId: receipt.providerRequestId,
          traceId: receipt.traceId
        }) : undefined
      });
      const actualUsage = usage(response.actualCredits);
      try {
        await writeFile(outputPath, response.bytes);
        const file = await fileEvidence(outputPath);
        const metadata = await probe(outputPath, {
          run: executeCommand,
          ffprobe: ffprobeCommand,
          signal
        });
        const audioStreams = metadata.streams.filter((entry) => entry.codec_type === "audio");
        const audio = audioStreams[0];
        const durationSeconds = Number(metadata.format.duration);
        if (audioStreams.length !== 1 || audio?.codec_name !== "mp3" ||
            !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          const error = new Error("ElevenLabs output failed audio verification.");
          error.code = "invalid_output";
          throw error;
        }
        const timing = spec.withTimestamps ? await storeTiming({ spec, response, durationSeconds, outputPath }) : null;
        return {
          file,
          durationSeconds,
          timing,
          actualCostUsd: null,
          actualUsage,
          providerRequestId: response.providerRequestId,
          traceId: response.traceId,
          verification: {
            status: "passed",
            checks: [
              "single_mp3_audio_stream", "positive_duration", "output_sha256",
              ...(timing?.available ? ["provider_alignment_consistent"] : [])
            ],
            details: {
              modelId: spec.modelId,
              voiceId: spec.voiceId,
              languageCode: spec.languageCode,
              providerRequestId: response.providerRequestId,
              listeningReview: "not_performed",
              ...(timing && !timing.available ? { timingUnavailable: timing.reason } : {})
            }
          }
        };
      } catch (error) {
        if (error && typeof error === "object") error.requestSubmitted = true;
        throw error;
      }
    },
    createResult({ prepared, execution }) {
      return {
        type: "audio.tts",
        name: "ElevenLabs TTS: " + prepared.trace.spec.voiceId,
        inputResources: [],
        inputResults: [],
        files: [
          primaryFile(prepared, execution, "speech.mp3", "audio"),
          ...(execution.timing?.available ? [{
            id: "timing", role: "timing", path: prepared.trace.directory + "/timing.json", name: "timing.json",
            mediaType: "application/json", ...execution.timing.file
          }] : [])
        ],
        data: {
          engine: "elevenlabs",
          language: prepared.trace.spec.languageCode,
          modelId: prepared.trace.spec.modelId,
          voiceId: prepared.trace.spec.voiceId,
          outputFormat: prepared.trace.spec.outputFormat,
          voiceSettings: prepared.trace.spec.voiceSettings,
          textLength: [...prepared.trace.spec.text].length,
          durationSeconds: execution.durationSeconds,
          providerRequestId: execution.providerRequestId,
          traceId: execution.traceId,
          textReview: prepared.trace.textReview,
          timing: timingSummary(execution.timing),
          contentReview: "not_performed"
        },
        verification: execution.verification
      };
    }
  };
}
