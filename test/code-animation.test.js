import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createCodeAnimationRenderer } from "../src/tools/code-animation-renderer.js";
import { createCodeAnimationSource } from "../src/tools/code-animation-source.js";
import { createCodeAnimationValidator } from "../src/tools/code-animation-validator.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

async function fixture(t, tools = []) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-animation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootDir = join(directory, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Code animation" });
  const registry = new ToolRegistry([createCodeAnimationSource(), createCodeAnimationValidator(), ...tools]);
  return { rootDir, store, executor: new ToolExecutor({ store, registry }) };
}

function request(capability, tool, purpose, inputs) { return { capability, tool, purpose, inputs }; }

async function sourceAndValidation(executor, source = "export const Demo = () => null; // Composition\n") {
  const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create editable motion source", {
    operation: "create", runtime: "remotion", name: "Kinetic title source", entryFile: "src/index.tsx", entrySymbol: "Demo",
    changeSummary: "Initial source", dependencies: [{ name: "remotion", version: "4.0.0" }],
    files: [{ path: "src/index.tsx", content: source }],
  }));
  const validated = await executor.execute("demo", request("animation.validate", "code-animation-validator", "Validate exact source", {
    sourceResultId: created.result.id,
  }));
  return { source: created.result, validation: validated.result };
}

function composition(sourceResultId) {
  return { version: "1.0", changeReason: "Initial composition", intent: "Explain one idea with legible kinetic type.", runtime: "remotion",
    sourceResultId, entry: { file: "src/index.tsx", symbol: "Demo" },
    format: { width: 320, height: 180, fps: 24, background: "#101010", transparent: false }, durationSeconds: 1,
    assets: [], style: { designRead: "High-contrast editorial title.", palette: ["#101010", "#FFFFFF"],
      motionPrinciples: ["Use purposeful easing."], antiPatterns: ["No decorative bouncing."] },
    reviewCriteria: ["Typography remains readable throughout."],
    executionPolicy: { codeTrust: "exact-user-approval", networkAccess: "not-required" } };
}

test("source packages are immutable, revisioned and reject traversal", async (t) => {
  const { executor } = await fixture(t);
  const { source } = await sourceAndValidation(executor);
  const revised = await executor.execute("demo", request("animation.source", "code-animation-source", "Revise exact source", {
    operation: "revise", runtime: "remotion", name: "Kinetic title source r2", entryFile: "src/index.tsx", entrySymbol: "Demo",
    changeSummary: "Adjust title timing", baseResultId: source.id,
    changes: [{ path: "src/index.tsx", content: "export const Demo = () => null; // Composition revised\n" }],
  }));
  assert.deepEqual(revised.result.inputResults, [source.id]);
  assert.equal(revised.result.data.parentSourceResultId, source.id);
  assert.deepEqual(revised.result.data.dependencies, source.data.dependencies);
  assert.notEqual(revised.result.data.packageSha256, source.data.packageSha256);
  await assert.rejects(executor.execute("demo", request("animation.source", "code-animation-source", "Reject traversal", {
    operation: "create", runtime: "remotion", name: "Bad", entryFile: "../bad.tsx", entrySymbol: "Demo",
    changeSummary: "Bad path", files: [{ path: "../bad.tsx", content: "Composition Demo" }],
  })), /safe relative path/);
});

test("static validation fails closed on host and network APIs", async (t) => {
  const { executor } = await fixture(t);
  const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create unsafe source", {
    operation: "create", runtime: "remotion", name: "Unsafe", entryFile: "index.tsx", entrySymbol: "Demo", changeSummary: "Fixture",
    files: [{ path: "index.tsx", content: "import fs from 'node:fs'; export const Demo=()=>null; // Composition" }],
  }));
  await assert.rejects(executor.execute("demo", request("animation.validate", "code-animation-validator", "Validate unsafe source", {
    sourceResultId: created.result.id,
  })), /host_or_network_module/);
});

