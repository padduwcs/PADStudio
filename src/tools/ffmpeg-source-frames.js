import { rm, writeFile } from "node:fs/promises";
import { sha256File } from "../analysis/source-identity.js";
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
  readJsonLines,
  readRuntimeProfiles,
  resolvePreparedSource,
  runProcess,
  runtimeProfileDigest,
  safeDetail,
  selectStream,
  temporaryOutputPath,
  writeJsonLines
} from "./source-analysis-common.js";

const GLYPHS = {
  "0":["111","101","101","101","111"], "1":["010","110","010","010","111"],
  "2":["111","001","111","100","111"], "3":["111","001","111","001","111"],
  "4":["101","101","111","001","001"], "5":["111","100","111","001","111"],
  "6":["111","100","111","101","111"], "7":["111","001","010","010","010"],
  "8":["111","101","111","101","111"], "9":["111","101","111","001","111"],
  ":":["0","1","0","1","0"], ".":["0","0","0","0","1"],
  "S":["111","100","111","001","111"], " ":["0","0","0","0","0"]
};

function normalizeOptions(value, profile) {
  onlyFields(value, ["timestamps", "budget", "contactSheet", "crop", "longShotSeconds", "maxWidth", "format"], "frames.options");
  const options = {
    timestamps: value.timestamps ?? null,
    budget: value.budget ?? profile.frameBudget,
    contactSheet: value.contactSheet ?? true,
    crop: value.crop ?? null,
    longShotSeconds: value.longShotSeconds ?? profile.longShotSeconds,
    maxWidth: value.maxWidth ?? 1920,
    format: value.format ?? "png",
    contactSheetColumns: profile.contactSheetColumns,
    contactSheetRows: profile.contactSheetRows,
    contactCellWidth: profile.contactCellWidth,
    contactCellHeight: profile.contactCellHeight
  };
  if (options.timestamps !== null && (!Array.isArray(options.timestamps) || !options.timestamps.length || options.timestamps.some((time) => !Number.isFinite(time) || time < 0))) {
    throw new SourceAnalysisToolError("frames.options.timestamps phải là danh sách số không âm.", "invalid_input");
  }
  if (!Number.isSafeInteger(options.budget) || options.budget < 1 || options.budget > 120) {
    throw new SourceAnalysisToolError("Frame budget phải trong [1,120].", "invalid_input");
  }
  if (options.timestamps && options.timestamps.length > options.budget) {
    throw new SourceAnalysisToolError("Frame budget không được nhỏ hơn số timestamp yêu cầu.", "invalid_input");
  }
  if (typeof options.contactSheet !== "boolean") throw new SourceAnalysisToolError("contactSheet phải là boolean.", "invalid_input");
  if (!Number.isFinite(options.longShotSeconds) || options.longShotSeconds <= 0) throw new SourceAnalysisToolError("longShotSeconds phải dương.", "invalid_input");
  if (!Number.isSafeInteger(options.maxWidth) || options.maxWidth < 160 || options.maxWidth > 7680) throw new SourceAnalysisToolError("maxWidth không hợp lệ.", "invalid_input");
  if (!["png", "jpeg"].includes(options.format)) throw new SourceAnalysisToolError("format phải là png hoặc jpeg.", "invalid_input");
  if (options.crop !== null) {
    if (!options.crop || typeof options.crop !== "object" || Array.isArray(options.crop)) throw new SourceAnalysisToolError("crop phải là object.", "invalid_input");
    onlyFields(options.crop, ["x", "y", "width", "height"], "frames.options.crop");
    if (![options.crop.x, options.crop.y, options.crop.width, options.crop.height].every(Number.isSafeInteger) || options.crop.x < 0 || options.crop.y < 0 || options.crop.width <= 0 || options.crop.height <= 0) {
      throw new SourceAnalysisToolError("crop cần tọa độ/kích thước pixel nguyên hợp lệ.", "invalid_input");
    }
  }
  return options;
}

function rotationOf(stream) {
  const side = (stream.side_data_list ?? []).find((entry) => finiteNumber(entry.rotation) !== null);
  return finiteNumber(side?.rotation) ?? finiteNumber(stream.tags?.rotate) ?? 0;
}

