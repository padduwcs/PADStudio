import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisQueryUrl,
  analysisResultSets,
  coverageIntervals,
  formatAnalysisTime
} from "../ui/source-analysis-view.js";

test("source workspace formats source time including long media", () => {
  assert.equal(formatAnalysisTime(0), "0:00.0");
  assert.equal(formatAnalysisTime(65.2), "1:05.2");
  assert.equal(formatAnalysisTime(3661.25), "1:01:01.3");
  assert.equal(formatAnalysisTime(59.6), "0:59.6");
  assert.equal(formatAnalysisTime(59.96), "1:00.0");
  assert.equal(formatAnalysisTime(Number.NaN), "—");
});

test("source workspace expands continuous coverage but preserves sampled intervals", () => {
  assert.deepEqual(
    coverageIntervals({ startSeconds: 2, endSeconds: 8, mode: "continuous" }),
    [{ startSeconds: 2, endSeconds: 8 }]
  );
  const sampled = [{ startSeconds: 1, endSeconds: 1.1 }, { startSeconds: 7, endSeconds: 7.1 }];
  assert.deepEqual(
    coverageIntervals({ startSeconds: 0, endSeconds: 10, mode: "sampled", intervals: sampled }),
    sampled
  );
  assert.deepEqual(coverageIntervals({ mode: "metadata" }), []);
});

test("source workspace builds encoded read-only query URLs", () => {
  const url = new URL(analysisQueryUrl("demo project", {
    view: "transcript",
    resultId: "result-1",
    range: { startSeconds: 1.5, endSeconds: 9 },
    transcriptMode: "both",
    limit: 50,
    cursor: null
  }), "http://localhost");
  assert.equal(url.pathname, "/api/projects/demo%20project/analysis/query");
  assert.equal(url.searchParams.get("view"), "transcript");
  assert.equal(url.searchParams.get("startSeconds"), "1.5");
  assert.equal(url.searchParams.get("endSeconds"), "9");
  assert.equal(url.searchParams.has("cursor"), false);
});

test("source workspace keeps profile and range result sets distinct and newest first", () => {
  const source = {
    resultSets: [
      { id: "old", operation: "transcript", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "frame", operation: "frames", createdAt: "2026-03-01T00:00:00.000Z" },
      { id: "new", operation: "transcript", createdAt: "2026-02-01T00:00:00.000Z" }
    ]
  };
  assert.deepEqual(analysisResultSets(source, "transcript").map((result) => result.id), ["new", "old"]);
});
