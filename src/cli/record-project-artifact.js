import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || !source || args.length !== 2) {
    throw new Error("Usage: <artifact-json> | npm run project:artifact -- <project-id> - or <file-json>");
  }
  const artifact = await new ProjectStore(projectRoot).recordArtifact(projectId, await readJsonInput(source));
  process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
