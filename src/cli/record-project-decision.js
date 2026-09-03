import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, decisionSource] = args;
  if (!projectId || !decisionSource || args.length !== 2) {
    throw new Error(
      "Cách dùng: <decision-json> | npm run project:decide -- <project-id> - hoặc <file-json>"
    );
  }
  const decision = await new ProjectStore(projectRoot).recordDecision(
    projectId,
    await readJsonInput(decisionSource)
  );
  process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
