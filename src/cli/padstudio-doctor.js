import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPadStudio } from "../operations/system-doctor.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");
const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--deep");
if (unknown.length || args.filter((arg) => !arg.startsWith("-")).length > 1) {
  process.stderr.write("Cách dùng: npm run padstudio:doctor -- [--deep] [project-id]\n");
  process.exitCode = 1;
} else {
  try {
    const projectId = args.find((arg) => !arg.startsWith("-")) ?? null;
    const result = await inspectPadStudio({
      rootDir: projectRoot,
      deep: args.includes("--deep"),
      projectId
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.status === "blocked" ? 2 : 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      version: "1.0", status: "failed", error: error.message
    }) + "\n");
    process.exitCode = 1;
  }
}
