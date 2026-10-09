import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || !source || args.length !== 2) throw new Error("Usage: <json> | npm run tool:authorize -- <project-id> -");
  const value = await readJsonInput(source);
  const executor = new ToolExecutor({ store: new ProjectStore(projectRoot), registry: createDefaultToolRegistry() });
  process.stdout.write(JSON.stringify(await executor.authorize(projectId, value.request, value.approval), null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
