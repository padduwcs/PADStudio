import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeAnimationComposition } from "../animation/animation-composition.js";
import { loadSourcePackage } from "../animation/source-package.js";
import { validHumanConfirmation } from "../project/human-confirmation.js";
import { fail, fileEvidence, object, probe, text, workspace } from "./asset-tool-common.js";

const execFileAsync = promisify(execFile);
const RUNTIME_META = Object.freeze({
  manim: { name: "manim-ce", provider: "Manim Community", env: "PADSTUDIO_MANIM_PATH", command: "manim" },
  remotion: { name: "remotion-local", provider: "Remotion", env: "PADSTUDIO_REMOTION_PATH", command: "remotion" },
  hyperframes: { name: "hyperframes-local", provider: "HyperFrames", env: "PADSTUDIO_HYPERFRAMES_PATH", command: "hyperframes" },
});
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_RUNTIME_ROOT = join(REPOSITORY_ROOT, ".runtime-tools");
const LOCAL_NODE_RUNTIME_ROOT = join(LOCAL_RUNTIME_ROOT, "code-animation-node");

function installedBrowser() {
  const configured = process.env.PADSTUDIO_CHROME_PATH?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") return null;
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate)) ?? null;
}

function findNodeModules(path) {
  let current = dirname(path);
  while (dirname(current) !== current) {
    if (basename(current).toLowerCase() === "node_modules") return current;
    current = dirname(current);
  }
  return null;
}

