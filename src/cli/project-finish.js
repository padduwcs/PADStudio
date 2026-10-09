import { ProjectStore } from "../project/project-store.js";
import { applyProjectFinish, planProjectFinish, ProjectFinishError } from "../operations/project-finish.js";
import { formatBytes } from "../operations/project-storage.js";
import { resolveProjectRoot } from "../config/project-root.js";

const USAGE = "Cách dùng: npm run project:finish -- <project-id> [--apply] | --all [--apply]";

function parse(args) {
  const options = { all: false, apply: false, projectId: null };
  for (const arg of args) {
    if (arg === "--all" && !options.all) options.all = true;
    else if (arg === "--apply" && !options.apply) options.apply = true;
    else if (!arg.startsWith("-") && !options.projectId) options.projectId = arg;
    else throw new Error(USAGE);
  }
  if (options.all === Boolean(options.projectId)) throw new Error(USAGE);
  return options;
}

function brief(result) {
  if (result.mode === "apply") return { ...result, freed: formatBytes(result.bytesFreed) };
  if (result.status === "not_finishable") return result;
  const { files: _files, ...rest } = result;
  return { ...rest, release: { ...result.release, size: formatBytes(result.release.bytes) },
    keep: { ...result.keep, assets: result.keep.assets.length, size: formatBytes(result.keep.bytes) } };
}

async function runOne(store, projectId, apply) {
  if (!apply) return planProjectFinish(store, projectId);
  try {
    return await applyProjectFinish(store, projectId);
  } catch (error) {
    if (error instanceof ProjectFinishError) return { mode: "apply", projectId, status: "not_finishable", reason: error.code, message: error.message };
    throw error;
  }
}

async function main(args) {
  const options = parse(args);
  const store = new ProjectStore(resolveProjectRoot());
  if (!options.all) {
    const result = brief(await runOne(store, options.projectId, options.apply));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.status === "not_finishable" || ["partial", "integrity_failure"].includes(result.status)) process.exitCode = 2;
    return;
  }
  const rows = [];
  let bytes = 0;
  let worst = 0;
  for (const project of await store.listProjects()) {
    const result = await runOne(store, project.id, options.apply);
    if (["partial", "integrity_failure"].includes(result.status)) worst = 2;
    if (result.status === "not_finishable") {
      rows.push({ projectId: project.id, status: result.status, reason: result.reason });
      continue;
    }
    const amount = options.apply ? result.bytesFreed : result.release.bytes;
    bytes += amount;
    rows.push({ projectId: project.id, status: result.status, [options.apply ? "freed" : "release"]: formatBytes(amount) });
  }
  process.stdout.write(JSON.stringify({
    version: "1.0",
    mode: options.apply ? "apply" : "plan",
    [options.apply ? "freed" : "release"]: formatBytes(bytes),
    ...(options.apply ? {} : { next: "Thêm --apply để thực sự dọn. Mặc định chỉ lập kế hoạch." }),
    rows
  }, null, 2) + "\n");
  process.exitCode = worst;
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
