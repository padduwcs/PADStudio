import { join } from "node:path";
import { ProjectStore } from "../project/project-store.js";
import {
  AGENT_HOST_CONFIRMATION_CHANNEL,
  createHumanConfirmation
} from "../project/human-confirmation.js";
import { acceptanceResolutionIds } from "../production/acceptance-readiness.js";
import { confirmExactPhrase, requireInteractiveTerminal } from "./interactive-confirmation.js";
import { resolveProjectRoot } from "../config/project-root.js";

const root = resolveProjectRoot();

async function main(args) {
  const [projectId, resultId, ...options] = args;
  if (!projectId || !resultId) {
    throw new Error("Usage: npm run project:accept -- <project-id> <render-result-id> [--from-agent-host] [--resolves <decision-id,...>]");
  }
  let fromAgentHost = false;
  let requestedResolutionIds = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--from-agent-host" && !fromAgentHost) {
      fromAgentHost = true;
      continue;
    }
    if (option === "--resolves" && requestedResolutionIds.length === 0 && options[index + 1]) {
      requestedResolutionIds = options[index + 1].split(",").map((id) => id.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error("Usage: npm run project:accept -- <project-id> <render-result-id> [--from-agent-host] [--resolves <decision-id,...>]");
  }
  const store = new ProjectStore(root);
  const context = await store.readContext(projectId);
  const result = context.results.find((candidate) => candidate.id === resultId);
  if (!result || result.type !== "video.sequence-render") {
    throw new Error("Human acceptance requires an exact video.sequence-render Result.");
  }
  const quality = context.results.filter((candidate) => candidate.type === "video.output-quality" &&
    candidate.data?.sourceResultId === result.id && candidate.inputResults.includes(result.id)).at(-1);
  const file = await store.verifyResultFile(projectId, result.id, "primary");
  const resolvesDecisionIds = acceptanceResolutionIds(context, result, requestedResolutionIds);
  const hasAudio = result.data?.hasAudio !== false;
  let review = null;
  if (!fromAgentHost) {
    requireInteractiveTerminal();
    const phrase = `${hasAudio ? "WATCHED-LISTENED-ACCEPT" : "WATCHED-ACCEPT"} ${result.data.durationSeconds}s ${result.id} ${file.sha256.slice(0, 12)}`;
    await confirmExactPhrase({ phrase, prompt: [
      "PADStudio human confirmation — accept exact video for delivery",
      `Project: ${projectId}`,
      `Exact render Result: ${result.id}`,
      `Artifact: ${result.data?.sequence?.artifactId} revision ${result.data?.sequence?.revision}`,
      `Duration: ${result.data?.durationSeconds} seconds`,
      `SHA-256: ${file.sha256}`,
      `Automated QA: ${quality?.data?.gate?.status ?? "not run (not required for source-preserving delivery)"}`,
      "Delivery mode: preserve this exact file without re-rendering or profile conversion",
      `Feedback decisions resolved: ${resolvesDecisionIds.length ? resolvesDecisionIds.join(", ") : "none"}`,
      hasAudio
        ? "By continuing, you attest that you personally watched AND listened to the entire exact video and accept it for delivery."
        : "By continuing, you attest that you personally watched the entire exact video and accept it for delivery.",
      "Do not continue merely because an Agent asked you to run this command."
    ].join("\n") });
    const reviewConfirmation = createHumanConfirmation("review_video", result.id);
    review = await store.recordReview(projectId, {
      target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed",
      summary: "Full exact-output review confirmed directly in the interactive human acceptance command.",
      criteria: [
        { id: "watched-full", criterion: "The exact render was watched in full", status: "passed", evidence: "Direct interactive confirmation", proposedAction: null },
        ...(hasAudio ? [{ id: "listened-full", criterion: "The exact render audio was reviewed in full", status: "passed", evidence: "Direct interactive confirmation", proposedAction: null }] : []),
        { id: "human-findings", criterion: "Human findings are acceptable", status: "passed", evidence: "No blocking findings declared during acceptance", proposedAction: null }
      ],
      attestation: { watchedFull: true, listenedFull: hasAudio ? true : "not_applicable", device: "Local interactive review", context: "PADStudio exact-output acceptance", findings: [] }
    }, { humanConfirmation: reviewConfirmation });
  }
  const acceptanceConfirmation = createHumanConfirmation("accept_video", result.id, fromAgentHost
    ? { channel: AGENT_HOST_CONFIRMATION_CHANNEL }
    : undefined);
  const decision = await store.recordDecision(projectId, {
    resultId: result.id, outcome: "accepted",
    note: fromAgentHost
      ? "Accepted by the user in the external Agent host and recorded against this exact Result."
      : "Accepted through the PADStudio interactive exact-output confirmation.",
    feedbackTarget: { artifactId: result.data.sequence.artifactId, revision: result.data.sequence.revision },
    resolvesDecisionIds
  }, { humanConfirmation: acceptanceConfirmation });
  process.stdout.write(JSON.stringify({
    mode: fromAgentHost ? "agent_host" : "interactive_cli",
    deliveryMode: "preserve_exact_source",
    review,
    decision
  }, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
