import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256File } from "../analysis/source-identity.js";
import { AnalysisReader } from "../analysis/analysis-reader.js";
import { pendingResultFeedback } from "../intelligence/project-context-assembler.js";
import { buildProductionContext } from "../production/production-context.js";
import { defaultProductionPolicyCatalog, OUTPUT_PROFILES } from "../production/production-policy-catalog.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export const LOCAL_DELIVERY_PROFILES = OUTPUT_PROFILES;

export class LocalDeliveryToolError extends Error {
  constructor(message, code = "delivery_failed") {
    super(message);
    this.name = "LocalDeliveryToolError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new LocalDeliveryToolError(message, code);
}

function ratio(value) {
  const [numerator, denominator] = String(value ?? "").split("/").map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function safeDetail(value, paths) {
  let detail = String(value ?? "").trim();
  for (const path of paths) {
    if (!path) continue;
    detail = detail.replaceAll(path, "<project-result>");
    detail = detail.replaceAll(path.replaceAll("\\", "/"), "<project-result>");
  }
  return detail.slice(0, 1200);
}

function parseLoudnorm(stderr) {
  const matches = [...String(stderr ?? "").matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)];
  const candidate = matches.at(-1);
  if (!candidate) fail("FFmpeg không trả kết quả đo loudness.", "invalid_audio_measurement");
  try {
    const value = JSON.parse(candidate[0]);
    const integratedLufs = finite(value.input_i);
    const truePeakDbtp = finite(value.input_tp);
    const loudnessRange = finite(value.input_lra);
    if ([integratedLufs, truePeakDbtp, loudnessRange].some((item) => item === null)) throw new Error();
    return { integratedLufs, truePeakDbtp, loudnessRange };
  } catch {
    fail("Kết quả đo loudness của FFmpeg không hợp lệ.", "invalid_audio_measurement");
  }
}

function parseTailSilence(stderr, durationSeconds) {
  const events = [...String(stderr ?? "").matchAll(/silence_(start|end):\s*(-?[0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => ({ type: match[1], seconds: Number(match[2]) }))
    .filter((event) => Number.isFinite(event.seconds));
  let open = null;
  const intervals = [];
  for (const event of events) {
    if (event.type === "start") open = Math.max(0, event.seconds);
    if (event.type === "end" && open !== null) {
      intervals.push({ start: open, end: Math.min(durationSeconds, event.seconds) });
      open = null;
    }
  }
  if (open !== null) intervals.push({ start: open, end: durationSeconds });
  const tail = intervals.at(-1);
  return tail && Math.abs(tail.end - durationSeconds) <= 0.06
    ? round(Math.max(0, tail.end - tail.start))
    : 0;
}

function exactApproval(context, result) {
  const latest = context.decisions
    .filter((decision) =>
      decision.kind !== "project_decision" &&
      decision.resultId === result.id)
    .at(-1) ?? null;
  return latest?.outcome === "accepted" ? latest : null;
}

function exactOutputQuality(context, result) {
  return context.results.filter((candidate) =>
    candidate.type === "video.output-quality" &&
    candidate.data?.sourceResultId === result.id &&
    candidate.inputResults.includes(result.id)
  ).at(-1) ?? null;
}

function sequenceKeyForDecision(context, decision) {
  return context.results.find((result) => result.id === decision.resultId)?.data?.sequence?.key ?? null;
}

async function writeMetadata(directory, name, value) {
  const path = join(directory, name);
  await writeFile(path, json(value), "utf8");
  return path;
}

export function createLocalDeliveryExporter({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = (command, args, options) => execFileAsync(command, args, {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    ...options
  }),
  timeoutMs = 180_000,
  now = () => new Date().toISOString(),
  policyCatalog = defaultProductionPolicyCatalog,
  analysisSummary = (store, projectId) =>
    new AnalysisReader({ rootDir: store.rootDir, projectStore: store }).summary(projectId)
} = {}) {
  async function command(executable, args, paths, options = {}) {
    try {
      return await executeCommand(executable, args, { timeout: timeoutMs, ...options });
    } catch (error) {
      const detail = safeDetail(error?.stderr || error?.message, paths);
      fail(
        error?.killed || error?.code === "ETIMEDOUT"
          ? "Kiểm tra delivery vượt quá thời gian cho phép."
          : "Lệnh media thất bại" + (detail ? ": " + detail : "."),
        error?.code === "ENOENT" ? "tool_unavailable" : "media_validation_failed"
      );
    }
  }

  return {
    name: "local-delivery",
    version: "1.0.0",
    provider: "PADStudio",
    capability: "video.export-delivery",
    description: "Đóng gói nguyên byte của video đã được người dùng duyệt thành bundle giao cục bộ có kiểm chứng.",
    runtime: "local",
    executionMode: "sync",
    producesFiles: true,
    approvalRequired: false,
    cost: { currency: "USD", estimated: 0 },
    sideEffects: ["Tạo một bundle delivery mới trong outputs của project; không ghi đè Result nguồn."],
    inputSchema: {
      type: "object",
      required: ["resultId", "profileId"],
      properties: {
        resultId: { type: "string" },
        profileId: { enum: policyCatalog.listOutputProfiles().map((profile) => profile.id) }
      },
      additionalProperties: false
    },
    outputDescription: "Video đã duyệt cùng manifest, provenance, review, approval và SHA-256 checksums.",

    async checkAvailability() {
      try {
        const [ffmpeg, ffprobe] = await Promise.all([
          command(ffmpegCommand, ["-version"], []),
          command(ffprobeCommand, ["-version"], [])
        ]);
        return {
          status: "available",
          executableVersion: String(ffmpeg.stdout).split(/\r?\n/)[0],
          ffprobeVersion: String(ffprobe.stdout).split(/\r?\n/)[0],
          profiles: policyCatalog.listOutputProfiles().map((profile) => profile.id)
        };
      } catch (error) {
        return { status: "unavailable", reason: error.message };
      }
    },

    async prepare({ store, projectId, inputs, outputWorkspace }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
          Object.keys(inputs).some((key) => !["resultId", "profileId"].includes(key)) ||
          typeof inputs.resultId !== "string" || typeof inputs.profileId !== "string") {
        fail("Delivery chỉ nhận resultId và profileId.", "invalid_input");
      }
      let profile;
      try {
        profile = policyCatalog.readOutputProfile(inputs.profileId);
      } catch {
        fail("Delivery profile không được hỗ trợ: " + inputs.profileId, "invalid_profile");
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        fail("PADStudio chưa cấp output workspace cho delivery.", "invalid_output_workspace");
      }
      const context = await store.readContext(projectId);
      const result = context.results.find((candidate) => candidate.id === inputs.resultId);
      if (!result || result.type !== "video.sequence-render") {
        fail("Delivery cần đúng một Result video.sequence-render đã lưu.", "invalid_source_result");
      }
      if (result.verification?.status !== "passed") {
        fail("Result nguồn chưa vượt qua kiểm tra kỹ thuật.", "source_not_verified");
      }
      const sourceFile = await store.verifyResultFile(projectId, result.id, "primary");
      const quality = exactOutputQuality(context, result);
      if (!quality) fail("Result nguồn chưa có automated output QA.", "output_quality_required");
      if (quality.verification?.status !== "passed" || quality.data?.gate?.deliveryEligible !== true) {
        fail("Automated output QA mới nhất chưa cho phép delivery.", "output_quality_failed");
      }
      if (quality.data?.sourceSha256 !== sourceFile.sha256) {
        fail("Automated output QA không còn khớp byte của exact Result.", "output_quality_stale");
      }
      const qualityReport = await store.verifyResultFile(projectId, quality.id, "report");
      for (const evidenceId of quality.inputResults.filter((id) => id !== result.id)) {
        const evidence = context.results.find((candidate) => candidate.id === evidenceId);
        if (!evidence) fail("Thiếu Result bằng chứng của automated QA.", "output_quality_stale");
        for (const file of evidence.files) await store.verifyResultFile(projectId, evidence.id, file.id);
      }
      const approval = exactApproval(context, result);
      if (!approval) fail("Result nguồn chưa được người dùng accepted.", "approval_required");
      const run = context.runs.find((candidate) => candidate.id === result.createdByRun);
      if (!run || run.status !== "completed" || run.pendingResult ||
          !run.outputs.includes(result.id)) {
        fail("Run tạo Result chưa finalization hoàn chỉnh.", "pending_finalization");
      }
      const analysis = await analysisSummary(store, projectId);
      const production = buildProductionContext({ ...context, analysis });
      const sequence = production.sequences.find((candidate) =>
        candidate.artifactId === result.data?.sequence?.artifactId);
      const resultState = production.resultStates.find((candidate) => candidate.resultId === result.id);
      if (!sequence || sequence.role !== "current" || sequence.reasons.length ||
          !resultState || resultState.reasons.length) {
        fail("Result nguồn hoặc dependency không còn là bản current.", "stale_result");
      }
      const pendingForSequence = pendingResultFeedback(context.decisions).filter((decision) =>
        sequenceKeyForDecision(context, decision) === result.data.sequence.key);
      if (pendingForSequence.length) {
        fail(
          "Sequence còn feedback chưa được giải quyết: " + pendingForSequence.map((item) => item.id).join(", "),
          "pending_feedback"
        );
      }
      return {
        runtime: {
          sourcePath: sourceFile.filePath,
          sourceSha256: sourceFile.sha256,
          profile,
          expectedDurationSeconds: finite(result.data?.durationSeconds),
          directory: outputWorkspace.temporaryDirectory,
          generatedAt: now(),
          bundle: {
            sourceResultName: result.name,
            approval: {
              resultId: result.id,
              decisionId: approval.id,
              outcome: approval.outcome,
              decidedBy: approval.decidedBy,
              createdAt: approval.createdAt,
              note: approval.note ?? null,
              feedbackTarget: approval.feedbackTarget ?? null,
              resolvesDecisionIds: approval.resolvesDecisionIds ?? []
            },
            provenance: {
              projectId: result.projectId,
              sourceResultId: result.id,
              sourceResultType: result.type,
              sourceResultCreatedAt: result.createdAt,
              sourceRunId: result.createdByRun,
              sourceTool: result.tool,
              sourceSha256: sourceFile.sha256,
              sourceChecksumRecord: sourceFile.checksumSource,
              inputResources: result.inputResources,
              inputResults: result.inputResults,
              inputArtifacts: result.inputArtifacts,
              sequence: result.data.sequence
            },
            reviews: {
              sourceResultId: result.id,
              reviews: context.reviews.filter((review) =>
                review.target?.kind === "result" && review.target.id === result.id)
            },
            quality: {
              resultId: quality.id,
              sourceResultId: quality.data.sourceResultId,
              profile: quality.data.profile,
              gate: quality.data.gate,
              checks: quality.data.checks,
              metrics: quality.data.metrics,
              evidence: quality.data.evidence,
              humanReview: quality.data.humanReview,
              reportSha256: qualityReport.sha256
            }
          }
        },
        trace: {
          result,
          approval,
          quality,
          qualityReport,
          reviews: context.reviews.filter((review) =>
            review.target?.kind === "result" && review.target.id === result.id),
          sourceFile: {
            id: sourceFile.id,
            name: sourceFile.name,
            sizeBytes: sourceFile.size,
            sha256: sourceFile.sha256,
            checksumSource: sourceFile.checksumSource
          },
          finalDirectory: outputWorkspace.projectRelativeDirectory
        }
      };
    },

    async execute({
      sourcePath, sourceSha256, profile, expectedDurationSeconds, directory, generatedAt, bundle, availability
    }) {
      const paths = [sourcePath, directory];
      const { stdout } = await command(
        ffprobeCommand,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", sourcePath],
        paths
      );
      let probe;
      try {
        probe = JSON.parse(stdout);
      } catch {
        fail("ffprobe trả dữ liệu không hợp lệ.", "invalid_probe");
      }
      const video = probe.streams?.find((stream) => stream.codec_type === "video");
      const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
      const durationSeconds = finite(probe.format?.duration);
      const fps = ratio(video?.avg_frame_rate);
      const mismatches = [];
      if (!String(probe.format?.format_name ?? "").split(",").includes(profile.container)) mismatches.push("container");
      if (video?.codec_name !== profile.videoCodec) mismatches.push("video_codec");
      if (video?.pix_fmt !== profile.pixelFormat) mismatches.push("pixel_format");
      if (video?.width !== profile.width || video?.height !== profile.height) mismatches.push("dimensions");
      if (fps === null || Math.abs(fps - profile.fps) > 0.001) mismatches.push("fps");
      if (audio?.codec_name !== profile.audioCodec) mismatches.push("audio_codec");
      if (Number(audio?.sample_rate) !== profile.sampleRate) mismatches.push("sample_rate");
      if (audio?.channels !== profile.channels) mismatches.push("channels");
      if (durationSeconds === null || durationSeconds <= 0) mismatches.push("duration");
      if (expectedDurationSeconds !== null && durationSeconds !== null &&
          Math.abs(durationSeconds - expectedDurationSeconds) > Math.max(0.15, 2 / profile.fps)) {
        mismatches.push("expected_duration");
      }
      if (mismatches.length) {
        fail("Video không khớp delivery profile: " + mismatches.join(", "), "profile_mismatch");
      }

      await command(
        ffmpegCommand,
        ["-hide_banner", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
        paths
      );
      const loudnessRun = await command(
        ffmpegCommand,
        ["-hide_banner", "-nostats", "-i", sourcePath, "-map", "0:a:0",
          "-af", "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        paths
      );
      const silenceRun = await command(
        ffmpegCommand,
        ["-hide_banner", "-nostats", "-i", sourcePath, "-map", "0:a:0",
          "-af", "silencedetect=noise=-50dB:d=0.2", "-f", "null", "-"],
        paths
      );
      const loudness = parseLoudnorm(loudnessRun.stderr);
      const tailSilenceSeconds = parseTailSilence(silenceRun.stderr, durationSeconds);
      if (loudness.integratedLufs < profile.integratedLufs.minimum ||
          loudness.integratedLufs > profile.integratedLufs.maximum) {
        fail("Loudness nằm ngoài delivery profile.", "loudness_out_of_range");
      }
      if (loudness.truePeakDbtp > profile.maximumTruePeakDbtp) {
        fail("True peak vượt delivery profile.", "true_peak_out_of_range");
      }
      if (tailSilenceSeconds > profile.maximumTailSilenceSeconds) {
        fail("Khoảng lặng cuối video vượt delivery profile.", "tail_silence_out_of_range");
      }

      const videoDirectory = join(directory, "video");
      const metadataDirectory = join(directory, "metadata");
      await Promise.all([
        mkdir(videoDirectory, { recursive: true }),
        mkdir(metadataDirectory, { recursive: true })
      ]);
      const outputVideo = join(videoDirectory, "output.mp4");
      await copyFile(sourcePath, outputVideo);
      const copiedSha256 = await sha256File(outputVideo);
      if (copiedSha256 !== sourceSha256) {
        fail("Byte video thay đổi trong lúc đóng gói.", "copy_integrity_failed");
      }
      const copiedInfo = await lstat(outputVideo);
      const media = {
        container: profile.container,
        videoCodec: video.codec_name,
        pixelFormat: video.pix_fmt,
        width: video.width,
        height: video.height,
        fps: round(fps),
        audioCodec: audio.codec_name,
        sampleRate: Number(audio.sample_rate),
        channels: audio.channels,
        durationSeconds: round(durationSeconds),
        integratedLufs: round(loudness.integratedLufs, 2),
        truePeakDbtp: round(loudness.truePeakDbtp, 2),
        loudnessRange: round(loudness.loudnessRange, 2),
        tailSilenceSeconds
      };
      const manifest = {
        version: "1.0",
        type: "PADStudio local delivery bundle",
        generatedAt,
        profile,
        sourceResultId: bundle.provenance.sourceResultId,
        approvalDecisionId: bundle.approval.decisionId,
        outputQualityResultId: bundle.quality.resultId,
        media,
        files: [
          "video/output.mp4",
          "metadata/manifest.json",
          "metadata/provenance.json",
          "metadata/reviews.json",
          "metadata/approval.json",
          "metadata/quality.json",
          "metadata/checksums.sha256"
        ]
      };
      const metadata = [
        ["manifest", "manifest.json", manifest],
        ["provenance", "provenance.json", bundle.provenance],
        ["reviews", "reviews.json", bundle.reviews],
        ["approval", "approval.json", bundle.approval],
        ["quality", "quality.json", bundle.quality]
      ];
      const written = [];
      for (const [id, name, value] of metadata) {
        const path = await writeMetadata(metadataDirectory, name, value);
        written.push({ id, name, path, sha256: await sha256File(path) });
      }
      const checksumsPath = join(metadataDirectory, "checksums.sha256");
      await writeFile(checksumsPath, [
        copiedSha256 + "  video/output.mp4",
        ...written.map((file) => file.sha256 + "  metadata/" + file.name)
      ].join("\n") + "\n", "utf8");
      const files = [
        {
          id: "primary", role: "delivery-video", path: outputVideo,
          relativePath: "video/output.mp4", name: "output.mp4", mediaType: "video",
          sizeBytes: copiedInfo.size
        },
        ...written.map((file) => ({
          id: file.id, role: "delivery-metadata", path: file.path,
          relativePath: "metadata/" + file.name, name: file.name, mediaType: "document"
        })),
        {
          id: "checksums", role: "delivery-checksums", path: checksumsPath,
          relativePath: "metadata/checksums.sha256", name: "checksums.sha256", mediaType: "document"
        }
      ];
      for (const file of files) {
        if (file.sizeBytes === undefined) file.sizeBytes = (await lstat(file.path)).size;
      }
      return {
        generatedAt,
        profile,
        media,
        manifest,
        files,
        sourceResultName: bundle.sourceResultName,
        copiedSha256,
        verification: {
          status: "passed",
          checks: [
            "exact_result_accepted",
            "exact_output_quality_passed",
            "current_dependencies",
            "source_sha256_verified",
            "full_decode_passed",
            "delivery_profile_matched",
            "loudness_in_range",
            "tail_silence_in_range",
            "copy_sha256_matched"
          ],
          details: {
            profileId: profile.id,
            media,
            executableVersion: availability.executableVersion ?? null,
            ffprobeVersion: availability.ffprobeVersion ?? null
          }
        },
        actualCostUsd: 0
      };
    },

    createResult({ prepared, execution }) {
      const { trace } = prepared;
      return {
        type: "delivery.bundle",
        name: "Delivery bundle: " + execution.sourceResultName,
        inputResources: trace.result.inputResources,
        inputResults: [trace.result.id, trace.quality.id],
        inputArtifacts: trace.result.inputArtifacts,
        files: execution.files.map(({ id, role, relativePath, name, mediaType, sizeBytes }) => ({
          id, role, path: trace.finalDirectory + "/" + relativePath, name, mediaType, sizeBytes
        })),
        data: {
          sourceResultId: trace.result.id,
          approvalDecisionId: trace.approval.id,
          outputQualityResultId: trace.quality.id,
          profileId: execution.profile.id,
          generatedAt: execution.generatedAt,
          sourceSha256: trace.sourceFile.sha256,
          outputSha256: execution.copiedSha256,
          media: execution.media,
          bundleFiles: execution.manifest.files
        },
        verification: execution.verification
      };
    }
  };
}
