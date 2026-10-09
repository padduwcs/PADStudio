import { ProjectStore } from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, option, view] = args;
  if (!projectId || ![1, 3].includes(args.length) || (args.length === 3 && (option !== "--view" || !["summary", "resume"].includes(view)))) {
    throw new Error("Usage: npm run project:context -- <project-id> [--view summary|resume]");
  }
  const assembler = new ProjectContextAssembler({
    projectStore: new ProjectStore(projectRoot),
    toolRegistry: createDefaultToolRegistry()
  });
  const context = view === "summary" ? await assembler.buildSummary(projectId)
    : view === "resume" ? await assembler.buildResume(projectId)
      : await assembler.build(projectId);
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
