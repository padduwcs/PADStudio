import { statfs } from "node:fs/promises";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { readRuntimeProfiles } from "../tools/source-analysis-common.js";

const ANALYSIS_CAPABILITIES = new Set([
  "source.probe", "video.detect-scenes", "source.extract-frames",
  "audio.analyze", "audio.transcribe", "source.preview"
]);

try {
  const registry = createDefaultToolRegistry();
  const [described, profiles] = await Promise.all([
    registry.describeCapabilities(),
    readRuntimeProfiles()
  ]);
  const capabilities = described.capabilities.filter((entry) => ANALYSIS_CAPABILITIES.has(entry.id));
  const pythonVersion = capabilities
    .flatMap((entry) => entry.tools)
    .map((tool) => tool.availability?.pythonVersion)
    .find(Boolean) ?? null;
  const disk = await statfs(process.cwd());
  const result = {
    version: "1.0",
    status: capabilities.every((entry) => entry.available) ? "ready" : "blocked",
    practicalDefault: profiles.practicalDefault,
    releaseDefault: profiles.releaseDefault,
    node: process.version,
    python: pythonVersion,
    platform: process.platform,
    diskFreeBytes: Number(disk.bavail) * Number(disk.bsize),
    capabilities,
    note: "Doctor không tải model và không chạy inference. Profile ASR không tự fallback."
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.status === "ready" ? 0 : 2;
} catch (error) {
  process.stderr.write(JSON.stringify({ version: "1.0", status: "failed", error: error?.message || String(error) }) + "\n");
  process.exitCode = 1;
}
