import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ProjectStore } from "../src/project/project-store.js";
import { normalizeAnimationComposition } from "../src/animation/animation-composition.js";
import {
  createCodeAnimationPreflight, createCodeAnimationRenderer, createHyperframesAnimationPreview, createHyperframesMotionPreview,
  createRemotionAnimationPreview,
} from "../src/tools/code-animation-renderer.js";
import { createCodeAnimationProps } from "../src/tools/code-animation-props.js";
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
  const registry = new ToolRegistry([createCodeAnimationSource(), createCodeAnimationProps(), createCodeAnimationValidator(), ...tools]);
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
    executionPolicy: { codeTrust: "agent-managed-execution", networkAccess: "not-required" } };
}

test("normalized compositions can be read again when designRead is omitted", () => {
  const input = composition("result-source");
  delete input.style.designRead;
  const once = normalizeAnimationComposition(input);
  assert.equal(once.style.designRead, null);
  assert.deepEqual(normalizeAnimationComposition(once), once);
});

test("legacy code approval compositions normalize to managed execution", () => {
  const input = composition("result-source");
  input.executionPolicy.codeTrust = "exact-user-approval";
  assert.throws(() => normalizeAnimationComposition(input), /agent-managed-execution/);
  assert.equal(normalizeAnimationComposition(input, { allowLegacy: true }).executionPolicy.codeTrust, "agent-managed-execution");
});

test("retired code approval decisions cannot be created", async (t) => {
  const { store, executor } = await fixture(t);
  const { source } = await sourceAndValidation(executor);
  await assert.rejects(store.recordDecision("demo", {
    target: { kind: "result", id: source.id }, category: "animation_code_execution",
    subject: "Retired approval", outcome: "approved", options: [], selected: null,
    reason: "The managed execution loop no longer records this decision.",
    decidedBy: "user", userVisible: true, confidence: "high",
  }), /is retired/);
});

test("animation props are immutable, normalized and composition-bound", async (t) => {
  const { store, executor } = await fixture(t);
  const { source } = await sourceAndValidation(executor);
  const first = (await executor.execute("demo", request("animation.props", "code-animation-props", "Create managed props", {
    operation: "create", name: "Title data", changeSummary: "Initial copy", props: { title: "Evidence", values: [3, 1, 2] },
  }))).result;
  const revised = (await executor.execute("demo", request("animation.props", "code-animation-props", "Revise managed props", {
    operation: "revise", name: "Title data r2", changeSummary: "Update copy", baseResultId: first.id,
    props: { values: [3, 1, 2], title: "Evidence first" },
  }))).result;
  assert.deepEqual(revised.inputResults, [first.id]);
  assert.equal(revised.data.parentPropsResultId, first.id);
  const data = composition(source.id); data.propsResultId = revised.id;
  await assert.rejects(store.recordArtifact("demo", { key: "bad-props-ref", type: "animation.composition", name: "Missing props ref",
    summary: "Must reference managed props.", data, references: [{ kind: "result", id: source.id }] }), /reference its props Result/);
  const artifact = await store.recordArtifact("demo", { key: "props-bound", type: "animation.composition", name: "Props bound",
    summary: "Uses managed props.", data, references: [{ kind: "result", id: source.id }, { kind: "result", id: revised.id }] });
  assert.equal(artifact.data.propsResultId, revised.id);
});

