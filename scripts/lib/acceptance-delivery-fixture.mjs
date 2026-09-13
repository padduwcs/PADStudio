import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDefaultToolRegistry } from "../../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../../src/execution/tool-executor.js";
import { planProjectRecovery, recoverProject } from "../../src/operations/project-recovery.js";
import { ProjectStore } from "../../src/project/project-store.js";
import { importProjectInput } from "../../src/resources/project-importer.js";

const exec = promisify(execFile);

export async function createAcceptanceDeliveryFixture({
  rootDir,
  sourcePath,
  projectId = "acceptance-delivery-fixture",
  interruptFinalization = false
}) {
  await exec("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=3.3",
    "-f", "lavfi", "-i", "sine=frequency=520:sample_rate=48000:duration=3.3",
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-y", sourcePath
  ], { windowsHide: true, timeout: 300_000 });
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId, title: "Self-contained delivery acceptance" });
  const imported = await importProjectInput({ rootDir, projectId, sourcePath });
  const sequenceData = (caption, changeReason) => ({
    version: "1.0",
    changeReason,
    format: { width: 1080, height: 1920, fps: 30 },
    segments: [0, 1, 2].map((start, index) => ({
      id: `part-${index + 1}`,
      title: `Part ${index + 1}`,
      intent: "Exercise a distinct timeline segment with managed source media.",
      durationSeconds: 1,
      visual: {
        source: { kind: "resource", id: imported.resourceId },
        startSeconds: start,
        volume: 1
      },
      captions: [{
        text: index === 1 ? caption : `Acceptance part ${index + 1}`,
        startSeconds: 0.1,
        endSeconds: 0.9
      }],
      references: []
    }))
  });
  const firstArtifact = await store.recordArtifact(projectId, {
    key: "acceptance-preview", type: "video.sequence", name: "Acceptance preview",
    summary: "Deterministic first revision for exact Result comparison.",
    data: sequenceData("First revision", "Create the deterministic acceptance fixture.")
  });
  const registry = createDefaultToolRegistry();
  const firstRender = await new ToolExecutor({ store, registry }).execute(projectId, {
    capability: "video.render-sequence", tool: "ffmpeg-sequence",
    purpose: "Render the historical acceptance revision.", inputs: { artifactId: firstArtifact.id }
  });
  const currentArtifact = await store.recordArtifact(projectId, {
    key: "acceptance-preview", type: "video.sequence", name: "Acceptance preview",
    summary: "Deterministic current revision for clean-checkout browser acceptance.",
    expectedRevision: firstArtifact.revision,
    data: sequenceData("Current revision", "Revise one caption to preserve a meaningful history.")
  });
  let interrupted = false;
  const finishRun = store.finishRun.bind(store);
  const executionStore = interruptFinalization ? new Proxy(store, {
    get(target, property) {
      if (property === "finishRun") return async (...args) => {
        if (args[2]?.status === "completed" && !interrupted) {
          interrupted = true;
          throw new Error("Injected acceptance finalization interruption.");
        }
        return finishRun(...args);
      };
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) : store;
  const currentRenderExecution = await new ToolExecutor({ store: executionStore, registry }).execute(projectId, {
    capability: "video.render-sequence", tool: "ffmpeg-sequence",
    purpose: "Render the current acceptance revision.",
    inputs: { artifactId: currentArtifact.id, reuseResultId: firstRender.result.id }
  });
  let recoveryPlan = null;
  let recovery = null;
  let repeatedRecovery = null;
  if (interruptFinalization) {
    if (currentRenderExecution.status !== "finalization_pending") {
      throw new Error("Injected fixture did not stop at finalization_pending.");
    }
    recoveryPlan = await planProjectRecovery(new ProjectStore(rootDir), projectId);
    recovery = await recoverProject(new ProjectStore(rootDir), projectId, { apply: true });
    repeatedRecovery = await recoverProject(new ProjectStore(rootDir), projectId, { apply: true });
  }
  const reopened = new ProjectStore(rootDir);
  const currentResult = await reopened.readResult(projectId, currentRenderExecution.resultId);
  const approval = await reopened.recordDecision(projectId, {
    resultId: currentResult.id, outcome: "accepted",
    note: "Synthetic acceptance for a deterministic technical fixture; not a human quality attestation.",
    feedbackTarget: { artifactId: currentArtifact.id, revision: currentArtifact.revision }
  });
  const delivery = await new ToolExecutor({ store: reopened, registry }).execute(projectId, {
    capability: "video.export-delivery", tool: "local-delivery",
    purpose: "Export the self-contained exact Result fixture.",
    inputs: { resultId: currentResult.id, profileId: "local-portrait-h264-v1" }
  });
  return {
    projectId, store: reopened, registry, imported, firstArtifact, currentArtifact,
    historicalResult: firstRender.result, currentResult, approval, delivery: delivery.result,
    deliveryRunId: delivery.runId, recoveryPlan, recovery, repeatedRecovery
  };
}
