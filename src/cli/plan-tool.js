import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, requestSource] = args;
  if (!projectId || !requestSource || args.length !== 2) throw new Error("Usage: <request-json> | npm run tool:plan -- <project-id> -");
  const executor = new ToolExecutor({ store: new ProjectStore(projectRoot), registry: createDefaultToolRegistry() });
  process.stdout.write(JSON.stringify(await executor.plan(projectId, await readJsonInput(requestSource)), null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