test("managed props cannot overwrite a source file", async (t) => {
  const { store, executor } = await fixture(t);
  const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create colliding source", {
    operation: "create", runtime: "remotion", name: "Collision", entryFile: "src/index.tsx", entrySymbol: "Demo",
    changeSummary: "Collision fixture", files: [
      { path: "src/index.tsx", content: "export const Demo = () => null; // Composition\n" },
      { path: "data/props.json", content: "{}\n" },
    ],
  }));
  const validated = await executor.execute("demo", request("animation.validate", "code-animation-validator", "Validate collision", {
    sourceResultId: created.result.id,
  }));
  const props = (await executor.execute("demo", request("animation.props", "code-animation-props", "Create managed props", {
    operation: "create", name: "Props", changeSummary: "Fixture", props: { title: "Managed" },
  }))).result;
  const data = composition(created.result.id); data.propsResultId = props.id;
  const artifact = await store.recordArtifact("demo", { key: "collision", type: "animation.composition", name: "Collision",
    summary: "Collision fixture.", data, references: [{ kind: "result", id: created.result.id }, { kind: "result", id: props.id }] });
  const preflight = createCodeAnimationPreflight("remotion", { runtimeCommand: "fake", browserCommand: "fake-browser",
    ffmpegCommand: "fake-ffmpeg", ffprobeCommand: "fake-ffprobe", executeCommand: async () => ({ stdout: "ok", stderr: "" }) });
  const collisionExecutor = new ToolExecutor({ store, registry: new ToolRegistry([preflight]) });
  await assert.rejects(collisionExecutor.execute("demo", request("animation.preflight", "remotion-local-preflight", "Reject collision", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validated.result.id,
  })), /collides with source file/);
});

test("new compositions require review criteria while legacy stored values remain readable", () => {
  const input = composition("result-source");
  delete input.reviewCriteria;
  assert.throws(() => normalizeAnimationComposition(input), /reviewCriteria must not be empty/);
  const legacy = normalizeAnimationComposition(input, { allowLegacy: true });
  assert.deepEqual(legacy.reviewCriteria, []);
});

test("projects reopen compositions stored before review criteria became required", async (t) => {
  const { rootDir, store } = await fixture(t);
  const data = composition("result-source");
  data.style.designRead = null;
  data.reviewCriteria = [];
  const legacy = {
    version: "1.0",
    id: "artifact-legacy-animation",
    projectId: "demo",
    key: "legacy-animation",
    revision: 1,
    supersedes: null,
    type: "animation.composition",
    name: "Legacy animation",
    summary: "Created before review criteria became mandatory.",
    status: "active",
    data,
    references: [],
    createdBy: "agent",
    createdAt: "2026-09-14T00:00:00.000Z",
  };
  await mkdir(join(rootDir, "demo", "artifacts"), { recursive: true });
  await writeFile(
    join(rootDir, "demo", "artifacts", "artifact-legacy-animation.json"),
    `${JSON.stringify(legacy, null, 2)}\n`,
    "utf8",
  );

  const artifacts = await store.intelligence.readArtifacts("demo");
  assert.equal(artifacts[0].id, legacy.id);
  assert.equal(artifacts[0].data.style.designRead, null);
  assert.deepEqual(artifacts[0].data.reviewCriteria, []);
});

