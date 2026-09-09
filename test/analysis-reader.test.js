import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalysisReader } from "../src/analysis/analysis-reader.js";
import { normalizeAnalysisQuery, normalizeSourceReference } from "../src/analysis/contracts.js";
import { resolveAnalysisSource } from "../src/analysis/source-identity.js";
import { ProjectStore } from "../src/project/project-store.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { createPadStudioServer } from "../src/web/server.js";
import { ProjectReader } from "../src/web/project-reader.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-analysis-reader-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const sourcePath = join(workspace, "source.mp4");
  await writeFile(sourcePath, "stable source bytes", "utf8");
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath });
  const store = new ProjectStore(rootDir);
  const source = normalizeSourceReference({ kind: "resource", id: imported.resourceId, itemPath: null });
  const identity = await resolveAnalysisSource({ store, projectId: "demo", source });
  return { workspace, rootDir, store, source, identity, imported };
}

async function transcriptResult(
  state,
  rows,
  { coverage = { startSeconds: 0, endSeconds: 10, mode: "continuous" }, profileId = "fixture" } = {}
) {
  const tool = { name: "fixture-transcript", version: "1.0.0", provider: "test" };
  const run = await state.store.startRun("demo", {
    capability: "audio.transcribe",
    purpose: "Create transcript fixture",
    tool,
    inputs: { source: state.source },
    estimatedCostUsd: 0
  });
  const workspace = await state.store.createRunOutputWorkspace("demo", run.id);
  const contents = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(join(workspace.temporaryDirectory, "transcript.jsonl"), contents, "utf8");
  await state.store.commitRunOutputWorkspace(workspace);
  const result = await state.store.addResult("demo", {
    runId: run.id,
    type: "source.transcript",
    name: "Transcript fixture",
    capability: "audio.transcribe",
    inputResources: [state.imported.resourceId],
    files: [{
      id: "segments", role: "dataset",
      path: workspace.projectRelativeDirectory + "/transcript.jsonl",
      name: "transcript.jsonl", mediaType: "application/x-ndjson",
      sizeBytes: Buffer.byteLength(contents)
    }],
    tool,
    data: {
      schemaVersion: "1.0", source: state.source,
      sourceKey: state.identity.sourceKey, sourceVersion: state.identity.sourceVersion,
      operation: "transcript", analysisJobId: null, unitId: null,
      fingerprint: "a".repeat(64),
      coverage,
      method: { profileId }, outcome: "produced",
      counts: { segments: rows.length },
      datasets: [{ kind: "transcript", fileId: "segments" }],
      warnings: [], contentReview: "not_performed"
    },
    verification: { status: "passed", checks: ["fixture"] },
    runCompletion: { durationMs: 1, actualCostUsd: 0 }
  });
  await state.store.finishRun("demo", run.id, { status: "completed", outputs: [result.id], durationMs: 1, actualCostUsd: 0 });
  state.store.releaseRunOutputWorkspace(workspace);
  return result;
}

function transcriptRows() {
  return [
    { id: "segment-1", startSeconds: 0, endSeconds: 2, text: "Thuat toan mo dau", language: "vi", words: [], diagnostics: {} },
    { id: "segment-2", startSeconds: 2, endSeconds: 5, text: "Day la thuat toan tim kiem", language: "vi", words: [], diagnostics: {} },
    { id: "segment-3", startSeconds: 6, endSeconds: 9, text: "Ket thuc", language: "vi", words: [], diagnostics: {} }
  ];
}

function baseArtifact(state, type, result, data, references = []) {
  return {
    key: type.replaceAll(".", "-") + "-fixture",
    type,
    name: type,
    summary: type + " fixture",
    status: "active",
    data: {
      version: "1.0", source: state.source,
      sourceKey: state.identity.sourceKey, sourceVersion: state.identity.sourceVersion,
      ...data
    },
    references: [
      { kind: "resource", id: state.imported.resourceId },
      ...(result ? [{ kind: "result", id: result.id }] : []),
      ...references
    ],
    createdBy: "agent"
  };
}

