import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);
export class AssetToolError extends Error {
  constructor(message, code = "invalid_input") { super(message); this.name = "AssetToolError"; this.code = code; }
}
export function fail(message, code) { throw new AssetToolError(message, code); }
export function object(value, fields, label = "inputs") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label + " must be an object.");
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) fail(label + " has unsupported fields: " + unknown.join(", "));
  return value;
}
export function text(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(label + " must be nonempty text (maximum " + max + ").");
  return value.trim().normalize("NFC");
}
export function number(value, label, min, max, fallback) {
  const actual = value === undefined ? fallback : value;
  if (!Number.isFinite(actual) || actual < min || actual > max) fail(label + " must be between " + min + " and " + max + ".");
  return actual;
}
export function sourceReference(value) {
  object(value, value?.kind === "resource" ? ["kind", "id", "itemPath"] : ["kind", "id", "file"], "source");
  if (!["resource", "result"].includes(value.kind)) fail("source.kind must be resource or result.");
  return { kind: value.kind, id: text(value.id, "source.id", 150),
    ...(value.kind === "resource" ? { itemPath: value.itemPath == null ? null : text(value.itemPath, "source.itemPath", 1000) }
      : { file: value.file === undefined ? "primary" : text(value.file, "source.file", 150) }) };
}
export function workspace(value) {
  if (!value?.temporaryDirectory || !value?.projectRelativeDirectory) fail("Missing project output workspace.", "invalid_output_workspace");
  return value;
}
export async function command(executable, args, options = {}) {
  try { return await exec(executable, args, { windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 120000, ...options }); }
  catch (error) {
    if (error.name === "AbortError") throw error;
    fail(error.code === "ENOENT" ? "Required executable is unavailable." : error.killed ? "Media command timed out." : "Media command failed.", error.code === "ENOENT" ? "tool_unavailable" : error.killed ? "timeout" : "media_command_failed");
  }
}
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
export async function fileEvidence(path, maxBytes = 512 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > maxBytes) fail("Invalid output file or size.", "invalid_output");
  return { sizeBytes: info.size, sha256: await hashFile(path) };
}
export async function probe(path, { run = command, ffprobe = "ffprobe", signal } = {}) {
  const result = await run(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { signal });
  let info;
  try { info = JSON.parse(result.stdout); } catch { fail("Invalid probe response.", "invalid_output"); }
  if (!Array.isArray(info?.streams) || !info.format) fail("Invalid media metadata.", "invalid_output");
  return info;
}
export async function ffmpegAvailability(run, ffmpeg, ffprobe) {
  try {
    const versions = await Promise.all([run(ffmpeg, ["-version"], { timeout: 5000 }), run(ffprobe, ["-version"], { timeout: 5000 })]);
    return { status: "available", executableVersion: versions[0].stdout.split(/\r?\n/)[0], ffprobeVersion: versions[1].stdout.split(/\r?\n/)[0] };
  } catch { return { status: "unavailable", reason: "Install FFmpeg/ffprobe or configure PADSTUDIO_FFMPEG_PATH and PADSTUDIO_FFPROBE_PATH." }; }
}
export function primaryFile(prepared, execution, name, mediaType) {
  return { id: "primary", role: "primary", path: prepared.trace.directory + "/" + name, name, mediaType, ...execution.file };
}
export const sourceSchema = { oneOf: [
  { type: "object", required: ["kind", "id"], properties: { kind: { const: "resource" }, id: { type: "string" }, itemPath: { type: ["string", "null"] } }, additionalProperties: false },
  { type: "object", required: ["kind", "id"], properties: { kind: { const: "result" }, id: { type: "string" }, file: { type: "string", default: "primary" } }, additionalProperties: false }
] };
