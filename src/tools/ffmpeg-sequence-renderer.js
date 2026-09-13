import { renderComposedSegment, finishComposition } from "./sequence-compositor.js";
﻿import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, lstat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { normalizeSequence, SEQUENCE_TYPE, segmentFingerprint } from "../production/video-sequence.js";
import { buildProductionContext } from "../production/production-context.js";
import { assessSequenceVisualQuality } from "../production/visual-quality.js";
import { createFfmpegSubtitleBurner } from "./ffmpeg-subtitle-burner.js";

const execFileAsync = promisify(execFile);
const VERSION = "1.2.0";

export function parseSilenceDetection(stderr, durationSeconds) {
  const events = [...String(stderr ?? "").matchAll(/silence_(start|end):\s*(-?[0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => ({ type: match[1], seconds: Number(match[2]) }))
    .filter((event) => Number.isFinite(event.seconds));
  const intervals = [];
  let start = null;
  for (const event of events) {
    if (event.type === "start") start = Math.max(0, event.seconds);
    if (event.type === "end" && start !== null) {
      const end = Math.min(durationSeconds, Math.max(start, event.seconds));
      intervals.push({ startSeconds: start, endSeconds: end, durationSeconds: end - start });
      start = null;
    }
  }
  if (start !== null && Number.isFinite(durationSeconds) && durationSeconds > start) {
    intervals.push({ startSeconds: start, endSeconds: durationSeconds, durationSeconds: durationSeconds - start });
  }
  const rounded = intervals.map((interval) => Object.fromEntries(
    Object.entries(interval).map(([key, value]) => [key, Math.round(value * 1000) / 1000])
  ));
  const tail = rounded.at(-1);
  return {
    silenceIntervals: rounded,
    maxSilenceSeconds: rounded.length ? Math.max(...rounded.map((interval) => interval.durationSeconds)) : 0,
    tailSilenceSeconds: tail && Math.abs(tail.endSeconds - durationSeconds) <= 0.05 ? tail.durationSeconds : 0,
  };
}

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function fail(message, code = "invalid_input") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return String(Math.floor(ms / 3600000)).padStart(2, "0") + ":" +
    String(Math.floor(ms / 60000) % 60).padStart(2, "0") + ":" +
    String(Math.floor(ms / 1000) % 60).padStart(2, "0") + "," + String(ms % 1000).padStart(3, "0");
}
function srt(cues) {
  return cues.map((cue, index) => (index + 1) + "\n" + timestamp(cue.startSeconds) + " --> " + timestamp(cue.endSeconds) + "\n" +
    cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("{", "｛").replaceAll("}", "｝").replace(/\r?\n/g, " ") + "\n").join("\n");
}

export function createFfmpegSequenceRenderer({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = (command, args, options) => execFileAsync(command, args, { windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, ...options }),
  timeoutMs = 120_000,
} = {}) {
  async function command(executable, args, options = {}) {
    try { return await executeCommand(executable, args, { timeout: timeoutMs, ...options }); }
    catch (error) {
      let detail = String(error?.stderr || error?.message || "").trim();
      for (const arg of args.filter((value) => typeof value === "string" && isAbsolute(value))) {
        detail = detail.replaceAll(arg, "<project-media>").replaceAll(arg.replaceAll("\\", "/"), "<project-media>");
      }
      fail(error?.killed ? "Local rendering timed out." :
        "Local media command failed: " + String(error?.code ?? "ffmpeg_error") + (detail ? ". " + detail.slice(0, 1000) : ""), "render_failed");
    }
  }
  async function probe(path) {
    const { stdout } = await command(ffprobeCommand, ["-v", "error", "-show_format", "-show_streams", "-of", "json", path]);
    const value = JSON.parse(stdout);
    if (!Array.isArray(value.streams)) fail("Invalid media probe.", "invalid_probe");
    return {
      video: value.streams.find((s) => s.codec_type === "video"),
      audio: value.streams.find((s) => s.codec_type === "audio"),
      duration: Number(value.format?.duration),
    };
  }
  async function validateVideo(path, duration, format) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) fail("Missing rendered media.", "invalid_output");
    const p = await probe(path);
    const [fpsNumerator, fpsDenominator] = String(p.video?.avg_frame_rate ?? "").split("/").map(Number);
    if (!p.video || !p.audio || p.video.width !== format.width || p.video.height !== format.height ||
      p.video.codec_name !== "h264" || p.audio.codec_name !== "aac" || p.audio.channels !== 2 ||
      Number(p.audio.sample_rate) !== 48000 || fpsNumerator / fpsDenominator !== format.fps ||
      Number(p.video.nb_frames) !== Math.round(duration * format.fps) ||
      !Number.isFinite(p.duration) || Math.abs(p.duration - duration) > Math.max(0.15, 2 / format.fps)) {
      fail("Rendered media does not match sequence dimensions, frame count, audio format or duration.", "invalid_output");
    }
    return { sizeBytes: info.size, durationSeconds: p.duration, sha256: await digest(path) };
  }
  return {
    name: "ffmpeg-sequence", version: VERSION, provider: "FFmpeg", capability: "video.render-sequence",
    description: "Render an exact video.sequence artifact revision, with per-segment media, captions and review frames.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    cost: { currency: "USD", estimated: 0 }, sideEffects: ["Writes registered preview, segment files and evidence inside the run output."],
    inputSchema: { type: "object", required: ["artifactId"], properties: {
      artifactId: { type: "string" }, reuseResultId: { type: "string" }, allowHistorical: { type: "boolean" },
    }, additionalProperties: false },
    outputDescription: "An MP4 preview tied to an artifact revision, reusable segment files and representative frames. Creative/audio correctness remains unreviewed.",
    async checkAvailability() {
      try {
        const ffmpeg = await command(ffmpegCommand, ["-version"], { timeout: 5000 });
        const ffprobe = await command(ffprobeCommand, ["-version"], { timeout: 5000 });
        return { status: "available", executableVersion: ffmpeg.stdout.split(/\r?\n/)[0], ffprobeVersion: ffprobe.stdout.split(/\r?\n/)[0] };
      } catch { return { status: "unavailable", reason: "FFmpeg and ffprobe are required; no remote fallback." }; }
    },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
        Object.keys(inputs).some((key) => !["artifactId", "reuseResultId", "allowHistorical"].includes(key)) ||
        typeof inputs.artifactId !== "string" ||
        (inputs.allowHistorical !== undefined && typeof inputs.allowHistorical !== "boolean") ||
        (inputs.reuseResultId !== undefined && typeof inputs.reuseResultId !== "string")) fail("Invalid sequence render request.");
      if (!outputWorkspace) fail("Missing project output workspace.");
      const context = await store.readContext(projectId);
      const artifact = context.artifacts.find((a) => a.id === inputs.artifactId);
      if (!artifact || artifact.type !== SEQUENCE_TYPE) fail("Expected a stored video.sequence artifact.");
      const sequence = normalizeSequence(artifact.data);
      const production = buildProductionContext(context);
      const state = production.sequences.find((s) => s.artifactId === artifact.id);
      const ownRevisionReason = (reason) => reason.kind === "artifact" && reason.id === artifact.id && reason.reason === "not_active_revision";
      const dependencyReasons = state.reasons.filter((reason) => !ownRevisionReason(reason));
      if ((state.role === "history" || dependencyReasons.length) && !inputs.allowHistorical) fail("Sequence history or its dependencies are not current. Review/rebase them, or explicitly set allowHistorical.", "stale_sequence");
      const missing = state.segments.filter((s) => s.blockers.length);
      if (missing.length) fail("Sequence has unresolved media: " + missing.map((s) => s.id + " (" + s.blockers.join(", ") + ")").join("; "), "unresolved_media");
      let reuse = null;
      if (inputs.reuseResultId) {
        reuse = await store.readResult(projectId, inputs.reuseResultId);
        if (reuse.type !== "video.sequence-render" || reuse.tool.name !== "ffmpeg-sequence" ||
          reuse.tool.version !== VERSION || reuse.data.sequence?.key !== artifact.key) fail("Reuse result must be a compatible render of the same sequence.");
      }
      const inputResources = new Set();
      const inputResults = new Set();
      const segments = [];
      for (let index = 0; index < sequence.segments.length; index++) {
        const segment = sequence.segments[index];
        const visual = await store.resolveMediaSource(projectId, segment.visual.source);
        if (!["image", "video"].includes(visual.mediaType)) fail("Segment " + segment.id + " needs image/video media.");
        if (visual.mediaType === "image" && segment.visual.startSeconds !== 0) fail("Images require startSeconds 0.");
        const narration = segment.narration ? await store.resolveMediaSource(projectId, segment.narration.source) : null;
        if (narration && !["audio", "video"].includes(narration.mediaType)) fail("Narration source must contain audio.");
        for (const media of [visual, narration].filter(Boolean)) {
          for (const id of media.inputResources) inputResources.add(id);
          for (const id of media.inputResults) inputResults.add(id);
        }
        const overlays = [];
        for (const spec of segment.overlays ?? []) {
          const media = await store.resolveMediaSource(projectId, spec.source);
          if (!["image", "video"].includes(media.mediaType)) fail("Overlay requires image/video.");
          overlays.push({ spec, media, hash: await digest(media.filePath) });
          for (const id of media.inputResources) inputResources.add(id);
          for (const id of media.inputResults) inputResults.add(id);
        }
        const visualHash = await digest(visual.filePath);
        const narrationHash = narration ? await digest(narration.filePath) : null;
        // Cached bytes are only reused after source/spec and output hashes match.
        const key = createHash("sha256").update(JSON.stringify({
          spec: segmentFingerprint(segment, sequence.format), visualHash, narrationHash,
          references: artifact.references, overlayHashes: overlays.map((o) => o.hash),
        })).digest("hex");
        const cached = reuse?.data.segments?.find((s) => s.id === segment.id && s.key === key);
        let cachedMedia = null;
        if (cached) {
          try {
            const media = await store.resolveResultFile(projectId, reuse.id, cached.fileId);
            if (await digest(media.filePath) === cached.sha256) cachedMedia = { path: media.filePath, resultId: reuse.id, fileId: cached.fileId, sha256: cached.sha256, executableVersion: reuse.verification.details?.executableVersion };
          } catch { /* A missing cache is recomputed from registered original sources. */ }
        }
        segments.push({ segment, visual, narration, key, visualHash, narrationHash, cachedMedia, index, overlays });
      }
      const music = [];
      for (const spec of sequence.music ?? []) {
        const media = await store.resolveMediaSource(projectId, spec.source);
        if (!["audio", "video"].includes(media.mediaType)) fail("Music requires audio/video.");
        music.push({ spec, media, hash: await digest(media.filePath) });
        for (const id of media.inputResources) inputResources.add(id);
        for (const id of media.inputResults) inputResults.add(id);
      }
      return {
        runtime: { artifact, sequence, segments, music, qualityFindings: assessSequenceVisualQuality(sequence), directory: outputWorkspace.temporaryDirectory },
        trace: {
          inputResources: [...inputResources], inputResults: [...inputResults], inputArtifacts: [artifact.id],
          directory: outputWorkspace.projectRelativeDirectory, sequenceRole: state.role,
          historical: state.role === "history" || dependencyReasons.length > 0,
        },
      };
    },
    async execute({ artifact, sequence, segments, music, qualityFindings, directory, availability }) {
      const { width, height, fps } = sequence.format;
      const files = [];
      const manifest = [];
      let startSeconds = 0;
      for (const entry of segments) {
        const { segment, visual, narration, key, index } = entry;
        const fileName = "segment-" + index + ".mp4";
        const outputPath = join(directory, fileName);
        // Also bind cache reuse to actual executable version.
        const cachedVersionMatches = entry.cachedMedia && entry.cachedMedia.executableVersion === availability.executableVersion;
        let reusedFrom = null;
        if (cachedVersionMatches) {
          // The output is re-probed below even after a matching content hash.
          await copyFile(entry.cachedMedia.path, outputPath);
          reusedFrom = { resultId: entry.cachedMedia.resultId, fileId: entry.cachedMedia.fileId };
        } else if (sequence.version === "1.1") {
          await renderComposedSegment({ entry, sequence, directory, outputPath, command, probe, ffmpegCommand });
        } else {
          const vp = await probe(visual.filePath);
          if (!vp.video) fail("Visual source has no video stream.");
          if (visual.mediaType === "video" && (!Number.isFinite(vp.duration) ||
            segment.visual.startSeconds + segment.durationSeconds > vp.duration + 0.03)) fail("Visual range exceeds source for " + segment.id + ".");
          const args = ["-hide_banner", "-loglevel", "error"];
          if (visual.mediaType === "image") args.push("-loop", "1", "-framerate", String(fps));
          else args.push("-ss", String(segment.visual.startSeconds));
          args.push("-i", visual.filePath);
          let narrationIndex = null;
          if (narration) {
            const np = await probe(narration.filePath);
            if (!np.audio || !Number.isFinite(np.duration) || segment.narration.startSeconds >= np.duration) fail("Invalid narration audio for " + segment.id + ".");
            if (np.duration - segment.narration.startSeconds > segment.durationSeconds + 0.05) fail("Narration exceeds segment duration; revise timing or explicitly trim the source first.");
            narrationIndex = 1;
            args.push("-ss", String(segment.narration.startSeconds), "-i", narration.filePath);
          }
          const silentIndex = narration ? 2 : 1;
          if (!vp.audio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
          const d = segment.durationSeconds;
          const audioFilter = (volume) => "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=" + volume + ",apad,atrim=duration=" + d + ",asetpts=PTS-STARTPTS";
          const filters = [
            "[0:v]scale=" + width + ":" + height + ":force_original_aspect_ratio=decrease,pad=" + width + ":" + height + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=" + fps + ",format=yuv420p,setpts=PTS-STARTPTS[v]",
            "[" + (vp.audio ? "0" : silentIndex) + ":a]" + audioFilter(segment.visual.volume) + "[base]",
          ];
          if (narration) {
            filters.push("[" + narrationIndex + ":a]" + audioFilter(segment.narration.volume) + "[voice]");
            filters.push("[base][voice]amix=inputs=2:duration=first:normalize=0[a]");
          }
          const basePath = segment.captions.length ? join(directory, "base-" + index + ".mp4") : outputPath;
          args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", narration ? "[a]" : "[base]",
            "-t", String(d), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-y", basePath);
          await command(ffmpegCommand, args);
          if (segment.captions.length) {
            const subtitlePath = join(directory, "captions-" + index + ".srt");
            await writeFile(subtitlePath, srt(segment.captions), "utf8");
            await createFfmpegSubtitleBurner({ ffmpegCommand, ffprobeCommand, executeCommand: command, timeoutMs }).execute({
              inputPath: basePath, subtitlePath, temporaryOutputPath: outputPath,
              fontSizeOverride: null, marginVOverride: null, lastCueEndSeconds: segment.captions.at(-1).endSeconds, availability,
            });
            await unlink(basePath);
            await unlink(subtitlePath);
          }
        }
        const checked = await validateVideo(outputPath, segment.durationSeconds, sequence.format);
        if (reusedFrom && checked.sha256 !== entry.cachedMedia.sha256) fail("Cached output changed while copying.", "source_changed");
        // Detect source modification during a render; never commit a mislabeled dependency.
        if (await digest(visual.filePath) !== entry.visualHash ||
          (narration && await digest(narration.filePath) !== entry.narrationHash)) fail("Source changed during rendering.", "source_changed");
        for (const overlay of entry.overlays) if (await digest(overlay.media.filePath) !== overlay.hash) fail("Overlay changed during rendering.", "source_changed");
        files.push({ id: "segment-" + index, role: "segment", name: fileName, mediaType: "video", sizeBytes: checked.sizeBytes });
        // Review one representative frame per segment. These are evidence, not an aesthetic verdict.
        const frameName = "frame-" + index + ".png";
        await command(ffmpegCommand, ["-hide_banner", "-loglevel", "error", "-ss", String(segment.durationSeconds / 2), "-i", outputPath, "-frames:v", "1", "-y", join(directory, frameName)]);
        const frameInfo = await lstat(join(directory, frameName));
        if (!frameInfo.isFile() || !frameInfo.size) fail("Review frame was not produced.", "invalid_output");
        files.push({ id: "frame-" + index, role: "review-frame", name: frameName, mediaType: "image", sizeBytes: frameInfo.size });
        manifest.push({ id: segment.id, key, fileId: "segment-" + index, frameFileId: "frame-" + index, startSeconds, durationSeconds: segment.durationSeconds,
          sha256: checked.sha256, sourceHashes: { visual: entry.visualHash, narration: entry.narrationHash, overlays: entry.overlays.map((o) => o.hash) }, reusedFrom });
        startSeconds += segment.durationSeconds - (segment.transition?.durationSeconds ?? 0);
      }
      const finalPath = join(directory, "preview.mp4");
      if (sequence.version === "1.1") {
        startSeconds = await finishComposition({ sequence, segments, music, directory, finalPath, command, probe, ffmpegCommand });
      } else {
        const listPath = join(directory, "segments.txt");
        await writeFile(listPath, manifest.map((s) => "file '" + files.find((f) => f.id === s.fileId).name + "'").join("\n"), "utf8");
        await command(ffmpegCommand, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1", "-i", listPath,
          "-c", "copy", "-movflags", "+faststart", "-y", finalPath], { cwd: directory });
        await unlink(listPath);
      }
      for (const track of music) if (await digest(track.media.filePath) !== track.hash) fail("Music changed during rendering.", "source_changed");
      for (const entry of segments) {
        for (const [media, expected] of [[entry.visual, entry.visualHash], [entry.narration, entry.narrationHash], ...entry.overlays.map((o) => [o.media, o.hash])]) {
          if (media && await digest(media.filePath) !== expected) fail("Source changed before finalization.", "source_changed");
        }
      }
      const checked = await validateVideo(finalPath, startSeconds, sequence.format);
      let audioMeasurement = null;
      if (sequence.version === "1.1") {
        const measurement = await command(ffmpegCommand, ["-hide_banner", "-i", finalPath, "-vn", "-af", "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
        const block = measurement.stderr?.match(/\{[^{}]*"input_i"[^{}]*\}/s)?.[0];
        if (!block) fail("Audio measurement missing.", "invalid_output");
        const m = JSON.parse(block);
        const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
        const silence = await command(ffmpegCommand, ["-hide_banner", "-i", finalPath, "-vn", "-af", "silencedetect=noise=-50dB:d=0.25", "-f", "null", "-"]);
        audioMeasurement = { integratedLufs: finite(m.input_i), truePeakDbtp: finite(m.input_tp), loudnessRange: finite(m.input_lra), targetLufs: sequence.audio.loudnessTargetLufs,
          ...parseSilenceDetection(silence.stderr, checked.durationSeconds), note: "Measured technical levels and digital silence; human listening still required." };
      }
      files.unshift({ id: "primary", role: "primary", name: "preview.mp4", mediaType: "video", sizeBytes: checked.sizeBytes });
      return { files, manifest, durationSeconds: checked.durationSeconds, sha256: checked.sha256, actualCostUsd: 0,
        verification: { status: "passed", checks: ["registered_sources_resolved", "source_hashes_stable", "segment_streams_and_duration", "preview_streams_and_duration", "review_frames_present", "visual_quality_contract"],
          details: { executableVersion: availability.executableVersion, audioMeasurement,
            visualQuality: { status: qualityFindings.length ? "warnings" : "passed", findings: qualityFindings }, creativeReview: "not_performed", speechContentReview: "not_performed",
            subtitleVisualReview: "not_performed", audioMixReview: "not_performed", needsReview: ["Watch full preview including cuts and captions", "Listen to narration and source mix", "Compare against segment intent and brief"] } } };
    },
    createResult({ prepared, execution }) {
      const { artifact } = prepared.runtime;
      return {
        type: "video.sequence-render", name: "Preview: " + artifact.name + " r" + artifact.revision,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: prepared.trace.inputArtifacts,
        files: execution.files.map((file) => ({ ...file, path: prepared.trace.directory + "/" + file.name })),
        data: { sequence: { artifactId: artifact.id, key: artifact.key, revision: artifact.revision },
          sequenceRole: prepared.trace.sequenceRole, historical: prepared.trace.historical, segments: execution.manifest, durationSeconds: execution.durationSeconds, sha256: execution.sha256,
          video: prepared.runtime.sequence.format, hasAudio: true },
        verification: execution.verification,
      };
    },
  };
}
