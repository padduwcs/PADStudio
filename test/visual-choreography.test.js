import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeAnimationComposition } from "../src/animation/animation-composition.js";
import {
  choreographyContinuityMetrics,
  choreographyReviewPoints,
  normalizeVisualChoreography,
  selectChoreographyPreviewFrames,
} from "../src/animation/visual-choreography.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createCodeAnimationSource } from "../src/tools/code-animation-source.js";
import { createCodeAnimationValidator } from "../src/tools/code-animation-validator.js";
import { createCodeAnimationPreflight, createRemotionAnimationPreview } from "../src/tools/code-animation-renderer.js";
import { ProjectReader } from "../src/web/project-reader.js";

function choreography() {
  return {
    version: "1.0",
    changeReason: "Plan the explanation before authoring motion.",
    purpose: "Show how two source cells accumulate into one prefix result.",
    durationSeconds: 4,
    fps: 24,
    objects: [
      { id: "matrix-a", label: "Input matrix A", role: "subject", continuity: "persistent", initialState: "All cells neutral." },
      { id: "cell-total", label: "Prefix result cell", role: "evidence", continuity: "persistent", initialState: "Empty." },
    ],
    beats: [
      {
        id: "select-cells", kind: "semantic", startSeconds: 0, endSeconds: 2,
        message: "Select the cells that contribute to this prefix.", narrationText: "First, select these cells.",
        visualPurpose: "Make membership visible before arithmetic.", primaryObjectId: "matrix-a",
        focusObjectIds: ["matrix-a"], stateBefore: "All cells are neutral.", stateAfter: "Contributing cells are highlighted.",
        actions: [{ id: "select", startSeconds: 0, endSeconds: 1, verb: "select", meaning: "semantic",
          subjectIds: ["matrix-a"], targetIds: [], description: "Highlight contributing cells in reading order.",
          resultingState: "The selected region is visibly distinct." }],
        holdAfterSeconds: 0.5, continuityFromBeatId: null,
        reviewCriteria: ["Every highlighted cell belongs to the prefix region."],
      },
      {
        id: "accumulate", kind: "semantic", startSeconds: 2, endSeconds: 4,
        message: "Accumulate the selected values into the result.", narrationText: "Then add them into S.",
        visualPurpose: "Expose causality between the region and the numeric result.", primaryObjectId: "cell-total",
        focusObjectIds: ["matrix-a", "cell-total"], stateBefore: "The region is selected and the result is empty.",
        stateAfter: "The result cell contains the computed total.",
        actions: [{ id: "sum", startSeconds: 2, endSeconds: 3.5, verb: "accumulate", meaning: "semantic",
          subjectIds: ["matrix-a"], targetIds: ["cell-total"], description: "Move the selected values into an addition expression and resolve it.",
          resultingState: "The total is written into the result cell." }],
        holdAfterSeconds: 0.5, continuityFromBeatId: "select-cells",
        reviewCriteria: ["The displayed total equals the selected values."],
      },
    ],
    reviewCriteria: ["Motion and narration describe the same operation."],
  };
}

function continuousChoreography() {
  const value = choreography();
  value.version = "1.1";
  value.continuity = {
    mode: "continuous-model",
    visualThesis: "One matrix remains visible while its selected region becomes a computed prefix value.",
    heroObjectIds: ["matrix-a"],
    maxResets: 0,
  };
  value.presentation = {
    narrationMode: "voice-led",
    stageDescription: "The matrix and result occupy the primary vertical stage; text is limited to values and operation labels.",
    targetStageCoveragePercent: 70,
    maxTextAreaPercent: 15,
  };
  value.chapters = [{
    id: "build-prefix", label: "Build one prefix value", goal: "Carry one selected region into its computed total.",
    heroObjectIds: ["matrix-a"],
  }];
  Object.assign(value.beats[0], {
    chapterId: "build-prefix", continuityMode: "establish", stateBeforeId: "matrix-neutral",
    stateAfterId: "matrix-selected", carriedObjectIds: [], newInformation: "The prefix region has explicit membership.",
    resetReason: null,
  });
  value.beats[0].actions[0].effect = "state-change";
  value.beats[0].actions[0].resultingState = value.beats[0].stateAfter;
  Object.assign(value.beats[1], {
    chapterId: "build-prefix", continuityMode: "continue", stateBeforeId: "matrix-selected",
    stateAfterId: "prefix-computed", carriedObjectIds: ["matrix-a"], newInformation: "The selected region resolves into one stored total.",
    resetReason: null,
  });
  value.beats[1].actions[0].effect = "state-change";
  value.beats[1].actions[0].resultingState = value.beats[1].stateAfter;
  return value;
}

