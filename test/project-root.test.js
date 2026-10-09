import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ARCHIVE_ROOT_ENV,
  PROJECT_ROOT_ENV,
  ProjectRootConfigError,
  resolveArchiveRoot,
  resolveProjectRoot
} from "../src/config/project-root.js";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRoot = join(repository, ".padstudio", "projects");

test("the project root defaults to .padstudio/projects beside the source", () => {
  assert.equal(resolveProjectRoot({ env: {} }), defaultRoot);
  assert.equal(resolveArchiveRoot({ env: {} }), join(repository, ".padstudio", "archive", "projects"));
});

test("PADSTUDIO_PROJECT_ROOT overrides the root and moves the archive beside it", () => {
  const root = join(tmpdir(), "padstudio-root-check", "projects");
  const env = { [PROJECT_ROOT_ENV]: `  ${root}  ` };
  assert.equal(resolveProjectRoot({ env }), resolve(root));
  assert.equal(resolveArchiveRoot({ env }), join(dirname(resolve(root)), "archive", "projects"));
  assert.equal(
    resolveArchiveRoot({ env: { ...env, [ARCHIVE_ROOT_ENV]: join(tmpdir(), "elsewhere") } }),
    join(tmpdir(), "elsewhere")
  );
});

test("a relative override is resolved against the working directory", () => {
  assert.equal(resolveProjectRoot({ env: { [PROJECT_ROOT_ENV]: "data/projects" } }), resolve(process.cwd(), "data/projects"));
});

test("an empty override is rejected instead of silently using the default", () => {
  assert.throws(() => resolveProjectRoot({ env: { [PROJECT_ROOT_ENV]: "   " } }), ProjectRootConfigError);
  assert.throws(() => resolveArchiveRoot({ env: { [ARCHIVE_ROOT_ENV]: "" }, projectRoot: defaultRoot }), ProjectRootConfigError);
});

async function cli(env, script, ...args) {
  const { stdout } = await exec(process.execPath, [join(repository, "src", "cli", script), ...args], {
    cwd: repository,
    env: { ...process.env, ...env },
    windowsHide: true
  });
  return stdout;
}

test("CLI commands read and write the configured root, never the default one", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-root-"));
  try {
    const env = { [PROJECT_ROOT_ENV]: join(workspace, "projects") };
    await cli(env, "create-project.js", "root-check", "Kiểm tra gốc dữ liệu");

    const stored = JSON.parse(await readFile(join(workspace, "projects", "root-check", "project.json"), "utf8"));
    assert.equal(stored.id, "root-check");
    await assert.rejects(stat(join(defaultRoot, "root-check")), { code: "ENOENT" });

    const resume = JSON.parse(await cli(env, "read-project-resume.js", "root-check"));
    assert.equal(resume.project.id, "root-check");

    const archived = JSON.parse(await cli(
      env, "project-archive.js", "archive", "root-check", "kiểm tra gốc", "--confirm-stopped"
    ));
    assert.equal(archived.state, "archived");
    await stat(join(workspace, "archive", "projects", "root-check", "archive.json"));
    await assert.rejects(stat(join(workspace, "projects", "root-check")), { code: "ENOENT" });

    const listed = JSON.parse(await cli(env, "project-archive.js", "list"));
    assert.deepEqual(listed.map((entry) => entry.project.id), ["root-check"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

test("the observer server lists projects from the configured root", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-root-server-"));
  const env = { [PROJECT_ROOT_ENV]: join(workspace, "projects") };
  await cli(env, "create-project.js", "served-project", "Dự án phục vụ");
  const port = await freePort();
  const server = spawn(process.execPath, [join(repository, "src", "web", "server.js")], {
    cwd: repository,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: "ignore",
    windowsHide: true
  });
  try {
    let body = null;
    for (let attempt = 0; attempt < 50 && !body; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/projects`);
        if (response.ok) body = await response.json();
      } catch {
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    assert.ok(body, "observer did not start");
    assert.deepEqual(body.projects.map((project) => project.id), ["served-project"]);
  } finally {
    server.kill();
    await new Promise((done) => server.once("exit", done));
    await rm(workspace, { recursive: true, force: true });
  }
});
