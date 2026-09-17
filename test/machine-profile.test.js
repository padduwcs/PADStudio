import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ProjectStore } from "../src/project/project-store.js";
import {
  inspectMachineProfile,
  parseFfmpegHardwareEncoders,
  parseLinuxGpuInventory,
  parseMacGpuInventory,
  parseNvidiaSmiInventory,
  parseWindowsGpuInventory,
} from "../src/operations/machine-profile.js";
import { buildPlanningEnvironment } from "../src/operations/planning-environment.js";

test("machine profile normalizes hardware without reading secrets or benchmarking", async () => {
  const calls = [];
  const run = async (executable, args) => {
    calls.push([executable, ...args]);
    if (executable === "nvidia-smi") return { stdout: "NVIDIA RTX Test, 12288, 555.12\n", stderr: "" };
    if (executable === "ffmpeg") return { stdout: " V....D h264_nvenc NVIDIA NVENC H.264 encoder\n V....D hevc_qsv Intel QSV HEVC encoder\n", stderr: "" };
    throw new Error(`Unexpected command ${executable}`);
  };
  const profile = await inspectMachineProfile({
    run, platform: "win32", architecture: "x64", release: "fixture",
    cpus: [{ model: "Fixture CPU" }, { model: "Fixture CPU" }],
    totalMemoryBytes: 16 * 1024 ** 3, freeMemoryBytes: 6 * 1024 ** 3,
    now: () => "2026-09-17T00:00:00.000Z",
  });
  assert.equal(profile.cpu.logicalCores, 2);
  assert.deepEqual(profile.cpu.models, ["Fixture CPU"]);
  assert.equal(profile.gpu.adapters[0].memoryBytes, 12288 * 1024 * 1024);
  assert.deepEqual(profile.mediaAcceleration.ffmpegEncoderCandidates, ["h264_nvenc", "hevc_qsv"]);
  assert.equal(profile.privacy.secretsRead, false);
  assert.equal(profile.privacy.networkProbePerformed, false);
  assert.equal(calls.some((call) => call[0] === "powershell.exe"), false);
});

test("hardware parsers handle Windows, NVIDIA and FFmpeg reports", () => {
  assert.equal(parseWindowsGpuInventory('{"Name":"Intel Arc","AdapterRAM":4294967296,"DriverVersion":"1.2"}')[0].name, "Intel Arc");
  assert.equal(parseNvidiaSmiInventory("RTX A, 8192, 10.0\nRTX B, 4096, 10.0").length, 2);
  assert.equal(parseMacGpuInventory('{"SPDisplaysDataType":[{"sppci_model":"Apple GPU","spdisplays_vram_shared":"16 GB"}]}')[0].memoryBytes, 16 * 1024 ** 3);
  assert.equal(parseLinuxGpuInventory('"01:00.0" "VGA compatible controller" "NVIDIA Corporation" "RTX Test"').at(0).name, "NVIDIA Corporation RTX Test");
  assert.deepEqual(parseFfmpegHardwareEncoders(" V..... h264_amf AMD AMF\n V..... av1_nvenc NVIDIA"), ["av1_nvenc", "h264_amf"]);
});

test("planning environment presents capability menu, runtime choices, setup and resource risks", () => {
  const machine = {
    checkedAt: "2026-09-17T00:00:00.000Z",
    operatingSystem: { platform: "win32", architecture: "x64" },
    cpu: { logicalCores: 4, models: ["CPU"] },
    memory: { totalBytes: 4 * 1024 ** 3, freeBytes: 2 * 1024 ** 3 },
    storage: { freeBytes: 20 * 1024 ** 3 },
    gpu: { status: "unavailable", adapters: [] },
    mediaAcceleration: { ffmpegDetected: true, ffmpegEncoderCandidates: [] },
    privacy: { secretsRead: false, networkProbePerformed: false },
  };
  const local = (name, availability, extra = {}) => ({ name, capability: "animation.render", availability, ...extra });
  const capabilities = { capabilities: [{ id: "animation.render", available: true, tools: [
    local("remotion-local", { status: "available", executableVersion: "4.0" }, {
      resourceProfile: { class: "standard", cpuCores: 4, ramMb: 8192, vramMb: 0, workingDiskMb: 2048, networkRequired: false, confidence: "catalog_estimate" },
    }),
    local("hyperframes-local", { status: "unavailable", reason: "missing runtime" }, {
      setup: { kind: "local_runtime", instructions: "Install pinned HyperFrames.", configKeys: [] },
    }),
  ] }] };
  const result = buildPlanningEnvironment({ machine, capabilityDescription: capabilities, onboarding: true });
  assert.equal(result.mode, "onboarding");
  assert.equal(result.compositionRuntimes.remotion.available, true);
  assert.equal(result.compositionRuntimes.hyperframes.available, false);
  assert.equal(result.capabilityMenu[0].configured, 1);
  assert.equal(result.setupOffers[0].tool, "hyperframes-local");
  assert.equal(result.resourceRisks[0].tool, "remotion-local");
  assert.ok(result.warnings.some((warning) => warning.includes("GPU/VRAM")));
});

test("a fresh project resume receives onboarding environment automatically", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-machine-profile-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "fresh", title: "Fresh project" });
  const machine = {
    checkedAt: "2026-09-17T00:00:00.000Z", operatingSystem: { platform: "win32", architecture: "x64" },
    cpu: { logicalCores: 8, models: ["Fixture CPU"] }, memory: { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 },
    storage: { freeBytes: 100 * 1024 ** 3 }, gpu: { status: "none", adapters: [] },
    mediaAcceleration: { ffmpegDetected: true, ffmpegEncoderCandidates: [] },
    privacy: { secretsRead: false, networkProbePerformed: false },
  };
  const assembler = new ProjectContextAssembler({
    projectStore: store,
    toolRegistry: { describeCapabilities: async () => ({ capabilities: [] }) },
    machineProfileReader: async () => machine,
  });
  const resume = await assembler.buildResume("fresh");
  assert.equal(resume.environment.mode, "onboarding");
  assert.equal(resume.environment.machine.cpuLogicalCores, 8);
});
