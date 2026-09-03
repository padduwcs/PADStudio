import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, requestPath] = args;
  if (!projectId || !requestPath || args.length !== 2) {
    throw new Error("Cách dùng: npm run tool:run -- <project-id> <file-request-json>");
  }
  const requestText = await readFile(resolve(requestPath), "utf8");
  const request = JSON.parse(requestText.replace(/^\uFEFF/, ""));
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
