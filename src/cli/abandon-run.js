import { join } from "node:path";
import { ProjectStore } from "../project/project-store.js";
import { resolveProjectRoot } from "../config/project-root.js";

const root = resolveProjectRoot();

async function main(args) {
  const confirmed = args.at(-1) === "--confirm-stopped";
  const values = confirmed ? args.slice(0, -1) : args;
  const [projectId, runId, ...reasonParts] = values;
  if (!projectId || !runId || !reasonParts.length || !confirmed) {
    throw new Error("Usage: npm run project:run:abandon -- <project-id> <run-id> <reason> --confirm-stopped");
  }
  const run = await new ProjectStore(root).abandonRun(projectId, runId, {
    reason: reasonParts.join(" "),
    confirmStopped: true
  });
  process.stdout.write(JSON.stringify(run, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
