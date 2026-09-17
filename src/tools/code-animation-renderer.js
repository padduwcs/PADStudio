import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeAnimationComposition } from "../animation/animation-composition.js";
import { loadAnimationProps } from "../animation/animation-props.js";
import { loadSourcePackage } from "../animation/source-package.js";
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

function installedBrowser({ allowSystem = true } = {}) {
  const configured = process.env.PADSTUDIO_CHROME_PATH?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") return null;
  const managed = [
    join(LOCAL_RUNTIME_ROOT, "chrome-for-testing", "chrome-win64", "chrome.exe"),
    join(LOCAL_RUNTIME_ROOT, "chrome-for-testing", "chrome.exe"),
    join(LOCAL_RUNTIME_ROOT, "chrome-headless-shell", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  ].find((candidate) => existsSync(candidate));
  if (managed || !allowSystem) return managed ?? null;
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate)) ?? null;
}

function remotionChromeMode(browser) {
  return basename(browser ?? "").toLowerCase().includes("headless-shell") ? "headless-shell" : "chrome-for-testing";
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
    LOCALAPPDATA: join(home, "local-app-data"), APPDATA: join(home, "app-data"),
    HYPERFRAMES_NO_UPDATE_CHECK: "1", ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}) };
}

function availabilityEnvironment({ nodeModules = null, browser = null } = {}) {
  const names = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "LANG",
    "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];
  const env = Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  const pathValue = process.env.Path ?? process.env.PATH ?? "";
  if (nodeModules) {
    env.PATH = `${join(nodeModules, ".bin")}${delimiter}${pathValue}`;
    env.Path = env.PATH; env.NODE_PATH = nodeModules;
  }
  return { ...env, NO_COLOR: "1", CI: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1",
    ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}) };
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

function renderArguments(runtime, composition, paths) {
  const frames = Math.round(composition.durationSeconds * composition.format.fps);
  if (runtime === "manim") return ["render", "--config_file", paths.config, "--disable_caching", "--format", "mp4", "--media_dir", paths.media,
    "--resolution", `${composition.format.width},${composition.format.height}`, "--frame_rate", String(composition.format.fps),
    "-o", "padstudio-animation.mp4", paths.entry, composition.entry.symbol];
  if (runtime === "remotion") return ["render", paths.entry, composition.entry.symbol, paths.output,
    `--width=${composition.format.width}`, `--height=${composition.format.height}`, `--fps=${composition.format.fps}`,
    `--frames=0-${frames - 1}`, "--codec=h264", "--pixel-format=yuv420p", `--chrome-mode=${paths.chromeMode}`, `--browser-executable=${paths.browser}`,
    ...(paths.props ? [`--props=${paths.props}`] : [])];
  return ["render", "--output", paths.output, "--fps", String(composition.format.fps), "--quality", "standard",
    "--strict-all", "--no-best-effort"];
}

function durationTolerance(composition) {
  if (composition.timing.mode === "measured") {
    return Math.max(2 / composition.format.fps, Math.min(2, composition.durationSeconds * 0.01));
  }
  return Math.max(0.15, 1 / composition.format.fps + 0.05);
}

async function prepareAnimationWorkspace({ store, projectId, inputs, outputWorkspace, runtime, allowedFields = [] }) {
  object(inputs, ["artifactId", "artifactRevision", "validationResultId", "allowHistorical", ...allowedFields]);
  if (inputs.allowHistorical !== undefined && typeof inputs.allowHistorical !== "boolean") fail("allowHistorical must be boolean.");
  const artifactId = text(inputs.artifactId, "artifactId", 150);
  if (!Number.isInteger(inputs.artifactRevision) || inputs.artifactRevision < 1) fail("artifactRevision must be a positive integer.");
  const artifact = (await store.readArtifacts(projectId)).find((item) => item.id === artifactId && item.revision === inputs.artifactRevision);
  if (!artifact || artifact.type !== "animation.composition") fail("Exact animation.composition revision was not found.");
  const current = (await store.readContext(projectId)).intelligence.activeArtifacts.some((item) => item.id === artifact.id);
  if (!current && !inputs.allowHistorical) fail("Animation composition is a draft or historical revision; review it and set allowHistorical explicitly to execute it.", "stale_animation");
  const composition = normalizeAnimationComposition(artifact.data);
  if (composition.runtime !== runtime) fail(`Composition runtime is ${composition.runtime}, not ${runtime}.`, "runtime_mismatch");
  const source = await loadSourcePackage(store, projectId, composition.sourceResultId, runtime);
  const validation = await store.readResult(projectId, text(inputs.validationResultId, "validationResultId", 150));
  if (validation.type !== "animation.validation" || validation.data?.status !== "passed" ||
      validation.data.sourceResultId !== source.result.id || validation.data.packageSha256 !== source.data.packageSha256) {
    fail("Validation Result is not bound to this exact source package.", "stale_validation");
  }
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
    if (source.files.some((file) => file.path.toLowerCase() === asset.target.toLowerCase())) fail(`Asset target collides with a source file: ${asset.target}.`);
    const media = await store.resolveMediaSource(projectId, asset.source);
    const target = join(codeDirectory, ...asset.target.split("/"));
    await mkdir(dirname(target), { recursive: true }); await copyFile(media.filePath, target);
    assets.push({ id: asset.id, source: media.trace, target: asset.target, ...(await fileEvidence(target)) });
    media.inputResources.forEach((id) => inputResources.add(id)); media.inputResults.forEach((id) => inputResults.add(id));
  }
  let props = null;
  if (composition.propsResultId) {
    if (source.files.some((file) => file.path.toLowerCase() === "data/props.json")) {
      fail("Managed props target collides with source file data/props.json.");
    }
    props = await loadAnimationProps(store, projectId, composition.propsResultId);
    const target = join(codeDirectory, "data", "props.json");
    await mkdir(dirname(target), { recursive: true }); await copyFile(props.file.filePath, target);
    props = { result: props.result, props: props.props, target, evidence: await fileEvidence(target, 1024 * 1024) };
    inputResults.add(props.result.id);
  }
  let preflight = null;
  if (inputs.preflightResultId !== undefined) {
    preflight = await store.readResult(projectId, text(inputs.preflightResultId, "preflightResultId", 150));
    if (preflight.type !== "animation.preflight" || preflight.data?.status !== "passed" ||
        preflight.data?.runtime !== runtime || preflight.data?.composition?.id !== artifact.id ||
        preflight.data?.composition?.revision !== artifact.revision || preflight.data?.sourceResultId !== source.result.id ||
        preflight.data?.validationResultId !== validation.id || preflight.data?.propsResultId !== (props?.result.id ?? null)) {
      fail("Preflight Result is not passed and bound to this exact composition/source/props/validation set.", "stale_preflight");
    }
    inputResults.add(preflight.id);
  }
  return { runtime: { composition, source, validation, assets, props, preflight,
      artifact: { id: artifact.id, revision: artifact.revision }, codeDirectory,
      entryPath: join(codeDirectory, ...composition.entry.file.split("/")),
      outputPath: join(output.temporaryDirectory, "animation.mp4"), mediaDirectory: join(output.temporaryDirectory, "manim-media"),
      homeDirectory: join(output.temporaryDirectory, "home"), outputDirectory: output.temporaryDirectory },
    trace: { directory: output.projectRelativeDirectory, artifact: { id: artifact.id, revision: artifact.revision },
      sourceResultId: source.result.id, validationResultId: validation.id,
      propsResultId: props?.result.id ?? null, preflightResultId: preflight?.id ?? null,
      allowHistorical: inputs.allowHistorical === true, inputResources: [...inputResources], inputResults: [...inputResults] } };
}

