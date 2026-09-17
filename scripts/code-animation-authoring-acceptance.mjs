import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createCodeAnimationProps } from "../src/tools/code-animation-props.js";
import { createCodeAnimationSource } from "../src/tools/code-animation-source.js";
import { createCodeAnimationValidator } from "../src/tools/code-animation-validator.js";
import {
  createRemotionAnimationPreflight,
  createRemotionAnimationPreview,
  createRemotionAnimationRenderer,
} from "../src/tools/code-animation-renderer.js";

const root = await mkdtemp(join(tmpdir(), "padstudio-animation-acceptance-"));
const store = new ProjectStore(join(root, "projects"));
const registry = new ToolRegistry([
  createCodeAnimationSource(), createCodeAnimationProps(), createCodeAnimationValidator(),
  createRemotionAnimationPreflight(), createRemotionAnimationPreview(), createRemotionAnimationRenderer(),
]);
const executor = new ToolExecutor({ store, registry });
const request = (capability, tool, purpose, inputs) => ({ capability, tool, purpose, inputs });

try {
  await store.createProject({ projectId: "acceptance", title: "Code animation authoring acceptance" });
  const source = (await executor.execute("acceptance", request("animation.source", "code-animation-source", "Create real Remotion fixture", {
    operation: "create", runtime: "remotion", name: "Real Remotion fixture", entryFile: "src/index.tsx", entrySymbol: "Demo",
    changeSummary: "Exercise managed props, preflight, preview and render.",
    dependencies: [{ name: "remotion", version: "4.0.524" }, { name: "react", version: "18.2.0" }],
    files: [{ path: "src/index.tsx", content: `import React from "react";
import {AbsoluteFill, Composition, interpolate, registerRoot, useCurrentFrame} from "remotion";
const Demo = ({title}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], {extrapolateRight: "clamp"});
  return <AbsoluteFill style={{backgroundColor: "#101820", color: "#ffffff", alignItems: "center", justifyContent: "center", fontFamily: "Arial"}}>
    <div style={{fontSize: 30, opacity}}>{title}</div>
  </AbsoluteFill>;
};
const Root = () => <Composition id="Demo" component={Demo} durationInFrames={24} fps={24} width={320} height={180} defaultProps={{title: "fallback"}} />;
registerRoot(Root);
export {Demo};
` }],
  }))).result;
  const props = (await executor.execute("acceptance", request("animation.props", "code-animation-props", "Create real managed props", {
    operation: "create", name: "Real props", changeSummary: "Use acceptance copy.", props: { title: "PADStudio" },
  }))).result;
  const validation = (await executor.execute("acceptance", request("animation.validate", "code-animation-validator", "Validate real source", {
    sourceResultId: source.id,
  }))).result;
  const artifact = await store.recordArtifact("acceptance", { key: "real-remotion", type: "animation.composition", name: "Real Remotion acceptance",
    summary: "One-second authoring-loop fixture.", references: [{ kind: "result", id: source.id }, { kind: "result", id: props.id }],
    data: { version: "1.0", changeReason: "Acceptance fixture", intent: "Prove the real authoring loop.", runtime: "remotion",
      sourceResultId: source.id, propsResultId: props.id, entry: { file: "src/index.tsx", symbol: "Demo" },
      format: { width: 320, height: 180, fps: 24, background: "#101820", transparent: false }, durationSeconds: 1,
      assets: [], style: { designRead: "Minimal runtime fixture.", palette: ["#101820", "#FFFFFF"],
        motionPrinciples: ["One purposeful fade."], antiPatterns: ["No decorative motion."] },
      reviewCriteria: ["Managed title is visible at the end."],
      executionPolicy: { codeTrust: "agent-managed-execution", networkAccess: "not-required" } } });
  const common = { artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id };
  const preflight = (await executor.execute("acceptance", request("animation.preflight", "remotion-local-preflight", "Real compile preflight", common))).result;
  if (preflight.data.status !== "passed") {
    const report = await store.verifyResultFile("acceptance", preflight.id, "report");
    throw new Error(`Real Remotion preflight failed:\n${await readFile(report.filePath, "utf8")}`);
  }
  assert.equal(preflight.data.status, "passed");
  const preview = (await executor.execute("acceptance", request("animation.preview", "remotion-preview", "Real frame previews",
    { ...common, preflightResultId: preflight.id, frames: [0, 12, 23], range: { startSeconds: 0, endSeconds: 0.5 } }))).result;
  assert.equal(preview.files.filter((file) => file.mediaType === "image").length, 3);
  const render = (await executor.execute("acceptance", request("animation.render", "remotion-local", "Real full render",
    { ...common, preflightResultId: preflight.id }))).result;
  assert.equal(render.data.propsResultId, props.id);
  assert.equal(render.data.preflightResultId, preflight.id);
  process.stdout.write(JSON.stringify({ status: "passed", sourceResultId: source.id, propsResultId: props.id,
    preflightResultId: preflight.id, previewResultId: preview.id, renderResultId: render.id,
    previewFiles: preview.files.length, renderVideo: render.data.video }, null, 2) + "\n");
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 30 : 0, retryDelay: 100 });
}
