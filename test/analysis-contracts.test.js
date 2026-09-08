import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AnalysisValidationError,
  canonicalJson,
  normalizeAnalysisRequest,
  normalizeSourceReference,
  ptsToSourceSeconds,
  validateAnalysisResultData
} from "../src/analysis/contracts.js";
import {
  analysisFingerprint,
  hashFileStable,
  sourceKeyFor
} from "../src/analysis/source-identity.js";

test("canonical JSON and source identity are stable across object key order", async () => {
  const left = { z: [3, { b: true, a: "á" }], a: -0 };
  const right = { a: 0, z: [3, { a: "á", b: true }] };
  assert.equal(canonicalJson(left), '{"a":0,"z":[3,{"a":"á","b":true}]}');
  assert.equal(analysisFingerprint(left), analysisFingerprint(right));

  const source = { kind: "resource", id: "resource-1", itemPath: "clip/video.mp4" };
  const golden = JSON.parse(await readFile(
    new URL("../eval/source-understanding/source-identity-golden.json", import.meta.url),
    "utf8"
  ));
  assert.equal(canonicalJson(golden.value), golden.canonicalJson);
  assert.equal(sourceKeyFor("demo", source), golden.sha256);
  assert.deepEqual(normalizeSourceReference(source), source);
});

test("canonical identity rejects unsafe paths and non-finite numbers", () => {
  assert.throws(
    () => normalizeSourceReference({ kind: "resource", id: "resource-1", itemPath: "../clip.mp4" }),
    AnalysisValidationError
  );
  assert.throws(() => canonicalJson({ duration: Number.NaN }), /không hữu hạn/);
  assert.throws(() => canonicalJson({ missing: undefined }), /undefined/);
});

test("PTS conversion uses the declared time base and stream offset", () => {
  assert.ok(Math.abs(ptsToSourceSeconds(13_500, "1/90000", 0.1) - 0.05) < 1e-12);
  assert.equal(ptsToSourceSeconds(0, { numerator: 1, denominator: 1000 }, 0), 0);
  assert.throws(() => ptsToSourceSeconds(1, "1/0"), /số nguyên dương/);
});

test("stable file hashing detects a source that changes while it is read", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-source-hash-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "source.bin");
  await writeFile(path, "stable bytes", "utf8");
  const first = await hashFileStable(path);
  const second = await hashFileStable(path);
  assert.equal(first.sourceVersion, second.sourceVersion);
  assert.equal(first.sizeBytes, 12);
  assert.equal(first.fingerprintMethod, "sha256-full-file-v1");
});

test("analysis Result metadata is strict, bounded and keeps technical review separate", () => {
  const hash = "a".repeat(64);
  const data = validateAnalysisResultData({
    schemaVersion: "1.0",
    source: { kind: "result", id: "result-1", file: "primary" },
    sourceKey: hash,
    sourceVersion: hash,
    operation: "transcript",
    analysisJobId: null,
    unitId: null,
    fingerprint: hash,
    coverage: { startSeconds: 0, endSeconds: 3, mode: "continuous" },
    method: { profileId: "large-v3-gpu-fp16" },
    outcome: "empty",
    emptyReason: "no_speech_detected",
    counts: { segments: 0 },
    datasets: [],
    warnings: [],
    contentReview: "not_performed"
  });
  assert.equal(data.outcome, "empty");
  assert.equal(data.contentReview, "not_performed");
  assert.throws(() => validateAnalysisResultData({ ...data, emptyReason: undefined }), /emptyReason/);
  assert.throws(() => validateAnalysisResultData({ ...data, surprise: true }), /không được hỗ trợ/);
  assert.throws(
    () => validateAnalysisResultData({ ...data, details: { text: "x".repeat(40_000) } }),
    /vượt giới hạn/
  );
  assert.throws(
    () => validateAnalysisResultData(data, { resultType: "source.metadata" }),
    /yêu cầu operation probe/
  );
});

test("analysis request validates explicit profile and per-source overrides", () => {
  const hash = "b".repeat(64);
  const request = normalizeAnalysisRequest({
    version: "1.0",
    sources: [{ kind: "resource", id: "resource-1", itemPath: null }],
    operations: ["probe"],
    profiles: { probe: "  probe-v1  " },
    ranges: { [`${hash}:probe`]: { startSeconds: 1, endSeconds: 2 } },
    tracks: { [hash]: { probe: 0 } },
    options: { probe: { decodeCheck: "sampled" } }
  });
  assert.equal(request.ranges[`${hash}:probe`].endSeconds, 2);
  assert.equal(request.tracks[hash].probe, 0);
  assert.equal(request.profiles.probe, "probe-v1");
  assert.throws(
    () => normalizeAnalysisRequest({ ...request, profiles: { unknown: "x" } }),
    /nhóm không hỗ trợ/
  );
  assert.throws(
    () => normalizeAnalysisRequest({ ...request, ranges: { probe: { startSeconds: 2, endSeconds: 1 } } }),
    /interval/
  );
  assert.throws(
    () => normalizeAnalysisRequest({ ...request, options: { typo: { decodeCheck: true } } }),
    /override key không hợp lệ/
  );
});
