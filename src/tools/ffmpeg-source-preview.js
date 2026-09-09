import {
  SourceAnalysisToolError,
  checkedFile,
  effectiveRange,
  executableVersion,
  finiteNumber,
  integer,
  listedFeature,
  onlyFields,
  outputFile,
  probeSource,
  readRuntimeProfiles,
  resolvePreparedSource,
  runProcess,
  runtimeProfileDigest,
  safeDetail,
  selectStream,
  temporaryOutputPath,
  timeoutForDuration
} from "./source-analysis-common.js";

function normalizeOptions(value, defaults) {
  onlyFields(value, ["videoStream", "audioStream", "maxWidth", "videoCrf"], "preview.options");
  const output = { ...defaults, ...value };
  for (const field of ["videoStream", "audioStream"]) {
    if (output[field] !== undefined && (!Number.isSafeInteger(output[field]) || output[field] < 0)) {
      throw new SourceAnalysisToolError(`preview.options.${field} phải là stream index không âm.`, "invalid_input");
    }
  }
  if (!Number.isSafeInteger(output.maxWidth) || output.maxWidth < 160 || output.maxWidth > 3840) {
    throw new SourceAnalysisToolError("preview.options.maxWidth phải trong [160,3840].", "invalid_input");
  }
  if (!Number.isSafeInteger(output.videoCrf) || output.videoCrf < 0 || output.videoCrf > 40) {
    throw new SourceAnalysisToolError("preview.options.videoCrf phải trong [0,40].", "invalid_input");
  }
  return output;
}

function isAnimatedImage(mediaType, probe) {
  if (mediaType !== "image") return false;
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  return (integer(video?.nb_frames) ?? 1) > 1
    || (finiteNumber(probe.format?.duration) ?? finiteNumber(video?.duration) ?? 0) > 0.1;
}

function chooseOptionalAudio(probe, requested) {
  const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
  if (!audio.length) return null;
  return selectStream(probe, "audio", requested, { allowDefault: false }).stream;
}

function videoFilter(stream, maxWidth) {
  const factor = `min(1,${maxWidth}/(iw*sar))`;
  const scale = `scale=w='max(2,trunc(iw*sar*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)',setsar=1`;
  const hdr = ["smpte2084", "arib-std-b67"].includes(stream.color_transfer);
  if (!hdr) return { filter: `${scale},format=yuv420p`, hdr: false };
  return {
    filter: `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,${scale},format=yuv420p`,
    hdr: true
  };
}

