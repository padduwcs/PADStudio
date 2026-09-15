import { createHumanConfirmation } from "../../src/project/human-confirmation.js";

export async function recordSyntheticHumanAcceptanceFixture({ store, projectId, result, artifact, note }) {
  const review = await store.recordReview(projectId, {
    target: { kind: "result", id: result.id }, perspective: "human", reviewer: "user", verdict: "passed",
    summary: "Synthetic human-confirmation receipt for an isolated acceptance fixture.",
    criteria: [
      { id: "watched-full", criterion: "The exact render was watched in full", status: "passed", evidence: "Synthetic acceptance fixture only", proposedAction: null },
      { id: "listened-full", criterion: "The exact render audio was reviewed in full", status: "passed", evidence: "Synthetic acceptance fixture only", proposedAction: null },
      { id: "human-findings", criterion: "Human findings are acceptable", status: "passed", evidence: "Synthetic acceptance fixture only", proposedAction: null }
    ],
    attestation: {
      watchedFull: true, listenedFull: true, device: "Isolated automated fixture",
      context: "Contract mechanics only; not real human evidence", findings: []
    }
  }, { humanConfirmation: createHumanConfirmation("review_video", result.id) });
  const approval = await store.recordDecision(projectId, {
    resultId: result.id, outcome: "accepted", note,
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision }
  }, { humanConfirmation: createHumanConfirmation("accept_video", result.id) });
  return { review, approval };
}