test("Manim and HyperFrames keep distinct entry contracts", async (t) => {
  const { executor } = await fixture(t);
  for (const sample of [
    { runtime: "manim", entryFile: "lesson.py", entrySymbol: "Lesson",
      content: "from manim import *\nclass Lesson(Scene):\n    def construct(self):\n        self.add(Text('Clear'))\n" },
    { runtime: "hyperframes", entryFile: "index.html", entrySymbol: "hero-title",
      content: "<!doctype html><html><body data-composition-id='hero-title'><svg></svg></body></html>" },
  ]) {
    const created = await executor.execute("demo", request("animation.source", "code-animation-source", `Create ${sample.runtime}`, {
      operation: "create", runtime: sample.runtime, name: sample.runtime, entryFile: sample.entryFile,
      entrySymbol: sample.entrySymbol, changeSummary: "Runtime contract fixture", files: [{ path: sample.entryFile, content: sample.content }],
    }));
    const validated = await executor.execute("demo", request("animation.validate", "code-animation-validator", `Validate ${sample.runtime}`, {
      sourceResultId: created.result.id,
    }));
    assert.equal(validated.result.data.runtime, sample.runtime);
  }
});

test("exact approval gates render; observer exposes it and sequence can consume the Result", async (t) => {
  const fakeCommand = async (executable, args) => {
    if (args.includes("--version") || args[0] === "-version" || args[0] === "help") return { stdout: `${executable} 1.0\n`, stderr: "" };
    if (executable === "fake-remotion" && args[0] === "render") {
      await writeFile(args[3], "fake-video-bytes"); return { stdout: "rendered", stderr: "" };
    }
    if (executable === "fake-ffprobe") return { stdout: JSON.stringify({ format: { duration: "1.000" }, streams: [
      { codec_type: "video", width: 320, height: 180, avg_frame_rate: "24/1" },
    ] }), stderr: "" };
    if (executable === "fake-ffmpeg") {
      await writeFile(args.at(-1), "fake-poster-bytes"); return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected command: ${executable} ${args.join(" ")}`);
  };
  const renderer = createCodeAnimationRenderer("remotion", { runtimeCommand: "fake-remotion", ffmpegCommand: "fake-ffmpeg",
    ffprobeCommand: "fake-ffprobe", browserCommand: "fake-chrome", executeCommand: fakeCommand });
  const { rootDir, store, executor } = await fixture(t, [renderer]);
  const exact = await sourceAndValidation(executor);
  const artifact = await store.recordArtifact("demo", { key: "hero-title", type: "animation.composition", name: "Hero title",
    summary: "A short, editable kinetic title.", data: composition(exact.source.id), references: [{ kind: "result", id: exact.source.id }] });
  const renderRequest = request("animation.render", "remotion-local", "Render approved title", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id,
  });
  await assert.rejects(executor.execute("demo", renderRequest), /Exact user approval/);
  const approval = await store.recordDecision("demo", { target: { kind: "result", id: exact.source.id }, category: "animation_code_execution",
    subject: "Execute exact animation source", outcome: "approved", options: [], selected: null,
    reason: "Reviewed this immutable source package for local execution.", decidedBy: "user", userVisible: true, confidence: "high" });
  const rendered = (await executor.execute("demo", renderRequest)).result;
  assert.equal(rendered.type, "animation.render");
  assert.equal(rendered.data.approvalDecisionId, approval.id);
  assert.equal(rendered.data.executionBoundary.networkIsolation, "not_enforced_by_host");
  assert.deepEqual(rendered.inputResults, [exact.source.id, exact.validation.id]);
  const reportFile = await store.verifyResultFile("demo", rendered.id, "report");
  const report = JSON.parse(await readFile(reportFile.filePath, "utf8"));
  assert.ok(report.commands[0].args.includes("--browser-executable=<configured-browser>"));
  assert.ok(report.commands[0].args.includes("--frames=0-23"));
  await store.recordArtifact("demo", { key: "film", type: "video.sequence", name: "Film", summary: "Sequence using managed animation.",
    data: { version: "1.0", changeReason: "Use code animation", format: { width: 320, height: 180, fps: 24 }, segments: [
      { id: "title", title: "Title", intent: "Open with the kinetic title.", durationSeconds: 1,
        visual: { source: { kind: "result", id: rendered.id, file: "primary" } } },
    ] }, references: [] });
  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.animation.activeCompositions[0].renders[0].resultId, rendered.id);
  assert.equal(context.production.sequences[0].segments[0].visual.source.id, rendered.id);
  const observer = await new ProjectReader(rootDir).readObserverSection("demo", "animation");
  assert.equal(observer.animation.compositions[0].executionApproval.id, approval.id);
  assert.equal(observer.animation.compositions[0].renders[0].files.find((file) => file.id === "primary").available, true);
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/projects/demo/observer/animation`)).status, 200);
  const moduleResponse = await fetch(`${origin}/animation-view.js`);
  assert.equal(moduleResponse.status, 200);
  assert.match(await moduleResponse.text(), /renderAnimation/);
});