export function createFfmpegSourcePreview({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe"
} = {}) {
  return {
    name: "ffmpeg-source-preview",
    version: "1.0.0",
    provider: "FFmpeg",
    capability: "source.preview",
    description: "Tạo proxy browser-safe từ ảnh, audio hoặc video mà không sửa nguồn.",
    runtime: "local",
    executionMode: "sync",
    inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.preview với proxy H.264/AAC/PNG và mapping về source time.",
    sideEffects: ["Tạo proxy media mới trong outputs của project."],
    cost: { currency: "USD", estimated: 0 },
    approvalRequired: false,
    producesFiles: true,

    async checkAvailability({ profileId = "source-preview-v1" } = {}) {
      try {
        profileId ??= "source-preview-v1";
        const profileDigest = await runtimeProfileDigest(profileId);
        const [ffmpeg, ffprobe, encoders, filters] = await Promise.all([
          runProcess(ffmpegCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffprobeCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-hide_banner", "-encoders"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-hide_banner", "-filters"], { timeoutMs: 5_000 })
        ]);
        for (const encoder of ["aac", "libx264", "png"]) {
          if (!listedFeature(encoders.stdout, encoder)) throw new SourceAnalysisToolError(`FFmpeg thiếu encoder ${encoder}.`, "tool_unavailable");
        }
        for (const filter of ["format", "scale"]) {
          if (!listedFeature(filters.stdout, filter)) throw new SourceAnalysisToolError(`FFmpeg thiếu filter ${filter}.`, "tool_unavailable");
        }
        return {
          status: "available",
          executableVersion: executableVersion(ffmpeg.stdout, "ffmpeg"),
          libraryVersions: { ffprobe: executableVersion(ffprobe.stdout, "ffprobe") },
          profileVersion: profileId,
          profileDigest,
          requiredFeatures: ["encoder:aac", "encoder:libx264", "encoder:png", "filter:format", "filter:scale"]
        };
      } catch (error) {
        return { status: "unavailable", reason: safeDetail(error.message, [ffmpegCommand, ffprobeCommand]) };
      }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "preview", producesFiles: true });
      const profileId = prepared.normalized.analysis.profileId ?? "source-preview-v1";
      const profiles = await readRuntimeProfiles();
      if (profileId !== "source-preview-v1" || !profiles.profiles[profileId]) {
        throw new SourceAnalysisToolError(`Preview profile không hỗ trợ: ${profileId}.`, "invalid_input");
      }
      const options = normalizeOptions(prepared.normalized.analysis.options, profiles.profiles[profileId]);
      const probe = await probeSource(prepared.media.filePath, { ffprobeCommand, signal: context.signal });
      const videos = probe.streams.filter((stream) => stream.codec_type === "video");
      const animated = isAnimatedImage(prepared.media.mediaType, probe);
      let kind;
      let video = null;
      let audio = null;
      if (prepared.media.mediaType === "image" && !animated) {
        kind = "image";
        video = selectStream(probe, "video", options.videoStream ?? prepared.normalized.analysis.track).stream;
      } else if (videos.length) {
        kind = "video";
        video = selectStream(probe, "video", options.videoStream ?? prepared.normalized.analysis.track).stream;
        audio = chooseOptionalAudio(probe, options.audioStream);
      } else {
        kind = "audio";
        audio = selectStream(probe, "audio", options.audioStream ?? prepared.normalized.analysis.track, { allowDefault: false }).stream;
      }
      const duration = finiteNumber(probe.format.duration) ?? finiteNumber(video?.duration) ?? finiteNumber(audio?.duration);
      const range = effectiveRange(prepared.normalized.analysis.range, duration, { image: kind === "image" });
      const name = kind === "image" ? "preview.png" : kind === "audio" ? "preview.m4a" : "preview.mp4";
      return {
        runtime: {
          inputPath: prepared.media.filePath,
          outputPath: temporaryOutputPath(prepared.output, name),
          kind,
          video,
          audio,
          range,
          options,
          animated,
          signal: context.signal
        },
        trace: { ...prepared.trace, workspace: prepared.output, name }
      };
    },

    async execute({ inputPath, outputPath, kind, video, audio, range, options, animated, signal, availability }) {
      const args = ["-hide_banner", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe"];
      if (range && range.startSeconds > 0) args.push("-ss", String(range.startSeconds));
      args.push("-i", inputPath);
      if (range) args.push("-t", String(range.endSeconds - range.startSeconds));
      let transform = null;
      if (kind === "image") {
        const visual = videoFilter(video, options.maxWidth);
        transform = visual.hdr ? "hdr_to_sdr_bt709_hable_rotation_sar_scale" : "display_rotation_sar_and_scale";
        args.push("-map", `0:${video.index}`, "-frames:v", "1", "-vf", visual.filter.replace(",format=yuv420p", ""), "-y", outputPath);
      } else if (kind === "audio") {
        args.push("-map", `0:${audio.index}`, "-vn", "-c:a", options.audioCodec, "-b:a", options.audioBitrate, "-movflags", "+faststart", "-y", outputPath);
      } else {
        const visual = videoFilter(video, options.maxWidth);
          transform = visual.hdr ? "hdr_to_sdr_bt709_hable_rotation_sar_scale" : "display_rotation_sar_and_scale";
        args.push("-map", `0:${video.index}`);
        if (audio) args.push("-map", `0:${audio.index}`);
        args.push("-vf", visual.filter, "-c:v", options.videoCodec, "-preset", options.videoPreset, "-crf", String(options.videoCrf));
        if (audio) args.push("-c:a", options.audioCodec, "-b:a", options.audioBitrate);
        else args.push("-an");
        args.push("-movflags", "+faststart", "-y", outputPath);
      }
      try {
        await runProcess(ffmpegCommand, args, {
          signal,
          timeoutMs: timeoutForDuration(range, { baseMs: 60_000, factor: 4 })
        });
      } catch (error) {
        const code = ["smpte2084", "arib-std-b67"].includes(video?.color_transfer) ? "hdr_preview_failed" : error.code;
        throw new SourceAnalysisToolError(error.message, code, { cause: error });
      }
      const info = await checkedFile(outputPath, "Preview proxy");
      const output = await probeSource(outputPath, { ffprobeCommand, signal });
      const outputVideo = output.streams.find((stream) => stream.codec_type === "video");
      const outputAudio = output.streams.find((stream) => stream.codec_type === "audio");
      if ((kind === "image" || kind === "video") && !outputVideo) throw new SourceAnalysisToolError("Preview thiếu video/image stream.", "invalid_output");
      if (kind === "audio" && !outputAudio) throw new SourceAnalysisToolError("Preview thiếu audio stream.", "invalid_output");
      if (kind === "image" && outputVideo.codec_name !== "png") throw new SourceAnalysisToolError("Preview ảnh không dùng codec PNG.", "invalid_output");
      if (kind === "video" && outputVideo.codec_name !== "h264") throw new SourceAnalysisToolError("Preview video không dùng codec H.264.", "invalid_output");
      if ((kind === "audio" || audio) && outputAudio?.codec_name !== "aac") throw new SourceAnalysisToolError("Preview audio không dùng codec AAC.", "invalid_output");
      const outputDuration = finiteNumber(output.format.duration);
      if (range && (outputDuration === null || Math.abs(outputDuration - (range.endSeconds - range.startSeconds)) > 0.35)) {
        throw new SourceAnalysisToolError("Preview không khớp thời lượng range yêu cầu.", "invalid_output");
      }
      return {
        file: { sizeBytes: info.size },
        details: {
          kind,
          sourceStartSeconds: range?.startSeconds ?? null,
          sourceEndSeconds: range?.endSeconds ?? null,
          durationSeconds: outputDuration,
          videoStream: video ? integer(video.index) : null,
          audioStream: audio ? integer(audio.index) : null,
          transform,
          animatedImage: animated,
          output: outputVideo ? { width: integer(outputVideo.width), height: integer(outputVideo.height), sampleAspectRatio: outputVideo.sample_aspect_ratio ?? null, codec: outputVideo.codec_name } : { codec: outputAudio.codec_name }
        },
        verification: {
          status: "passed",
          checks: ["ffmpeg_exit_0", "proxy_file_present", "browser_codec_created", ...(range ? ["duration_matches_range"] : [])],
          details: { executableVersion: availability.executableVersion }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const kind = execution.details.kind;
      const file = outputFile({
        id: "primary", role: "preview", workspace: prepared.trace.workspace, name: prepared.trace.name,
        mediaType: kind === "image" ? "image/png" : kind === "audio" ? "audio/mp4" : "video/mp4",
        sizeBytes: execution.file.sizeBytes
      });
      return {
        type: "source.preview",
        name: `Preview nguồn: ${prepared.trace.sourceName}`,
        inputResources: prepared.trace.inputResources,
        inputResults: prepared.trace.inputResults,
        files: [file],
        data: {
          coverage: kind === "image" ? { mode: "full_image" } : { ...prepared.runtime.range, mode: "continuous" },
          outcome: "produced",
          counts: { previews: 1 },
          datasets: [],
          warnings: [],
          contentReview: "not_performed",
          details: { ...execution.details, derivative: true }
        },
        verification: execution.verification
      };
    }
  };
}
