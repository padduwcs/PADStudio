import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveProject, listArchivedProjects, restoreProject } from "../project/project-archive.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const activeRoot = join(applicationRoot, ".padstudio", "projects");
const archiveRoot = join(applicationRoot, ".padstudio", "archive", "projects");

async function main(args) {
  const [action, projectId, ...rest] = args;
  if (action === "list" && args.length === 1) {
    process.stdout.write(JSON.stringify(await listArchivedProjects({ archiveRoot }), null, 2) + "\n");
    return;
  }
  if (action === "archive" && projectId && rest.at(-1) === "--confirm-stopped") {
    const reason = rest.slice(0, -1).join(" ");
    process.stdout.write(JSON.stringify(await archiveProject({ activeRoot, archiveRoot, projectId, reason, confirmedStopped: true }), null, 2) + "\n");
    return;
  }
  if (action === "restore" && projectId && rest.length === 1 && rest[0] === "--confirm-stopped") {
    process.stdout.write(JSON.stringify(await restoreProject({ activeRoot, archiveRoot, projectId, confirmedStopped: true }), null, 2) + "\n");
    return;
  }
  throw new Error("Usage: npm run project:archive -- list | archive <project-id> <reason> --confirm-stopped | restore <project-id> --confirm-stopped");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
