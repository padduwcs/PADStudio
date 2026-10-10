import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, normalizeSourceReference, normalizeTimeRange } from "../analysis/contracts.js";

const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const REFERENCED_MEDIA_EXTENSIONS = new Set([
  ".concat", ".cue", ".ffconcat", ".ism", ".ismc", ".m3u", ".m3u8",
  ".mpd", ".pls", ".sdp", ".xspf"
]);
const ANALYSIS_FIELDS = new Set([
  "schemaVersion", "sourceKey", "sourceVersion", "operation", "range", "track",
  "profileId", "language", "options", "method", "fingerprint", "analysisJobId",
  "unitId", "dependencyResultIds"
]);

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const runtimeAnalysisDirectory = join(repositoryRoot, "runtime", "analysis");

export class SourceAnalysisToolError extends Error {
  constructor(message, code = "analysis_tool_failed", { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SourceAnalysisToolError";
    this.code = code;
  }
}

export function finiteNumber(value) {
  if (value === undefined || value === null || value === "" || value === "N/A") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function integer(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

export function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function executableVersion(output, executable) {
  const line = String(output || "").split(/\r?\n/, 1)[0].trim();
  const expression = executable === "ffprobe"
    ? /^ffprobe version\s+([^\s]+)/i
    : /^ffmpeg version\s+([^\s]+)/i;
  return expression.exec(line)?.[1] ?? null;
}

export function listedFeature(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "m").test(String(output || ""));
}

export function safeDetail(value, paths = []) {
  let detail = String(value || "").trim();
  for (const path of paths.filter(Boolean)) detail = detail.replaceAll(path, "<project-media>");
  return detail.slice(0, 2000);
}

function appendLimited(chunks, chunk, state, maxBytes) {
  if (state.bytes >= maxBytes) {
    state.truncated = true;
    return;
  }
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = maxBytes - state.bytes;
  chunks.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
  if (buffer.length > remaining) state.truncated = true;
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        shell: false,
        stdio: "ignore"
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

export async function runProcess(command, args, {
  signal,
  timeoutMs = 60_000,
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
  cwd,
  env,
  input = null,
  onStdout = null,
  collectStdout = true
} = {}) {
  if (signal?.aborted) throw new SourceAnalysisToolError("Analysis unit đã bị hủy.", "analysis_cancelled");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args.map(String), {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0, truncated: false };
    const stderrState = { bytes: 0, truncated: false };
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let streamError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, timeoutMs);
    timer.unref?.();
    const abort = () => {
      aborted = true;
      void terminateProcessTree(child);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new SourceAnalysisToolError(
        error?.code === "ENOENT" ? `Không tìm thấy executable: ${command}` : error.message,
        error?.code === "ENOENT" ? "tool_unavailable" : "process_start_failed",
        { cause: error }
      ));
    });
    child.stdout.on("data", (chunk) => {
      if (onStdout) {
        try { onStdout(chunk); } catch (error) {
          streamError = error;
          void terminateProcessTree(child);
        }
      }
      if (collectStdout) appendLimited(stdout, chunk, stdoutState, maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => appendLimited(stderr, chunk, stderrState, maxOutputBytes));
    child.once("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const result = {
        code,
        signal: exitSignal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        stdoutTruncated: stdoutState.truncated,
        stderrTruncated: stderrState.truncated
      };
      if (aborted) return reject(new SourceAnalysisToolError("Analysis unit đã bị hủy.", "analysis_cancelled"));
      if (timedOut) return reject(new SourceAnalysisToolError(`Tiến trình vượt quá giới hạn ${timeoutMs} ms.`, "timeout"));
      if (streamError) return reject(streamError);
      if (code !== 0) {
        const redactPaths = [command, ...args, ...collectStringValues(input)].filter((value) => typeof value === "string" && isAbsolute(value));
        const detail = safeDetail(result.stderr.toString("utf8"), redactPaths).trim();
        return reject(new SourceAnalysisToolError(
          `Tiến trình ${basename(command)} thất bại (${code}).${detail ? ` ${detail}` : ""}`,
          "process_failed"
        ));
      }
      resolve(result);
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(typeof input === "string" || Buffer.isBuffer(input) ? input : JSON.stringify(input));
  });
}

function collectStringValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStringValues);
  return [];
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceAnalysisToolError(`${label} phải là object.`, "invalid_input");
  }
  return value;
}

export function onlyFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length) throw new SourceAnalysisToolError(`${label} chứa field không hỗ trợ: ${unknown.join(", ")}.`, "invalid_input");
}

