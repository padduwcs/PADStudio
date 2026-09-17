import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HARDWARE_ENCODERS = Object.freeze([
  "h264_nvenc", "hevc_nvenc", "av1_nvenc",
  "h264_qsv", "hevc_qsv", "av1_qsv",
  "h264_amf", "hevc_amf", "av1_amf",
  "h264_videotoolbox", "hevc_videotoolbox",
]);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function compactText(value, limit = 200) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, limit) : null;
}

function normalizeGpu(value, source) {
  const name = compactText(value?.name ?? value?.Name);
  if (!name) return null;
  const memoryBytes = positiveInteger(value?.memoryBytes ?? value?.AdapterRAM);
  const memoryMb = positiveInteger(value?.memoryMb ?? value?.memory_total);
  return {
    name,
    memoryBytes: memoryBytes ?? (memoryMb ? memoryMb * 1024 * 1024 : null),
    driverVersion: compactText(value?.driverVersion ?? value?.DriverVersion),
    source,
  };
}

export function parseWindowsGpuInventory(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((value) => normalizeGpu(value, "windows_cim"))
    .filter(Boolean);
}

export function parseNvidiaSmiInventory(stdout) {
  return String(stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, memoryMb, driverVersion] = line.split(",").map((value) => value.trim());
    return normalizeGpu({ name, memoryMb, driverVersion }, "nvidia_smi");
  }).filter(Boolean);
}

function memoryTextBytes(value) {
  const match = String(value ?? "").match(/([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)/iu);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2));
}

export function parseMacGpuInventory(stdout) {
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const entries = Array.isArray(parsed?.SPDisplaysDataType) ? parsed.SPDisplaysDataType : [];
  return entries.map((value) => normalizeGpu({
    name: value.sppci_model ?? value._name,
    memoryBytes: memoryTextBytes(value.spdisplays_vram ?? value.spdisplays_vram_shared),
  }, "macos_system_profiler")).filter(Boolean);
}

export function parseLinuxGpuInventory(stdout) {
  return String(stdout ?? "").split(/\r?\n/u).filter((line) => /"(?:VGA compatible controller|3D controller|Display controller)"/iu.test(line)).map((line) => {
    const fields = [...line.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
    return normalizeGpu({ name: fields.slice(2).join(" ") }, "linux_lspci");
  }).filter(Boolean);
}

export function parseFfmpegHardwareEncoders(stdout) {
  const text = String(stdout ?? "");
  return HARDWARE_ENCODERS.filter((encoder) => new RegExp(`(?:^|\\s)${encoder}(?:\\s|$)`, "mu").test(text));
}

async function runQuiet(run, executable, args, timeout = 8_000) {
  try {
    const result = await run(executable, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: String(result?.stdout ?? ""), stderr: String(result?.stderr ?? "") };
  } catch (error) {
    return { ok: false, code: error?.code ?? null, message: compactText(error?.message, 300) };
  }
}

async function gpuInventory(platform, run) {
  const nvidia = await runQuiet(run, "nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits",
  ]);
  if (nvidia.ok) {
    const adapters = parseNvidiaSmiInventory(nvidia.stdout);
    if (adapters.length) return { status: "detected", adapters };
  }
  if (platform === "win32") {
    const command = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion) | ConvertTo-Json -Compress";
    const result = await runQuiet(run, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    if (result.ok) {
      try {
        const adapters = parseWindowsGpuInventory(result.stdout);
        return { status: adapters.length ? "detected" : "none", adapters };
      } catch {
        return { status: "unavailable", adapters: [], reason: "gpu_inventory_parse_failed" };
      }
    }
  }
  if (platform === "darwin") {
    const result = await runQuiet(run, "system_profiler", ["SPDisplaysDataType", "-json"], 12_000);
    if (result.ok) {
      try {
        const adapters = parseMacGpuInventory(result.stdout);
        return { status: adapters.length ? "detected" : "none", adapters };
      } catch {
        return { status: "unavailable", adapters: [], reason: "gpu_inventory_parse_failed" };
      }
    }
  }
  if (platform === "linux") {
    const result = await runQuiet(run, "lspci", ["-mm"]);
    if (result.ok) {
      const adapters = parseLinuxGpuInventory(result.stdout);
      return { status: adapters.length ? "detected" : "none", adapters };
    }
  }
  return { status: "unavailable", adapters: [], reason: "gpu_inventory_not_available" };
}

async function storageProfile(rootDir) {
  if (!rootDir) return null;
  try {
    const disk = await statfs(rootDir);
    return {
      freeBytes: Number(disk.bavail) * Number(disk.bsize),
      totalBytes: Number(disk.blocks) * Number(disk.bsize),
    };
  } catch {
    return null;
  }
}

export async function inspectMachineProfile({
  rootDir = null,
  run = execFileAsync,
  platform = process.platform,
  architecture = process.arch,
  release = os.release(),
  cpus = os.cpus(),
  totalMemoryBytes = os.totalmem(),
  freeMemoryBytes = os.freemem(),
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  now = () => new Date().toISOString(),
} = {}) {
  const [gpu, storage, ffmpeg] = await Promise.all([
    gpuInventory(platform, run),
    storageProfile(rootDir),
    runQuiet(run, ffmpegCommand, ["-hide_banner", "-encoders"]),
  ]);
  const cpuModels = [...new Set((cpus ?? []).map((cpu) => compactText(cpu?.model)).filter(Boolean))];
  return {
    version: "1.0",
    checkedAt: now(),
    operatingSystem: { platform, architecture, release: compactText(release) },
    cpu: { logicalCores: cpus?.length ?? 0, models: cpuModels.slice(0, 4) },
    memory: {
      totalBytes: positiveInteger(totalMemoryBytes) ?? 0,
      freeBytes: positiveInteger(freeMemoryBytes) ?? 0,
    },
    storage,
    gpu,
    mediaAcceleration: {
      ffmpegDetected: ffmpeg.ok,
      // FFmpeg listing an encoder proves build support, not that matching
      // hardware is usable. Exact render availability must still be tested.
      ffmpegEncoderCandidates: ffmpeg.ok ? parseFfmpegHardwareEncoders(ffmpeg.stdout) : [],
    },
    privacy: {
      secretsRead: false,
      networkProbePerformed: false,
      note: "The profile contains local capability facts only; it does not read API-key values or benchmark the machine.",
    },
  };
}