function composition(sourceResultId, choreographyArtifactId) {
  return {
    version: "1.1", changeReason: "Bind semantic motion plan.", intent: "Teach prefix accumulation through visible operations.",
    runtime: "remotion", sourceResultId, choreographyArtifactId,
    entry: { file: "src/index.tsx", symbol: "Demo" },
    format: { width: 1080, height: 1920, fps: 24, background: "#101010", transparent: false },
    durationSeconds: 4, assets: [],
    style: { designRead: "Persistent matrix workspace.", palette: ["#101010", "#FFFFFF", "#EAB308"],
      motionPrinciples: ["State change carries meaning."], antiPatterns: ["No generic slide replacement."] },
    reviewCriteria: ["Every semantic beat is visible in the bound interval."],
    executionPolicy: { codeTrust: "agent-managed-execution", networkAccess: "not-required" },
  };
}

test("visual choreography validates semantic state changes and derives exact review frames", () => {
  const normalized = normalizeVisualChoreography(choreography());
  assert.equal(normalized.beats.length, 2);
  assert.deepEqual(choreographyReviewPoints(normalized).map((point) => point.frame), [0, 24, 47, 48, 84, 95]);
  assert.deepEqual(selectChoreographyPreviewFrames(normalized), [0, 24, 47, 48, 84, 95]);

  const holdOnly = choreography();
  holdOnly.beats[0].actions[0].verb = "hold";
  assert.throws(() => normalizeVisualChoreography(holdOnly), /non-hold semantic action/);
  const unknownObject = choreography();
  unknownObject.beats[0].focusObjectIds = ["missing"];
  assert.throws(() => normalizeVisualChoreography(unknownObject), /unknown objects/);
  const offFrame = choreography();
  offFrame.beats[0].actions[0].endSeconds = 1.01;
  assert.throws(() => normalizeVisualChoreography(offFrame), /align to the choreography frame rate/);
});

test("visual choreography 1.1 enforces a continuous model instead of animated mini-slides", () => {
  const normalized = normalizeVisualChoreography(continuousChoreography());
  assert.equal(normalized.version, "1.1");
  assert.deepEqual(choreographyContinuityMetrics(normalized), {
    contractVersion: "1.1", continuityMode: "continuous-model", chapterCount: 1,
    heroObjectCount: 1, resetCount: 0, carriedBeatRatio: 1, narrationMode: "voice-led",
    targetStageCoveragePercent: 70, maxTextAreaPercent: 15,
  });

  const disconnected = continuousChoreography();
  disconnected.beats[1].carriedObjectIds = [];
  assert.throws(() => normalizeVisualChoreography(disconnected), /preserve at least one choreography hero/);

  const brokenStateChain = continuousChoreography();
  brokenStateChain.beats[1].stateBeforeId = "new-slide";
  assert.throws(() => normalizeVisualChoreography(brokenStateChain), /must equal the preceding beat stateAfterId/);

  const decorativeSemanticAction = continuousChoreography();
  decorativeSemanticAction.beats[0].actions[0].verb = "highlight";
  assert.throws(() => normalizeVisualChoreography(decorativeSemanticAction), /cannot count as a state change/);

  const repeatedBeat = continuousChoreography();
  repeatedBeat.beats[1].newInformation = repeatedBeat.beats[0].newInformation;
  assert.throws(() => normalizeVisualChoreography(repeatedBeat), /repeats an earlier beat/);

  const transcriptPanel = continuousChoreography();
  transcriptPanel.presentation.narrationMode = "full-transcript";
  assert.throws(() => normalizeVisualChoreography(transcriptPanel), /cannot use a full-transcript presentation panel/);

  const excessiveReset = continuousChoreography();
  excessiveReset.beats[1].continuityMode = "reset";
  excessiveReset.beats[1].resetReason = "A deliberately isolated counterexample.";
  excessiveReset.beats[1].carriedObjectIds = [];
  assert.throws(() => normalizeVisualChoreography(excessiveReset), /exceeding continuity.maxResets/);

  const unexplainedState = continuousChoreography();
  unexplainedState.beats[1].stateAfter = "A different result description.";
  assert.throws(() => normalizeVisualChoreography(unexplainedState), /must equal the resultingState/);
});