export function validateAnalysisInputs(inputs, operation) {
  requireObject(inputs, `Đầu vào ${operation}`);
  onlyFields(inputs, ["source", "analysis"], `Đầu vào ${operation}`);
  const source = normalizeSourceReference(inputs.source);
  const analysis = requireObject(inputs.analysis, `${operation}.analysis`);
  const unknown = Object.keys(analysis).filter((field) => !ANALYSIS_FIELDS.has(field));
  if (unknown.length) throw new SourceAnalysisToolError(`${operation}.analysis chứa field không hỗ trợ: ${unknown.join(", ")}.`, "invalid_input");
  const mismatches = [];
  if (analysis.schemaVersion !== "1.0") {
    mismatches.push(`schemaVersion phải là "1.0" (nhận ${JSON.stringify(analysis.schemaVersion) ?? "không có"})`);
  }
  if (analysis.operation !== operation) {
    mismatches.push(`operation phải là "${operation}" (nhận ${JSON.stringify(analysis.operation) ?? "không có"})`);
  }
  if (mismatches.length) {
    throw new SourceAnalysisToolError(`${operation}.analysis không khớp schema/operation: ${mismatches.join("; ")}.`, "invalid_input");
  }
  // The analysis service supplies the source identity and records the Result with it. A bare tool:run has neither,
  // so the tool would finish its work and then be unable to store the Result; say so before doing the work.
  const missingIdentity = ["sourceKey", "sourceVersion"].filter((field) => typeof analysis[field] !== "string" || !analysis[field]);
  if (missingIdentity.length) {
    throw new SourceAnalysisToolError(
      `${operation}.analysis thiếu ${missingIdentity.join(", ")}. Tool phân tích không lưu được Result khi gọi trực tiếp bằng tool:run ` +
        "vì danh tính nguồn do dịch vụ phân tích cấp; hãy chạy `npm run project:analyze -- <project-id> <yêu-cầu>` " +
        "(xem PADSTUDIO-AGENT-REFERENCE.md, mục phân tích nguồn).",
      "analysis_service_required"
    );
  }
  const range = normalizeTimeRange(analysis.range, `${operation}.analysis.range`);
  const track = analysis.track;
  if (track !== null && track !== undefined && (!Number.isSafeInteger(track) || track < 0)) {
    throw new SourceAnalysisToolError(`${operation}.analysis.track phải là stream index không âm.`, "invalid_input");
  }
  if (!analysis.options || typeof analysis.options !== "object" || Array.isArray(analysis.options)) {
    throw new SourceAnalysisToolError(`${operation}.analysis.options phải là object.`, "invalid_input");
  }
  const dependencyResultIds = analysis.dependencyResultIds ?? [];
  if (
    !Array.isArray(dependencyResultIds) || dependencyResultIds.length > 32 ||
    dependencyResultIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new SourceAnalysisToolError(`${operation}.analysis.dependencyResultIds không hợp lệ.`, "invalid_input");
  }
  return {
    source,
    analysis: {
      ...analysis,
      range,
      track: track ?? null,
      profileId: analysis.profileId ?? null,
      language: analysis.language ?? null,
      dependencyResultIds
    }
  };
}

export async function resolvePreparedSource({ store, projectId, inputs, operation, outputWorkspace, producesFiles = false }) {
  const normalized = validateAnalysisInputs(inputs, operation);
  if (producesFiles && (!outputWorkspace?.temporaryDirectory || !outputWorkspace?.projectRelativeDirectory)) {
    throw new SourceAnalysisToolError("PADStudio chưa cấp workspace output.", "invalid_output_workspace");
  }
  const media = await store.resolveMediaSource(projectId, normalized.source);
  return {
    normalized,
    media,
    output: producesFiles ? outputWorkspace : null,
    trace: {
      source: media.trace,
      sourceName: media.itemName,
      inputResources: media.inputResources,
      inputResults: media.inputResults
    }
  };
}

export async function assertSelfContainedMediaPath(filePath) {
  if (REFERENCED_MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new SourceAnalysisToolError("Playlist/manifest tham chiếu media khác không được hỗ trợ.", "referenced_media_unsupported");
  }
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8");
    const referencedText = /^\s*#EXTM3U\b/im.test(header)
      || /^\s*ffconcat\s+version\b/im.test(header)
      || (/^\s*v=0\s*$/im.test(header) && /^\s*m=/im.test(header))
      || /<\s*(?:MPD|SmoothStreamingMedia)\b/i.test(header);
    if (referencedText) {
      throw new SourceAnalysisToolError("Nội dung playlist/manifest tham chiếu media khác không được hỗ trợ.", "referenced_media_unsupported");
    }
  } finally {
    await handle.close();
  }
}

