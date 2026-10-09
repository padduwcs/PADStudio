import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

const exec = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), "padstudio-ui-empty-"));
const rootDir = join(workspace, "projects");
await mkdir(rootDir);
const store = new ProjectStore(rootDir);
const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function check(name, projectId = null) {
  const args = ["scripts/ui-smoke.mjs", "--url", origin, "--empty", "--shots", resolve(".cache/ui-focus-review", name)];
  if (projectId) args.push("--project", projectId);
  const { stdout } = await exec(process.execPath, args, { windowsHide: true, encoding: "utf8", timeout: 180_000, maxBuffer: 2e6 });
  const report = JSON.parse(stdout);
  if (report.status !== "passed" || report.writeRequests) throw new Error(`${name}: incorrect empty presentation`);
  console.log(`${name}: passed (${report.views} responsive views${projectId ? ", tabs, library, theme, offline recovery" : ", welcome screen"})`);
}

try {
  await check("empty-library");
  await store.createProject({ projectId: "empty-project", title: "Một câu chuyện mới" });
  await check("empty-project", "empty-project");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-ui-empty-")) {
    throw new Error("Refusing to remove a fixture outside its temporary directory.");
  }
  await rm(target, { recursive: true, force: true });
}