export function createCodeAnimationRenderer(runtime, {
  runtimeCommand = process.env[RUNTIME_META[runtime]?.env]?.trim() || null,
  runtimePrefixArgs = [],
  ffmpegCommand = process.env.PADSTUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobeCommand = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe",
  browserCommand = installedBrowser({ allowSystem: runtime === "hyperframes" }),
  executeCommand = hostCommand,
  timeoutMs = 60 * 60 * 1000,
} = {}) {
  const meta = RUNTIME_META[runtime];
  if (!meta) throw new Error(`Unsupported animation runtime: ${runtime}.`);
  const launch = runtimeLaunch(runtime, runtimeCommand, runtimePrefixArgs);
  return {
    name: meta.name, version: "1.0.0", provider: meta.provider, capability: "animation.render",
    description: `Render an exact, validated ${runtime} composition from managed project sources.`,
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes statically validated source code in a temporary Run workspace on the local host.", "Creates verified video, poster and render-report files."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "A verified animation.render Result bound to exact source, props, validation, preflight and composition revisions.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId", "preflightResultId"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 }, validationResultId: { type: "string" },
        preflightResultId: { type: "string" }, allowHistorical: { type: "boolean" } } },
    async checkAvailability() {
      if (["remotion", "hyperframes"].includes(runtime) && !browserCommand) {
        return { status: "unavailable", reason: runtime === "remotion"
          ? "Remotion requires an explicitly installed Chrome for Testing or Chrome Headless Shell. Put it under .runtime-tools or configure PADSTUDIO_CHROME_PATH; PADStudio will not download a browser automatically. Branded Chrome 136+ is not auto-selected because its remote-debugging policy can reject automation profiles."
          : `${meta.provider} requires an existing Chrome/Edge browser. Configure PADSTUDIO_CHROME_PATH; PADStudio will not download a browser automatically.` };
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
          ...(runtime === "hyperframes" ? [executeCommand(launch.executable, [...launch.prefixArgs, "doctor", "--json"], {
            timeout: 20_000, env: availabilityEnvironment({ nodeModules: launch.nodeModules, browser: browserCommand }),
          })] : []),
        ];
        const [runtimeVersion, ffmpegVersion, ffprobeVersion, doctorOutput] = await Promise.all(checks);
        const doctor = runtime === "hyperframes" ? normalizeHyperframesDoctor(parseJsonOutput(doctorOutput?.stdout)) : null;
        if (runtime === "hyperframes" && !doctor) throw new Error("HyperFrames doctor did not return valid JSON.");
        if (doctor?.blockingFailedCount) throw new Error("HyperFrames doctor reported a required runtime failure.");
        return { status: "available", runtime,
          executableVersion: String(runtimeVersion.stdout || runtimeVersion.stderr || "").split(/\r?\n/u)[0].slice(0, 200),
          ffmpegVersion: String(ffmpegVersion.stdout || "").split(/\r?\n/u)[0].slice(0, 200),
          ffprobeVersion: String(ffprobeVersion.stdout || "").split(/\r?\n/u)[0].slice(0, 200),
          ...(doctor ? { doctor } : {}) };
      } catch (error) {
        return { status: "unavailable", reason: `${meta.provider} runtime or FFmpeg is unavailable. Install it explicitly, pin its dependencies, or configure ${meta.env}; PADStudio will not auto-install or silently switch runtimes.` };
      }
    },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      const prepared = await prepareAnimationWorkspace({ store, projectId, inputs, outputWorkspace, runtime, allowedFields: ["preflightResultId"] });
      if (inputs.preflightResultId === undefined) fail("A passed exact preflightResultId is required before full render.", "preflight_required");
      return prepared;
    },
    async execute({ composition, source, validation, assets, props, artifact, codeDirectory, entryPath, outputPath, mediaDirectory, homeDirectory, availability, signal }) {
      await Promise.all([homeDirectory, join(homeDirectory, "local-app-data"), join(homeDirectory, "app-data")]
        .map((directory) => mkdir(directory, { recursive: true })));
      const paths = { entry: entryPath, output: outputPath, media: mediaDirectory, props: props?.target ?? null,
        config: join(homeDirectory, "manim.cfg"), browser: browserCommand, chromeMode: remotionChromeMode(browserCommand) };
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      if (runtime === "manim") await writeFile(paths.config, `[CLI]\nbackground_color = ${composition.format.background}\n`, "utf8");
      const commands = [];
      const run = async (executable, args, options = {}) => {
        commands.push({ executable: executable === launch.executable ? meta.name : executable === ffmpegCommand ? "ffmpeg" : "ffprobe", args: args.map((arg) =>
          typeof arg === "string" && arg.startsWith("--browser-executable=") ? "--browser-executable=<configured-browser>" :
            launch.prefixArgs.includes(arg) ? "<runtime-entry>" :
            typeof arg === "string" && arg.startsWith("--props=") ? "--props=<managed-props>" :
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
        validationResultId: validation.id, format: composition.format,
        timing: { ...composition.timing, targetDurationSeconds: composition.durationSeconds,
          actualDurationSeconds: video.durationSeconds, durationDriftSeconds, toleranceSeconds: tolerance },
        dependencies: source.data.dependencies, assets,
        props: props ? { resultId: props.result.id, target: "data/props.json", ...props.evidence } : null,
        output: video, commands,
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
          validationResultId: prepared.trace.validationResultId,
          propsResultId: prepared.runtime.props?.result.id ?? null,
          preflightResultId: prepared.trace.preflightResultId,
          durationSeconds: execution.video.durationSeconds, timing: execution.report.timing,
          video: { width: execution.video.width, height: execution.video.height, frameRate: execution.video.frameRate },
          hasAudio: execution.video.hasAudio, executionBoundary: execution.report.executionBoundary },
        verification: { status: "passed", checks: ["source_checksums_verified", "agent_managed_code_execution", "static_validation_bound", "exact_preflight_bound",
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

function outputTail(value, limit = 32_000) {
  return String(value ?? "").slice(-limit);
}

function redactDiagnostic(value, replacements, limit) {
  let result = outputTail(value, limit);
  for (const [path, label] of replacements) {
    if (!path) continue;
    result = result.split(path).join(label).split(path.replaceAll("\\", "/")).join(label);
  }
  return result;
}

function parseJsonOutput(value) {
  const textValue = String(value ?? "").trim();
  if (!textValue) return null;
  try { return JSON.parse(textValue); } catch { return null; }
}

function normalizeHyperframesDoctor(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.checks)) return null;
  const checks = parsed.checks.slice(0, 60).map((check) => ({
    name: String(check?.name ?? "unknown").slice(0, 120),
    ok: check?.ok === true,
    detail: String(check?.detail ?? "").slice(0, 500),
    hint: check?.hint == null ? null : String(check.hint).slice(0, 500),
  }));
  const failed = checks.filter((check) => !check.ok);
  const blockingNames = new Set(["Version", "Node.js", "FFmpeg", "FFprobe", "Chrome"]);
  const blockingFailed = failed.filter((check) => blockingNames.has(check.name));
  return {
    status: blockingFailed.length ? "blocked" : failed.length ? "degraded" : "healthy",
    checkCount: checks.length,
    failedCount: failed.length,
    blockingFailedCount: blockingFailed.length,
    failedChecks: failed.map(({ name, detail, hint }) => ({ name, detail, hint })),
    version: parsed._meta?.version == null ? null : String(parsed._meta.version).slice(0, 80),
  };
}

const HYPERFRAMES_FINDING_SECTIONS = Object.freeze(["lint", "runtime", "layout", "motion", "contrast"]);

function finiteNumber(value) { return Number.isFinite(value) ? value : null; }

function normalizeHyperframesFinding(section, finding) {
  if (!finding || typeof finding !== "object") return null;
  const bbox = finding.bbox && typeof finding.bbox === "object" ? {
    x: finiteNumber(finding.bbox.x), y: finiteNumber(finding.bbox.y),
    width: finiteNumber(finding.bbox.width), height: finiteNumber(finding.bbox.height),
  } : null;
  return {
    section,
    code: String(finding.code ?? "unknown").slice(0, 160),
    severity: ["error", "warning", "info"].includes(finding.severity) ? finding.severity : "info",
    message: String(finding.message ?? "").slice(0, 2_000),
    selector: finding.selector == null ? null : String(finding.selector).slice(0, 500),
    sourceFile: finding.sourceFile == null ? null : String(finding.sourceFile).slice(0, 500),
    time: finiteNumber(finding.time), firstSeen: finiteNumber(finding.firstSeen), lastSeen: finiteNumber(finding.lastSeen),
    occurrences: Number.isInteger(finding.occurrences) && finding.occurrences > 0 ? finding.occurrences : null,
    bbox, fixHint: finding.fixHint == null ? null : String(finding.fixHint).slice(0, 2_000),
  };
}

function normalizeHyperframesDiagnostics(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const all = HYPERFRAMES_FINDING_SECTIONS.flatMap((section) => Array.isArray(parsed[section]?.findings)
    ? parsed[section].findings.map((finding) => normalizeHyperframesFinding(section, finding)).filter(Boolean) : []);
  const findings = all.slice(0, 200);
  const sections = Object.fromEntries(HYPERFRAMES_FINDING_SECTIONS.map((section) => [section, {
    errorCount: Number.isInteger(parsed[section]?.errorCount) ? parsed[section].errorCount : all.filter((finding) => finding.section === section && finding.severity === "error").length,
    warningCount: Number.isInteger(parsed[section]?.warningCount) ? parsed[section].warningCount : all.filter((finding) => finding.section === section && finding.severity === "warning").length,
    sampleCount: Array.isArray(parsed[section]?.samples) ? parsed[section].samples.length : finiteNumber(parsed[section]?.samples),
    enabled: typeof parsed[section]?.enabled === "boolean" ? parsed[section].enabled : null,
    totalIssueCount: Number.isInteger(parsed[section]?.totalIssueCount) ? parsed[section].totalIssueCount : null,
    truncated: parsed[section]?.truncated === true,
    ...(section === "layout" ? {
      duration: finiteNumber(parsed.layout?.duration),
      transitionSampleCount: Array.isArray(parsed.layout?.transitionSamples) ? parsed.layout.transitionSamples.length : finiteNumber(parsed.layout?.transitionSamples),
      transitionSamplesDropped: Number.isInteger(parsed.layout?.transitionSamplesDropped) ? parsed.layout.transitionSamplesDropped
        : Number.isInteger(parsed.transitionSamplesDropped) ? parsed.transitionSamplesDropped : 0,
    } : {}),
  }]));
  const coverageComplete = sections.layout.transitionSamplesDropped === 0 &&
    parsed.truncated !== true && !Object.values(sections).some((section) => section.truncated) && all.length <= findings.length;
  const snapshots = parsed.snapshots && typeof parsed.snapshots === "object" ? {
    enabled: parsed.snapshots.enabled === true,
    fileCount: Array.isArray(parsed.snapshots.files) ? parsed.snapshots.files.length : null,
    findingFileCount: Array.isArray(parsed.snapshots.findingFiles) ? parsed.snapshots.findingFiles.length : null,
    expected: finiteNumber(parsed.snapshots.expected), written: finiteNumber(parsed.snapshots.written),
  } : null;
  return { ok: parsed.ok === true, strict: parsed.strict === true,
    errorCount: Object.values(sections).reduce((total, section) => total + section.errorCount, 0),
    warningCount: Object.values(sections).reduce((total, section) => total + section.warningCount, 0),
    findingCount: all.length, reportedIssueCount: Object.values(sections).reduce((total, section) => total + (section.totalIssueCount ?? 0), 0),
    findings, findingsTruncated: all.length > findings.length, coverageComplete, sections, snapshots };
}

async function imageEvidenceIn(directory, { prefix = "", limit = 40 } = {}) {
  if (!existsSync(directory)) return [];
  const images = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (images.length >= limit) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && [".png", ".jpg", ".jpeg"].includes(extname(entry.name).toLowerCase())) {
        images.push({ name: `${prefix}${entry.name}`, path, mediaType: "image", ...(await fileEvidence(path, 50 * 1024 * 1024)) });
      }
    }
  }
  await visit(directory);
  return images.sort((left, right) => left.name.localeCompare(right.name));
}

async function preserveHyperframesCheckImages(codeDirectory, outputDirectory) {
  const sourceDirectory = join(codeDirectory, "snapshots");
  const sourceImages = await imageEvidenceIn(sourceDirectory, { limit: 40 });
  const preserved = [];
  for (let index = 0; index < sourceImages.length; index += 1) {
    const source = sourceImages[index];
    const sourcePath = resolve(source.path);
    const root = resolve(sourceDirectory);
    if (sourcePath !== root && !sourcePath.startsWith(root + sep)) continue;
    const name = `check-${String(index + 1).padStart(2, "0")}-${basename(source.name)}`;
    const target = join(outputDirectory, name);
    await copyFile(sourcePath, target);
    preserved.push({ name, path: target, mediaType: source.mediaType, ...(await fileEvidence(target, 50 * 1024 * 1024)) });
  }
  return preserved;
}

export function createCodeAnimationPreflight(runtime, options = {}) {
  const meta = RUNTIME_META[runtime];
  if (!meta) throw new Error(`Unsupported animation runtime: ${runtime}.`);
  const runtimeCommand = options.runtimeCommand ?? process.env[meta.env]?.trim() ?? null;
  const launch = runtimeLaunch(runtime, runtimeCommand, options.runtimePrefixArgs ?? []);
  const browserCommand = options.browserCommand === undefined ? installedBrowser({ allowSystem: runtime === "hyperframes" }) : options.browserCommand;
  const executeCommand = options.executeCommand ?? hostCommand;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const availabilityTool = createCodeAnimationRenderer(runtime, options);
  return {
    name: `${meta.name}-preflight`, version: "1.0.0", provider: meta.provider, capability: "animation.preflight",
    description: `Run an exact, validated ${runtime} runtime preflight and preserve structured diagnostics.`,
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes the validated animation package in a temporary Run workspace when the runtime check requires compilation.",
      "Writes a diagnostic report even when the runtime check fails."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.preflight Result bound to exact composition, source, props, assets and validation revisions.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 },
        validationResultId: { type: "string" }, allowHistorical: { type: "boolean" } } },
    checkAvailability: availabilityTool.checkAvailability,
    async prepare(args) { return prepareAnimationWorkspace({ ...args, runtime }); },
    async execute({ composition, source, props, artifact, codeDirectory, entryPath, homeDirectory, outputDirectory, availability, signal }) {
      await Promise.all([homeDirectory, join(homeDirectory, "local-app-data"), join(homeDirectory, "app-data")]
        .map((directory) => mkdir(directory, { recursive: true })));
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      const hyperframesSamples = Math.min(60, Math.max(9, Math.ceil(composition.durationSeconds / 5)));
      const args = runtime === "remotion"
        ? ["compositions", entryPath, "--quiet", `--chrome-mode=${remotionChromeMode(browserCommand)}`, `--browser-executable=${browserCommand}`, ...(props ? [`--props=${props.target}`] : [])]
        : runtime === "hyperframes" ? ["check", "--strict", "--json", `--samples=${hyperframesSamples}`, "--at-transitions", "--max-transition-samples=120", "--snapshots"] : ["--version"];
      const commandRecord = { executable: meta.name, args: args.map((arg) =>
        arg === entryPath ? "<entry-file>" : typeof arg === "string" && arg.startsWith("--browser-executable=") ? "--browser-executable=<configured-browser>" :
          typeof arg === "string" && arg.startsWith("--props=") ? "--props=<managed-props>" : launch.prefixArgs.includes(arg) ? "<runtime-entry>" : arg) };
      let status = "passed"; let stdout = ""; let stderr = ""; let errorCode = null;
      const diagnosticPaths = [[codeDirectory, "<run-workspace>"], [outputDirectory, "<run-output>"],
        [homeDirectory, "<run-home>"], [REPOSITORY_ROOT, "<padstudio-root>"]];
      try {
        const response = await executeCommand(launch.executable, [...launch.prefixArgs, ...args],
          { cwd: codeDirectory, timeout: timeoutMs, env, signal });
        stdout = redactDiagnostic(response.stdout, diagnosticPaths, runtime === "hyperframes" ? 512_000 : undefined);
        stderr = redactDiagnostic(response.stderr, diagnosticPaths);
        if (runtime === "remotion" && !stdout.split(/\s+/u).includes(composition.entry.symbol)) {
          status = "failed"; errorCode = "composition_not_found";
          stderr = outputTail(`${stderr}\nDeclared composition ${composition.entry.symbol} was not listed by Remotion.`.trim());
        }
      } catch (error) {
        status = "failed"; stdout = redactDiagnostic(error?.stdout, diagnosticPaths, runtime === "hyperframes" ? 512_000 : undefined);
        stderr = redactDiagnostic(error?.stderr || error?.message, diagnosticPaths);
        errorCode = error?.killed ? "timeout" : "runtime_check_failed";
      }
      const dependencyChecks = {};
      if (runtime === "manim") {
        for (const dependency of ["latex", "dvisvgm"]) {
          try {
            const lookup = await executeCommand(process.platform === "win32" ? "where.exe" : "which", [dependency],
              { cwd: codeDirectory, timeout: 8_000, env, signal });
            dependencyChecks[dependency] = { available: Boolean(String(lookup.stdout ?? "").trim()) };
          } catch { dependencyChecks[dependency] = { available: false }; }
        }
      }
      const scope = runtime === "manim" ? "runtime_environment" : "exact_composition_compile_and_runtime_check";
      const parsed = parseJsonOutput(stdout);
      const hyperframesDiagnostics = runtime === "hyperframes" ? normalizeHyperframesDiagnostics(parsed) : null;
      if (runtime === "hyperframes" && status === "passed" && (!hyperframesDiagnostics || !hyperframesDiagnostics.ok || !hyperframesDiagnostics.strict)) {
        status = "failed"; errorCode = "invalid_runtime_diagnostics";
        stderr = outputTail(`${stderr}\nHyperFrames check did not return a successful strict JSON report.`.trim());
      }
      const snapshots = runtime === "hyperframes" ? await preserveHyperframesCheckImages(codeDirectory, outputDirectory) : [];
      const limitations = runtime === "manim"
        ? ["Manim preflight verifies the installed runtime and reports TeX tool availability; exact Scene execution, fonts and Scene-specific dependencies remain part of render."]
        : runtime === "hyperframes" && hyperframesDiagnostics && !hyperframesDiagnostics.coverageComplete
          ? ["HyperFrames diagnostic coverage was truncated or transition samples were dropped; inspect the report and run targeted previews before relying on this preflight."] : [];
      const report = { version: runtime === "hyperframes" ? "1.2" : "1.0", status, runtime, scope, artifact, sourceResultId: source.result.id,
        propsResultId: props?.result.id ?? null, command: commandRecord, diagnostics: { stdout, stderr, parsed },
        ...(hyperframesDiagnostics ? { findings: hyperframesDiagnostics } : {}),
        ...(runtime === "hyperframes" ? { snapshots: snapshots.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })) } : {}),
        dependencyChecks,
        runtimeFingerprint: { executableVersion: availability.executableVersion ?? null, ffmpegVersion: availability.ffmpegVersion ?? null,
          ffprobeVersion: availability.ffprobeVersion ?? null, doctor: availability.doctor ?? null }, errorCode, limitations };
      const reportPath = join(outputDirectory, "preflight-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, report, snapshots, reportFile: await fileEvidence(reportPath, 2 * 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.preflight", name: `${runtime} preflight: ${prepared.trace.artifact.id} r${prepared.trace.artifact.revision}`,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: [prepared.trace.artifact.id],
        files: [{ id: "report", role: "evidence", path: `${prepared.trace.directory}/preflight-report.json`, name: "preflight-report.json",
          mediaType: "application/json", ...execution.reportFile },
          ...execution.snapshots.map((snapshot, index) => ({ id: `snapshot-${index + 1}`, role: "evidence", path: `${prepared.trace.directory}/${snapshot.name}`,
            name: snapshot.name, mediaType: snapshot.mediaType, sizeBytes: snapshot.sizeBytes, sha256: snapshot.sha256 }))],
        data: { version: runtime === "hyperframes" ? "1.2" : "1.0", status: execution.report.status, runtime, scope: execution.report.scope,
          composition: prepared.trace.artifact, sourceResultId: prepared.trace.sourceResultId,
          validationResultId: prepared.trace.validationResultId, propsResultId: prepared.trace.propsResultId,
          runtimeFingerprint: execution.report.runtimeFingerprint,
          errorCode: execution.report.errorCode, limitations: execution.report.limitations,
          ...(runtime === "hyperframes" ? { findings: execution.report.findings ?? null, snapshotCount: execution.snapshots.length } : {}) },
        verification: { status: "passed", checks: ["source_checksums_verified", "agent_managed_code_execution", "static_validation_bound",
          "managed_assets_staged", "runtime_diagnostics_preserved"], details: { preflightStatus: execution.report.status, runtime } } };
    },
  };
}