export async function probeSource(filePath, { ffprobeCommand = "ffprobe", signal, timeoutMs = 30_000 } = {}) {
  await assertSelfContainedMediaPath(filePath);
  const response = await runProcess(ffprobeCommand, [
    "-v", "error", "-protocol_whitelist", "file,pipe", "-print_format", "json",
    "-show_format", "-show_streams", "-show_chapters", filePath
  ], { signal, timeoutMs });
  try {
    const parsed = JSON.parse(response.stdout.toString("utf8"));
    if (!parsed?.format || !Array.isArray(parsed.streams)) throw new Error();
    return parsed;
  } catch {
    throw new SourceAnalysisToolError("ffprobe trả JSON media không hợp lệ.", "invalid_probe_output");
  }
}

export function selectStream(probe, type, requestedIndex, { allowDefault = true } = {}) {
  const streams = probe.streams.filter((stream) => stream.codec_type === type);
  if (!streams.length) throw new SourceAnalysisToolError(`Nguồn không có ${type} stream.`, "not_applicable");
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const selected = streams.find((stream) => integer(stream.index) === requestedIndex);
    if (!selected) throw new SourceAnalysisToolError(`Stream ${requestedIndex} không phải ${type} stream hợp lệ.`, "invalid_input");
    return { stream: selected, defaulted: false };
  }
  if (streams.length === 1) return { stream: streams[0], defaulted: true };
  const defaults = streams.filter((stream) => integer(stream.disposition?.default) === 1);
  if (allowDefault && defaults.length === 1) return { stream: defaults[0], defaulted: true };
  throw new SourceAnalysisToolError(`Nguồn có nhiều ${type} stream; cần chọn stream index rõ ràng.`, "track_selection_required");
}

export function effectiveRange(requested, duration, { image = false } = {}) {
  if (image) return null;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new SourceAnalysisToolError("Không xác định được thời lượng nguồn.", "unsupported_input");
  }
  const range = requested ?? { startSeconds: 0, endSeconds: duration };
  if (range.endSeconds > duration + 0.05) {
    throw new SourceAnalysisToolError(`Range vượt thời lượng nguồn ${duration} giây.`, "invalid_input");
  }
  return { startSeconds: range.startSeconds, endSeconds: Math.min(range.endSeconds, duration) };
}

export async function checkedFile(path, label = "file đầu ra", { allowEmpty = false } = {}) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error?.code === "ENOENT") throw new SourceAnalysisToolError(`${label} không được tạo.`, "invalid_output");
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || (!allowEmpty && info.size <= 0)) {
    throw new SourceAnalysisToolError(`${label} không hợp lệ.`, "invalid_output");
  }
  return info;
}

export async function writeJsonLines(path, rows) {
  const contents = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  await writeFile(path, contents, "utf8");
  return checkedFile(path, "Dataset JSONL");
}

export async function readJsonLines(path, { maxRows = 100_000 } = {}) {
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length > maxRows) throw new SourceAnalysisToolError("Dataset vượt giới hạn row an toàn.", "invalid_dependency");
  return lines.map((line, index) => {
    try { return JSON.parse(line); } catch {
      throw new SourceAnalysisToolError(`Dataset JSONL lỗi tại dòng ${index + 1}.`, "invalid_dependency");
    }
  });
}

export function finalOutputPath(workspace, name) {
  return `${workspace.projectRelativeDirectory}/${name}`;
}

export function temporaryOutputPath(workspace, name) {
  return join(workspace.temporaryDirectory, name);
}

export function runtimeProfilePath() {
  return join(runtimeAnalysisDirectory, "profiles.json");
}

export function runtimeHelperPath() {
  return join(runtimeAnalysisDirectory, "helper.py");
}

export function defaultPythonPath() {
  return process.env.PADSTUDIO_ANALYSIS_PYTHON?.trim() || join(
    repositoryRoot,
    ".runtime-tools",
    "source-eval",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
  );
}

export async function readRuntimeProfiles() {
  try { return JSON.parse(await readFile(runtimeProfilePath(), "utf8")); } catch (error) {
    throw new SourceAnalysisToolError("Không đọc được runtime analysis profiles.", "runtime_config_invalid", { cause: error });
  }
}

export async function runtimeProfileDigest(profileId) {
  const document = await readRuntimeProfiles();
  const profile = document?.profiles?.[profileId];
  if (document?.version !== "1.0" || !profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new SourceAnalysisToolError(`Runtime profile không hợp lệ: ${profileId}.`, "runtime_config_invalid");
  }
  return createHash("sha256")
    .update(canonicalJson({ profileId, profile }), "utf8")
    .digest("hex");
}

export function outputFile({ id, role, workspace, name, mediaType, sizeBytes }) {
  return { id, role, path: finalOutputPath(workspace, name), name, mediaType, sizeBytes };
}

export function timeoutForDuration(range, { baseMs = 30_000, factor = 3, maximumMs = 4 * 60 * 60 * 1000 } = {}) {
  const duration = range ? range.endSeconds - range.startSeconds : 1;
  return Math.min(maximumMs, Math.max(baseMs, Math.ceil(duration * factor * 1000)));
}