function runtimeLaunch(runtime, configuredCommand, configuredPrefixArgs = []) {
  if (configuredCommand) {
    if ([".js", ".mjs", ".cjs"].includes(extname(configuredCommand).toLowerCase())) {
      return { executable: process.execPath, prefixArgs: [configuredCommand, ...configuredPrefixArgs],
        nodeModules: findNodeModules(configuredCommand) };
    }
    if (process.platform === "win32" && [".cmd", ".ps1"].includes(extname(configuredCommand).toLowerCase()) && runtime !== "manim") {
      const commandDirectory = dirname(configuredCommand);
      const nodeModules = basename(commandDirectory).toLowerCase() === ".bin"
        ? dirname(commandDirectory) : join(commandDirectory, "node_modules");
      const script = runtime === "remotion"
        ? join(nodeModules, "@remotion", "cli", "remotion-cli.js")
        : join(nodeModules, "hyperframes", "bin", "hyperframes.mjs");
      if (existsSync(script)) return { executable: process.execPath, prefixArgs: [script, ...configuredPrefixArgs], nodeModules };
    }
    return { executable: configuredCommand, prefixArgs: configuredPrefixArgs, nodeModules: null };
  }
  if (runtime === "manim") {
    const local = process.platform === "win32"
      ? join(LOCAL_RUNTIME_ROOT, "manim-venv", "Scripts", "manim.exe")
      : join(LOCAL_RUNTIME_ROOT, "manim-venv", "bin", "manim");
    return { executable: existsSync(local) ? local : "manim", prefixArgs: [], nodeModules: null };
  }
  const script = runtime === "remotion"
    ? join(LOCAL_NODE_RUNTIME_ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js")
    : join(LOCAL_NODE_RUNTIME_ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  return existsSync(script)
    ? { executable: process.execPath, prefixArgs: [script], nodeModules: join(LOCAL_NODE_RUNTIME_ROOT, "node_modules") }
    : { executable: RUNTIME_META[runtime].command, prefixArgs: [], nodeModules: null };
}

function hostCommand(executable, args, options = {}) {
  return execFileAsync(executable, args, { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
}

function cleanEnvironment(home, { nodeModules = null, browser = null } = {}) {
  const names = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "LANG"];
  const env = Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  const pathValue = process.env.Path ?? process.env.PATH ?? "";
  if (nodeModules) {
    const bin = join(nodeModules, ".bin");
    env.PATH = `${bin}${delimiter}${pathValue}`;
    env.Path = env.PATH;
    env.NODE_PATH = nodeModules;
  }
  return { ...env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: join(home, ".cache"), NO_COLOR: "1", CI: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1", ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}) };
}

function ratio(value) {
  if (typeof value !== "string") return null;
  const [top, bottom = "1"] = value.split("/").map(Number);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0 ? top / bottom : null;
}

function mediaDetails(info) {
  const video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  return { width: Number(video?.width), height: Number(video?.height), frameRate: ratio(video?.avg_frame_rate ?? video?.r_frame_rate),
    durationSeconds: Number(info.format?.duration ?? video?.duration), hasAudio: Boolean(audio) };
}

async function findNamedFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findNamedFile(path, name);
      if (found) return found;
    } else if (entry.isFile() && entry.name === name) return path;
  }
  return null;
}

function latestExecutionApproval(decisions, sourceResultId) {
  return decisions.filter((decision) => decision.kind === "project_decision" &&
    decision.target?.kind === "result" && decision.target.id === sourceResultId &&
    decision.category === "animation_code_execution" && decision.decidedBy === "user" &&
    validHumanConfirmation(decision.confirmation, "execute_animation_code", sourceResultId)).at(-1) ?? null;
}

function renderArguments(runtime, composition, paths) {
  const frames = Math.round(composition.durationSeconds * composition.format.fps);
  if (runtime === "manim") return ["render", "--config_file", paths.config, "--disable_caching", "--format", "mp4", "--media_dir", paths.media,
    "--resolution", `${composition.format.width},${composition.format.height}`, "--frame_rate", String(composition.format.fps),
    "-o", "padstudio-animation.mp4", paths.entry, composition.entry.symbol];
  if (runtime === "remotion") return ["render", paths.entry, composition.entry.symbol, paths.output,
    `--width=${composition.format.width}`, `--height=${composition.format.height}`, `--fps=${composition.format.fps}`,
    `--frames=0-${frames - 1}`, "--codec=h264", "--pixel-format=yuv420p", `--browser-executable=${paths.browser}`];
  return ["render", "--output", paths.output, "--fps", String(composition.format.fps), "--quality", "standard", "--strict"];
}

function durationTolerance(composition) {
  if (composition.timing.mode === "measured") {
    return Math.max(2 / composition.format.fps, Math.min(2, composition.durationSeconds * 0.01));
  }
  return Math.max(0.15, 1 / composition.format.fps + 0.05);
}

export function createCodeAnimationRenderer(runtime, {
  runtimeCommand = process.env[RUNTIME_META[runtime]?.env]?.trim() || null,
  runtimePrefixArgs = [],
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  browserCommand = installedBrowser(),
  executeCommand = hostCommand,
  timeoutMs = 20 * 60 * 1000,
} = {}) {
  const meta = RUNTIME_META[runtime];
  if (!meta) throw new Error(`Unsupported animation runtime: ${runtime}.`);
  const launch = runtimeLaunch(runtime, runtimeCommand, runtimePrefixArgs);
  return {
    name: meta.name, version: "1.0.0", provider: meta.provider, capability: "animation.render",
    description: `Render an exact, approved ${runtime} composition from managed project sources.`,
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes user-approved source code in a temporary Run workspace on the local host.", "Creates verified video, poster and render-report files."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "A verified animation.render Result bound to exact source, validation and composition revisions.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 }, validationResultId: { type: "string" }, allowHistorical: { type: "boolean" } } },
    async checkAvailability() {
      if (["remotion", "hyperframes"].includes(runtime) && !browserCommand) {
        return { status: "unavailable", reason: `${meta.provider} requires an existing Chrome/Edge browser. Configure PADSTUDIO_CHROME_PATH; PADStudio will not download a browser automatically.` };
      }
      if (["remotion", "hyperframes"].includes(runtime) && isAbsolute(browserCommand) && !existsSync(browserCommand)) {
        return { status: "unavailable", reason: `Configured browser does not exist: ${browserCommand}. PADStudio will not download a browser automatically.` };
      }
      try {
        const versionArgs = runtime === "remotion" ? ["help", "render"] : ["--version"];
        const checks = [
          executeCommand(launch.executable, [...launch.prefixArgs, ...versionArgs], { timeout: 8_000 }),
          executeCommand(ffmpegCommand, ["-version"], { timeout: 8_000 }),
          executeCommand(ffprobeCommand, ["-version"], { timeout: 8_000 }),
        ];
        const [runtimeVersion, ffmpegVersion, ffprobeVersion] = await Promise.all(checks);
        return { status: "available", runtime,
          executableVersion: String(runtimeVersion.stdout || runtimeVersion.stderr || "").split(/\r?\n/u)[0].slice(0, 200),
          ffmpegVersion: String(ffmpegVersion.stdout || "").split(/\r?\n/u)[0].slice(0, 200),
          ffprobeVersion: String(ffprobeVersion.stdout || "").split(/\r?\n/u)[0].slice(0, 200) };
      } catch (error) {
        return { status: "unavailable", reason: `${meta.provider} runtime or FFmpeg is unavailable. Install it explicitly, pin its dependencies, or configure ${meta.env}; PADStudio will not auto-install or silently switch runtimes.` };
      }
    },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      object(inputs, ["artifactId", "artifactRevision", "validationResultId", "allowHistorical"]);
      if (inputs.allowHistorical !== undefined && typeof inputs.allowHistorical !== "boolean") fail("allowHistorical must be boolean.");
      const artifactId = text(inputs.artifactId, "artifactId", 150);
      if (!Number.isInteger(inputs.artifactRevision) || inputs.artifactRevision < 1) fail("artifactRevision must be a positive integer.");
      const artifact = (await store.readArtifacts(projectId)).find((item) => item.id === artifactId && item.revision === inputs.artifactRevision);
      if (!artifact || artifact.type !== "animation.composition") fail("Exact animation.composition revision was not found.");
      const current = (await store.readContext(projectId)).intelligence.activeArtifacts.some((item) => item.id === artifact.id);
      if (!current && !inputs.allowHistorical) fail("Animation composition is a draft or historical revision; review it and set allowHistorical explicitly to render it.", "stale_animation");
      const composition = normalizeAnimationComposition(artifact.data);
      if (composition.runtime !== runtime) fail(`Composition runtime is ${composition.runtime}, not ${runtime}.`, "runtime_mismatch");
      const source = await loadSourcePackage(store, projectId, composition.sourceResultId, runtime);
      const validation = await store.readResult(projectId, text(inputs.validationResultId, "validationResultId", 150));
      if (validation.type !== "animation.validation" || validation.data?.status !== "passed" ||
          validation.data.sourceResultId !== source.result.id || validation.data.packageSha256 !== source.data.packageSha256) {
        fail("Validation Result is not bound to this exact source package.", "stale_validation");
      }
      const approval = latestExecutionApproval(await store.readDecisions(projectId), source.result.id);
      if (approval?.outcome !== "approved") fail("Exact user approval is required for this source Result before host code execution.", "code_execution_approval_required");
      const output = workspace(outputWorkspace);
      const codeDirectory = join(output.temporaryDirectory, "workspace");
      await mkdir(codeDirectory, { recursive: true });
      for (const file of source.files) {
        const target = join(codeDirectory, ...file.path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(file.filePath, target);
      }
      const inputResources = new Set(); const inputResults = new Set([source.result.id, validation.id]); const assets = [];
      for (const asset of composition.assets) {
        if (source.files.some((file) => file.path.toLowerCase() === asset.target.toLowerCase())) {
          fail(`Asset target collides with a source file: ${asset.target}.`);
        }
        const media = await store.resolveMediaSource(projectId, asset.source);
        const target = join(codeDirectory, ...asset.target.split("/"));
        await mkdir(dirname(target), { recursive: true }); await copyFile(media.filePath, target);
        assets.push({ id: asset.id, source: media.trace, target: asset.target, ...(await fileEvidence(target)) });
        media.inputResources.forEach((id) => inputResources.add(id)); media.inputResults.forEach((id) => inputResults.add(id));
      }
      const outputPath = join(output.temporaryDirectory, "animation.mp4");
      return { runtime: { composition, source, validation, approval, assets, artifact: { id: artifact.id, revision: artifact.revision }, codeDirectory,
          entryPath: join(codeDirectory, ...composition.entry.file.split("/")), outputPath,
          mediaDirectory: join(output.temporaryDirectory, "manim-media"), homeDirectory: join(output.temporaryDirectory, "home") },
        trace: { directory: output.projectRelativeDirectory, artifact: { id: artifact.id, revision: artifact.revision },
          sourceResultId: source.result.id, validationResultId: validation.id, approvalDecisionId: approval.id, allowHistorical: inputs.allowHistorical === true,
          inputResources: [...inputResources], inputResults: [...inputResults] } };
    },
    async execute({ composition, source, validation, approval, assets, artifact, codeDirectory, entryPath, outputPath, mediaDirectory, homeDirectory, availability, signal }) {
      await mkdir(homeDirectory, { recursive: true });
      const paths = { entry: entryPath, output: outputPath, media: mediaDirectory,
        config: join(homeDirectory, "manim.cfg"), browser: browserCommand };
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      if (runtime === "manim") await writeFile(paths.config, `[CLI]\nbackground_color = ${composition.format.background}\n`, "utf8");
      const commands = [];
      const run = async (executable, args, options = {}) => {
        commands.push({ executable: executable === launch.executable ? meta.name : executable === ffmpegCommand ? "ffmpeg" : "ffprobe", args: args.map((arg) =>
          typeof arg === "string" && arg.startsWith("--browser-executable=") ? "--browser-executable=<configured-browser>" :
            launch.prefixArgs.includes(arg) ? "<runtime-entry>" :
            [entryPath, outputPath, paths.config, codeDirectory, mediaDirectory].includes(arg) ? `<${extname(arg) ? "file" : "workspace"}>` : arg) });
        try { return await executeCommand(executable, args, { cwd: codeDirectory, timeout: timeoutMs, env, signal, ...options }); }
        catch (error) { fail(`${meta.provider} render command failed: ${String(error?.stderr || error?.message || "unknown error").slice(-1000)}`, error?.killed ? "timeout" : "animation_render_failed"); }
      };
      if (runtime === "hyperframes") await run(launch.executable, [...launch.prefixArgs, "check", "--strict"]);
      await run(launch.executable, [...launch.prefixArgs, ...renderArguments(runtime, composition, paths)]);
      if (runtime === "manim") {
        const rendered = await findNamedFile(mediaDirectory, "padstudio-animation.mp4");
        if (!rendered) fail("Manim exited without the declared output file.", "invalid_output");
        await copyFile(rendered, outputPath);
      }
      const info = await probe(outputPath, { run: executeCommand, ffprobe: ffprobeCommand, signal });
      const video = mediaDetails(info);
      const tolerance = durationTolerance(composition);
      const durationDriftSeconds = video.durationSeconds - composition.durationSeconds;
      if (video.width !== composition.format.width || video.height !== composition.format.height ||
          !Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0 || video.durationSeconds > 600 ||
          Math.abs(durationDriftSeconds) > tolerance ||
          !Number.isFinite(video.frameRate) || Math.abs(video.frameRate - composition.format.fps) > 0.05) {
        fail(
          `Rendered animation does not match the composition contract. ` +
          `Expected ${composition.format.width}x${composition.format.height} at ${composition.format.fps} fps, ` +
          `actual ${video.width}x${video.height} at ${video.frameRate} fps. ` +
          `Timing mode: ${composition.timing.mode}; target duration: ${composition.durationSeconds}s, ` +
          `actual duration: ${video.durationSeconds}s, allowed drift: ${tolerance}s.`,
          "invalid_output"
        );
      }
      const posterPath = join(dirname(outputPath), "poster.jpg");
      try {
        await executeCommand(ffmpegCommand, ["-hide_banner", "-loglevel", "error", "-ss", String(Math.min(video.durationSeconds / 2, video.durationSeconds - 0.01)),
          "-i", outputPath, "-frames:v", "1", "-y", posterPath], { signal, timeout: 60_000, env });
      } catch (error) {
        fail(`FFmpeg could not create the animation poster: ${String(error?.stderr || error?.message || "unknown error").slice(-500)}`, "poster_failed");
      }
      const report = { version: "1.0", runtime, artifact, sourceResultId: source.result.id,
        validationResultId: validation.id, approvalDecisionId: approval.id, format: composition.format,
        timing: { ...composition.timing, targetDurationSeconds: composition.durationSeconds,
          actualDurationSeconds: video.durationSeconds, durationDriftSeconds, toleranceSeconds: tolerance },
        dependencies: source.data.dependencies, assets, output: video, commands,
        executionBoundary: { workspace: "temporary_run_workspace", environment: "allowlisted_variables", networkIsolation: "not_enforced_by_host" },
        executableVersion: availability.executableVersion ?? null };
      const reportPath = join(dirname(outputPath), "render-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, video, report,
        output: await fileEvidence(outputPath), poster: await fileEvidence(posterPath, 20 * 1024 * 1024),
        reportFile: await fileEvidence(reportPath, 2 * 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.render", name: `${runtime} animation: ${prepared.trace.artifact.id} r${prepared.trace.artifact.revision}`,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: [prepared.trace.artifact.id],
        files: [
          { id: "primary", role: "primary", path: `${prepared.trace.directory}/animation.mp4`, name: "animation.mp4", mediaType: "video", ...execution.output },
          { id: "poster", role: "poster", path: `${prepared.trace.directory}/poster.jpg`, name: "poster.jpg", mediaType: "image", ...execution.poster },
          { id: "report", role: "evidence", path: `${prepared.trace.directory}/render-report.json`, name: "render-report.json", mediaType: "application/json", ...execution.reportFile },
        ],
        data: { version: "1.0", runtime, composition: prepared.trace.artifact, sourceResultId: prepared.trace.sourceResultId,
          validationResultId: prepared.trace.validationResultId, approvalDecisionId: prepared.trace.approvalDecisionId,
          durationSeconds: execution.video.durationSeconds, timing: execution.report.timing,
          video: { width: execution.video.width, height: execution.video.height, frameRate: execution.video.frameRate },
          hasAudio: execution.video.hasAudio, executionBoundary: execution.report.executionBoundary },
        verification: { status: "passed", checks: ["source_checksums_verified", "exact_user_code_approval", "static_validation_bound",
          "runtime_exit_0", "video_stream_present", "resolution_matches", "frame_rate_matches",
          prepared.runtime.composition.timing.mode === "measured" ? "duration_measured_within_tolerance" : "duration_matches",
          "poster_generated"],
          details: { runtime, artifactRevision: prepared.trace.artifact.revision, networkIsolation: "not_enforced_by_host" } } };
    },
  };
}

export const createManimAnimationRenderer = (options) => createCodeAnimationRenderer("manim", options);
export const createRemotionAnimationRenderer = (options) => createCodeAnimationRenderer("remotion", options);
export const createHyperframesAnimationRenderer = (options) => createCodeAnimationRenderer("hyperframes", options);
