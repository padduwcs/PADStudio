import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, requestSource] = args;
  if (!projectId || !requestSource || args.length !== 2) {
    throw new Error(
      "Cách dùng: <request-json> | npm run tool:run -- <project-id> - hoặc <file-request-json>"
    );
  }
  const request = await readJsonInput(requestSource);
  const executor = new ToolExecutor({
    store: new ProjectStore(projectRoot),
    registry: createDefaultToolRegistry()
  });
  const result = await executor.execute(projectId, request);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
