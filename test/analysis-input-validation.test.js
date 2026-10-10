import assert from "node:assert/strict";
import test from "node:test";
import { SourceAnalysisToolError, validateAnalysisInputs } from "../src/tools/source-analysis-common.js";

const hash = "a".repeat(64);
const source = { kind: "result", id: "result-source", file: "primary" };

function inputs(analysis) {
  return { source, analysis: { schemaVersion: "1.0", operation: "transcript", sourceKey: hash, sourceVersion: hash, range: null, options: {}, ...analysis } };
}

test("analysis input prepared by the analysis service is accepted", () => {
  const normalized = validateAnalysisInputs(inputs({ language: "vi" }), "transcript");
  assert.equal(normalized.analysis.language, "vi");
  assert.equal(normalized.analysis.sourceKey, hash);
});

test("a schema or operation mismatch names each wrong field and what was received", () => {
  assert.throws(
    () => validateAnalysisInputs(inputs({ schemaVersion: undefined, operation: "audio" }), "transcript"),
    (error) => error instanceof SourceAnalysisToolError && error.code === "invalid_input" &&
      /schemaVersion phải là "1\.0" \(nhận không có\)/.test(error.message) &&
      /operation phải là "transcript" \(nhận "audio"\)/.test(error.message)
  );
  assert.throws(
    () => validateAnalysisInputs(inputs({ schemaVersion: "2.0" }), "transcript"),
    (error) => /schemaVersion phải là "1\.0" \(nhận "2\.0"\)/.test(error.message) && !/operation phải/.test(error.message)
  );
});

test("a direct tool run without the service's source identity is refused up front and points to project:analyze", () => {
  const bare = { source, analysis: { schemaVersion: "1.0", operation: "transcript", range: null, language: "vi", options: {} } };
  assert.throws(
    () => validateAnalysisInputs(bare, "transcript"),
    (error) => error instanceof SourceAnalysisToolError && error.code === "analysis_service_required" &&
      /thiếu sourceKey, sourceVersion/.test(error.message) && /project:analyze/.test(error.message)
  );
  // Naming only one of the two is still incomplete, and the message names the one that is missing.
  assert.throws(
    () => validateAnalysisInputs(inputs({ sourceVersion: undefined }), "transcript"),
    (error) => error.code === "analysis_service_required" && /thiếu sourceVersion\./.test(error.message)
  );
});
