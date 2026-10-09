import assert from "node:assert/strict";
import test from "node:test";
import { creativeReviewStatus, feedbackForSegment, productionRenderOptions, viewerProjectState, defaultVideoRevision, defaultVideoRender } from "../ui/production-view.js";

test("technical review alone does not imply creative review of the exact render", () => {
  assert.equal(creativeReviewStatus({ reviews: [{ perspective: "technical", verdict: "passed" }] }), "missing");
  assert.equal(creativeReviewStatus({ reviews: [{ perspective: "creative", verdict: "passed_with_notes" }] }), "reviewed");
});

test("production result options retain multiple exact Results from one revision", () => {
  const options = productionRenderOptions([
    {
      artifactId: "artifact-a",
      revision: 3,
      renders: [
        { resultId: "result-a", createdAt: "2026-01-01T00:00:00.000Z" },
        { resultId: "result-b", createdAt: "2026-01-01T00:01:00.000Z" }
      ]
    },
    {
      artifactId: "artifact-b",
      revision: 4,
      renders: [{ resultId: "result-c", createdAt: "2026-01-01T00:02:00.000Z" }]
    }
  ]);
  assert.deepEqual(options.map((item) => [item.revision, item.resultId]), [
    [3, "result-a"], [3, "result-b"], [4, "result-c"]
  ]);
});

test("structured feedback is projected only onto its exact segment", () => {
  const whole = { id: "decision-whole", outcome: "accepted", feedbackTarget: null };
  const opening = {
    id: "decision-opening", outcome: "changes_requested",
    feedbackTarget: { artifactId: "artifact-a", revision: 3, segmentId: "opening" }
  };
  const ending = {
    id: "decision-ending", outcome: "changes_requested",
    feedbackTarget: { artifactId: "artifact-a", revision: 3, segmentId: "ending" }
  };
  const render = { decisions: [whole, opening, ending] };
  assert.deepEqual(feedbackForSegment(render).map((item) => item.id), ["decision-whole"]);
  assert.deepEqual(feedbackForSegment(render, "opening").map((item) => item.id), ["decision-opening"]);
  assert.deepEqual(feedbackForSegment(render, "ending").map((item) => item.id), ["decision-ending"]);
});

test("planned work and completed or failed historical runs never imply ongoing activity", () => {
  assert.equal(viewerProjectState({ intelligence: { currentWorkItems: [{ status: "ready" }] } }, {
    runs: [{ status: "failed" }, { status: "completed" }]
  }), null);
});

test("a running render remains visible while another item awaits user approval", () => {
  assert.deepEqual(viewerProjectState({ intelligence: { pendingApprovals: [{}] } }, {
    runs: [{ id: "render", status: "in_progress", capability: "video.render-sequence" }]
  }), { kind: "working", label: "Đang dựng video" });
  assert.deepEqual(viewerProjectState(null, { runs: [{ status: "in_progress", capability: "tts.synthesize" }] }),
    { kind: "working", label: "Đang tạo giọng đọc" });
});

test("durable output awaiting run recovery is waiting rather than an active render", () => {
  assert.deepEqual(viewerProjectState(null, {
    runs: [{ id: "render", status: "in_progress", capability: "video.render-sequence" }],
    runRecovery: { pendingFinalizations: [{ runId: "render", recoverable: true }] }
  }), { kind: "waiting", label: "Chờ tiếp tục" });
});

test("workflow progress and user approval work without a running tool", () => {
  assert.deepEqual(viewerProjectState({ intelligence: { currentWorkItems: [{ status: "in_progress" }] } }),
    { kind: "working", label: "Đang thực hiện" });
  assert.deepEqual(viewerProjectState({ intelligence: { pendingApprovals: [{}] } }),
    { kind: "waiting", label: "Chờ bạn xem" });
});

test("a new revision without video keeps the most recent playable preview", () => {
  const revisions = [
    { artifactId: "first", active: false, renders: [{ files: [{ id: "primary", available: true }] }] },
    { artifactId: "second", active: true, renders: [] }
  ];
  assert.equal(defaultVideoRevision(revisions).artifactId, "first");
  revisions[1].renders.push({ files: [{ id: "primary", available: true }] });
  assert.equal(defaultVideoRevision(revisions).artifactId, "second");
});

test("missing media does not hide an older available preview or invent a playable first cut", () => {
  const revisions = [
    { artifactId: "first", renders: [{ files: [{ id: "primary", available: true }] }] },
    { artifactId: "second", active: true, renders: [{ files: [{ id: "primary", available: false }] }] }
  ];
  assert.equal(defaultVideoRevision(revisions).artifactId, "first");
  assert.equal(defaultVideoRevision([{ artifactId: "new", active: true, renders: [] }]).artifactId, "new");
  assert.equal(defaultVideoRender({ renders: [
    { resultId: "available", files: [{ id: "primary", available: true }] },
    { resultId: "missing", files: [{ id: "primary", available: false }] }
  ] }).resultId, "available");
});
