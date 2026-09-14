import assert from "node:assert/strict";
import test from "node:test";
import { compactResumeContext } from "../src/intelligence/project-context-assembler.js";

test("resume context keeps current action and drops historical/tool detail", () => {
  const summary = {
    project: { id: "demo", title: "Demo", createdAt: "2026-09-14T00:00:00.000Z" },
    checkpoint: { updatedAt: "2026-09-14T01:00:00.000Z", goal: "Make a film", constraints: ["Local"], selectedResources: ["resource-1"], pending: [], next: "Render", activeWorkflowId: "workflow-1", activeWorkItemId: "edit", activeArtifacts: ["artifact-1"], pendingDecisions: [] },
    checkpointFreshness: { status: "current" },
    health: { status: "ready", issues: [], counts: { results: 12 } },
    activeWorkflow: { id: "workflow-1", revision: 2, name: "Film", purpose: "Deliver", status: "active", items: [{ id: "history" }] },
    resumeView: { activeWorkItemId: "edit", attention: [{ id: "edit", status: "in_progress", purpose: "Edit", skillIds: ["video-sequence-planning"], blockedBy: [] }], pendingApprovalIds: [] },
    activeArtifacts: [{ id: "artifact-1", key: "film", revision: 3, type: "video.sequence", name: "Film", summary: "Current", status: "active", references: [{ kind: "result", id: "old" }] }],
    production: { activeSequences: [{ artifactId: "artifact-1", key: "film", revision: 3, name: "Film", status: "active", durationSeconds: 20, reasons: [], blockedSegments: [], renders: [{ resultId: "old" }, { resultId: "latest" }] }], affectedWorkItems: [], pendingFinalizations: [] },
    pendingFeedback: [{ id: "decision-1", resultId: "latest", note: "Shorten", feedbackTarget: { segmentId: "end" }, createdAt: "2026-09-14T02:00:00.000Z", options: ["unused"] }],
    budget: { policy: null, spentUsd: 0 },
    analysis: { counts: { sources: 1 }, jobStates: { completed: 1 }, sources: [{ sourceKey: "source", source: { kind: "resource", id: "resource-1" }, freshness: "verified_current", operations: { probe: { id: "probe", type: "source.metadata", outcome: "passed", warningCodes: [], coverage: { unused: true } } }, jobs: [{ id: "historical-job" }] }] },
    capabilities: { capabilities: [{ id: "video.render-sequence", available: true, tools: [{ name: "ffmpeg-sequence", inputSchema: { huge: true } }] }, { id: "tts.synthesize", available: false, tools: [] }] }
  };
  const resume = compactResumeContext(summary);
  assert.equal(resume.view, "resume");
  assert.equal(resume.production.activeSequences[0].latestRender.resultId, "latest");
  assert.deepEqual(resume.work.relevantSkillIds, ["video-sequence-planning"]);
  assert.deepEqual(resume.capabilityStatus, { total: 2, available: 1, unavailable: ["tts.synthesize"] });
  assert.equal("items" in resume.work.activeWorkflow, false);
  assert.equal("renders" in resume.production.activeSequences[0], false);
  assert.equal("tools" in resume.capabilityStatus, false);
  assert.ok(JSON.stringify(resume).length < 4_000);
});