function displayedPixelSize(stream) {
  const quarterTurn = Math.abs(Math.round(rotationOf(stream) / 90)) % 2 === 1;
  return {
    width: integer(quarterTurn ? stream.height : stream.width),
    height: integer(quarterTurn ? stream.width : stream.height)
  };
}

function squarePixelScale(maxWidth) {
  const factor = `min(1,${maxWidth}/(iw*sar))`;
  return `scale=w='max(2,trunc(iw*sar*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)',setsar=1`;
}

async function loadShots(store, projectId, ids, sourceVersion) {
  for (const id of ids) {
    const result = await store.readResult(projectId, id);
    if (result.type !== "source.scenes") continue;
    if (result.data.sourceVersion !== sourceVersion) throw new SourceAnalysisToolError("Scene dependency khác source version.", "invalid_dependency");
    const dataset = result.data.datasets.find((entry) => entry.kind === "scenes");
    if (!dataset) throw new SourceAnalysisToolError("Scene dependency thiếu dataset.", "invalid_dependency");
    const file = await store.resolveResultFile(projectId, result.id, dataset.fileId);
    if (
      file.size !== file.sizeBytes || typeof file.sha256 !== "string" ||
      await sha256File(file.filePath) !== file.sha256
    ) throw new SourceAnalysisToolError("Scene dependency thiếu hoặc sai checksum.", "invalid_dependency");
    const rows = await readJsonLines(file.filePath);
    let previous = result.data.coverage.startSeconds;
    for (const [index, row] of rows.entries()) {
      if (
        row.id !== `shot-${String(index + 1).padStart(5, "0")}` ||
        !Number.isFinite(row.startSeconds) || !Number.isFinite(row.endSeconds) ||
        Math.abs(row.startSeconds - previous) > 0.001 || row.endSeconds <= row.startSeconds ||
        row.endSeconds > result.data.coverage.endSeconds + 0.001
      ) throw new SourceAnalysisToolError("Scene dependency có row không hợp lệ.", "invalid_dependency");
      previous = row.endSeconds;
    }
    if (Math.abs(previous - result.data.coverage.endSeconds) > 0.001) {
      throw new SourceAnalysisToolError("Scene dependency không phủ hết coverage.", "invalid_dependency");
    }
    return rows;
  }
  return [];
}

function framePlan(range, shots, options, image) {
  if (image) return { frames: [{ requestedTime: null, shotId: null, reason: "full_image" }], omissions: [] };
  const candidates = [];
  const end = Math.max(range.startSeconds, range.endSeconds - 0.001);
  const shotAt = (time) => shots.find((shot) => shot.startSeconds <= time && time < shot.endSeconds + 0.001)?.id ?? null;
  const add = (time, shotId, reason, priority) => {
    time = Math.max(range.startSeconds, Math.min(end, time));
    if (!candidates.some((entry) => Math.abs(entry.requestedTime - time) < 0.001)) candidates.push({ requestedTime: time, shotId, reason, priority });
  };
  if (options.timestamps) {
    for (const time of options.timestamps) {
      if (time < range.startSeconds || time >= range.endSeconds) throw new SourceAnalysisToolError("Frame timestamp nằm ngoài range.", "invalid_input");
      add(time, shotAt(time), "requested", 0);
    }
  } else {
    for (const time of [range.startSeconds, (range.startSeconds + range.endSeconds) / 2, end]) add(time, shotAt(time), "range_sample", 0);
    const coveredByRange = new Set(candidates.map((entry) => entry.shotId).filter(Boolean));
    for (const shot of shots) {
      add((shot.startSeconds + shot.endSeconds) / 2, shot.id, "shot_representative", coveredByRange.has(shot.id) ? 2 : 1);
      for (let time = shot.startSeconds + options.longShotSeconds; time < shot.endSeconds; time += options.longShotSeconds) add(time, shot.id, "long_shot_sample", 3);
    }
  }
  const frames = candidates.sort((a, b) => a.priority - b.priority || a.requestedTime - b.requestedTime).slice(0, options.budget).sort((a, b) => a.requestedTime - b.requestedTime);
  const covered = new Set(frames.map((entry) => entry.shotId).filter(Boolean));
  const omissions = shots
    .filter((shot) => !covered.has(shot.id))
    .map((shot) => ({ shotId: shot.id, startSeconds: shot.startSeconds, endSeconds: shot.endSeconds }));
  return { frames, omissions };
}

