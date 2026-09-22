import assert from "node:assert/strict";
import test from "node:test";
import { resolveRemotionPreviewRange } from "../src/animation/remotion-preview-range.js";

function fixture({ runtime = "remotion", preflightStatus = "passed" } = {}) {
  const artifact = {
    id: "artifact-composition-r2", key: "main-film", revision: 2, type: "animation.composition",
    data: { runtime, durationSeconds: 60, sourceResultId: "source-r2", propsResultId: "props-r2" },
  };
  const preflight = {
    id: "preflight-r2", type: "animation.preflight",
    data: { status: preflightStatus, runtime, composition: { id: artifact.id, revision: 2 },
      sourceResultId: "source-r2", propsResultId: "props-r2", validationResultId: "validation-r2" },
  };
  return {
    store: {
      readArtifacts: async () => [{ ...artifact, revision: 1 }, artifact],
      readResults: async () => [preflight],
      readContext: async () => ({ intelligence: { activeArtifacts: [{ id: artifact.id, revision: artifact.revision }] } }),
    },
    artifact,
  };
}

test("preview-range resolves the active revision's exact passed dependencies", async () => {
  const { store } = fixture();
  const request = await resolveRemotionPreviewRange(store, "demo", "main-film", 12.5, 17);
  assert.equal(request.tool, "remotion-preview");
  assert.deepEqual(request.inputs, {
    artifactId: "artifact-composition-r2", artifactRevision: 2,
    validationResultId: "validation-r2", preflightResultId: "preflight-r2",
    range: { startSeconds: 12.5, endSeconds: 17 },
  });
});

test("preview-range refuses unsupported runtime and missing passed preflight", async () => {
  await assert.rejects(resolveRemotionPreviewRange(fixture({ runtime: "manim" }).store, "demo", "main-film", 0, 2), /supports Remotion/);
  await assert.rejects(resolveRemotionPreviewRange(fixture({ preflightStatus: "failed" }).store, "demo", "main-film", 0, 2), /no passed exact/);
});