test("Manim measures bounded runtime drift while frame-controlled Remotion stays exact", async (t) => {
  const manimInput = composition("result-source");
  manimInput.runtime = "manim";
  manimInput.entry = { file: "lesson.py", symbol: "Lesson" };
  manimInput.format = { width: 1920, height: 1080, fps: 30, background: "#101010", transparent: false };
  manimInput.durationSeconds = 180;
  const measured = normalizeAnimationComposition(manimInput);
  assert.deepEqual(measured.timing, { mode: "measured" });
  assert.deepEqual(normalizeAnimationComposition(composition("result-source")).timing, { mode: "exact" });
  const invalidRemotion = composition("result-source");
  invalidRemotion.timing = { mode: "measured" };
  assert.throws(() => normalizeAnimationComposition(invalidRemotion), /Remotion compositions must use exact timing/);

  const directory = await mkdtemp(join(tmpdir(), "padstudio-manim-timing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakeCommand = async (executable, args) => {
    if (executable === "fake-manim") {
      const mediaDirectory = args[args.indexOf("--media_dir") + 1];
      await mkdir(mediaDirectory, { recursive: true });
      await writeFile(join(mediaDirectory, "padstudio-animation.mp4"), "fake-video-bytes");
      return { stdout: "rendered", stderr: "" };
    }
    if (executable === "fake-ffprobe") return { stdout: JSON.stringify({ format: { duration: "180.400" }, streams: [
      { codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1" },
    ] }), stderr: "" };
    if (executable === "fake-ffmpeg") {
      await writeFile(args.at(-1), "fake-poster-bytes");
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected command: ${executable} ${args.join(" ")}`);
  };
  const renderer = createCodeAnimationRenderer("manim", { runtimeCommand: "fake-manim", ffmpegCommand: "fake-ffmpeg",
    ffprobeCommand: "fake-ffprobe", executeCommand: fakeCommand });
  const execute = (compositionData, suffix) => renderer.execute({
    composition: compositionData,
    source: { result: { id: "result-source" }, data: { dependencies: [] } },
    validation: { id: "result-validation" }, assets: [],
    artifact: { id: "artifact-animation", revision: 1 },
    codeDirectory: join(directory, `code-${suffix}`), entryPath: join(directory, `code-${suffix}`, "lesson.py"),
    outputPath: join(directory, `animation-${suffix}.mp4`), mediaDirectory: join(directory, `media-${suffix}`),
    homeDirectory: join(directory, `home-${suffix}`), availability: { executableVersion: "fake-manim 1.0" },
  });
  await mkdir(join(directory, "code-measured"), { recursive: true });
  const execution = await execute(measured, "measured");
  assert.equal(execution.report.timing.actualDurationSeconds, 180.4);
  assert.ok(Math.abs(execution.report.timing.durationDriftSeconds - 0.4) < 1e-9);
  assert.equal(execution.report.timing.toleranceSeconds, 1.8);

  await mkdir(join(directory, "code-exact"), { recursive: true });
  await assert.rejects(execute({ ...measured, timing: { mode: "exact" } }, "exact"), /allowed drift: 0.15s/);
});

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

test("Remotion validation catches asset packaging mistakes before execution", async (t) => {
  const { executor } = await fixture(t);
  for (const sample of [
    { name: "Static file", content: "import {staticFile} from 'remotion'; export const Demo=()=>staticFile('voice.wav'); // Composition", rule: "unsupported_static_asset_reference" },
    { name: "Raw asset URL", content: "export const Demo=()=> <Audio src={'assets/narration.wav'}/>; // Composition", rule: "unsupported_unbundled_asset_reference" },
    { name: "Missing import", content: "import voice from './missing.wav'; export const Demo=()=>voice; // Composition", rule: "unresolved_local_import" },
  ]) {
    const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create invalid asset reference", {
      operation: "create", runtime: "remotion", name: sample.name, entryFile: "src/index.tsx", entrySymbol: "Demo",
      changeSummary: "Validation fixture", files: [{ path: "src/index.tsx", content: sample.content }],
    }));
    await assert.rejects(executor.execute("demo", request("animation.validate", "code-animation-validator", "Validate asset references", {
      sourceResultId: created.result.id,
    })), new RegExp(sample.rule));
  }

  const managed = await sourceAndValidation(executor,
    "import voice from '../assets/narration.wav'; import props from '../data/props.json'; export const Demo=()=>props && voice; // Composition");
  assert.equal(managed.validation.data.status, "passed");
  assert.ok(managed.validation.verification.checks.includes("managed_asset_references_checked"));
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

test("HyperFrames source cannot impersonate runtime snapshot evidence", async (t) => {
  const { executor } = await fixture(t);
  const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create ambiguous HyperFrames evidence", {
    operation: "create", runtime: "hyperframes", name: "Ambiguous snapshots", entryFile: "index.html", entrySymbol: "hero-title",
    changeSummary: "Reserved path fixture", files: [
      { path: "index.html", content: "<!doctype html><html><body data-composition-id='hero-title'></body></html>" },
      { path: "snapshots/frame-00.png", content: "not runtime evidence" },
    ],
  }));
  await assert.rejects(executor.execute("demo", request("animation.validate", "code-animation-validator", "Reject ambiguous evidence", {
    sourceResultId: created.result.id,
  })), /reserved_runtime_output_path/);
});

test("HyperFrames preflight preserves normalized findings and images, then previews exact frames", async (t) => {
  const calls = [];
  const fakeCommand = async (executable, args, options = {}) => {
    calls.push([executable, ...args]);
    if (args.includes("--version") || args[0] === "-version") return { stdout: `${executable} 1.0\n`, stderr: "" };
    if (executable === "fake-hyperframes" && args[0] === "doctor") return { stdout: JSON.stringify({ ok: false,
      checks: [{ name: "FFmpeg", ok: true, detail: "available" }, { name: "TTS (Kokoro)", ok: false, detail: "optional" }],
      _meta: { version: "0.8.42" } }), stderr: "" };
    if (executable === "fake-hyperframes" && args[0] === "check") {
      assert.ok(args.includes("--strict"));
      if (!args.includes("--json")) return { stdout: "check passed", stderr: "" };
      assert.ok(args.includes("--snapshots"));
      assert.ok(args.includes("--at-transitions"));
      assert.ok(args.includes("--samples=9"));
      assert.equal(await readFile(join(options.cwd, "index.motion.json"), "utf8"), "{\"staysInFrame\":[]}\n");
      await mkdir(join(options.cwd, "snapshots"), { recursive: true });
      await writeFile(join(options.cwd, "snapshots", "frame-00-at-0.0s.png"), "check-frame");
      await writeFile(join(options.cwd, "snapshots", "finding-00-overflow.png"), "finding-crop");
      return { stdout: JSON.stringify({ ok: true, strict: true,
        lint: { errorCount: 0, warningCount: 0, findings: [] },
        runtime: { errorCount: 0, warningCount: 0, findings: [] },
        layout: { errorCount: 0, warningCount: 0, samples: [0, 0.5, 1], duration: 1, transitionSamples: [0.45, 0.5],
          transitionSamplesDropped: 2, totalIssueCount: 1, truncated: false, findings: [{ code: "layout_note", severity: "info",
          message: "Measured title bounds.", selector: "#title", sourceFile: "index.html", time: 0.5,
          bbox: { x: 10, y: 20, width: 100, height: 30 } }] },
        motion: { enabled: true, errorCount: 0, warningCount: 0, samples: 3, findings: [] },
        contrast: { enabled: true, errorCount: 0, warningCount: 0, samples: [0, 1], findings: [] },
        snapshots: { enabled: true, files: ["snapshots/frame-00-at-0.0s.png"], findingFiles: ["snapshots/finding-00-overflow.png"] },
      }), stderr: "" };
    }
    if (executable === "fake-hyperframes" && args[0] === "snapshot") {
      const output = args.find((arg) => arg.startsWith("--output=")).slice("--output=".length);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "frame-00-at-0.0s.png"), "preview-zero");
      await writeFile(join(output, "frame-01-at-0.5s.png"), "preview-half");
      await writeFile(join(output, "contact-sheet.jpg"), "preview-contact-sheet");
      return { stdout: "3 snapshots saved", stderr: "" };
    }
    if (executable === "fake-hyperframes" && args[0] === "keyframes" && args.includes("--json")) {
      return { stdout: JSON.stringify({ ok: true, target: "index.html", selector: "#title", keyframes: [{ time: 0, x: 0 }, { time: 1, x: 200 }] }), stderr: "" };
    }
    if (executable === "fake-hyperframes" && args[0] === "keyframes" && args.some((arg) => arg.startsWith("--shot="))) {
      const output = args.find((arg) => arg.startsWith("--shot=")).slice("--shot=".length);
      await writeFile(output, "motion-preview"); return { stdout: "saved", stderr: "" };
    }
    if (executable === "fake-hyperframes" && args[0] === "render") {
      const output = args[args.indexOf("--output") + 1]; await writeFile(output, "fake-video"); return { stdout: "rendered", stderr: "" };
    }
    if (executable === "fake-ffprobe") return { stdout: JSON.stringify({ format: { duration: "1.000" }, streams: [
      { codec_type: "video", width: 320, height: 180, avg_frame_rate: "24/1" },
    ] }), stderr: "" };
    if (executable === "fake-ffmpeg") { await writeFile(args.at(-1), "fake-poster"); return { stdout: "", stderr: "" }; }
    throw new Error(`Unexpected command: ${executable} ${args.join(" ")}`);
  };
  const options = { runtimeCommand: "fake-hyperframes", ffmpegCommand: "fake-ffmpeg", ffprobeCommand: "fake-ffprobe",
    browserCommand: "fake-browser", executeCommand: fakeCommand };
  const preflightTool = createCodeAnimationPreflight("hyperframes", options);
  const previewTool = createHyperframesAnimationPreview(options);
  const motionPreviewTool = createHyperframesMotionPreview(options);
  const renderer = createCodeAnimationRenderer("hyperframes", options);
  const { rootDir, store, executor } = await fixture(t, [preflightTool, previewTool, motionPreviewTool, renderer]);
  const created = await executor.execute("demo", request("animation.source", "code-animation-source", "Create HyperFrames source", {
    operation: "create", runtime: "hyperframes", name: "HyperFrames title", entryFile: "index.html", entrySymbol: "hero-title",
    changeSummary: "Fixture with an optional motion contract", dependencies: [{ name: "hyperframes", version: "0.8.42" }], files: [
      { path: "index.html", content: "<!doctype html><html><body data-composition-id='hero-title'><h1 id='title'>Clear</h1></body></html>" },
      { path: "index.motion.json", content: "{\"staysInFrame\":[]}\n" },
    ],
  }));
  const validation = (await executor.execute("demo", request("animation.validate", "code-animation-validator", "Validate HyperFrames source", {
    sourceResultId: created.result.id,
  }))).result;
  const compositionData = composition(created.result.id);
  compositionData.runtime = "hyperframes";
  compositionData.entry = { file: "index.html", symbol: "hero-title" };
  const artifact = await store.recordArtifact("demo", { key: "hyperframes-title", type: "animation.composition", name: "HyperFrames title",
    summary: "Structured check and snapshot fixture.", data: compositionData, references: [{ kind: "result", id: created.result.id }] });
  const preflight = (await executor.execute("demo", request("animation.preflight", "hyperframes-local-preflight", "Check exact composition", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id,
  }))).result;
  assert.equal(preflight.data.status, "passed");
  assert.equal(preflight.data.findings.findingCount, 1);
  assert.equal(preflight.data.findings.findings[0].section, "layout");
  assert.equal(preflight.data.findings.sections.motion.enabled, true);
  assert.equal(preflight.data.findings.sections.layout.duration, 1);
  assert.equal(preflight.data.findings.sections.layout.transitionSampleCount, 2);
  assert.equal(preflight.data.findings.sections.layout.transitionSamplesDropped, 2);
  assert.equal(preflight.data.findings.coverageComplete, false);
  assert.equal(preflight.data.runtimeFingerprint.doctor.status, "degraded");
  assert.equal(preflight.data.limitations.length, 1);
  assert.equal(preflight.data.snapshotCount, 2);
  assert.equal(preflight.files.filter((file) => file.mediaType === "image").length, 2);
  const preview = (await executor.execute("demo", request("animation.preview", "hyperframes-preview", "Inspect exact key frames", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id,
    preflightResultId: preflight.id, frames: [0, 12],
  }))).result;
  assert.deepEqual(preview.data.frames, [0, 12]);
  assert.equal(preview.files.filter((file) => file.mediaType === "image").length, 3);
  assert.ok(calls.some((call) => call.includes("--at=0,0.5") && call.includes("--no-end") && call.includes("--describe=false")));
  const motionPreview = (await executor.execute("demo", request("animation.preview", "hyperframes-motion-preview", "Inspect title motion", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id,
    preflightResultId: preflight.id, selector: "#title", fromFrame: 0, toFrame: 23, samples: 7, layout: "path", ghost: true,
  }))).result;
  assert.equal(motionPreview.data.motion.selector, "#title");
  assert.equal(motionPreview.data.motion.samples, 7);
  assert.equal(motionPreview.files.find((file) => file.id === "motion").mediaType, "image");
  assert.ok(calls.some((call) => call.includes("--selector=#title") && call.includes("--runtime=all") && call.includes("--json")));
  assert.ok(calls.some((call) => call.includes("--samples=7") && call.includes("--ghost") && call.includes("--to=0.9583333333333334")));
  const rendered = (await executor.execute("demo", request("animation.render", "hyperframes-local", "Render fail-closed", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id, preflightResultId: preflight.id,
  }))).result;
  assert.equal(rendered.type, "animation.render");
  assert.ok(calls.some((call) => call[1] === "render" && call.includes("--strict-all") && call.includes("--no-best-effort")));
  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.animation.activeCompositions[0].preflights[0].findings.findingCount, 1);
  assert.equal(context.animation.activeCompositions[0].previews[0].resultId, preview.id);
  assert.equal(context.animation.activeCompositions[0].previews[1].motion.selector, "#title");
  const observer = await new ProjectReader(rootDir).readObserverSection("demo", "animation");
  const observedPreflight = observer.animation.compositions[0].preflights[0];
  assert.equal(observedPreflight.findings.sections.motion.enabled, true);
  assert.equal(observedPreflight.files.filter((file) => file.available && file.mediaType === "image").length, 2);
});

test("managed validation and preflight gate render without code approval; sequence can consume the Result", async (t) => {
  const fakeCommand = async (executable, args) => {
    if (args.includes("--version") || args[0] === "-version" || args[0] === "help") return { stdout: `${executable} 1.0\n`, stderr: "" };
    if (executable === "fake-remotion" && args[0] === "compositions") return { stdout: "Demo\n", stderr: "" };
    if (executable === "fake-remotion" && args[0] === "render") {
      await writeFile(args[3], "fake-video-bytes"); return { stdout: "rendered", stderr: "" };
    }
    if (executable === "fake-remotion" && args[0] === "still") {
      await writeFile(args[3], "fake-image-bytes"); return { stdout: "rendered", stderr: "" };
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
  const preflightTool = createCodeAnimationPreflight("remotion", { runtimeCommand: "fake-remotion", ffmpegCommand: "fake-ffmpeg",
    ffprobeCommand: "fake-ffprobe", browserCommand: "fake-chrome", executeCommand: fakeCommand });
  const previewTool = createRemotionAnimationPreview({ runtimeCommand: "fake-remotion", ffmpegCommand: "fake-ffmpeg",
    ffprobeCommand: "fake-ffprobe", browserCommand: "fake-chrome", executeCommand: fakeCommand });
  const { rootDir, store, executor } = await fixture(t, [preflightTool, previewTool, renderer]);
  const exact = await sourceAndValidation(executor);
  const props = (await executor.execute("demo", request("animation.props", "code-animation-props", "Create title props", {
    operation: "create", name: "Hero title props", changeSummary: "Initial copy", props: { title: "A traceable title" },
  }))).result;
  const compositionData = composition(exact.source.id); compositionData.propsResultId = props.id;
  const artifact = await store.recordArtifact("demo", { key: "hero-title", type: "animation.composition", name: "Hero title",
    summary: "A short, editable kinetic title.", data: compositionData,
    references: [{ kind: "result", id: exact.source.id }, { kind: "result", id: props.id }] });
  const renderRequest = request("animation.render", "remotion-local", "Render validated title", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id, preflightResultId: "result-not-yet-created",
  });
  await assert.rejects(executor.execute("demo", renderRequest), /Không tìm thấy result|not passed and bound/);
  const preflight = (await executor.execute("demo", request("animation.preflight", "remotion-local-preflight", "Compile exact title", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id,
  }))).result;
  assert.equal(preflight.data.status, "passed");
  renderRequest.inputs.preflightResultId = preflight.id;
  const preview = (await executor.execute("demo", request("animation.preview", "remotion-preview", "Review key title frames", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id,
    preflightResultId: preflight.id, frames: [0, 12, 23], range: { startSeconds: 0, endSeconds: 1 },
  }))).result;
  assert.equal(preview.type, "animation.preview");
  assert.equal(preview.files.filter((file) => file.mediaType === "image").length, 3);
  const rendered = (await executor.execute("demo", renderRequest)).result;
  assert.equal(rendered.type, "animation.render");
  assert.equal("approvalDecisionId" in rendered.data, false);
  assert.equal(rendered.data.executionBoundary.networkIsolation, "not_enforced_by_host");
  assert.deepEqual(rendered.inputResults, [exact.source.id, exact.validation.id, props.id, preflight.id]);
  const reportFile = await store.verifyResultFile("demo", rendered.id, "report");
  const report = JSON.parse(await readFile(reportFile.filePath, "utf8"));
  assert.ok(report.commands[0].args.includes("--browser-executable=<configured-browser>"));
  assert.ok(report.commands[0].args.includes("--props=<managed-props>"));
  assert.ok(report.commands[0].args.includes("--frames=0-23"));
  await store.recordArtifact("demo", { key: "film", type: "video.sequence", name: "Film", summary: "Sequence using managed animation.",
    data: { version: "1.0", changeReason: "Use code animation", format: { width: 320, height: 180, fps: 24 }, segments: [
      { id: "title", title: "Title", intent: "Open with the kinetic title.", durationSeconds: 1,
        visual: { source: { kind: "result", id: rendered.id, file: "primary" } } },
    ] }, references: [] });
  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.animation.activeCompositions[0].renders[0].resultId, rendered.id);
  assert.equal(context.animation.activeCompositions[0].preflights[0].resultId, preflight.id);
  assert.equal(context.animation.activeCompositions[0].previews[0].resultId, preview.id);
  assert.equal(context.animation.activeCompositions[0].renders[0].durationSeconds, 1);
  assert.equal(context.animation.activeCompositions[0].timing.mode, "exact");
  assert.equal(context.production.sequences[0].segments[0].visual.source.id, rendered.id);
  const observer = await new ProjectReader(rootDir).readObserverSection("demo", "animation");
  assert.equal("executionApproval" in observer.animation.compositions[0], false);
  assert.equal(observer.animation.compositions[0].renders[0].files.find((file) => file.id === "primary").available, true);
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/projects/demo/observer/animation`)).status, 200);
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
  const unhealthyRuntime = createCodeAnimationRenderer("hyperframes", { runtimeCommand: "hyperframes", browserCommand: "browser",
    ffmpegCommand: "ffmpeg", ffprobeCommand: "ffprobe", executeCommand: async (executable, args) => {
      if (args[0] === "doctor") return { stdout: JSON.stringify({ checks: [{ name: "Chrome", ok: false, detail: "missing" }],
        _meta: { version: "0.8.42" } }), stderr: "" };
      return { stdout: `${executable} 1.0\n`, stderr: "" };
    } });
  assert.equal((await unhealthyRuntime.checkAvailability()).status, "unavailable");
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

test("failed runtime preflight is preserved as evidence and cannot gate render", async (t) => {
  const fakeCommand = async (executable, args) => {
    if (args.includes("--version") || args[0] === "-version" || args[0] === "help") return { stdout: `${executable} 1.0\n`, stderr: "" };
    if (executable === "fake-remotion" && args[0] === "compositions") {
      throw Object.assign(new Error("bundle failed"), { stderr: "TS2322: title must be a string" });
    }
    throw new Error(`Unexpected command: ${executable} ${args.join(" ")}`);
  };
  const options = { runtimeCommand: "fake-remotion", ffmpegCommand: "fake-ffmpeg", ffprobeCommand: "fake-ffprobe",
    browserCommand: "fake-chrome", executeCommand: fakeCommand };
  const preflightTool = createCodeAnimationPreflight("remotion", options);
  const renderer = createCodeAnimationRenderer("remotion", options);
  const { store, executor } = await fixture(t, [preflightTool, renderer]);
  const exact = await sourceAndValidation(executor);
  const artifact = await store.recordArtifact("demo", { key: "broken", type: "animation.composition", name: "Broken title",
    summary: "Compile failure fixture.", data: composition(exact.source.id), references: [{ kind: "result", id: exact.source.id }] });
  const preflight = (await executor.execute("demo", request("animation.preflight", "remotion-local-preflight", "Capture compile failure", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id,
  }))).result;
  assert.equal(preflight.data.status, "failed");
  assert.equal(preflight.data.errorCode, "runtime_check_failed");
  const reportPath = await store.verifyResultFile("demo", preflight.id, "report");
  assert.match(await readFile(reportPath.filePath, "utf8"), /TS2322: title must be a string/);
  await assert.rejects(executor.execute("demo", request("animation.render", "remotion-local", "Reject failed preflight", {
    artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: exact.validation.id, preflightResultId: preflight.id,
  })), /not passed and bound/);
});