export function createRemotionAnimationPreview(options = {}) {
  const runtime = "remotion"; const meta = RUNTIME_META[runtime];
  const runtimeCommand = options.runtimeCommand ?? process.env[meta.env]?.trim() ?? null;
  const launch = runtimeLaunch(runtime, runtimeCommand, options.runtimePrefixArgs ?? []);
  const browserCommand = options.browserCommand === undefined ? installedBrowser({ allowSystem: false }) : options.browserCommand;
  const executeCommand = options.executeCommand ?? hostCommand;
  const ffprobeCommand = options.ffprobeCommand ?? process.env.PADSTUDIO_FFPROBE_PATH?.trim() ?? "ffprobe";
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const availabilityTool = createCodeAnimationRenderer(runtime, options);
  return {
    name: "remotion-preview", version: "1.0.0", provider: meta.provider, capability: "animation.preview",
    description: "Render selected still frames and/or a short frame-exact clip from a validated, preflighted Remotion composition.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes exact validated Remotion source in a temporary Run workspace.", "Creates project-owned preview media and a report."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.preview Result containing requested stills and/or a short video clip.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId", "preflightResultId"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 }, validationResultId: { type: "string" },
        preflightResultId: { type: "string" }, allowHistorical: { type: "boolean" },
        frames: { type: "array", maxItems: 12, items: { type: "integer", minimum: 0 } },
        range: { type: "object", required: ["startSeconds", "endSeconds"], additionalProperties: false,
          properties: { startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", minimum: 0 } } } } },
    checkAvailability: availabilityTool.checkAvailability,
    async prepare(args) {
      const prepared = await prepareAnimationWorkspace({ ...args, runtime, allowedFields: ["preflightResultId", "frames", "range"] });
      const { frames, range } = args.inputs;
      if (frames !== undefined && (!Array.isArray(frames) || !frames.length || frames.length > 12 || frames.some((frame) => !Number.isInteger(frame) || frame < 0))) {
        fail("frames must contain 1-12 nonnegative integer frame numbers.");
      }
      const totalFrames = Math.round(prepared.runtime.composition.durationSeconds * prepared.runtime.composition.format.fps);
      const normalizedFrames = [...new Set(frames ?? [])];
      if (normalizedFrames.some((frame) => frame >= totalFrames)) fail(`Preview frames must be between 0 and ${totalFrames - 1}.`);
      let normalizedRange = null;
      if (range !== undefined) {
        object(range, ["startSeconds", "endSeconds"], "range");
        if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds) || range.startSeconds < 0 ||
            range.endSeconds <= range.startSeconds || range.endSeconds > prepared.runtime.composition.durationSeconds || range.endSeconds - range.startSeconds > 30) {
          fail("range must be inside the composition, have positive duration, and be at most 30 seconds.");
        }
        const fps = prepared.runtime.composition.format.fps;
        normalizedRange = { startFrame: Math.floor(range.startSeconds * fps), endFrame: Math.ceil(range.endSeconds * fps) - 1 };
      }
      if (!normalizedFrames.length && !normalizedRange) fail("Request at least one frame or one preview range.");
      prepared.runtime.previewFrames = normalizedFrames; prepared.runtime.previewRange = normalizedRange;
      prepared.trace.previewFrames = normalizedFrames; prepared.trace.previewRange = normalizedRange;
      return prepared;
    },
    async execute({ composition, source, props, artifact, codeDirectory, entryPath, homeDirectory, outputDirectory,
      previewFrames, previewRange, availability, signal }) {
      await Promise.all([homeDirectory, join(homeDirectory, "local-app-data"), join(homeDirectory, "app-data")]
        .map((directory) => mkdir(directory, { recursive: true })));
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      const common = [`--width=${composition.format.width}`, `--height=${composition.format.height}`, `--chrome-mode=${remotionChromeMode(browserCommand)}`, `--browser-executable=${browserCommand}`,
        ...(props ? [`--props=${props.target}`] : [])];
      const commands = [];
      const run = async (args) => {
        commands.push({ executable: meta.name, args: args.map((arg) => arg === entryPath ? "<entry-file>" :
          typeof arg === "string" && arg.startsWith("--browser-executable=") ? "--browser-executable=<configured-browser>" :
            typeof arg === "string" && arg.startsWith("--props=") ? "--props=<managed-props>" :
              isAbsolute(arg) ? `<output:${basename(arg)}>` : launch.prefixArgs.includes(arg) ? "<runtime-entry>" : arg) });
        try { return await executeCommand(launch.executable, [...launch.prefixArgs, ...args], { cwd: codeDirectory, timeout: timeoutMs, env, signal }); }
        catch (error) { fail(`Remotion preview failed: ${outputTail(error?.stderr || error?.message, 2000)}`, error?.killed ? "timeout" : "animation_preview_failed"); }
      };
      const snapshots = [];
      for (const frame of previewFrames) {
        const name = `snapshot-${String(frame).padStart(6, "0")}.png`; const path = join(outputDirectory, name);
        await run(["still", entryPath, composition.entry.symbol, path, `--frame=${frame}`, ...common]);
        snapshots.push({ frame, name, path, ...(await fileEvidence(path, 50 * 1024 * 1024)) });
      }
      let clip = null;
      if (previewRange) {
        const path = join(outputDirectory, "preview.mp4");
        await run(["render", entryPath, composition.entry.symbol, path, `--fps=${composition.format.fps}`,
          `--frames=${previewRange.startFrame}-${previewRange.endFrame}`, "--codec=h264", "--pixel-format=yuv420p", ...common]);
        const video = mediaDetails(await probe(path, { run: executeCommand, ffprobe: ffprobeCommand, signal }));
        const expectedDuration = (previewRange.endFrame - previewRange.startFrame + 1) / composition.format.fps;
        if (video.width !== composition.format.width || video.height !== composition.format.height ||
            Math.abs(video.frameRate - composition.format.fps) > 0.05 || Math.abs(video.durationSeconds - expectedDuration) > Math.max(0.15, 2 / composition.format.fps)) {
          fail("Remotion preview clip does not match the requested frame range and format.", "invalid_output");
        }
        clip = { name: "preview.mp4", path, video, expectedDuration, ...(await fileEvidence(path)) };
      }
      const report = { version: "1.0", runtime, artifact, sourceResultId: source.result.id, propsResultId: props?.result.id ?? null,
        frames: previewFrames, range: previewRange, snapshots: snapshots.map(({ frame, name, sizeBytes, sha256 }) => ({ frame, name, sizeBytes, sha256 })),
        clip: clip ? { name: clip.name, video: clip.video, expectedDuration: clip.expectedDuration, sizeBytes: clip.sizeBytes, sha256: clip.sha256 } : null,
        commands, runtimeFingerprint: { executableVersion: availability.executableVersion ?? null } };
      const reportPath = join(outputDirectory, "preview-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, snapshots, clip, report, reportFile: await fileEvidence(reportPath, 2 * 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.preview", name: `Remotion preview: ${prepared.trace.artifact.id} r${prepared.trace.artifact.revision}`,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: [prepared.trace.artifact.id],
        files: [
          ...execution.snapshots.map((snapshot, index) => ({ id: `snapshot-${index + 1}`, role: "preview", path: `${prepared.trace.directory}/${snapshot.name}`,
            name: snapshot.name, mediaType: "image", sizeBytes: snapshot.sizeBytes, sha256: snapshot.sha256 })),
          ...(execution.clip ? [{ id: "clip", role: "preview", path: `${prepared.trace.directory}/preview.mp4`, name: "preview.mp4", mediaType: "video",
            sizeBytes: execution.clip.sizeBytes, sha256: execution.clip.sha256 }] : []),
          { id: "report", role: "evidence", path: `${prepared.trace.directory}/preview-report.json`, name: "preview-report.json",
            mediaType: "application/json", ...execution.reportFile },
        ],
        data: { version: "1.0", runtime, composition: prepared.trace.artifact, sourceResultId: prepared.trace.sourceResultId,
          validationResultId: prepared.trace.validationResultId, propsResultId: prepared.trace.propsResultId,
          preflightResultId: prepared.trace.preflightResultId,
          frames: prepared.trace.previewFrames, range: prepared.trace.previewRange,
          clip: execution.clip ? { durationSeconds: execution.clip.video.durationSeconds, width: execution.clip.video.width,
            height: execution.clip.video.height, frameRate: execution.clip.video.frameRate } : null },
        verification: { status: "passed", checks: ["exact_preflight_bound", "agent_managed_code_execution", "requested_frames_rendered",
          ...(execution.clip ? ["preview_clip_probed", "preview_format_matches"] : [])], details: { runtime } } };
    },
  };
}

