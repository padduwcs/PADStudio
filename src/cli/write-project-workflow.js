import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = join(applicationRoot, ".padstudio", "projects");

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || !source || args.length !== 2) {
    throw new Error("Usage: <workflow-json> | npm run project:workflow -- <project-id> - or <file-json>");
  }
  const workflow = await new ProjectStore(projectRoot).writeWorkflow(projectId, await readJsonInput(source));
  process.stdout.write(JSON.stringify(workflow, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
