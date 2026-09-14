import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readJson, writeJsonAtomic } from "./atomic-files.js";
import { projectDirectory, validateProjectId } from "./project-paths.js";
import { ProjectStore } from "./project-store.js";

export class ProjectArchiveError extends Error {
  constructor(message, code = "project_archive_failed") { super(message); this.name = "ProjectArchiveError"; this.code = code; }
}

function requiredText(value, label, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new ProjectArchiveError(`${label} must contain 1-${maximum} characters.`, "invalid_input");
  return value.trim();
}

function canonicalNow(now) {
  const value = now();
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new ProjectArchiveError("Archive timestamp must be canonical ISO.", "invalid_input");
  return value;
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function missing(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error?.code === "ENOENT") return true; throw error; }
}

async function safeProjectDirectory(root, projectId, label) {
  const path = projectDirectory(root, projectId);
  const [actual, info] = await Promise.all([realpath(path), lstat(path)]);
  const expected = resolve(path);
  const samePath = process.platform === "win32"
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
  if (!samePath || !info.isDirectory() || info.isSymbolicLink()) throw new ProjectArchiveError(`${label} must be a real project directory.`, "unsafe_project_directory");
  return path;
}

async function roots(activeRoot, archiveRoot) {
  const active = resolve(activeRoot), archive = resolve(archiveRoot);
  if (active === archive || inside(active, archive) || inside(archive, active)) throw new ProjectArchiveError("Active and archive roots must be separate sibling trees.", "invalid_roots");
  await mkdir(archive, { recursive: true });
  return { active: await realpath(active), archive: await realpath(archive) };
}

function assertConfirmed(value) {
  if (value !== true) throw new ProjectArchiveError("Confirm that PADStudio and other Agents are stopped before moving a project.", "confirmation_required");
}

export async function archiveProject({ activeRoot, archiveRoot, projectId, reason, confirmedStopped = false, now = () => new Date().toISOString() }) {
  validateProjectId(projectId); assertConfirmed(confirmedStopped);
  const resolved = await roots(activeRoot, archiveRoot);
  const store = new ProjectStore(resolved.active);
  const project = await store.readProject(projectId);
  const running = (await store.readRuns(projectId)).filter((run) => run.status === "in_progress");
  if (running.length) throw new ProjectArchiveError(`Project has ${running.length} in-progress Run(s).`, "project_busy");
  const source = await safeProjectDirectory(resolved.active, projectId, "Active project");
  const target = projectDirectory(resolved.archive, projectId);
  if (!(await missing(target))) throw new ProjectArchiveError(`Archived project already exists: ${projectId}.`, "archive_exists");
  const record = { version: "1.0", state: "archived", projectId, title: project.title, archivedAt: canonicalNow(now), reason: requiredText(reason, "reason") };
  await rename(source, target);
  try { await writeJsonAtomic(join(projectDirectory(resolved.archive, projectId), "archive.json"), record); }
  catch (error) { await rename(target, source); throw error; }
  return record;
}

export async function restoreProject({ activeRoot, archiveRoot, projectId, confirmedStopped = false, now = () => new Date().toISOString() }) {
  validateProjectId(projectId); assertConfirmed(confirmedStopped);
  const resolved = await roots(activeRoot, archiveRoot);
  const archiveStore = new ProjectStore(resolved.archive);
  const project = await archiveStore.readProject(projectId);
  const source = await safeProjectDirectory(resolved.archive, projectId, "Archived project");
  const target = projectDirectory(resolved.active, projectId);
  if (!(await missing(target))) throw new ProjectArchiveError(`Active project already exists: ${projectId}.`, "active_exists");
  const previous = await readJson(join(projectDirectory(resolved.archive, projectId), "archive.json"));
  if (previous?.version !== "1.0" || previous?.projectId !== projectId) throw new ProjectArchiveError("Archive manifest does not match the project.", "invalid_archive_manifest");
  const record = { ...previous, state: "restored", restoredAt: canonicalNow(now), title: project.title };
  await rename(source, target);
  try { await writeJsonAtomic(join(projectDirectory(resolved.active, projectId), "archive.json"), record); }
  catch (error) { await rename(target, source); throw error; }
  return record;
}

export async function listArchivedProjects({ archiveRoot }) {
  const root = resolve(archiveRoot);
  await mkdir(root, { recursive: true });
  const store = new ProjectStore(root);
  const projects = await store.listProjects();
  return Promise.all(projects.map(async (project) => ({
    project,
    archive: await readJson(join(projectDirectory(root, project.id), "archive.json"))
  })));
}
