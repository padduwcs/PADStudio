import assert from "node:assert/strict";
import test from "node:test";
import {
  creativeReviewStatus, feedbackAnchorText, feedbackForSegment, productionRenderOptions, segmentAtTime,
  defaultVideoRevision, defaultVideoRender
} from "../ui/production-view.js";
import { readFile } from "node:fs/promises";

const sequence = {
  artifactId: "artifact-a", revision: 3, durationSeconds: 11.5,
  segments: [{ id: "opening", title: "Mở đầu" }, { id: "middle", title: "Giữa" }, { id: "ending", title: "Kết" }],
  timeline: [
    { track: "Hình", segmentId: "opening", startSeconds: 0, endSeconds: 4 },
    { track: "Lời đọc", label: "x", startSeconds: 0.5, endSeconds: 3 },
    { track: "Hình", segmentId: "middle", startSeconds: 4, endSeconds: 8.5 },
    { track: "Hình", segmentId: "ending", startSeconds: 8.5, endSeconds: 11.5 }
  ]
};
const render = { resultId: "result-r1" };

test("a playhead position maps to the exact segment of the timeline", () => {
  assert.equal(segmentAtTime(sequence, 0.2).id, "opening");
  assert.equal(segmentAtTime(sequence, 4).id, "middle", "a boundary belongs to the segment that starts there");
  assert.equal(segmentAtTime(sequence, 8.499).id, "middle");
  assert.equal(segmentAtTime(sequence, 11.5).id, "ending", "the last segment owns the final instant");
  assert.equal(segmentAtTime(sequence, 11.6), null);
  assert.equal(segmentAtTime(sequence, -1), null);
  assert.equal(segmentAtTime({ segments: [], timeline: [] }, 1), null);
  assert.deepEqual(segmentAtTime(sequence, 5), { id: "middle", title: "Giữa", startSeconds: 4, endSeconds: 8.5 });
});

test("the feedback anchor names the exact Result, revision, segment range and playhead", () => {
  assert.equal(
    feedbackAnchorText({ projectId: "demo", sequence, render, currentTime: 5.25 }),
    "project=demo · result=result-r1 · artifact=artifact-a · revision=3 · segment=middle · time=4.000-8.500 · at=5.250"
  );
});

test("an anchor taken before playback points at the whole Result", () => {
  assert.equal(
    feedbackAnchorText({ projectId: "demo", sequence, render, currentTime: 0 }),
    "project=demo · result=result-r1 · artifact=artifact-a · revision=3"
  );
  assert.equal(feedbackAnchorText({ projectId: "demo", sequence, render, currentTime: Number.NaN }),
    "project=demo · result=result-r1 · artifact=artifact-a · revision=3");
});

test("an anchor never points past the end and tolerates a sequence without a timeline", () => {
  assert.match(feedbackAnchorText({ projectId: "demo", sequence, render, currentTime: 99 }), /segment=ending · time=8\.500-11\.500 · at=11\.500$/);
  assert.equal(
    feedbackAnchorText({ projectId: "demo", sequence: { artifactId: "a", revision: 1 }, render, currentTime: 2 }),
    "project=demo · result=result-r1 · artifact=a · revision=1 · at=2.000"
  );
});

test("the viewer keeps the feedback-anchor control wired to the playable video", async () => {
  const source = await readFile(new URL("../ui/production-view.js", import.meta.url), "utf8");
  assert.match(source, /function anchorControl\(context, sequence, render, video\)/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /Sao chép mốc phản hồi/);
  const css = await readFile(new URL("../ui/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.anchor-status\b/);
});

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