test("composition 1.1 binds exact choreography provenance and observer context", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-choreography-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootDir = join(directory, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Choreographed explainer" });
  const fakeCommand = async (executable, args) => {
    if (args.includes("--version") || args[0] === "-version" || args[0] === "help") return { stdout: `${executable} 1.0\n`, stderr: "" };
    if (executable === "fake-remotion" && args[0] === "compositions") return { stdout: "Demo\n", stderr: "" };
    if (executable === "fake-remotion" && args[0] === "still") {
      await writeFile(args[3], "fake-image-bytes");
      return { stdout: "rendered", stderr: "" };
    }
    throw new Error(`Unexpected command: ${executable} ${args.join(" ")}`);
  };
  const runtimeOptions = { runtimeCommand: "fake-remotion", ffmpegCommand: "fake-ffmpeg",
    ffprobeCommand: "fake-ffprobe", browserCommand: "fake-chrome", executeCommand: fakeCommand };
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([
    createCodeAnimationSource(), createCodeAnimationValidator(),
    createCodeAnimationPreflight("remotion", runtimeOptions), createRemotionAnimationPreview(runtimeOptions),
  ]) });
  const source = (await executor.execute("demo", {
    capability: "animation.source", tool: "code-animation-source", purpose: "Create fixture source",
    inputs: { operation: "create", runtime: "remotion", name: "Fixture", entryFile: "src/index.tsx", entrySymbol: "Demo",
      changeSummary: "Fixture", dependencies: [{ name: "remotion", version: "4.0.0" }],
      files: [{ path: "src/index.tsx", content: "export const Demo = () => null; // Composition\n" }] },
  })).result;
  const validation = (await executor.execute("demo", {
    capability: "animation.validate", tool: "code-animation-validator", purpose: "Validate fixture source",
    inputs: { sourceResultId: source.id },
  })).result;
  const plan = await store.recordArtifact("demo", {
    key: "prefix-choreography", type: "animation.choreography", name: "Prefix choreography",
    summary: "Two semantic operations.", data: continuousChoreography(), references: [],
  });
  const data = composition(source.id, plan.id);
  await assert.rejects(store.recordArtifact("demo", {
    key: "missing-plan-ref", type: "animation.composition", name: "Missing plan ref", summary: "Invalid.",
    data, references: [{ kind: "result", id: source.id }],
  }), /reference its exact choreography Artifact/);
  const mismatch = structuredClone(data); mismatch.durationSeconds = 5;
  await assert.rejects(store.recordArtifact("demo", {
    key: "mismatched-plan", type: "animation.composition", name: "Mismatched plan", summary: "Invalid.", data: mismatch,
    references: [{ kind: "result", id: source.id }, { kind: "artifact", id: plan.id }],
  }), /must match its choreography/);
  const artifact = await store.recordArtifact("demo", {
    key: "prefix-composition", type: "animation.composition", name: "Prefix composition", summary: "Bound plan.", data,
    references: [{ kind: "result", id: source.id }, { kind: "artifact", id: plan.id }],
  });
  assert.equal(normalizeAnimationComposition(artifact.data).choreographyArtifactId, plan.id);

  const preflight = (await executor.execute("demo", {
    capability: "animation.preflight", tool: "remotion-local-preflight", purpose: "Compile exact choreographed composition",
    inputs: { artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id },
  })).result;
  const preview = (await executor.execute("demo", {
    capability: "animation.preview", tool: "remotion-preview", purpose: "Preview semantic action boundaries",
    inputs: { artifactId: artifact.id, artifactRevision: artifact.revision, validationResultId: validation.id,
      preflightResultId: preflight.id, useChoreographyFrames: true },
  })).result;
  assert.deepEqual(preview.data.frames, [0, 24, 47, 48, 84, 95]);
  assert.equal(preview.data.frameSelection, "choreography");
  assert.deepEqual(preview.inputArtifacts, [artifact.id, plan.id]);

  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.animation.activeChoreographies[0].semanticBeatCount, 2);
  assert.deepEqual(context.animation.activeCompositions[0].choreography.recommendedPreviewFrames, [0, 24, 47, 48, 84, 95]);
  const observer = await new ProjectReader(rootDir).readObserverSection("demo", "animation");
  assert.equal(observer.animation.compositions[0].choreographyArtifactId, plan.id);
  assert.equal(observer.animation.choreographies[0].continuity.continuityMode, "continuous-model");
  assert.equal(observer.animation.choreographies[0].continuity.carriedBeatRatio, 1);
  assert.equal(observer.animation.choreographies[0].beats[1].actions[0].verb, "accumulate");

  const revisedData = continuousChoreography();
  revisedData.changeReason = "Clarify the accumulation action.";
  revisedData.beats[1].actions[0].description = "Move each selected value into the expression, then resolve the total.";
  const revisedPlan = await store.recordArtifact("demo", {
    key: "prefix-choreography", type: "animation.choreography", name: "Prefix choreography r2",
    summary: "Clarified semantic operation.", data: revisedData, references: [], expectedRevision: 1,
  });
  assert.equal(revisedPlan.revision, 2);
  const staleContext = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(staleContext.animation.activeCompositions[0].dependencyReasons[0].reason, "choreography_not_active_revision");
});
