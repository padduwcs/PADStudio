import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourcePackage } from "../animation/source-package.js";
import { ProjectStore } from "../project/project-store.js";
import { createHumanConfirmation, validHumanConfirmation } from "../project/human-confirmation.js";
import { confirmExactPhrase, requireInteractiveTerminal } from "./interactive-confirmation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");

async function main(args) {
  if (args.length !== 2) throw new Error("Usage: npm run project:approve-code -- <project-id> <source-result-id>");
  const [projectId, resultId] = args;
  const store = new ProjectStore(root);
  const source = await loadSourcePackage(store, projectId, resultId);
  const latest = (await store.readDecisions(projectId)).filter((decision) =>
    decision.kind === "project_decision" && decision.target?.kind === "result" && decision.target.id === source.result.id &&
    decision.category === "animation_code_execution" && decision.decidedBy === "user"
  ).at(-1);
  if (latest?.outcome === "approved" && validHumanConfirmation(latest.confirmation, "execute_animation_code", source.result.id)) {
    process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
    return;
  }
  const validation = (await store.readResults(projectId)).filter((result) =>
    result.type === "animation.validation" && result.data?.status === "passed" &&
    result.data?.sourceResultId === source.result.id && result.data?.packageSha256 === source.data.packageSha256
  ).at(-1);
  if (!validation) throw new Error("This exact source package does not have a passing validation Result.");
  requireInteractiveTerminal();
  const phrase = `RUN ${source.result.id} ${source.data.packageSha256.slice(0, 12)}`;
  const files = source.data.sourceFiles.map((file) => `  - ${file.path}  sha256:${file.sha256.slice(0, 12)}...`).join("\n");
  await confirmExactPhrase({ phrase, prompt: [
    "PADStudio human confirmation — execute local animation code",
    `Project: ${projectId}`,
    `Exact source Result: ${source.result.id}`,
    `Runtime: ${source.data.runtime}`,
    `Validation Result: ${validation.id}`,
    `Package SHA-256: ${source.data.packageSha256}`,
    "Files:", files,
    "WARNING: this executes code on this computer. Static validation is not a sandbox and host network isolation is not enforced.",
    "Only continue if you intentionally approve this exact immutable package."
  ].join("\n") });
  const confirmation = createHumanConfirmation("execute_animation_code", source.result.id);
  const decision = await store.recordProjectDecision(projectId, {
    target: { kind: "result", id: source.result.id },
    category: "animation_code_execution",
    subject: "Execute exact animation source",
    outcome: "approved",
    options: [],
    selected: null,
    reason: "Confirmed directly in the PADStudio interactive human approval command.",
    decidedBy: "user",
    userVisible: true,
    confidence: "high"
  }, { humanConfirmation: confirmation });
  process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
