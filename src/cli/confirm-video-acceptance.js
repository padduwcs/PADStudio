import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ProjectStore } from "../project/project-store.js";
import { createHumanConfirmation } from "../project/human-confirmation.js";
import { acceptanceResolutionIds, deliveryProfilesForAcceptance } from "../production/acceptance-readiness.js";
import { describeDeliveryMedia, parseDeliveryProbe } from "../production/delivery-readiness.js";
import { defaultProductionPolicyCatalog } from "../production/production-policy-catalog.js";
import { confirmExactPhrase, requireInteractiveTerminal } from "./interactive-confirmation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");
const execFileAsync = promisify(execFile);

async function inspectExactMedia(filePath) {
  const ffprobe = process.env.PADSTUDIO_FFPROBE_PATH?.trim() || "ffprobe";
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v", "error", "-show_format", "-show_streams", "-of", "json", filePath
    ], { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    return parseDeliveryProbe(stdout);
  } catch (error) {
    throw new Error("Cannot inspect the exact render for delivery readiness: " + (error?.message || "ffprobe failed"));
  }
}

async function main(args) {
  const validArgs = args.length === 2 || (args.length === 4 && args[2] === "--resolves");
  if (!validArgs) throw new Error("Usage: npm run project:accept -- <project-id> <render-result-id> [--resolves <decision-id,...>]");
  const [projectId, resultId] = args;
  const requestedResolutionIds = args[3] ? args[3].split(",").map((id) => id.trim()).filter(Boolean) : [];
  const store = new ProjectStore(root);
  const context = await store.readContext(projectId);
  const pending = context.runRecovery?.pendingFinalizations ?? [];
  if (pending.length) throw new Error(`Project has ${pending.length} unfinished Run(s); resolve or safely abandon them before acceptance.`);
  const result = context.results.find((candidate) => candidate.id === resultId);
  if (!result || result.type !== "video.sequence-render" || result.verification?.status !== "passed") {
    throw new Error("Human acceptance requires an exact, verified video.sequence-render Result.");
  }
  const quality = context.results.filter((candidate) => candidate.type === "video.output-quality" &&
    candidate.data?.sourceResultId === result.id && candidate.inputResults.includes(result.id)).at(-1);
  if (!quality || quality.verification?.status !== "passed" || quality.data?.gate?.deliveryEligible !== true) {
    throw new Error("The exact render does not have delivery-eligible automated output QA.");
  }
  const file = await store.verifyResultFile(projectId, result.id, "primary");
  const media = await inspectExactMedia(file.filePath);
  const deliveryProfiles = deliveryProfilesForAcceptance(media, result, defaultProductionPolicyCatalog);
  if (!deliveryProfiles.length) {
    throw new Error(
      "The exact render is not compatible with any configured delivery profile. " +
      `Detected: ${describeDeliveryMedia(media)}. Render a delivery-compatible Result before human acceptance.`
    );
  }
  const resolvesDecisionIds = acceptanceResolutionIds(context, result, requestedResolutionIds);
  requireInteractiveTerminal();
  const hasAudio = result.data?.hasAudio !== false;
  const phrase = `${hasAudio ? "WATCHED-LISTENED-ACCEPT" : "WATCHED-ACCEPT"} ${result.data.durationSeconds}s ${result.id} ${file.sha256.slice(0, 12)}`;
  await confirmExactPhrase({ phrase, prompt: [
    "PADStudio human confirmation — accept exact video for delivery",
    `Project: ${projectId}`,
    `Exact render Result: ${result.id}`,
    `Artifact: ${result.data?.sequence?.artifactId} revision ${result.data?.sequence?.revision}`,
    `Duration: ${result.data?.durationSeconds} seconds`,
    `SHA-256: ${file.sha256}`,
    `Automated QA: ${quality.data?.gate?.status ?? "passed"}`,
    `Delivery ready: ${deliveryProfiles.map((profile) => profile.id).join(", ")}`,
    `Feedback decisions resolved: ${resolvesDecisionIds.length ? resolvesDecisionIds.join(", ") : "none"}`,
    hasAudio
      ? "By continuing, you attest that you personally watched AND listened to the entire exact video and accept it for delivery."
      : "By continuing, you attest that you personally watched the entire exact video and accept it for delivery.",
    "Do not continue merely because an Agent asked you to run this command."
  ].join("\n") });
  const reviewConfirmation = createHumanConfirmation("review_video", result.id);
  const review = await store.recordReview(projectId, {
    target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed",
    summary: "Full exact-output review confirmed directly in the interactive human acceptance command.",
    criteria: [
      { id: "watched-full", criterion: "The exact render was watched in full", status: "passed", evidence: "Direct interactive confirmation", proposedAction: null },
      ...(hasAudio ? [{ id: "listened-full", criterion: "The exact render audio was reviewed in full", status: "passed", evidence: "Direct interactive confirmation", proposedAction: null }] : []),
      { id: "human-findings", criterion: "Human findings are acceptable", status: "passed", evidence: "No blocking findings declared during acceptance", proposedAction: null }
    ],
    attestation: { watchedFull: true, listenedFull: hasAudio ? true : "not_applicable", device: "Local interactive review", context: "PADStudio exact-output acceptance", findings: [] }
  }, { humanConfirmation: reviewConfirmation });
  const acceptanceConfirmation = createHumanConfirmation("accept_video", result.id);
  const decision = await store.recordDecision(projectId, {
    resultId: result.id, outcome: "accepted",
    note: "Accepted through the PADStudio interactive exact-output confirmation.",
    feedbackTarget: { artifactId: result.data.sequence.artifactId, revision: result.data.sequence.revision },
    resolvesDecisionIds
  }, { humanConfirmation: acceptanceConfirmation });
  process.stdout.write(JSON.stringify({ review, decision }, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
