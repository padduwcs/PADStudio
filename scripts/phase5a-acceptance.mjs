import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { locatePilotFixture } from "./lib/pilot-fixture.mjs";

const exec = promisify(execFile);
const report = {
  version: "1.0",
  phase: "5A",
  checkedAt: new Date().toISOString(),
  status: "incomplete",
  checks: {},
  limits: [
    "The web workspace remains read-only; feedback is copied into the Agent chat.",
    "Generation detection scans durable project metadata; it is polling, not push notification.",
    "Detail sections are loaded on demand but share one server-side context snapshot per generation.",
  ],
};
const logDir = resolve(".cache/phase5a-acceptance");
await mkdir(logDir, { recursive: true });

async function run(name, command, args) {
  try {
    const result = await exec(command, args, {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8e6,
      timeout: 180_000,
    });
    await writeFile(resolve(logDir, `${name}.txt`), result.stdout + result.stderr);
    report.checks[name] = { status: "passed", output: (result.stdout + result.stderr).slice(-900) };
    console.log(`${name}: passed`);
  } catch (error) {
    await writeFile(resolve(logDir, `${name}.txt`), (error.stdout ?? "") + (error.stderr ?? ""));
    report.checks[name] = { status: "failed", error: error.message };
    throw error;
  }
}

async function measuredJson(origin, path, etag = null) {
  const response = await fetch(origin + path, {
    headers: etag ? { "If-None-Match": etag } : {},
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    etag: response.headers.get("etag"),
    bytes: bytes.byteLength,
    body: bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : null,
  };
}

let server;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);
  const pilot = JSON.parse(await readFile("reports/phase4-pilot.json", "utf8"));
  const fixture = await locatePilotFixture(pilot.projectId);
  const reader = new ProjectReader(fixture.root);
  server = createPadStudioServer({ reader });
  await new Promise((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const projectPath = `/api/projects/${encodeURIComponent(pilot.projectId)}`;
  const [list, summary, production, full] = await Promise.all([
    measuredJson(origin, "/api/projects"),
    measuredJson(origin, `${projectPath}/observer/summary`),
    measuredJson(origin, `${projectPath}/observer/production`),
    measuredJson(origin, projectPath),
  ]);
  const [list304, summary304, production304] = await Promise.all([
    measuredJson(origin, "/api/projects", list.etag),
    measuredJson(origin, `${projectPath}/observer/summary`, summary.etag),
    measuredJson(origin, `${projectPath}/observer/production`, production.etag),
  ]);
  const failures = [
    [list.status === 200 && list.body.projects.some(({ id }) => id === pilot.projectId), "Pilot is absent from observer list."],
    [summary.status === 200 && summary.body.context.view === "observer-summary", "Summary snapshot contract failed."],
    [production.status === 200 && production.body.context.view === "observer-production", "Production snapshot contract failed."],
    [summary.bytes <= 32_768, `Summary payload exceeds 32 KiB (${summary.bytes} bytes).`],
    [summary.bytes < full.bytes, "Summary is not smaller than the legacy full context."],
    [production.bytes < full.bytes, "Production section is not smaller than the legacy full context."],
    [[list304, summary304, production304].every(({ status, bytes }) => status === 304 && bytes === 0), "Conditional requests did not return empty 304 responses."],
  ].filter(([passed]) => !passed).map(([, message]) => message);
  if (failures.length) throw new Error(failures.join(" "));
  report.checks["snapshot-budget"] = {
    status: "passed",
    bytes: { projectList: list.bytes, summary: summary.bytes, production: production.bytes, legacyFull: full.bytes },
    unchangedResponses: { projectList: list304.status, summary: summary304.status, production: production304.status },
  };
  await run("browser", process.execPath, ["scripts/ui-smoke.mjs", "--project", pilot.projectId, "--url", origin]);
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
  await writeFile("reports/phase5a-observer-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report.status);
}