test("analysis query contract rejects ambiguous and unsupported requests", () => {
  assert.equal(normalizeAnalysisQuery({ view: "summary" }).limit, 50);
  assert.throws(() => normalizeAnalysisQuery({ view: "transcript" }), /sourceKey or resultId/);
  assert.throws(() => normalizeAnalysisQuery({ view: "search", text: "x", unknown: true }), /unknown/);
  assert.throws(() => normalizeAnalysisQuery({ view: "search", text: "x".repeat(501) }), /500/);
});

test("reader streams paged transcript, verifies evidence, and searches Vietnamese text", async (t) => {
  const state = await fixture(t);
  const result = await transcriptResult(state, transcriptRows());
  const reader = new AnalysisReader({ rootDir: state.rootDir, projectStore: state.store });

  const first = await reader.query("demo", { view: "transcript", resultId: result.id, limit: 1 });
  assert.deepEqual(first.rows.map((row) => row.id), ["segment-1"]);
  assert.ok(first.nextCursor);
  const second = await reader.query("demo", {
    view: "transcript", resultId: result.id, limit: 1, cursor: first.nextCursor
  });
  assert.deepEqual(second.rows.map((row) => row.id), ["segment-2"]);

  const verification = await reader.verify("demo", { resultId: result.id });
  assert.equal(verification.results[result.id].status, "verified_current");
  assert.equal(verification.searchIndex.rowCount, 3);
  const search = await reader.query("demo", {
    view: "search", text: "thuật toán", diacriticInsensitive: true, limit: 10
  });
  assert.deepEqual(search.rows.map((row) => row.itemId), ["segment-1", "segment-2"]);

  const pagedSearch = await reader.query("demo", {
    view: "search", text: "thuật toán", diacriticInsensitive: true, limit: 1
  });
  assert.ok(pagedSearch.nextCursor);
  await state.store.recordArtifact("demo", baseArtifact(state, "source.transcript-edit", result, {
    baseResultIds: [result.id],
    corrections: [{
      segmentId: "segment-3", originalText: "Ket thuc", correctedText: "Kết thúc",
      reason: "Verified spelling", evidence: [{ resultId: result.id, itemId: "segment-3" }]
    }],
    evidenceReviewed: [{
      resultId: result.id, itemId: "segment-3", action: "listened", reviewedBy: "agent"
    }],
    changeReason: "Add verified spelling"
  }));
  await reader.verify("demo", { resultId: result.id });
  await assert.rejects(
    reader.query("demo", {
      view: "search", text: "thuật toán", diacriticInsensitive: true,
      limit: 1, cursor: pagedSearch.nextCursor
    }),
    (error) => error.code === "cursor_stale"
  );

  const indexPath = join(state.rootDir, "demo", "analysis", "indexes", "search-v1.jsonl");
  await writeFile(indexPath, (await readFile(indexPath, "utf8")) + "{}\n", "utf8");
  await assert.rejects(
    reader.query("demo", { view: "search", text: "thuat" }),
    (error) => error.code === "index_not_ready"
  );

  await transcriptResult(state, [
    { id: "segment-other", startSeconds: 0, endSeconds: 1, text: "Ban khac", language: "vi", words: [], diagnostics: {} }
  ], { profileId: "fixture-other" });
  const summary = await reader.summary("demo");
  assert.equal(summary.sources[0].resultSets.length, 2);
  await assert.rejects(
    reader.query("demo", { view: "transcript", sourceKey: state.identity.sourceKey }),
    (error) => error.code === "ambiguous_result"
  );
});

