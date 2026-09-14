import { copyFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { object, text, number, sourceReference, workspace, fileEvidence, command, ffmpegAvailability, primaryFile, fail } from "./asset-tool-common.js";

export function createExternalGeneratedMedia({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = command
} = {}) {
  return {
    name: "external-generated-media", version: "1.0.0", provider: "External Agent/provider", capability: "media.register-generated",
    description: "Register an already imported/generated image, audio or video as a traceable Result with provider, model, prompt and rights provenance.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    cost: { currency: "USD", estimated: 0 }, sideEffects: ["Copies exact managed media into a new immutable run output; does not call the external provider."],
    outputDescription: "media.generated with exact bytes, generation provenance and explicit unverified human/rights review state.",
    inputSchema: { type: "object", required: ["source", "mediaType", "name", "generation"], additionalProperties: false, properties: {
      source: { type: "object" }, mediaType: { enum: ["image", "audio", "video"] }, name: { type: "string", maxLength: 240 },
      generation: { type: "object", required: ["provider", "model", "prompt", "rightsBasis"], additionalProperties: false, properties: {
        provider: { type: "string" }, model: { type: "string" }, prompt: { type: "string" }, rightsBasis: { type: "string" },
        seed: { type: ["string", "number"] }, requestId: { type: "string" }, createdAt: { type: "string" }, externalCostUsd: { type: "number" }
      } }
    } },
    async checkAvailability() { return ffmpegAvailability(executeCommand, ffmpegCommand, ffprobeCommand); },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      object(inputs, ["source", "mediaType", "name", "generation"]);
      if (!["image", "audio", "video"].includes(inputs.mediaType)) fail("mediaType must be image, audio or video.");
      const source = sourceReference(inputs.source);
      const managed = await store.resolveMediaSource(projectId, source);
      if (managed.mediaType !== inputs.mediaType) fail("Managed source does not match mediaType.");
      object(inputs.generation, ["provider", "model", "prompt", "rightsBasis", "seed", "requestId", "createdAt", "externalCostUsd"], "generation");
      const generation = {
        provider: text(inputs.generation.provider, "generation.provider", 200), model: text(inputs.generation.model, "generation.model", 300),
        prompt: text(inputs.generation.prompt, "generation.prompt", 12000), rightsBasis: text(inputs.generation.rightsBasis, "generation.rightsBasis", 2000),
        ...(inputs.generation.seed === undefined ? {} : { seed: inputs.generation.seed }),
        ...(inputs.generation.requestId === undefined ? {} : { requestId: text(inputs.generation.requestId, "generation.requestId", 500) }),
        ...(inputs.generation.createdAt === undefined ? {} : { createdAt: text(inputs.generation.createdAt, "generation.createdAt", 100) }),
        ...(inputs.generation.externalCostUsd === undefined ? {} : { externalCostUsd: number(inputs.generation.externalCostUsd, "generation.externalCostUsd", 0, 100000) })
      };
      if (generation.seed !== undefined && !["string", "number"].includes(typeof generation.seed)) fail("generation.seed must be text or number.");
      if (typeof generation.seed === "number" && !Number.isFinite(generation.seed)) fail("generation.seed must be finite.");
      if (typeof generation.seed === "string") generation.seed = text(generation.seed, "generation.seed", 500);
      if (generation.createdAt !== undefined && !Number.isFinite(Date.parse(generation.createdAt))) fail("generation.createdAt must be an ISO date-time.");
      const output = workspace(outputWorkspace); const extension = extname(managed.itemName).toLowerCase();
      if (!/^\.[a-z0-9]{1,8}$/.test(extension)) fail("Managed source has no safe media extension.");
      return { runtime: { managed, mediaType: inputs.mediaType, outputPath: join(output.temporaryDirectory, "generated" + extension) },
        trace: { directory: output.projectRelativeDirectory, name: text(inputs.name, "name", 240), source, generation } };
    },
    async execute({ managed, mediaType, outputPath, availability, signal }) {
      await copyFile(managed.filePath, outputPath); const file = await fileEvidence(outputPath);
      const probe = JSON.parse((await executeCommand(ffprobeCommand, ["-v", "error", "-show_format", "-show_streams", "-of", "json", outputPath], { signal })).stdout);
      const video = probe.streams?.find((item) => item.codec_type === "video" && !item.disposition?.attached_pic);
      const audio = probe.streams?.find((item) => item.codec_type === "audio");
      if ((mediaType === "image" && !video) || (mediaType === "video" && !video) || (mediaType === "audio" && (!audio || video))) fail("Generated media does not match its declared type.", "invalid_output");
      await executeCommand(ffmpegCommand, ["-v", "error", "-xerror", "-i", outputPath, "-map", mediaType === "audio" ? "0:a:0" : "0:v:0", ...(mediaType === "image" ? ["-frames:v", "1"] : []), "-f", "null", "-"], { signal });
      return { file, mediaType, outputName: "generated" + extname(outputPath), actualCostUsd: 0, verification: { status: "passed", checks: ["managed_source", "declared_media_type", "primary_stream_decode", "output_sha256"], details: { executableVersion: availability.executableVersion, contentReview: "not_performed", rightsReview: "caller_supplied_not_verified" } } };
    },
    createResult({ prepared, execution }) {
      return { type: "media.generated", name: prepared.trace.name, inputResources: prepared.runtime.managed.inputResources, inputResults: prepared.runtime.managed.inputResults,
        files: [primaryFile(prepared, execution, execution.outputName, execution.mediaType)], data: { generation: prepared.trace.generation, source: prepared.trace.source, contentReview: "not_performed", rightsReview: "caller_supplied_not_verified" }, verification: execution.verification };
    }
  };
}
