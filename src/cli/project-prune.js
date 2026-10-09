import { ProjectStore } from "../project/project-store.js";
import { applyProjectPrune, planProjectPrune } from "../operations/project-prune.js";
import { formatBytes } from "../operations/project-storage.js";
import { resolveProjectRoot } from "../config/project-root.js";

const USAGE = "Cách dùng: npm run project:prune -- <project-id> [--run <run-id,...>] [--apply] | --all [--apply]";

function parse(args) {
  const options = { all: false, apply: false, projectId: null, runIds: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--all" && !options.all) options.all = true;
    else if (arg === "--apply" && !options.apply) options.apply = true;
    else if (arg === "--run" && !options.runIds && args[index + 1]) {
      options.runIds = args[index + 1].split(",").map((id) => id.trim()).filter(Boolean);
      index += 1;
    } else if (!arg.startsWith("-") && !options.projectId) options.projectId = arg;
    else throw new Error(USAGE);
  }
  if (options.all === Boolean(options.projectId) || (options.all && options.runIds)) throw new Error(USAGE);
  if (options.runIds && !options.runIds.length) throw new Error(USAGE);
  return options;
}

function brief(result) {
  const bytes = result.mode === "apply" ? result.bytesFreed : result.summary.bytes;
  return { ...result, [result.mode === "apply" ? "freed" : "reclaimable"]: formatBytes(bytes) };
}

async function main(args) {
  const options = parse(args);
  const store = new ProjectStore(resolveProjectRoot());
  const run = (projectId) => options.apply
    ? applyProjectPrune(store, projectId, { runIds: options.runIds })
    : planProjectPrune(store, projectId, { runIds: options.runIds });

  if (!options.all) {
    const result = brief(await run(options.projectId));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (["partial", "integrity_failure"].includes(result.status)) process.exitCode = 2;
    return;
  }

  const rows = [];
  let bytes = 0;
  let worst = 0;
  for (const project of await store.listProjects()) {
    const result = await run(project.id);
    const amount = result.mode === "apply" ? result.bytesFreed : result.summary.bytes;
    bytes += amount;
    if (["partial", "integrity_failure"].includes(result.status)) worst = 2;
    if (amount > 0 || result.status !== "nothing_to_do") {
      rows.push({
        projectId: project.id, status: result.status, [options.apply ? "freed" : "reclaimable"]: formatBytes(amount),
        ...(result.mode === "apply" ? { failedEntries: result.failedEntries, integrity: result.integrity.status } : { runs: result.summary.runs })
      });
    }
  }
  process.stdout.write(JSON.stringify({
    version: "1.0",
    mode: options.apply ? "apply" : "plan",
    projects: rows.length,
    [options.apply ? "freed" : "reclaimable"]: formatBytes(bytes),
    ...(options.apply ? {} : { next: "Thêm --apply để thực sự xóa. Mặc định chỉ lập kế hoạch." }),
    rows
  }, null, 2) + "\n");
  process.exitCode = worst;
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