export function createHyperframesAnimationPreview(options = {}) {
  const runtime = "hyperframes"; const meta = RUNTIME_META[runtime];
  const runtimeCommand = options.runtimeCommand ?? process.env[meta.env]?.trim() ?? null;
  const launch = runtimeLaunch(runtime, runtimeCommand, options.runtimePrefixArgs ?? []);
  const browserCommand = options.browserCommand === undefined ? installedBrowser({ allowSystem: true }) : options.browserCommand;
  const executeCommand = options.executeCommand ?? hostCommand;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const availabilityTool = createCodeAnimationRenderer(runtime, options);
  return {
    name: "hyperframes-preview", version: "1.0.0", provider: meta.provider, capability: "animation.preview",
    description: "Capture exact requested frames and a contact sheet from a validated, preflighted HyperFrames composition.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes exact validated HyperFrames source in a temporary Run workspace.", "Creates project-owned preview images and a report."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.preview Result containing requested HyperFrames snapshots and a contact sheet when available.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId", "preflightResultId", "frames"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 }, validationResultId: { type: "string" },
        preflightResultId: { type: "string" }, allowHistorical: { type: "boolean" },
        frames: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 0 } } } },
    checkAvailability: availabilityTool.checkAvailability,
    async prepare(args) {
      const prepared = await prepareAnimationWorkspace({ ...args, runtime, allowedFields: ["preflightResultId", "frames"] });
      const frames = args.inputs.frames;
      if (!Array.isArray(frames) || !frames.length || frames.length > 12 || frames.some((frame) => !Number.isInteger(frame) || frame < 0)) {
        fail("frames must contain 1-12 nonnegative integer frame numbers.");
      }
      const totalFrames = Math.round(prepared.runtime.composition.durationSeconds * prepared.runtime.composition.format.fps);
      const normalizedFrames = [...new Set(frames)];
      if (normalizedFrames.some((frame) => frame >= totalFrames)) fail(`Preview frames must be between 0 and ${totalFrames - 1}.`);
      prepared.runtime.previewFrames = normalizedFrames;
      prepared.trace.previewFrames = normalizedFrames;
      return prepared;
    },
    async execute({ composition, source, props, artifact, codeDirectory, homeDirectory, outputDirectory, previewFrames, availability, signal }) {
      await Promise.all([homeDirectory, join(homeDirectory, "local-app-data"), join(homeDirectory, "app-data")]
        .map((directory) => mkdir(directory, { recursive: true })));
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      const previewDirectory = join(outputDirectory, "hyperframes-preview");
      await mkdir(previewDirectory, { recursive: true });
      const times = previewFrames.map((frame) => frame / composition.format.fps);
      const args = ["snapshot", `--output=${previewDirectory}`, `--at=${times.join(",")}`, "--no-end", "--describe=false"];
      const command = { executable: meta.name, args: args.map((arg) => arg.startsWith("--output=") ? "--output=<run-output>" : launch.prefixArgs.includes(arg) ? "<runtime-entry>" : arg) };
      try {
        await executeCommand(launch.executable, [...launch.prefixArgs, ...args], { cwd: codeDirectory, timeout: timeoutMs, env, signal });
      } catch (error) {
        fail(`HyperFrames preview failed: ${outputTail(error?.stderr || error?.message, 2000)}`, error?.killed ? "timeout" : "animation_preview_failed");
      }
      const images = await imageEvidenceIn(previewDirectory, { limit: 20 });
      const snapshots = images.filter((file) => file.name.toLowerCase().endsWith(".png") && file.name.startsWith("frame-"));
      if (snapshots.length !== previewFrames.length) fail("HyperFrames preview did not create every requested frame.", "invalid_output");
      const report = { version: "1.0", runtime, artifact, sourceResultId: source.result.id, propsResultId: props?.result.id ?? null,
        frames: previewFrames, times, files: images.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })), command,
        runtimeFingerprint: { executableVersion: availability.executableVersion ?? null } };
      const reportPath = join(outputDirectory, "preview-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, images, report, reportFile: await fileEvidence(reportPath, 2 * 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.preview", name: `HyperFrames preview: ${prepared.trace.artifact.id} r${prepared.trace.artifact.revision}`,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: [prepared.trace.artifact.id],
        files: [...execution.images.map((snapshot, index) => ({ id: `snapshot-${index + 1}`, role: "preview",
          path: `${prepared.trace.directory}/hyperframes-preview/${snapshot.name}`, name: snapshot.name, mediaType: snapshot.mediaType,
          sizeBytes: snapshot.sizeBytes, sha256: snapshot.sha256 })),
          { id: "report", role: "evidence", path: `${prepared.trace.directory}/preview-report.json`, name: "preview-report.json",
            mediaType: "application/json", ...execution.reportFile }],
        data: { version: "1.0", runtime, composition: prepared.trace.artifact, sourceResultId: prepared.trace.sourceResultId,
          validationResultId: prepared.trace.validationResultId, propsResultId: prepared.trace.propsResultId,
          preflightResultId: prepared.trace.preflightResultId,
          frames: prepared.trace.previewFrames, range: null, clip: null },
        verification: { status: "passed", checks: ["exact_preflight_bound", "agent_managed_code_execution", "requested_frames_rendered", "snapshot_count_matches"],
          details: { runtime } } };
    },
  };
}

