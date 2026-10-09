import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisQueryUrl,
  analysisResultSets,
  coverageIntervals,
  formatAnalysisTime,
  sourceMediaDescriptor
} from "../ui/source-analysis-view.js";

test("source workspace formats source time including long media", () => {
  assert.equal(formatAnalysisTime(0), "0:00.0");
  assert.equal(formatAnalysisTime(65.2), "1:05.2");
  assert.equal(formatAnalysisTime(3661.25), "1:01:01.3");
  assert.equal(formatAnalysisTime(59.6), "0:59.6");
  assert.equal(formatAnalysisTime(59.96), "1:00.0");
  assert.equal(formatAnalysisTime(Number.NaN), "—");
});

test("source preview accepts registered media kinds and MIME types with exact proxy timing", () => {
  for (const mediaType of ["video", "video/mp4"]) {
    const context = { project: { id: "demo project" }, resources: [], results: [{
      id: "preview-1", files: [{ id: "primary", available: true, mediaType }],
      data: { details: { sourceStartSeconds: 12, sourceEndSeconds: 24 } }
    }] };
    const source = { source: { kind: "result", id: "original" }, operations: { preview: { id: "preview-1" } } };
    assert.deepEqual(sourceMediaDescriptor(context, source), {
      kind: "video", url: "/project-results/demo%20project/preview-1/primary",
      key: "preview-1:primary", sourceStart: 12, sourceEnd: 24, derivative: true
    });
  }
});

test("analyzed Result media can be viewed without a separate source preview", () => {
  const context = { project: { id: "demo" }, resources: [], results: [{
    id: "render-1", files: [{ id: "primary", available: true, mediaType: "video" }]
  }] };
  const source = { source: { kind: "result", id: "render-1" }, operations: {} };
  assert.equal(sourceMediaDescriptor(context, source)?.url, "/project-results/demo/render-1/primary");
  assert.equal(sourceMediaDescriptor(context, source)?.derivative, false);
  context.results[0].files[0].available = false;
  assert.equal(sourceMediaDescriptor(context, source), null);
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
