import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectReader } from "../src/web/project-reader.js";
import { buildCreativeObserverModel } from "../ui/creative-direction-view.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureLimit = 24 * 1024 * 1024;

function argumentsFrom(argv) {
  const options = { projectId: "phase2-brute-force-pilot", reportPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--project") options.projectId = argv[++index];
    else if (argv[index] === "--report") options.reportPath = argv[++index];
    else throw new Error(`Tham số không được hỗ trợ: ${argv[index]}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.projectId ?? "")) {
    throw new Error("--project phải là project id hợp lệ.");
  }
  return options;
}

function run(command, args, { env = process.env } = {}) {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const append = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > captureLimit) {
        child.kill();
        reject(new Error("Output tiến trình vượt giới hạn acceptance."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun({
      code, signal, durationMs: Date.now() - started,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
}

function requireSuccess(label, result) {
  if (result.code === 0) return result;
  throw new Error(`${label} thất bại (exit ${result.code}):\n${(result.stderr || result.stdout).slice(-4000)}`);
}

function parseJson(label, text) {
  try {
    return JSON.parse(text.trim());
  } catch (error) {
    throw new Error(`${label} không trả JSON hợp lệ: ${error.message}`);
  }
}

function testNames(tap) {
  return [...tap.matchAll(/^\s*ok\s+\d+\s+-\s+(.+)$/gm)].map((match) => match[1].trim());
}

function tapCount(tap, label) {
  return Number(tap.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? 0);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Observer dừng sớm với exit ${child.exitCode}.`);
    try {
      if ((await fetch(`${url}/api/projects`)).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Observer không sẵn sàng trong 15 giây.");
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function browserAcceptance(projectId) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["src/web/server.js"], {
    cwd: root, env: { ...process.env, PORT: String(port) },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString("utf8"); });
  try {
    await waitForServer(url, server);
    const result = requireSuccess("creative browser acceptance", await run("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/source-observer-browser-smoke.ps1",
      "-Url", url, "-ProjectId", projectId, "-Creative"
    ]));
    return { durationMs: result.durationMs, ...parseJson("creative browser acceptance", result.stdout) };
  } catch (error) {
    if (serverError.trim()) error.message += `\nObserver stderr:\n${serverError.trim()}`;
    throw error;
  } finally {
    await stop(server);
  }
}

function reportPath(path) {
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (isAbsolute(relation) || relation.startsWith("..")) throw new Error("Từ chối ghi report ngoài repository.");
  return target;
}

const acceptanceMatrix = [
  {
    id: "project-reopen",
    label: "Project state survives reopening",
    tests: [
      "project identity and checkpoint survive reopening without temporary files",
      "context assembler joins durable intelligence, resume state, and real capabilities"
    ]
  },
  {
    id: "creative-provenance",
    label: "Brief, proposal, direction and approvals have exact provenance",
    tests: [
      "creative artifact contracts reject ambiguous or incomplete content",
      "brief, proposal and chosen direction keep exact provenance and revisions",
      "creative provenance rejects missing, mismatched, or unknown basis",
      "a source-backed direction reopens at the explicit approval boundary"
    ]
  },
  {
    id: "sample-review-reuse",
    label: "Sample rendering, review and selective reuse remain durable",
    tests: [
      "local production renders, reuses unchanged segments, preserves reviews and fails without output on invalid sources",
      "dependency impact propagates without deleting historical approvals or selecting new work"
    ]
  },
  {
    id: "failure-recovery",
    label: "Interrupted finalization can be recovered without rendering twice",
    tests: [
      "an executor finalization failure preserves sequence media and is recoverable without rendering twice",
      "executor preserves a durable output when run finalization fails and supports recovery"
    ]
  },
  {
    id: "observer",
    label: "Read-only observer exposes the full creative chain",
    tests: [
      "creative observer maps brief, proposal, direction, sample and exact approval",
      "creative observer keeps superseded revisions and reports stale dependencies",
      "creative observer degrades gracefully without creative artifacts",
      "observer serves the creative direction module as JavaScript",
      "web server exposes no project mutation or chat endpoint"
    ]
  }
];

function requireCreativeEvidence(model) {
  const required = ["brief", "proposal", "direction", "selectedOption", "sequence", "render", "approval", "renderReview"];
  const missing = required.filter((field) => !model[field]);
  if (missing.length) throw new Error("Pilot is missing creative evidence: " + missing.join(", "));
  if (model.pendingApprovals.length) {
    throw new Error("Pilot still has pending approvals: " + model.pendingApprovals.map((item) => item.id).join(", "));
  }
  const exactReference = model.approval.binding?.outputReferences?.some(
    (reference) => reference.kind === "result" && reference.id === model.render.resultId
  );
  if (!exactReference) throw new Error("The active approval is not bound to the displayed render.");
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const tests = requireSuccess("repository test suite", await run(process.execPath, [
    "--test", "--test-reporter=tap"
  ]));
  const passedNames = new Set(testNames(tests.stdout));
  const matrix = acceptanceMatrix.map((entry) => {
    const missingTests = entry.tests.filter((name) => !passedNames.has(name));
    return { ...entry, status: missingTests.length ? "failed" : "passed", missingTests };
  });
  const failedMatrix = matrix.filter((entry) => entry.status !== "passed");
  if (failedMatrix.length) {
    throw new Error("Acceptance matrix is incomplete: " + failedMatrix.map((entry) => entry.id).join(", "));
  }

  const doctorRun = requireSuccess("analysis doctor", await run(process.execPath, [
    "src/cli/analysis-doctor.js"
  ]));
  const doctor = parseJson("analysis doctor", doctorRun.stdout);
  if (doctor.status !== "ready") throw new Error("Analysis doctor status is " + doctor.status + ".");

  const verifyRun = requireSuccess("analysis verification", await run(process.execPath, [
    "src/cli/verify-analysis.js", options.projectId
  ]));
  const verification = parseJson("analysis verification", verifyRun.stdout);
  const resultStatuses = Object.values(verification.results ?? {}).map((item) => item.status);
  const staleResults = resultStatuses.filter((status) => status !== "verified_current").length;
  if (!resultStatuses.length || staleResults) {
    throw new Error("Source verification has " + staleResults + " stale result(s).");
  }

  const context = await new ProjectReader(resolve(root, ".padstudio", "projects"))
    .readProject(options.projectId);
  const model = buildCreativeObserverModel(context);
  requireCreativeEvidence(model);
  if (context.resumeView?.activeWorkflowId) throw new Error("Pilot still has an active workflow.");

  const browser = await browserAcceptance(options.projectId);
  const report = {
    version: "1.0",
    phase: 2,
    package: "E",
    status: "passed_with_documented_limits",
    scope: "practical_owner_machine",
    startedAt,
    completedAt: new Date().toISOString(),
    projectId: options.projectId,
    automatedVerification: {
      repositoryTests: {
        status: "passed",
        tests: tapCount(tests.stdout, "tests"),
        passed: tapCount(tests.stdout, "pass"),
        failed: tapCount(tests.stdout, "fail"),
        durationMs: tests.durationMs
      },
      analysisDoctor: {
        status: doctor.status,
        practicalDefault: doctor.practicalDefault,
        releaseDefault: doctor.releaseDefault,
        durationMs: doctorRun.durationMs
      },
      analysisVerification: {
        status: "passed",
        resultCount: resultStatuses.length,
        staleResults,
        searchRows: verification.searchIndex?.rowCount ?? 0,
        durationMs: verifyRun.durationMs
      },
      browser
    },
    evidence: {
      briefArtifactId: model.brief.id,
      proposalArtifactId: model.proposal.id,
      directionArtifactId: model.direction.id,
      selectedOptionId: model.selectedOption.id,
      sequenceArtifactId: model.sequence.artifactId,
      sequenceRevision: model.sequence.revision,
      renderResultId: model.render.resultId,
      reviewId: model.renderReview.id,
      approvalDecisionId: model.approval.id,
      reusedSegments: model.render.reusedSegmentIds?.length ?? 0,
      totalSegments: model.sequence.segments?.length ?? 0,
      pendingApprovals: model.pendingApprovals.length,
      trace: model.trace
    },
    acceptanceMatrix: matrix,
    limits: [
      "Acceptance covers one representative local pilot, not every future project shape.",
      "Approval applies only to the exact approved render and is never inherited by a newer render.",
      "Creative listening remains a user playback responsibility in the current Agent host.",
      "No paid provider or external service was used.",
      "Phase 1 releaseDefault remains unset and is not silently promoted."
    ]
  };

  if (options.reportPath) {
    const target = reportPath(options.reportPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    version: "1.0", status: "failed", error: error?.message || String(error)
  }, null, 2) + "\n");
  process.exitCode = 1;
});
