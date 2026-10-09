import { ProjectStore } from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { resolveProjectRoot } from "../config/project-root.js";


async function main(args) {
  const [projectId] = args;
  if (!projectId || args.length !== 1) throw new Error("Usage: npm run project:resume -- <project-id>");
  const assembler = new ProjectContextAssembler({
    projectStore: new ProjectStore(resolveProjectRoot()),
    toolRegistry: createDefaultToolRegistry()
  });
  process.stdout.write(JSON.stringify(await assembler.buildResume(projectId), null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
