import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

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
    throw new Error("animation_code_execution is a retired decision category; code animation now runs through managed validation and preflight without a user code-approval decision.");
  }
  if (!value?.target && value.outcome === "accepted") {
    const result = await store.readResult(projectId, value.resultId);
    if (result.type === "video.sequence-render") {
      throw new Error("Final video acceptance cannot be imported from generic JSON. Record the user's exact-result approval with project:accept, using --from-agent-host when the user approved in chat.");
    }
  }
  const decision = await store.recordDecision(projectId, value);
  process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
