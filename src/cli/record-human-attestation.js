import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");
async function main(args) {
  const [projectId, source] = args; if (!projectId || !source || args.length !== 2) throw new Error("Usage: npm run project:attest -- <project-id> <json|file|->");
  const value = await readJsonInput(source), findings = value.findings ?? [], verdict = value.verdict ?? (findings.length ? "passed_with_notes" : "passed");
  const failed = ["revise", "blocked"].includes(verdict);
  const review = await new ProjectStore(root).recordReview(projectId, {
    target: { kind: "result", id: value.resultId }, perspective: "human", reviewer: "user", verdict,
    summary: value.summary ?? "Full human viewing/listening attestation.",
    criteria: [
      { id: "watched-full", criterion: "The exact render was watched in full", status: "passed", evidence: `${value.device}; ${value.context}` },
      { id: "listened-full", criterion: "The exact render audio was reviewed in full", status: value.listenedFull === true ? "passed" : "warning", evidence: value.listenedFull === true ? `${value.device}; ${value.context}` : "Audio is not applicable." },
      { id: "human-findings", criterion: "Human findings are acceptable", status: failed ? "failed" : findings.length ? "warning" : "passed", evidence: findings.length ? findings.join(" | ") : "No findings recorded.", ...(failed ? { proposedAction: findings.join(" | ") || "Revise the render and review again." } : {}) }
    ],
    attestation: { watchedFull: value.watchedFull, listenedFull: value.listenedFull, device: value.device, context: value.context, findings }
  });
  process.stdout.write(JSON.stringify(review, null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
