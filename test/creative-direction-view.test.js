import assert from "node:assert/strict";
import test from "node:test";
import { buildCreativeObserverModel } from "../ui/creative-direction-view.js";

const artifact = (id, type, data, rest = {}) => ({
  id, type, data, key: rest.key ?? type, revision: rest.revision ?? 1,
  name: rest.name ?? id, summary: rest.summary ?? id, status: rest.status ?? "active",
  references: rest.references ?? [], createdAt: rest.createdAt ?? "2026-01-01T00:00:00.000Z",
  ...rest
});

function creativeContext() {
  const brief = artifact("brief-1", "project.brief", {
    purpose: "Teach clearly", audience: "Beginners", desiredOutcome: "Explain the idea",
    constraints: [], knownFacts: [], assumptions: [], openQuestions: []
  });
  const proposal = artifact("proposal-1", "creative.proposal", {
    comparisonCriteria: ["clarity"],
    recommendedOptionId: "keys",
    recommendationReason: "Concrete for beginners",
    options: [
      { id: "keys", name: "Keys first", hook: "Which key opens the door?", premise: "Try each key",
        narrativeApproach: "Example then concept", advantages: ["Concrete"], tradeoffs: ["Reorders source"], risks: ["Bridge may be weak"] },
      { id: "definition", name: "Definition first", hook: "What is brute force?", premise: "Name the concept",
        narrativeApproach: "Concept then example", advantages: ["Direct"], tradeoffs: ["Abstract"], risks: ["Slow hook"] }
    ]
  }, { references: [{ kind: "artifact", id: brief.id }] });
  const oldDirection = artifact("direction-1", "creative.direction", {
    basis: { kind: "proposal", proposalArtifactId: proposal.id, optionId: "keys" },
    selectionReason: "Draft", principles: ["Use keys"], avoidances: [], reviewCriteria: [], sample: null
  }, { key: "direction", status: "retired" });
  const direction = artifact("direction-2", "creative.direction", {
    basis: { kind: "proposal", proposalArtifactId: proposal.id, optionId: "keys" },
    selectionReason: "User selected keys", principles: ["Use keys"], avoidances: ["No CTA"],
    reviewCriteria: ["Clear on mobile"],
    sample: { purpose: "Test the bridge", durationSeconds: 45, successCriteria: ["Clear concept"] }
  }, { key: "direction", revision: 2, supersedes: oldDirection.id,
    references: [{ kind: "artifact", id: proposal.id }], createdAt: "2026-01-02T00:00:00.000Z" });
  const directionApproval = {
    kind: "project_decision", id: "decision-direction", decidedBy: "user", outcome: "approved",
    reason: "Use keys", createdAt: "2026-01-03T00:00:00.000Z",
    binding: { outputReferences: [{ kind: "artifact", id: direction.id }] }
  };
  const renderApproval = {
    kind: "project_decision", id: "decision-render", decidedBy: "user", outcome: "approved",
    reason: "Approve exact r2", createdAt: "2026-01-04T00:00:00.000Z",
    binding: { outputReferences: [{ kind: "result", id: "render-r2" }], reviewId: "review-r2" }
  };
  const review = {
    id: "review-r2", perspective: "combined", verdict: "passed_with_notes", summary: "Ready",
    createdAt: "2026-01-04T00:00:00.000Z",
    binding: { outputReferences: [{ kind: "result", id: "render-r2" }] }
  };
  const sequence = {
    artifactId: "sequence-2", name: "Sample", revision: 2, active: true,
    references: [{ kind: "artifact", id: direction.id }], durationSeconds: 45,
    segments: [{ id: "a" }, { id: "b" }], reasons: [],
    renders: [
      { resultId: "render-r2", reusedSegmentIds: ["a"], createdAt: "2026-01-04T00:00:00.000Z" },
      { resultId: "render-r3-unapproved", reusedSegmentIds: ["a", "b"], createdAt: "2026-01-05T00:00:00.000Z" }
    ]
  };
  return {
    project: { id: "demo" },
    artifacts: [brief, proposal, oldDirection, direction],
    reviews: [review],
    decisions: [directionApproval, renderApproval],
    projectDecisions: [directionApproval, renderApproval],
    intelligence: { activeArtifacts: [brief, proposal, direction], pendingApprovals: [] },
    production: {
      sequences: [sequence],
      artifactStates: [brief, proposal, oldDirection, direction].map((item) => ({
        artifactId: item.id, reasons: []
      }))
    }
  };
}

test("creative observer maps brief, proposal, direction, sample and exact approval", () => {
  const model = buildCreativeObserverModel(creativeContext());
  assert.equal(model.brief.id, "brief-1");
  assert.equal(model.proposal.id, "proposal-1");
  assert.equal(model.direction.id, "direction-2");
  assert.equal(model.selectedOption.id, "keys");
  assert.equal(model.sequence.artifactId, "sequence-2");
  assert.equal(model.render.resultId, "render-r2");
  assert.equal(model.approval.id, "decision-render");
  assert.equal(model.renderReview.id, "review-r2");
  assert.deepEqual(model.trace, ["brief-1", "proposal-1", "direction-2", "sequence-2", "render-r2"]);
});

test("creative observer keeps superseded revisions and reports stale dependencies", () => {
  const context = creativeContext();
  context.production.artifactStates.find((item) => item.artifactId === "direction-2").reasons = [
    { kind: "artifact", id: "proposal-1", reason: "not_active_revision" }
  ];
  const model = buildCreativeObserverModel(context);
  assert.equal(model.history.filter((item) => item.type === "creative.direction").length, 2);
  assert.equal(model.direction.reasons[0].reason, "not_active_revision");
  assert.equal(model.pendingApprovals.length, 0);
});

test("creative observer degrades gracefully without creative artifacts", () => {
  const model = buildCreativeObserverModel({
    project: { id: "empty" }, artifacts: [], reviews: [], decisions: [],
    intelligence: { activeArtifacts: [], pendingApprovals: [] },
    production: { sequences: [], artifactStates: [] }
  });
  assert.equal(model.empty, true);
  assert.equal(model.direction, null);
  assert.deepEqual(model.trace, []);
});
