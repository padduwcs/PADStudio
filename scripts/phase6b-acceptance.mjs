import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { inspectPadStudio } from "../src/operations/system-doctor.js";
import { planProjectRecovery, recoverProject } from "../src/operations/project-recovery.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

const exec = promisify(execFile);
const logDir = resolve(".cache/phase6b-acceptance");
const report = {
  version: "1.0",
  phase: "6B",
  checkedAt: new Date().toISOString(),
  status: "incomplete",
  checks: {},
  limits: [
    "Practical acceptance covers the current owner machine, not every hardware/codec combination.",
    "Human listening and broad release corpus/benchmark gates remain explicitly unmeasured.",
    "Recovery only finalizes already durable evidence; it never recreates media or repeats provider calls."
  ]
};
await mkdir(logDir, { recursive: true });

async function run(name, command, args, timeout = 300_000) {
  const result = await exec(command, args, {
    windowsHide: true, encoding: "utf8", maxBuffer: 16e6, timeout
  });
  await writeFile(join(logDir, name + ".txt"), result.stdout + result.stderr);
  report.checks[name] = {
    status: "passed",
    output: (result.stdout + result.stderr).slice(-1400)
  };
  return result;
}

let fixtureDirectory;
let server;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);
  await run("analysis-doctor", process.execPath, ["src/cli/analysis-doctor.js"]);
  const workspaceDoctor = await run(
    "workspace-doctor",
    process.execPath,
    ["src/cli/padstudio-doctor.js", "--deep", "phase3-vd04-asset-pilot"]
  );
  const workspaceDoctorValue = JSON.parse(workspaceDoctor.stdout);
  const workspaceProject = workspaceDoctorValue.projects[0];
  if (workspaceDoctorValue.status === "blocked" ||
      workspaceProject.health.status !== "ready" ||
      workspaceProject.integrity.failed !== 0) {
    throw new Error("Workspace deep doctor found a blocking or failed integrity condition.");
  }
  report.checks["workspace-doctor"].deepIntegrity = {
    verified: workspaceProject.integrity.verified,
    uncheckedLegacy: workspaceProject.integrity.unchecked,
    failed: workspaceProject.integrity.failed
  };

  fixtureDirectory = await mkdtemp(resolve(".cache/phase6b-e2e-"));
  const rootDir = join(fixtureDirectory, "projects");
  const sourcePath = join(fixtureDirectory, "source.mp4");
  await run("fixture-media", "ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "color=c=0x17324d:s=1080x1920:r=30:d=1.2",
    "-f", "lavfi", "-i", "sine=frequency=520:sample_rate=48000:duration=1.2",
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", sourcePath
  ]);
  const projectId = "phase6b-fresh-project";
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId, title: "Phase 6B fresh end-to-end" });
  const imported = await importProjectInput({ rootDir, projectId, sourcePath });
  const artifact = await store.recordArtifact(projectId, {
    key: "pilot-preview",
    type: "video.sequence",
    name: "Fresh operational acceptance",
    summary: "One exact local source exercises render, recovery and delivery.",
    data: {
      version: "1.0",
      changeReason: "Initial end-to-end operational fixture.",
      format: { width: 1080, height: 1920, fps: 30 },
      segments: [{
        id: "opening",
        title: "Opening",
        intent: "Preserve the exact imported picture and audio.",
        durationSeconds: 1.2,
        visual: {
          source: { kind: "resource", id: imported.resourceId },
          startSeconds: 0,
          volume: 1
        },
        captions: [{
          text: "PADStudio operational acceptance",
          startSeconds: 0.1,
          endSeconds: 1.1
        }],
        references: []
      }]
    }
  });

  const finishRun = store.finishRun.bind(store);
  let interruptOnce = true;
  const interruptedStore = new Proxy(store, {
    get(target, property) {
      if (property === "finishRun") {
        return async (...args) => {
          if (args[2]?.status === "completed" && interruptOnce) {
            interruptOnce = false;
            throw new Error("Phase 6B injected finalization interruption.");
          }
          return finishRun(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const registry = createDefaultToolRegistry();
  const rendered = await new ToolExecutor({
    store: interruptedStore,
    registry
  }).execute(projectId, {
    capability: "video.render-sequence",
    tool: "ffmpeg-sequence",
    purpose: "Render once, then exercise finalization recovery.",
    inputs: { artifactId: artifact.id }
  });
  if (rendered.status !== "finalization_pending") {
    throw new Error("Injected render did not stop at finalization_pending.");
  }
  const reopened = new ProjectStore(rootDir);
  const plan = await planProjectRecovery(reopened, projectId);
  if (plan.summary.recoverable !== 1 || plan.summary.blocked !== 0) {
    throw new Error("Recovery plan does not identify exactly one safe action.");
  }
  const recovered = await recoverProject(reopened, projectId, { apply: true });
  const repeated = await recoverProject(reopened, projectId, { apply: true });
  if (recovered.status !== "completed" || repeated.status !== "nothing_to_do") {
    throw new Error("Project recovery is not idempotent.");
  }
  const renderResult = await reopened.readResult(projectId, rendered.resultId);
  if ((await reopened.readResults(projectId)).filter((result) =>
    result.type === "video.sequence-render").length !== 1) {
    throw new Error("Recovery rerendered or duplicated the exact Result.");
  }
  const approval = await reopened.recordDecision(projectId, {
    resultId: renderResult.id,
    outcome: "accepted",
    note: "Synthetic owner-machine acceptance for the Phase 6B operational fixture.",
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision }
  });
  const delivery = await new ToolExecutor({
    store: reopened,
    registry
  }).execute(projectId, {
    capability: "video.export-delivery",
    tool: "local-delivery",
    purpose: "Produce the final end-to-end delivery bundle.",
    inputs: {
      resultId: renderResult.id,
      profileId: "local-portrait-h264-v1"
    }
  });
  if (delivery.status !== "completed") throw new Error("Fresh project delivery did not complete.");
  for (const file of delivery.result.files) {
    await reopened.verifyResultFile(projectId, delivery.result.id, file.id);
  }
  await reopened.writeCheckpoint(projectId, {
    goal: "Fresh project completed through verified local delivery.",
    constraints: ["Keep exact Result provenance and do not repeat provider work during recovery."],
    selectedResources: [imported.resourceId],
    pending: [],
    next: "No operational action is pending.",
    activeArtifacts: [artifact.id]
  });

  const finalStore = new ProjectStore(rootDir);
  const finalContext = await finalStore.readContext(projectId);
  if (finalContext.runRecovery.pendingFinalizations.length ||
      finalContext.results.filter((result) => result.type === "delivery.bundle").length !== 1) {
    throw new Error("Fresh project did not survive reopen cleanly.");
  }
  const fixtureDoctor = await inspectPadStudio({
    rootDir,
    deep: true,
    projectId,
    registry,
    store: finalStore,
    minimumFreeBytes: 0
  });
  if (fixtureDoctor.status !== "ready" ||
      fixtureDoctor.projects[0].integrity.failed !== 0 ||
      fixtureDoctor.projects[0].health.status !== "ready") {
    throw new Error("Fresh project deep doctor is not ready.");
  }

  server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const [healthResponse, deliveryResponse] = await Promise.all([
    fetch(origin + "/api/projects/" + projectId + "/observer/health"),
    fetch(origin + "/api/projects/" + projectId + "/observer/delivery")
  ]);
  const health = (await healthResponse.json()).context;
  const deliveryView = (await deliveryResponse.json()).context;
  if (!healthResponse.ok || !deliveryResponse.ok ||
      health.health.status !== "ready" ||
      deliveryView.delivery.bundles[0]?.id !== delivery.result.id) {
    throw new Error("Fresh project health/delivery observer is incomplete.");
  }

  report.checks["fresh-project-e2e"] = {
    status: "passed",
    projectId,
    resourceId: imported.resourceId,
    artifactId: artifact.id,
    renderRunId: rendered.runId,
    renderResultId: renderResult.id,
    recoveryPlan: plan.summary,
    recovery: recovered.summary,
    repeatedRecovery: repeated.status,
    approvalDecisionId: approval.id,
    deliveryRunId: delivery.runId,
    deliveryResultId: delivery.result.id,
    deliverySha256: delivery.result.data.outputSha256,
    health: health.health.status,
    deepIntegrity: fixtureDoctor.projects[0].integrity
  };

  if (server) {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
    server = null;
  }
  const workspaceRoot = resolve(".padstudio/projects");
  server = createPadStudioServer({ reader: new ProjectReader(workspaceRoot) });
  await new Promise((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  await run("browser", "powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/phase5a-observer-browser-smoke.ps1",
    "-ProjectId", "phase3-vd04-asset-pilot",
    "-Url", "http://127.0.0.1:" + server.address().port
  ]);
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  server = null;
  const locks = (await readdir(workspaceRoot, { recursive: true }))
    .filter((path) => path.endsWith(".lock"));
  if (locks.length) throw new Error("Workspace mutation locks remain: " + locks.join(", "));
  report.checks["lock-cleanup"] = { status: "passed", remaining: 0 };
  report.status = "passed_with_documented_limits";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/phase6b-operations-acceptance.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(report.status);
}