export function createHyperframesMotionPreview(options = {}) {
  const runtime = "hyperframes"; const meta = RUNTIME_META[runtime];
  const runtimeCommand = options.runtimeCommand ?? process.env[meta.env]?.trim() ?? null;
  const launch = runtimeLaunch(runtime, runtimeCommand, options.runtimePrefixArgs ?? []);
  const browserCommand = options.browserCommand === undefined ? installedBrowser({ allowSystem: true }) : options.browserCommand;
  const executeCommand = options.executeCommand ?? hostCommand;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const availabilityTool = createCodeAnimationRenderer(runtime, options);
  return {
    name: "hyperframes-motion-preview", version: "1.0.0", provider: meta.provider, capability: "animation.preview",
    description: "Inspect a selected HyperFrames element and create an onion-skin motion-path preview over an exact frame range.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Executes exact validated HyperFrames source in a temporary Run workspace.",
      "Creates a project-owned motion diagnostic image and structured keyframe report."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.preview Result containing an onion-skin motion image and machine-readable keyframe evidence.",
    inputSchema: { type: "object", required: ["artifactId", "artifactRevision", "validationResultId", "preflightResultId", "selector"], additionalProperties: false,
      properties: { artifactId: { type: "string" }, artifactRevision: { type: "integer", minimum: 1 }, validationResultId: { type: "string" },
        preflightResultId: { type: "string" }, allowHistorical: { type: "boolean" }, selector: { type: "string", minLength: 1, maxLength: 500 },
        fromFrame: { type: "integer", minimum: 0 }, toFrame: { type: "integer", minimum: 0 }, samples: { type: "integer", minimum: 2, maximum: 30 },
        layout: { type: "string", enum: ["path", "strip"] }, ghost: { type: "boolean" },
        angle: { type: "string", enum: ["front", "iso", "top", "side", "rear-iso"] }, fit: { type: "boolean" } } },
    checkAvailability: availabilityTool.checkAvailability,
    async prepare(args) {
      const allowedFields = ["preflightResultId", "selector", "fromFrame", "toFrame", "samples", "layout", "ghost", "angle", "fit"];
      const prepared = await prepareAnimationWorkspace({ ...args, runtime, allowedFields });
      const selector = text(args.inputs.selector, "selector", 500);
      const totalFrames = Math.round(prepared.runtime.composition.durationSeconds * prepared.runtime.composition.format.fps);
      const fromFrame = args.inputs.fromFrame ?? 0;
      const toFrame = args.inputs.toFrame ?? totalFrames - 1;
      const samples = args.inputs.samples ?? 9;
      const layout = args.inputs.layout ?? "path";
      const ghost = args.inputs.ghost ?? false;
      const fit = args.inputs.fit ?? true;
      if (!Number.isInteger(fromFrame) || !Number.isInteger(toFrame) || fromFrame < 0 || toFrame < fromFrame || toFrame >= totalFrames) {
        fail(`Motion preview frame range must be between 0 and ${totalFrames - 1}, with fromFrame <= toFrame.`);
      }
      if (!Number.isInteger(samples) || samples < 2 || samples > 30) fail("samples must be an integer between 2 and 30.");
      if (!["path", "strip"].includes(layout)) fail("layout must be path or strip.");
      if (typeof ghost !== "boolean" || typeof fit !== "boolean") fail("ghost and fit must be boolean when provided.");
      if (args.inputs.angle !== undefined && !["front", "iso", "top", "side", "rear-iso"].includes(args.inputs.angle)) {
        fail("angle must be a supported camera preset.");
      }
      const motion = { selector, fromFrame, toFrame, samples, layout, ghost, fit, angle: args.inputs.angle ?? null };
      prepared.runtime.motionPreview = motion; prepared.trace.motionPreview = motion;
      return prepared;
    },
    async execute({ composition, source, props, artifact, codeDirectory, homeDirectory, outputDirectory, motionPreview, availability, signal }) {
      await Promise.all([homeDirectory, join(homeDirectory, "local-app-data"), join(homeDirectory, "app-data")]
        .map((directory) => mkdir(directory, { recursive: true })));
      const env = cleanEnvironment(homeDirectory, { nodeModules: launch.nodeModules, browser: browserCommand });
      const shotPath = join(outputDirectory, "motion-preview.png");
      const seconds = (frame) => frame / composition.format.fps;
      const diagnosticArgs = ["keyframes", `--selector=${motionPreview.selector}`, "--runtime=all", "--json"];
      const shotArgs = ["keyframes", `--selector=${motionPreview.selector}`, `--shot=${shotPath}`, `--samples=${motionPreview.samples}`,
        `--layout=${motionPreview.layout}`, `--from=${seconds(motionPreview.fromFrame)}`, `--to=${seconds(motionPreview.toFrame)}`,
        ...(motionPreview.ghost ? ["--ghost"] : []), ...(motionPreview.fit ? [] : ["--no-fit"]),
        ...(motionPreview.angle ? [`--angle=${motionPreview.angle}`] : [])];
      const commandRecord = (args) => ({ executable: meta.name, args: args.map((arg) => arg.startsWith("--shot=")
        ? "--shot=<run-output>" : launch.prefixArgs.includes(arg) ? "<runtime-entry>" : arg) });
      let diagnosticOutput;
      try {
        diagnosticOutput = await executeCommand(launch.executable, [...launch.prefixArgs, ...diagnosticArgs],
          { cwd: codeDirectory, timeout: timeoutMs, env, signal });
        await executeCommand(launch.executable, [...launch.prefixArgs, ...shotArgs],
          { cwd: codeDirectory, timeout: timeoutMs, env, signal });
      } catch (error) {
        fail(`HyperFrames motion preview failed: ${outputTail(error?.stderr || error?.message, 2000)}`,
          error?.killed ? "timeout" : "animation_preview_failed");
      }
      const diagnosticText = redactDiagnostic(diagnosticOutput?.stdout, [[codeDirectory, "<run-workspace>"],
        [outputDirectory, "<run-output>"], [homeDirectory, "<run-home>"], [REPOSITORY_ROOT, "<padstudio-root>"]], 512_000);
      const diagnostics = parseJsonOutput(diagnosticText);
      if (!diagnostics || typeof diagnostics !== "object") fail("HyperFrames keyframes did not return valid JSON diagnostics.", "invalid_output");
      const shot = await fileEvidence(shotPath, 50 * 1024 * 1024);
      const report = { version: "1.0", runtime, artifact, sourceResultId: source.result.id, propsResultId: props?.result.id ?? null,
        motion: { ...motionPreview, fromSeconds: seconds(motionPreview.fromFrame), toSeconds: seconds(motionPreview.toFrame) },
        diagnostics, commands: [commandRecord(diagnosticArgs), commandRecord(shotArgs)],
        runtimeFingerprint: { executableVersion: availability.executableVersion ?? null, doctor: availability.doctor ?? null } };
      const reportPath = join(outputDirectory, "motion-preview-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, shot, report, reportFile: await fileEvidence(reportPath, 8 * 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.preview", name: `HyperFrames motion preview: ${prepared.trace.artifact.id} r${prepared.trace.artifact.revision}`,
        inputResources: prepared.trace.inputResources, inputResults: prepared.trace.inputResults, inputArtifacts: [prepared.trace.artifact.id],
        files: [
          { id: "motion", role: "preview", path: `${prepared.trace.directory}/motion-preview.png`, name: "motion-preview.png",
            mediaType: "image", ...execution.shot },
          { id: "report", role: "evidence", path: `${prepared.trace.directory}/motion-preview-report.json`, name: "motion-preview-report.json",
            mediaType: "application/json", ...execution.reportFile },
        ],
        data: { version: "1.0", runtime, composition: prepared.trace.artifact, sourceResultId: prepared.trace.sourceResultId,
          validationResultId: prepared.trace.validationResultId, propsResultId: prepared.trace.propsResultId,
          preflightResultId: prepared.trace.preflightResultId,
          frames: [], range: null, clip: null, motion: execution.report.motion },
        verification: { status: "passed", checks: ["exact_preflight_bound", "agent_managed_code_execution", "keyframes_inspected",
          "motion_preview_created"], details: { runtime, selector: prepared.trace.motionPreview.selector } } };
    },
  };
}

export const createManimAnimationPreflight = (options) => createCodeAnimationPreflight("manim", options);
export const createRemotionAnimationPreflight = (options) => createCodeAnimationPreflight("remotion", options);
export const createHyperframesAnimationPreflight = (options) => createCodeAnimationPreflight("hyperframes", options);