async function nearestFrame(inputPath, stream, requestedTime, range, ffprobeCommand, signal) {
  const streamStart = finiteNumber(stream.start_time) ?? 0;
  const inspect = async (intervalStart, intervalEnd) => {
    const response = await runProcess(ffprobeCommand, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-read_intervals", `${intervalStart}%${intervalEnd}`,
      "-select_streams", String(stream.index), "-show_frames",
      "-show_entries", "frame=stream_index,best_effort_timestamp,best_effort_timestamp_time", "-of", "json", inputPath
    ], { signal, timeoutMs: 30_000 });
    let frames;
    try { frames = JSON.parse(response.stdout.toString("utf8")).frames; } catch { frames = []; }
    return frames
      .filter((frame) => integer(frame.stream_index) === integer(stream.index) && finiteNumber(frame.best_effort_timestamp_time) !== null)
      .map((frame) => ({ pts: integer(frame.best_effort_timestamp), actualTime: finiteNumber(frame.best_effort_timestamp_time) - streamStart }))
      .filter((frame) => frame.pts !== null && frame.actualTime >= range.startSeconds - 0.05 && frame.actualTime < range.endSeconds - 1e-9);
  };
  const sourceEnd = range.endSeconds + streamStart;
  const interval = (backSeconds, forwardSeconds) => {
    const start = Math.max(streamStart, requestedTime + streamStart - backSeconds);
    const end = Math.min(sourceEnd, requestedTime + streamStart + forwardSeconds);
    return [start, Math.max(start + 0.001, end)];
  };
  let candidates = await inspect(...interval(0, 5));
  if (!candidates.length) {
    candidates = await inspect(...interval(1, 5));
  }
  if (!candidates.length) {
    candidates = await inspect(...interval(5, 30));
  }
  candidates.sort((a, b) => Math.abs(a.actualTime - requestedTime) - Math.abs(b.actualTime - requestedTime) || a.actualTime - b.actualTime);
  if (!candidates.length) throw new SourceAnalysisToolError(`Không tìm được decoded PTS gần ${requestedTime} giây.`, "frame_timestamp_unavailable");
  return candidates[0];
}

function decodedFrameTiming(stderr, streamStart) {
  const match = /\bn:\s*0\s+pts:\s*(-?\d+)\s+pts_time:\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(String(stderr));
  const pts = match ? Number(match[1]) : null;
  const ptsTime = match ? Number(match[2]) : null;
  if (!Number.isSafeInteger(pts) || !Number.isFinite(ptsTime)) {
    throw new SourceAnalysisToolError("FFmpeg không trả PTS của frame đã ghi.", "frame_timestamp_unavailable");
  }
  return { pts, actualTime: ptsTime - streamStart };
}

