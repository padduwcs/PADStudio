import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(args) {
  const [projectId] = args;
  if (!projectId || args.length !== 1) throw new Error("Usage: npm run project:resume -- <project-id>");
  const assembler = new ProjectContextAssembler({
    projectStore: new ProjectStore(join(applicationRoot, ".padstudio", "projects")),
    toolRegistry: createDefaultToolRegistry()
  });
  process.stdout.write(JSON.stringify(await assembler.buildResume(projectId), null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
