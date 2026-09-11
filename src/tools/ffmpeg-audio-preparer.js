import { join } from "node:path";
import { command, fail, object, number, sourceReference, workspace, hashFile, fileEvidence, probe, ffmpegAvailability, primaryFile, sourceSchema } from "./asset-tool-common.js";

export function createFfmpegAudioPreparer({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = command
} = {}) {
  return {
    name: "ffmpeg-audio-prepare", version: "1.0.0", provider: "FFmpeg", capability: "audio.prepare",
    description: "Tách/cắt audio từ nguồn đã đăng ký; gain, fade và loudness tùy chọn. Xuất WAV stereo 48 kHz để dùng tiếp.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    cost: { currency: "USD", estimated: 0 }, sideEffects: ["Tạo audio mới trong output project; không sửa nguồn."],
    outputDescription: "audio.prepared với WAV, source range/hash, tham số và bằng chứng kỹ thuật.",
    inputSchema: { type: "object", required: ["source"], additionalProperties: false, properties: {
      source: sourceSchema, startSeconds: { type: "number", minimum: 0, default: 0 },
      endSeconds: { type: "number", minimum: 0 }, audioStream: { type: "integer", minimum: 0, maximum: 15, default: 0 },
      gainDb: { type: "number", minimum: -30, maximum: 12, default: 0 },
      fadeInSeconds: { type: "number", minimum: 0, maximum: 30, default: 0 },
      fadeOutSeconds: { type: "number", minimum: 0, maximum: 30, default: 0 },
      loudnessTargetLufs: { type: "number", minimum: -30, maximum: -10 }
    } },
    checkAvailability() { return ffmpegAvailability(executeCommand, ffmpegCommand, ffprobeCommand); },
    async prepare({ store, projectId, inputs, outputWorkspace, signal }) {
      object(inputs, ["source", "startSeconds", "endSeconds", "audioStream", "gainDb", "fadeInSeconds", "fadeOutSeconds", "loudnessTargetLufs"]);
      const source = sourceReference(inputs.source);
      const spec = {
        startSeconds: number(inputs.startSeconds, "startSeconds", 0, 86400, 0),
        endSeconds: inputs.endSeconds === undefined ? null : number(inputs.endSeconds, "endSeconds", 0, 86400),
        audioStream: number(inputs.audioStream, "audioStream", 0, 15, 0),
        gainDb: number(inputs.gainDb, "gainDb", -30, 12, 0),
        fadeInSeconds: number(inputs.fadeInSeconds, "fadeInSeconds", 0, 30, 0),
        fadeOutSeconds: number(inputs.fadeOutSeconds, "fadeOutSeconds", 0, 30, 0),
        loudnessTargetLufs: inputs.loudnessTargetLufs === undefined ? null : number(inputs.loudnessTargetLufs, "loudnessTargetLufs", -30, -10)
      };
      if (!Number.isInteger(spec.audioStream)) fail("audioStream must be an integer.");
      const media = await store.resolveMediaSource(projectId, source);
      if (!["audio", "video"].includes(media.mediaType)) fail("audio.prepare needs an audio or video source.");
      const output = workspace(outputWorkspace);
      return { runtime: { inputPath: media.filePath, outputPath: join(output.temporaryDirectory, "audio.wav"), spec, signal },
        trace: { source: media.trace, name: media.itemName, inputResources: media.inputResources, inputResults: media.inputResults, directory: output.projectRelativeDirectory } };
    },
    async execute({ inputPath, outputPath, spec, signal, availability }) {
      const sourceSha256 = await hashFile(inputPath);
      const metadata = await probe(inputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const stream = metadata.streams.filter((entry) => entry.codec_type === "audio")[spec.audioStream];
      if (!stream) fail("Requested audio stream does not exist.", "missing_audio");
      const duration = Number(stream.duration ?? metadata.format.duration);
      const endSeconds = spec.endSeconds ?? duration;
      if (!Number.isFinite(duration) || duration <= 0 || endSeconds > duration + 0.001 ||
          endSeconds <= spec.startSeconds || endSeconds - spec.startSeconds > 1800) fail("Requested range must exist and be at most 1800 seconds.");
      const durationSeconds = endSeconds - spec.startSeconds;
      if (spec.fadeInSeconds + spec.fadeOutSeconds > durationSeconds) fail("Fades exceed selected duration.");
      const base = ["-hide_banner", "-i", inputPath, "-map", "0:a:" + spec.audioStream, "-vn", "-sn", "-dn"];
      const filters = ["asetpts=PTS-STARTPTS", "atrim=start=" + spec.startSeconds + ":end=" + endSeconds, "asetpts=PTS-STARTPTS", "volume=" + spec.gainDb + "dB"];
      if (spec.fadeInSeconds) filters.push("afade=t=in:d=" + spec.fadeInSeconds);
      if (spec.fadeOutSeconds) filters.push("afade=t=out:st=" + (durationSeconds - spec.fadeOutSeconds) + ":d=" + spec.fadeOutSeconds);
      let loudness = null;
      if (spec.loudnessTargetLufs !== null) {
        const first = await executeCommand(ffmpegCommand, [...base, "-af", [...filters, "loudnorm=I=" + spec.loudnessTargetLufs + ":TP=-1.5:LRA=11:print_format=json"].join(","), "-f", "null", "-"], { signal });
        const match = String(first.stderr).match(/\{\s*"input_i"[\s\S]*?\}/);
        try { loudness = JSON.parse(match?.[0]); } catch { fail("Missing loudness measurements.", "invalid_output"); }
        if (!["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"].every((key) => Number.isFinite(Number(loudness?.[key])))) fail("Cannot normalize silent or unmeasurable audio.", "unmeasurable_audio");
        filters.push("loudnorm=I=" + spec.loudnessTargetLufs + ":TP=-1.5:LRA=11:measured_I=" + loudness.input_i +
          ":measured_TP=" + loudness.input_tp + ":measured_LRA=" + loudness.input_lra + ":measured_thresh=" + loudness.input_thresh +
          ":offset=" + loudness.target_offset + ":linear=true");
      }
      await executeCommand(ffmpegCommand, [...base, "-loglevel", "error", "-af", filters.join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-y", outputPath], { signal });
      const file = await fileEvidence(outputPath);
      const output = await probe(outputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const audio = output.streams.find((entry) => entry.codec_type === "audio");
      if (output.streams.length !== 1 || audio?.codec_name !== "pcm_s16le" || Number(audio.sample_rate) !== 48000 || audio.channels !== 2 ||
          Math.abs(Number(output.format.duration) - durationSeconds) > 0.06 || !Number.isFinite(Number(output.format.duration))) fail("Prepared audio failed stream/duration verification.", "invalid_output");
      if (sourceSha256 !== await hashFile(inputPath)) fail("Source changed during audio preparation.", "source_changed");
      return { file, durationSeconds: Number(output.format.duration), endSeconds, sourceSha256, loudness, actualCostUsd: 0,
        verification: { status: "passed", checks: ["audio_stream_and_range", "wav_pcm_stereo_48k", "duration_within_0.06_seconds", "source_hash_stable", "output_sha256"],
          details: { executableVersion: availability.executableVersion, loudnessTwoPass: loudness !== null, listeningReview: "not_performed" } } };
    },
    createResult({ prepared, execution }) {
      return { type: "audio.prepared", name: "Audio: " + prepared.trace.name,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults,
        files: [primaryFile(prepared, execution, "audio.wav", "audio")],
        data: { ...prepared.runtime.spec, endSeconds: execution.endSeconds, durationSeconds: execution.durationSeconds,
          source: prepared.trace.source, sourceSha256: execution.sourceSha256, loudnessMeasurements: execution.loudness, contentReview: "not_performed" },
        verification: execution.verification };
    }
  };
}
