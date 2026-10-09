import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { locatePilotFixture } from "./lib/pilot-fixture.mjs";

const exec = promisify(execFile);
const logDir = resolve(".cache/phase5b-acceptance");
const report = {
  version: "1.0",
  phase: "5B",
  checkedAt: new Date().toISOString(),
  status: "incomplete",
  checks: {},
  limits: [
    "The observer remains read-only; the Agent records feedback received in chat.",
    "Legacy Result decisions remain readable without feedbackTarget; every new video sequence decision requires one.",
    "Feedback resolution is explicit through resolvesDecisionIds and is never inferred from a newer render."
  ]
};
await mkdir(logDir, { recursive: true });

async function run(name, command, args) {
  try {
    const result = await exec(command, args, {
      windowsHide: true, encoding: "utf8", maxBuffer: 8e6, timeout: 240_000
    });
    await writeFile(resolve(logDir, `${name}.txt`), result.stdout + result.stderr);
    report.checks[name] = { status: "passed", output: (result.stdout + result.stderr).slice(-1000) };
    console.log(`${name}: passed`);
  } catch (error) {
    await writeFile(resolve(logDir, `${name}.txt`), (error.stdout ?? "") + (error.stderr ?? ""));
    report.checks[name] = { status: "failed", error: error.message };
    throw error;
  }
}

let server;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);

  const pilot = JSON.parse(await readFile("reports/phase4-pilot.json", "utf8"));
  const rootDir = (await locatePilotFixture(pilot.projectId)).root;
  const assembler = new ProjectContextAssembler({
    projectStore: new ProjectStore(rootDir),
    toolRegistry: createDefaultToolRegistry()
  });
  const [summary, full] = await Promise.all([
    assembler.buildSummary(pilot.projectId), assembler.build(pilot.projectId)
  ]);
  const summaryBytes = Buffer.byteLength(JSON.stringify(summary));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  if (summaryBytes > 32_768) throw new Error(`Agent summary exceeds 32 KiB: ${summaryBytes} bytes.`);
  if (summaryBytes >= fullBytes) throw new Error("Agent summary is not smaller than full context.");
  if (!Array.isArray(summary.pendingFeedback) || !Array.isArray(summary.resumeView.pendingFeedbackIds)) {
    throw new Error("Agent summary does not expose pending feedback.");
  }
  report.checks["agent-summary"] = {
    status: "passed", bytes: summaryBytes, fullContextBytes: fullBytes,
    pendingFeedbackCount: summary.pendingFeedback.length
  };

  const lockFiles = (await readdir(rootDir, { recursive: true }))
    .filter((path) => path.endsWith(".lock"));
  if (lockFiles.length) throw new Error("Mutation locks remain after tests: " + lockFiles.join(", "));
  report.checks["lock-cleanup"] = { status: "passed", remaining: 0 };

  server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  await run("browser", process.execPath, ["scripts/ui-smoke.mjs", "--project", pilot.projectId, "--url", `http://127.0.0.1:${server.address().port}`]);
  report.pilot = { projectId: pilot.projectId, artifactId: pilot.artifactId, resultId: pilot.resultId };
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
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase5b-feedback-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report.status);
}
