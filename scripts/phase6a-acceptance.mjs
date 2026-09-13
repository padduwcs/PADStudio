import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { createAcceptanceDeliveryFixture } from "./lib/acceptance-delivery-fixture.mjs";

const exec = promisify(execFile);
const profileId = "local-portrait-h264-v1";
const logDir = resolve(".cache/phase6a-acceptance");
const report = {
  version: "1.0",
  phase: "6A",
  checkedAt: new Date().toISOString(),
  status: "incomplete",
  checks: {},
  limits: [
    "Delivery is local only; no uploader, publishing platform or cloud worker is included.",
    "The first profile is intentionally pinned to portrait MP4/H.264/AAC 1080x1920 at 30 fps.",
    "Technical decode/loudness checks do not replace human review; export requires an exact stored user acceptance."
  ]
};
await mkdir(logDir, { recursive: true });

async function run(name, command, args) {
  const result = await exec(command, args, {
    windowsHide: true, encoding: "utf8", maxBuffer: 12e6, timeout: 300_000
  });
  await writeFile(resolve(logDir, name + ".txt"), result.stdout + result.stderr);
  report.checks[name] = { status: "passed", output: (result.stdout + result.stderr).slice(-1200) };
}

let server;
let fixtureDirectory;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);

  fixtureDirectory = await mkdtemp(resolve(".cache/phase6a-e2e-"));
  const rootDir = join(fixtureDirectory, "projects");
  const fixture = await createAcceptanceDeliveryFixture({
    rootDir,
    sourcePath: join(fixtureDirectory, "source.mp4"),
    projectId: "phase6a-fresh-project"
  });
  const { projectId } = fixture;
  const sourceResultId = fixture.currentResult.id;
  const store = new ProjectStore(rootDir);
  const before = await store.readContext(projectId);
  let bundle = before.results.filter((result) =>
    result.type === "delivery.bundle" &&
    result.data?.sourceResultId === sourceResultId &&
    result.data?.profileId === profileId &&
    result.verification?.status === "passed"
  ).at(-1);
  if (!bundle) {
    const executed = await new ToolExecutor({
      store,
      registry: createDefaultToolRegistry()
    }).execute(projectId, {
      capability: "video.export-delivery",
      tool: "local-delivery",
      purpose: "Phase 6A acceptance delivery",
      inputs: { resultId: sourceResultId, profileId }
    });
    bundle = executed.result;
  }
  const verified = [];
  for (const file of bundle.files) {
    verified.push(await store.verifyResultFile(projectId, bundle.id, file.id));
  }
  if (bundle.data.sourceSha256 !== bundle.data.outputSha256 ||
      verified.find((file) => file.id === "primary")?.sha256 !== bundle.data.sourceSha256) {
    throw new Error("Delivered video bytes do not match the approved source Result.");
  }
  const checksumsFile = verified.find((file) => file.id === "checksums");
  const checksums = await readFile(checksumsFile.filePath, "utf8");
  for (const file of bundle.files.filter((file) => file.id !== "checksums")) {
    const relative = file.id === "primary" ? "video/output.mp4" : "metadata/" + file.name;
    if (!checksums.includes(file.sha256 + "  " + relative)) {
      throw new Error("Bundle checksum manifest misses " + relative);
    }
  }
  report.checks.delivery = {
    status: "passed",
    projectId,
    sourceResultId,
    resultId: bundle.id,
    runId: bundle.createdByRun,
    profileId,
    files: bundle.files.map(({ id, name, sizeBytes, sha256 }) => ({ id, name, sizeBytes, sha256 })),
    media: bundle.data.media
  };

  server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const [sectionResponse, moduleResponse] = await Promise.all([
    fetch(origin + "/api/projects/" + projectId + "/observer/delivery"),
    fetch(origin + "/delivery-view.js")
  ]);
  const section = (await sectionResponse.json()).context;
  if (!sectionResponse.ok || !moduleResponse.ok ||
      !section.delivery.bundles.some((candidate) => candidate.id === bundle.id)) {
    throw new Error("Observer delivery section does not expose the accepted bundle.");
  }
  report.checks.observer = {
    status: "passed",
    view: section.view,
    generation: section.generation,
    bundleCount: section.delivery.bundles.length
  };
  await run("browser", "powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/phase5a-observer-browser-smoke.ps1",
    "-ProjectId", projectId,
    "-SequenceKey", "acceptance-preview",
    "-TechnicalFixture",
    "-VisualBaseline", "scripts/browser-baselines/acceptance-fixture.json",
    ...(process.env.PADSTUDIO_UPDATE_ACCEPTANCE_BASELINE === "1" ? ["-UpdateVisualBaseline"] : []),
    "-Url", origin
  ]);

  const locks = (await readdir(rootDir, { recursive: true })).filter((path) => path.endsWith(".lock"));
  if (locks.length) throw new Error("Mutation locks remain: " + locks.join(", "));
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
  await writeFile("reports/phase6a-delivery-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report.status);
}