test("source artifacts bind observations and transcript corrections to durable evidence", async (t) => {
  const state = await fixture(t);
  const result = await transcriptResult(state, transcriptRows());
  const profile = await state.store.recordArtifact("demo", baseArtifact(state, "source.profile", null, {
    usage: "source", purpose: "Primary footage", constraints: ["internal"],
    originNote: "Owner supplied", changeReason: "Classify source"
  }));
  assert.equal(profile.data.usage, "source");

  const assessmentValue = baseArtifact(state, "source.assessment", result, {
    purpose: "Find useful explanation", summary: "The source explains a search algorithm.",
    changeReason: "Initial assessment",
    evidenceReviewed: [{ resultId: result.id, itemId: "segment-2", action: "read_transcript", reviewedBy: "agent" }],
    findings: [{
      id: "finding-1", statement: "The middle segment names the algorithm.", basis: "observation",
      evidence: [{ resultId: result.id, itemId: "segment-2", range: { startSeconds: 2, endSeconds: 5 } }],
      certainty: "high", reason: "The transcript states it directly."
    }],
    usableRanges: [{
      startSeconds: 2, endSeconds: 5, intendedUse: "Opening explanation", reason: "Direct statement",
      evidence: [{ resultId: result.id, itemId: "segment-2" }]
    }],
    limitations: ["Visual content not reviewed"], openQuestions: ["Check pronunciation"],
    reviewCoverage: {
      visual: { status: "not_reviewed", ranges: [], note: null },
      audio: { status: "not_reviewed", ranges: [], note: null },
      text: { status: "partial", ranges: [{ startSeconds: 2, endSeconds: 5 }], note: "One segment" }
    }
  });
  const assessment = await state.store.recordArtifact("demo", assessmentValue);
  assert.equal(assessment.data.findings[0].basis, "observation");

  const editValue = baseArtifact(state, "source.transcript-edit", result, {
    baseResultIds: [result.id],
    corrections: [{
      segmentId: "segment-2", originalText: "Day la thuat toan tim kiem",
      correctedText: "Day la thuat toan tim kiem chinh xac", reason: "Verified by listening",
      evidence: [{ resultId: result.id, itemId: "segment-2" }]
    }],
    evidenceReviewed: [{ resultId: result.id, itemId: "segment-2", action: "listened", reviewedBy: "agent" }],
    changeReason: "Correct ASR omission"
  });
  const edit = await state.store.recordArtifact("demo", editValue);
  const reader = new AnalysisReader({ rootDir: state.rootDir, projectStore: state.store });
  const corrected = await reader.query("demo", {
    view: "transcript", resultId: result.id, transcriptMode: "corrected", limit: 10
  });
  assert.equal(corrected.rows[1].rawText, "Day la thuat toan tim kiem");
  assert.equal(corrected.rows[1].text, "Day la thuat toan tim kiem chinh xac");
  assert.equal(corrected.rows[1].correction.artifactId, edit.id);

  await assert.rejects(
    state.store.recordArtifact("demo", { ...editValue, data: { ...editValue.data, changeReason: "Second edit" } }),
    /revision conflict/
  );
  const invalid = structuredClone(assessmentValue);
  invalid.key = "invalid-assessment";
  invalid.data.findings[0].evidence[0].itemId = "missing-segment";
  await assert.rejects(state.store.recordArtifact("demo", invalid), /Evidence item does not exist/);

  const unreviewed = structuredClone(assessmentValue);
  unreviewed.key = "unreviewed-assessment";
  unreviewed.data.evidenceReviewed[0].itemId = "segment-1";
  await assert.rejects(state.store.recordArtifact("demo", unreviewed), /was not reviewed/);
});

test("verify reports stale managed source without rewriting historical Results", async (t) => {
  const state = await fixture(t);
  const result = await transcriptResult(state, transcriptRows());
  const managed = await state.store.resolveMediaSource("demo", state.source);
  await writeFile(managed.filePath, "changed managed source bytes", "utf8");
  const reader = new AnalysisReader({ rootDir: state.rootDir, projectStore: state.store });
  const verification = await reader.verify("demo", { resultId: result.id });
  assert.equal(verification.results[result.id].status, "stale");
  assert.equal((await state.store.readResult("demo", result.id)).data.sourceVersion, state.identity.sourceVersion);
});

test("observer exposes specific analysis routes without treating suffixes as project IDs", async (t) => {
  const state = await fixture(t);
  await transcriptResult(state, transcriptRows());
  const server = createPadStudioServer({ reader: new ProjectReader(state.rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const summary = await fetch(base + "/api/projects/demo/analysis");
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).view, "summary");
  const detail = await fetch(base + "/api/projects/demo?view=summary");
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).context.view, "summary");
  const invalid = await fetch(base + "/api/projects/demo/analysis/query?view=transcript");
  assert.equal(invalid.status, 400);
});
