import assert from "node:assert/strict";
import test from "node:test";
import { creativeReviewStatus, feedbackForSegment, productionRenderOptions } from "../ui/production-view.js";

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
