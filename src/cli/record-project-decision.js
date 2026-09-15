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
  const store = new ProjectStore(projectRoot);
  const value = await readJsonInput(decisionSource);
  if (value?.target && value.category === "animation_code_execution" &&
      value.outcome === "approved" && value.decidedBy === "user") {
    throw new Error("Code execution approval cannot be imported from Agent-authored JSON. Run project:approve-code directly in an interactive terminal.");
  }
  if (!value?.target && value.outcome === "accepted") {
    const result = await store.readResult(projectId, value.resultId);
    if (result.type === "video.sequence-render") {
      throw new Error("Final video acceptance cannot be imported from Agent-authored JSON. Run project:accept directly after watching the exact video in full.");
    }
  }
  const decision = await store.recordDecision(projectId, value);
  process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
