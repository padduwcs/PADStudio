import { rename } from "node:fs/promises";
import { join } from "node:path";
import { object, text, fail, workspace, fileEvidence, command, ffmpegAvailability, primaryFile } from "./asset-tool-common.js";
import { downloadPublicMedia, publicMediaUrl, downloadTypes } from "./public-media-download.js";

export function createUrlMediaAcquirer({
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  executeCommand = command, download = downloadPublicMedia
} = {}) {
  return {
    name: "https-media", version: "1.0.0", provider: "Public HTTPS", capability: "media.acquire",
    description: "Tải một file ảnh/video/audio từ URL công khai đã chọn, giữ nguồn và attribution; không tự tìm kiếm hoặc chọn tư liệu.",
    runtime: "network", executionMode: "sync", producesFiles: true, approvalRequired: false,
    cost: { currency: "USD", estimated: 0 }, sideEffects: ["GET URL công khai và tối đa 3 redirect; lưu file mới trong output project."],
    outputDescription: "media.acquired có media đã kiểm tra, SHA-256, URL nguồn/cuối, thời điểm và attribution do người gọi cung cấp.",
    inputSchema: { type: "object", required: ["url", "mediaType", "name", "attribution"], additionalProperties: false, properties: {
      url: { type: "string", format: "uri", maxLength: 2048 }, mediaType: { enum: ["image", "video", "audio"] },
      name: { type: "string", maxLength: 240 }, expectedSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
      attribution: { type: "object", required: ["creator", "license"], additionalProperties: false, properties: {
        creator: { type: "string", maxLength: 500 }, license: { type: "string", maxLength: 1000 }, sourcePage: { type: "string", format: "uri" }
      } }
    } },
    async checkAvailability() {
      const status = await ffmpegAvailability(executeCommand, ffmpegCommand, ffprobeCommand);
      return { ...status, note: "Availability does not contact the network. Public IPv4 HTTPS only; 128 MiB and 30 minutes maximum." };
    },
    async prepare({ inputs, outputWorkspace, signal }) {
      object(inputs, ["url", "mediaType", "name", "attribution", "expectedSha256"]);
      const url = publicMediaUrl(text(inputs.url, "url", 2048)).href;
      if (!["image", "video", "audio"].includes(inputs.mediaType)) fail("mediaType must be image, video or audio.");
      object(inputs.attribution, ["creator", "license", "sourcePage"], "attribution");
      const attribution = { creator: text(inputs.attribution.creator, "creator", 500), license: text(inputs.attribution.license, "license", 1000) };
      if (inputs.attribution.sourcePage !== undefined) attribution.sourcePage = publicMediaUrl(text(inputs.attribution.sourcePage, "sourcePage", 2048)).href;
      const expectedSha256 = typeof inputs.expectedSha256 === "string" ? inputs.expectedSha256.toLowerCase() : undefined;
      if (inputs.expectedSha256 !== undefined && (typeof inputs.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256))) fail("expectedSha256 must be a SHA-256 hex string.");
      const output = workspace(outputWorkspace);
      return { runtime: { url, mediaType: inputs.mediaType, directory: output.temporaryDirectory, expectedSha256, signal },
        trace: { directory: output.projectRelativeDirectory, name: text(inputs.name, "name", 240), attribution } };
    },
    async execute({ url, mediaType, directory, expectedSha256, signal, availability }) {
      const partial = join(directory, "download.part");
      let acquired;
      try { acquired = await download(url, partial, { mediaType, signal }); }
      catch (error) {
        if (error.name === "AbortError" || error.code === "non_public_url") throw error;
        fail("Media download failed; no result was saved.", "download_failed");
      }
      const type = downloadTypes[acquired.contentType];
      if (!type || type.mediaType !== mediaType) fail("Unsupported acquired media.", "invalid_download");
      const name = "media." + type.extension, path = join(directory, name);
      await rename(partial, path);
      const file = await fileEvidence(path, 128 * 1024 * 1024);
      if (expectedSha256 && file.sha256 !== expectedSha256) fail("Downloaded media checksum does not match.", "checksum_mismatch");
      // Only standalone containers/images are supported. No playlist, network
      // protocols or content-controlled subordinate files may be opened.
      const formats = "mov,matroska,mp3,wav,flac,ogg,image2,png_pipe,jpeg_pipe,webp_pipe";
      const result = await executeCommand(ffprobeCommand, ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats,
        "-show_format", "-show_streams", "-of", "json", path], { signal });
      let info;
      try { info = JSON.parse(result.stdout); } catch { fail("Invalid downloaded media.", "invalid_output"); }
      if (!info?.format || !Array.isArray(info.streams)) fail("Downloaded media has no streams.", "invalid_output");
      const video = info.streams.find((entry) => entry.codec_type === "video" && !entry.disposition?.attached_pic);
      const audio = info.streams.find((entry) => entry.codec_type === "audio");
      const durationSeconds = Number(info.format.duration);
      if ((mediaType === "image" && (!video || video.codec_name !== type.codec)) ||
          (mediaType === "video" && !video) || (mediaType === "audio" && (!audio || video)) ||
          (mediaType !== "image" && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 1800)) ||
          (video && (!Number.isFinite(video.width) || !Number.isFinite(video.height) || video.width * video.height > 3840 * 2160))) fail("Downloaded media does not match its declared type or limits.", "invalid_output");
      await executeCommand(ffmpegCommand, ["-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats,
        "-i", path, "-map", mediaType === "audio" ? "0:a:0" : "0:v:0", ...(mediaType === "image" ? ["-frames:v", "1"] : []),
        "-f", "null", "-"], { timeout: 120000, signal });
      return { file, name, mediaType, acquired, durationSeconds: mediaType === "image" ? null : durationSeconds,
        resolution: video ? { width: video.width, height: video.height } : null, acquiredAt: new Date().toISOString(), actualCostUsd: 0,
        verification: { status: "passed", checks: ["public_https_download", "bounded_file", "declared_media_type", "primary_stream_decode", "output_sha256"],
          details: { executableVersion: availability.executableVersion, contentReview: "not_performed", rightsReview: "caller_supplied_not_verified" } } };
    },
    createResult({ prepared, execution }) {
      return { type: "media.acquired", name: prepared.trace.name, inputResources: [], inputResults: [],
        files: [primaryFile(prepared, execution, execution.name, execution.mediaType)],
        data: { acquisition: { requestedUrl: prepared.runtime.url, finalUrl: execution.acquired.finalUrl,
          redirects: execution.acquired.redirects, contentType: execution.acquired.contentType, acquiredAt: execution.acquiredAt,
          attribution: prepared.trace.attribution, rightsReview: "caller_supplied_not_verified" },
          durationSeconds: execution.durationSeconds, resolution: execution.resolution, contentReview: "not_performed" },
        verification: execution.verification };
    }
  };
}
