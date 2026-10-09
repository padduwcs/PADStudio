import { ProjectStore } from "../project/project-store.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, runId] = args;
  if (!projectId || !runId || args.length !== 2) {
    throw new Error("Cách dùng: npm run project:run:recover -- <project-id> <run-id>");
  }
  const run = await new ProjectStore(projectRoot).recoverRunFinalization(projectId, runId);
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
