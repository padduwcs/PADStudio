import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId] = args;
  if (!projectId || args.length !== 1) {
    throw new Error("Cách dùng: npm run project:context -- <project-id>");
  }
  const context = await new ProjectContextAssembler({
    projectStore: new ProjectStore(projectRoot),
    toolRegistry: createDefaultToolRegistry()
  }).build(projectId);
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
