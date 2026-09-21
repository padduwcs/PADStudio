import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256File } from "../analysis/source-identity.js";
import { validHumanConfirmation } from "../project/human-confirmation.js";
import { defaultProductionPolicyCatalog, OUTPUT_PROFILES } from "../production/production-policy-catalog.js";
import { parseDeliveryProbe } from "../production/delivery-readiness.js";

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

function exactApproval(context, result) {
  const latest = context.decisions
    .filter((decision) =>
      decision.kind !== "project_decision" &&
      decision.resultId === result.id)
    .at(-1) ?? null;
  return latest?.outcome === "accepted" &&
    validHumanConfirmation(latest.confirmation, "accept_video", result.id) ? latest : null;
}

function exactOutputQuality(context, result) {
  return context.results.filter((candidate) =>
    candidate.type === "video.output-quality" &&
    candidate.data?.sourceResultId === result.id &&
    candidate.inputResults.includes(result.id)
  ).at(-1) ?? null;
}

async function writeMetadata(directory, name, value) {
  const path = join(directory, name);
  await writeFile(path, json(value), "utf8");
  return path;
}

export function createLocalDeliveryExporter({
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = (command, args, options) => execFileAsync(command, args, {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    ...options
  }),
  timeoutMs = 180_000,
  now = () => new Date().toISOString(),
  policyCatalog = defaultProductionPolicyCatalog
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
    description: "Đóng gói nguyên byte của video đã được người dùng duyệt; không render lại hoặc ép chuẩn profile sau khi duyệt.",
    runtime: "local",
    executionMode: "sync",
    producesFiles: true,
    approvalRequired: false,
    cost: { currency: "USD", estimated: 0 },
    sideEffects: ["Tạo một bundle delivery mới trong outputs của project; không ghi đè Result nguồn."],
    inputSchema: {
      type: "object",
      required: ["resultId"],
      properties: {
        resultId: { type: "string" },
        profileId: { enum: policyCatalog.listOutputProfiles().map((profile) => profile.id) }
      },
      additionalProperties: false
    },
    outputDescription: "Exact video đã duyệt cùng manifest, provenance, approval và SHA-256 checksums.",

    async checkAvailability() {
      try {
        const ffprobe = await command(ffprobeCommand, ["-version"], []);
        return {
          status: "available",
          ffprobeVersion: String(ffprobe.stdout).split(/\r?\n/)[0],
          profiles: policyCatalog.listOutputProfiles().map((profile) => profile.id)
        };
      } catch (error) {
        return { status: "unavailable", reason: error.message };
      }
    },

    async prepare({ store, projectId, inputs, runId, outputWorkspace }) {
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
          Object.keys(inputs).some((key) => !["resultId", "profileId"].includes(key)) ||
          typeof inputs.resultId !== "string" ||
          (inputs.profileId !== undefined && typeof inputs.profileId !== "string")) {
        fail("Delivery chỉ nhận resultId và profileId tùy chọn.", "invalid_input");
      }
      let profile = null;
      if (inputs.profileId !== undefined) {
        try {
          profile = policyCatalog.readOutputProfile(inputs.profileId);
        } catch {
          fail("Delivery profile không được hỗ trợ: " + inputs.profileId, "invalid_profile");
        }
      }
      if (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory) {
        fail("PADStudio chưa cấp output workspace cho delivery.", "invalid_output_workspace");
      }
      const context = await store.readContext(projectId);
      const result = context.results.find((candidate) => candidate.id === inputs.resultId);
      if (!result || result.type !== "video.sequence-render") {
        fail("Delivery cần đúng một Result video.sequence-render đã lưu.", "invalid_source_result");
      }
      const sourceFile = await store.verifyResultFile(projectId, result.id, "primary");
      const quality = exactOutputQuality(context, result);
      const approval = exactApproval(context, result);
      if (!approval) fail("Result nguồn chưa được người dùng accepted.", "approval_required");
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
            quality: quality ? {
              status: "advisory",
              resultId: quality.id,
              sourceResultId: quality.data?.sourceResultId ?? null,
              sourceSha256: quality.data?.sourceSha256 ?? null,
              matchesDeliveredBytes: quality.data?.sourceSha256 === sourceFile.sha256,
              gate: quality.data?.gate ?? null,
              checks: quality.data?.checks ?? [],
              metrics: quality.data?.metrics ?? null
            } : { status: "not_run", resultId: null, matchesDeliveredBytes: null }
          }
        },
        trace: {
          result,
          approval,
          advisoryResultIds: quality ? [quality.id] : [],
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
      let probedMedia;
      try {
        probedMedia = parseDeliveryProbe(stdout);
      } catch {
        fail("ffprobe trả dữ liệu không hợp lệ.", "invalid_probe");
      }
      const { raw, video, audio, durationSeconds, fps } = probedMedia;
      if (!video || durationSeconds === null || durationSeconds <= 0) {
        fail("Exact Result không có video stream hoặc duration hợp lệ.", "invalid_media");
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
        container: String(raw.format?.format_name ?? "").split(",")[0] || null,
        videoCodec: video.codec_name,
        pixelFormat: video.pix_fmt,
        width: video.width,
        height: video.height,
        fps: round(fps),
        audioCodec: audio?.codec_name ?? null,
        sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
        channels: audio?.channels ?? null,
        durationSeconds: round(durationSeconds),
        expectedDurationSeconds,
        requestedProfileId: profile?.id ?? null,
        profileComplianceEnforced: false
      };
      const manifest = {
        version: "1.0",
        type: "PADStudio local delivery bundle",
        generatedAt,
        deliveryMode: "preserve_exact_source",
        requestedProfile: profile,
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
            "source_sha256_verified",
            "source_media_probed",
            "copy_sha256_matched"
          ],
          details: {
            deliveryMode: "preserve_exact_source",
            requestedProfileId: profile?.id ?? null,
            media,
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
        inputResults: [trace.result.id, ...trace.advisoryResultIds],
        inputArtifacts: trace.result.inputArtifacts,
        files: execution.files.map(({ id, role, relativePath, name, mediaType, sizeBytes }) => ({
          id, role, path: trace.finalDirectory + "/" + relativePath, name, mediaType, sizeBytes
        })),
        data: {
          sourceResultId: trace.result.id,
          approvalDecisionId: trace.approval.id,
          outputQualityResultId: execution.manifest.outputQualityResultId ?? null,
          profileId: execution.profile?.id ?? null,
          deliveryMode: "preserve_exact_source",
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
