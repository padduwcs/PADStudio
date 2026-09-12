import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverProject } from "../operations/project-recovery.js";
import { ProjectStore } from "../project/project-store.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");
const args = process.argv.slice(2);
const projectIds = args.filter((arg) => !arg.startsWith("-"));
const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--apply");
if (projectIds.length !== 1 || unknown.length) {
  process.stderr.write("Cách dùng: npm run project:recover -- <project-id> [--apply]\n");
  process.exitCode = 1;
} else {
  try {
    const result = await recoverProject(
      new ProjectStore(projectRoot),
      projectIds[0],
      { apply: args.includes("--apply") }
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.status === "partial" ? 2 : 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      version: "1.0", status: "failed", error: error.message
    }) + "\n");
    process.exitCode = 1;
  }
}