test("renderer availability is honest and never auto-installs", async (t) => {
  const calls = [];
  const renderer = createCodeAnimationRenderer("hyperframes", { runtimeCommand: "missing-hyperframes",
    executeCommand: async (executable, args) => { calls.push([executable, ...args]); throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });
  const availability = await renderer.checkAvailability();
  assert.equal(availability.status, "unavailable");
  assert.match(availability.reason, /will not auto-install/);
  assert.ok(calls.every((call) => !call.includes("npx") && !call.includes("npm")));
  let remotionCalls = 0;
  const remotion = createCodeAnimationRenderer("remotion", { runtimeCommand: "remotion", browserCommand: null,
    executeCommand: async () => { remotionCalls += 1; return { stdout: "ok" }; } });
  assert.equal((await remotion.checkAvailability()).status, "unavailable");
  assert.equal(remotionCalls, 0);
  const missingBrowser = createCodeAnimationRenderer("hyperframes", { runtimeCommand: "hyperframes",
    browserCommand: "C:\\missing\\chrome.exe", executeCommand: async () => { throw new Error("must not execute"); } });
  assert.equal((await missingBrowser.checkAvailability()).status, "unavailable");
  assert.match((await missingBrowser.checkAvailability()).reason, /does not exist/);
  const scriptCalls = [];
  const scriptRuntime = createCodeAnimationRenderer("remotion", { runtimeCommand: "C:\\runtime\\node_modules\\@remotion\\cli\\remotion-cli.js",
    browserCommand: "browser", executeCommand: async (executable, args) => {
      scriptCalls.push([executable, ...args]); return { stdout: "ok\n", stderr: "" };
    } });
  assert.equal((await scriptRuntime.checkAvailability()).status, "available");
  assert.equal(scriptCalls[0][0], process.execPath);
  assert.equal(scriptCalls[0][1], "C:\\runtime\\node_modules\\@remotion\\cli\\remotion-cli.js");
  const shimRoot = await mkdtemp(join(tmpdir(), "padstudio-runtime-shim-"));
  t.after(() => rm(shimRoot, { recursive: true, force: true }));
  const cliScript = join(shimRoot, "node_modules", "@remotion", "cli", "remotion-cli.js");
  await mkdir(join(shimRoot, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(shimRoot, "node_modules", "@remotion", "cli"), { recursive: true });
  await writeFile(cliScript, "", "utf8");
  const shimCalls = [];
  const shimRuntime = createCodeAnimationRenderer("remotion", {
    runtimeCommand: join(shimRoot, "node_modules", ".bin", "remotion.cmd"), browserCommand: "browser",
    executeCommand: async (executable, args) => { shimCalls.push([executable, ...args]); return { stdout: "ok\n", stderr: "" }; },
  });
  assert.equal((await shimRuntime.checkAvailability()).status, "available");
  assert.equal(shimCalls[0][0], process.execPath);
  assert.equal(shimCalls[0][1], cliScript);
});
