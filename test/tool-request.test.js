import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readToolRequest } from "../src/cli/tool-request.js";

const request = {
  capability: "media.inspect",
  tool: "ffprobe",
  purpose: "Inspect source media",
  inputs: { resourceId: "resource-123" }
};

test("tool request accepts a JSON object directly", async () => {
  assert.deepEqual(await readToolRequest(JSON.stringify(request)), request);
});

test("tool request accepts JSON from standard input", async () => {
  assert.deepEqual(
    await readToolRequest("-", { readInput: async () => JSON.stringify(request) }),
    request
  );
});

test("tool request keeps support for a JSON file", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-tool-request-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "request.json"), "\uFEFF" + JSON.stringify(request), "utf8");

  assert.deepEqual(
    await readToolRequest("request.json", { baseDirectory: workspace }),
    request
  );
});

test("tool request rejects malformed direct JSON and non-object JSON", async () => {
  await assert.rejects(readToolRequest("{invalid"), /không phải JSON hợp lệ/);
  await assert.rejects(readToolRequest("[1, 2]"), /phải là một JSON object/);
});
