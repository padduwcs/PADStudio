import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPadStudioServer } from "../src/web/server.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { resolve } from "node:path";
const exec = promisify(execFile);
const report = { version: "1.0", phase: 4, checkedAt: new Date().toISOString(), status: "incomplete", checks: {}, limits: ["Human listening and aesthetic approval remain pending.", "Animation is preset-based; no general keyframe editor.", "Local fonts can differ between machines.", "Synthetic media tests do not certify arbitrary long or complex productions."] };
const logDir = resolve(".cache/phase4-acceptance"); await mkdir(logDir, { recursive: true });
async function run(name, command, args) {
  try {
    const r = await exec(command, args, { windowsHide: true, encoding: "utf8", maxBuffer: 8e6, timeout: 180000 });
    await writeFile(resolve(logDir, name + ".txt"), r.stdout + r.stderr);
    report.checks[name] = { status: "passed", output: (r.stdout + r.stderr).slice(-900) };
    console.log(name + ": passed");
  } catch (e) {
    await writeFile(resolve(logDir, name + ".txt"), (e.stdout ?? "") + (e.stderr ?? ""));
    report.checks[name] = { status: "failed", error: e.message }; throw e;
  }
}
let server;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);
  const pilot = JSON.parse(await readFile("reports/phase4-pilot.json", "utf8"));
  const reader = new ProjectReader(resolve(".padstudio/projects"));
  const context = await reader.readProject(pilot.projectId);
  if (!context.results.some((r) => r.id === pilot.resultId && r.files.some((f) => f.id === "primary" && f.available))) throw new Error("Pilot result not available.");
  server = createPadStudioServer({ reader });
  await new Promise((ok, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ok); });
  await run("browser", "powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/phase4-observer-browser-smoke.ps1", "-ProjectId", pilot.projectId, "-Url", `http://127.0.0.1:${server.address().port}`]);
  report.pilot = { projectId: pilot.projectId, resultId: pilot.resultId, userApproval: false };
  report.status = "passed_with_documented_limits";
} catch (e) { report.status = "failed"; report.error = e.message; process.exitCode = 1; }
finally {
  if (server) { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); }
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase4-production-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report.status);
}