function labelFor(seconds, shotId) {
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const remainder = milliseconds - minutes * 60000;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1000)).padStart(2, "0")}.${String(remainder % 1000).padStart(3, "0")} S${String(Number(shotId?.split("-").at(-1) ?? 0)).padStart(3, "0")}`;
}

async function writeBitmapLabel(path, label, width) {
  const height = 24;
  const pixels = Buffer.alloc(width * height * 3, 18);
  let cursor = 8;
  for (const character of label) {
    const glyph = GLYPHS[character] ?? GLYPHS[" "];
    for (let y = 0; y < glyph.length; y++) for (let x = 0; x < glyph[y].length; x++) if (glyph[y][x] === "1") {
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
        const px = cursor + x * 3 + xx, py = 4 + y * 3 + yy;
        const offset = (py * width + px) * 3;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 245;
      }
    }
    cursor += (Math.max(...glyph.map((row) => row.length)) + 1) * 3;
  }
  await writeFile(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), pixels]));
}

async function contactSheets({ rows, frameFiles, workspace, options, ffmpegCommand, signal }) {
  if (!options.contactSheet || !rows.length) return { files: [], pages: [] };
  const perPage = options.contactSheetColumns * options.contactSheetRows;
  const files = [], pages = [];
  for (let start = 0; start < rows.length; start += perPage) {
    const pageRows = rows.slice(start, start + perPage);
    const cellPaths = [];
    for (let local = 0; local < pageRows.length; local++) {
      const global = start + local;
      const label = temporaryOutputPath(workspace, `label-${global}.ppm`);
      const cell = temporaryOutputPath(workspace, `cell-${global}.png`);
      await writeBitmapLabel(label, labelFor(pageRows[local].actualTime ?? 0, pageRows[local].shotId), options.contactCellWidth);
      await runProcess(ffmpegCommand, [
        "-hide_banner", "-v", "error", "-nostdin", "-i", temporaryOutputPath(workspace, frameFiles[global].name), "-i", label,
        "-filter_complex", `[0:v]scale=${options.contactCellWidth}:${options.contactCellHeight}:force_original_aspect_ratio=decrease,pad=${options.contactCellWidth}:${options.contactCellHeight}:(ow-iw)/2:(oh-ih)/2:black[image];[image][1:v]vstack=inputs=2`,
        "-frames:v", "1", "-y", cell
      ], { signal, timeoutMs: 30_000 });
      await rm(label, { force: true });
      cellPaths.push(cell);
    }
    const pageNumber = pages.length + 1;
    const name = `contact-sheet-${String(pageNumber).padStart(3, "0")}.jpg`;
    const output = temporaryOutputPath(workspace, name);
    const args = ["-hide_banner", "-v", "error", "-nostdin"];
    for (const path of cellPaths) args.push("-i", path);
    const pageWidth = options.contactSheetColumns * options.contactCellWidth + (options.contactSheetColumns - 1) * 4;
    const cellHeight = options.contactCellHeight + 24;
    const pageHeight = options.contactSheetRows * cellHeight + (options.contactSheetRows - 1) * 4;
    if (cellPaths.length > 1) {
      const layout = pageRows.map((_, index) => `${(index % options.contactSheetColumns) * (options.contactCellWidth + 4)}_${Math.floor(index / options.contactSheetColumns) * (options.contactCellHeight + 28)}`).join("|");
      args.push("-filter_complex", `xstack=inputs=${pageRows.length}:layout=${layout}:fill=black[stack];[stack]pad=${pageWidth}:${pageHeight}:0:0:black[page]`, "-map", "[page]");
    } else {
      args.push("-vf", `pad=${pageWidth}:${pageHeight}:0:0:black`);
    }
    args.push("-frames:v", "1", "-q:v", "3", "-y", output);
    await runProcess(ffmpegCommand, args, { signal, timeoutMs: 60_000 });
    for (const path of cellPaths) await rm(path, { force: true });
    const info = await checkedFile(output, "Contact sheet");
    const id = `contact-${String(pageNumber).padStart(3, "0")}`;
    files.push(outputFile({ id, role: "preview", workspace, name, mediaType: "image/jpeg", sizeBytes: info.size }));
    pages.push({ id, fileId: id, frameIds: pageRows.map((row) => row.id), columns: options.contactSheetColumns, rows: options.contactSheetRows });
  }
  return { files, pages };
}

export function createFfmpegSourceFrames({ ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg", ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe" } = {}) {
  return {
    name: "ffmpeg-source-frames", version: "1.0.1", provider: "FFmpeg", capability: "source.extract-frames",
    description: "Trích frame theo decoded PTS, scene/range budget và tạo contact sheet nhiều trang.",
    runtime: "local", executionMode: "sync", inputSchema: { type: "object", required: ["source", "analysis"], additionalProperties: false },
    outputDescription: "source.frames gồm ảnh riêng, JSONL mapping và contact sheet.",
    sideEffects: ["Tạo ảnh và dataset trong outputs của project."], cost: { currency: "USD", estimated: 0 }, approvalRequired: false, producesFiles: true,

    async checkAvailability({ profileId = "source-standard-v1" } = {}) {
      try {
        profileId ??= "source-standard-v1";
        const profileDigest = await runtimeProfileDigest(profileId);
        const [ffmpeg, ffprobe, encoders, filters] = await Promise.all([
          runProcess(ffmpegCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffprobeCommand, ["-version"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-hide_banner", "-encoders"], { timeoutMs: 5_000 }),
          runProcess(ffmpegCommand, ["-hide_banner", "-filters"], { timeoutMs: 5_000 })
        ]);
        for (const encoder of ["png", "mjpeg"]) {
          if (!listedFeature(encoders.stdout, encoder)) throw new SourceAnalysisToolError(`FFmpeg thiếu encoder ${encoder}.`, "tool_unavailable");
        }
        for (const filter of ["crop", "pad", "scale", "showinfo", "vstack", "xstack"]) {
          if (!listedFeature(filters.stdout, filter)) throw new SourceAnalysisToolError(`FFmpeg thiếu filter ${filter}.`, "tool_unavailable");
        }
        return { status: "available", executableVersion: executableVersion(ffmpeg.stdout, "ffmpeg"), libraryVersions: { ffprobe: executableVersion(ffprobe.stdout, "ffprobe") }, profileVersion: profileId, profileDigest, requiredFeatures: ["encoder:png", "encoder:mjpeg", "filter:crop", "filter:pad", "filter:scale", "filter:showinfo", "filter:vstack", "filter:xstack"] };
      } catch (error) { return { status: "unavailable", reason: safeDetail(error.message, [ffmpegCommand, ffprobeCommand]) }; }
    },

    async prepare(context) {
      const prepared = await resolvePreparedSource({ ...context, operation: "frames", producesFiles: true });
      const profileId = prepared.normalized.analysis.profileId ?? "source-standard-v1";
      const profiles = await readRuntimeProfiles();
      if (profileId !== "source-standard-v1" || !profiles.profiles[profileId]) throw new SourceAnalysisToolError(`Visual profile không hỗ trợ: ${profileId}.`, "invalid_input");
      const options = normalizeOptions(prepared.normalized.analysis.options, profiles.profiles[profileId]);
      const probe = await probeSource(prepared.media.filePath, { ffprobeCommand, signal: context.signal });
      const selected = selectStream(probe, "video", prepared.normalized.analysis.track);
      const duration = finiteNumber(probe.format.duration) ?? finiteNumber(selected.stream.duration);
      const animated = prepared.media.mediaType === "image" && (
        (integer(selected.stream.nb_frames) ?? 1) > 1 || (duration ?? 0) > 0.1
      );
      const image = prepared.media.mediaType === "image" && !animated;
      const range = effectiveRange(prepared.normalized.analysis.range, duration, { image });
      const displayedPixels = displayedPixelSize(selected.stream);
      if (options.crop && (
        displayedPixels.width === null || displayedPixels.height === null ||
        options.crop.x + options.crop.width > displayedPixels.width ||
        options.crop.y + options.crop.height > displayedPixels.height
      )) throw new SourceAnalysisToolError("Crop vượt kích thước pixel sau khi áp dụng rotation.", "invalid_input");
      const shots = image ? [] : await loadShots(context.store, context.projectId, prepared.normalized.analysis.dependencyResultIds, prepared.normalized.analysis.sourceVersion);
      return { runtime: { inputPath: prepared.media.filePath, stream: selected.stream, range, options, image, plan: framePlan(range, shots, options, image), signal: context.signal, workspace: prepared.output }, trace: { ...prepared.trace, workspace: prepared.output } };
    },

    async execute({ inputPath, stream, range, options, image, plan, signal, workspace, availability }) {
      const extension = options.format === "jpeg" ? "jpg" : "png", rows = [], frameFiles = [];
      for (const [index, planned] of plan.frames.entries()) {
        const id = `frame-${String(index + 1).padStart(4, "0")}`, name = `${id}.${extension}`, output = temporaryOutputPath(workspace, name);
        const selectedTiming = image ? { pts: null, actualTime: null } : await nearestFrame(inputPath, stream, planned.requestedTime, range, ffprobeCommand, signal);
        const args = ["-hide_banner", "-v", image ? "error" : "info", "-nostats", "-nostdin", "-protocol_whitelist", "file,pipe"];
        if (!image) args.push("-copyts", "-ss", String(selectedTiming.actualTime));
        args.push("-i", inputPath, "-map", `0:${stream.index}`, "-frames:v", "1");
        const filters = [];
        if (options.crop) filters.push(`crop=${options.crop.width}:${options.crop.height}:${options.crop.x}:${options.crop.y}`);
        filters.push(squarePixelScale(options.maxWidth));
        if (!image) filters.push("showinfo");
        args.push("-vf", filters.join(","), "-y", output);
        const response = await runProcess(ffmpegCommand, args, { signal, timeoutMs: 60_000 });
        const timing = image ? selectedTiming : decodedFrameTiming(response.stderr, finiteNumber(stream.start_time) ?? 0);
        if (!image && (
          timing.pts !== selectedTiming.pts ||
          Math.abs(timing.actualTime - selectedTiming.actualTime) > 0.000_001
        )) {
          throw new SourceAnalysisToolError(
            `PTS frame đã ghi (${timing.pts}) không khớp PTS đã chọn (${selectedTiming.pts}).`,
            "frame_timestamp_mismatch"
          );
        }
        const info = await checkedFile(output, "Frame output");
        frameFiles.push(outputFile({ id, role: "evidence", workspace, name, mediaType: options.format === "jpeg" ? "image/jpeg" : "image/png", sizeBytes: info.size }));
        rows.push({ id, fileId: id, requestedTime: planned.requestedTime, actualTime: timing.actualTime, pts: timing.pts, shotId: planned.shotId, reason: planned.reason, displayTransform: { autorotationApplied: true, sampleAspectRatioApplied: true, squarePixels: true, crop: options.crop, maxWidth: options.maxWidth } });
      }
      const sheets = await contactSheets({ rows, frameFiles, workspace, options, ffmpegCommand, signal });
      const datasetName = "frames.jsonl", datasetInfo = await writeJsonLines(temporaryOutputPath(workspace, datasetName), rows);
      const dataset = outputFile({ id: "frames", role: "dataset", workspace, name: datasetName, mediaType: "application/x-ndjson", sizeBytes: datasetInfo.size });
      const omissionFiles = [];
      if (plan.omissions.length) {
        const name = "frame-omissions.jsonl";
        const info = await writeJsonLines(temporaryOutputPath(workspace, name), plan.omissions);
        omissionFiles.push(outputFile({ id: "omissions", role: "dataset", workspace, name, mediaType: "application/x-ndjson", sizeBytes: info.size }));
      }
      return { files: [...frameFiles, ...sheets.files, dataset, ...omissionFiles], rows, pages: sheets.pages, omissions: plan.omissions, verification: { status: "passed", checks: ["ffmpeg_exit_0", "frame_files_present", ...(image ? [] : ["actual_pts_recorded", "output_pts_matches_metadata"]), "frame_budget_enforced", ...(sheets.pages.length ? ["contact_sheets_present"] : []), ...(plan.omissions.length ? ["omitted_ranges_recorded"] : [])], details: { executableVersion: availability.executableVersion, budget: options.budget } }, actualCostUsd: 0 };
    },

    createResult({ prepared, execution }) {
      const runtime = prepared.runtime;
      const intervals = runtime.image ? [] : execution.rows.map((row) => ({ startSeconds: row.actualTime, endSeconds: Math.min(runtime.range.endSeconds, row.actualTime + 0.001) })).filter((range) => range.endSeconds > range.startSeconds);
      const omittedPreview = execution.omissions.slice(0, 100);
      const omissionsTruncated = execution.omissions.length > omittedPreview.length;
      return { type: "source.frames", name: `Khung hình: ${prepared.trace.sourceName}`, inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, files: execution.files, data: { coverage: runtime.image ? { mode: "full_image" } : { ...runtime.range, mode: "sampled", intervals }, outcome: "produced", counts: { frames: execution.rows.length, contactSheets: execution.pages.length, omittedShots: execution.omissions.length }, datasets: [{ kind: "frames", fileId: "frames" }, ...(execution.omissions.length ? [{ kind: "frame-omissions", fileId: "omissions" }] : [])], warnings: execution.omissions.length ? [{ code: "frame_budget_omitted_shots", message: "Frame budget không phủ mọi shot; xem dataset omissions để biết đầy đủ range chưa lấy mẫu.", count: execution.omissions.length, datasetFileId: "omissions" }] : [], contentReview: "not_performed", details: { contactSheets: execution.pages, omittedShotIds: omittedPreview.map((entry) => entry.shotId), unsampledRanges: omittedPreview.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })), omissionsTruncated } }, verification: execution.verification };
    }
  };
}
