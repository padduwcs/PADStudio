import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "../project/atomic-files.js";
import { ProjectStore } from "../project/project-store.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, checkpointPath] = args;
  if (!projectId || !checkpointPath || args.length !== 2) {
    throw new Error("Cách dùng: npm run project:checkpoint -- <project-id> <file-json>");
  }
  const checkpoint = await new ProjectStore(projectRoot).writeCheckpoint(
    projectId,
    await readJson(resolve(checkpointPath))
  );
  process.stdout.write(`${JSON.stringify(checkpoint)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
