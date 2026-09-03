import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readJsonInput } from "../src/cli/json-input.js";

const value = { capability: "media.inspect", inputs: { resourceId: "resource-123" } };

test("JSON input accepts an object directly", async () => {
  assert.deepEqual(await readJsonInput(JSON.stringify(value)), value);
});

test("JSON input accepts an object from standard input", async () => {
  assert.deepEqual(
    await readJsonInput("-", { readInput: async () => JSON.stringify(value) }),
    value
  );
});

test("JSON input keeps support for a file", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-json-input-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "request.json"), "\uFEFF" + JSON.stringify(value), "utf8");
  assert.deepEqual(await readJsonInput("request.json", { baseDirectory: workspace }), value);
});

test("JSON input rejects malformed and non-object JSON", async () => {
  await assert.rejects(readJsonInput("{invalid"), /không phải JSON hợp lệ/);
  await assert.rejects(readJsonInput("[1, 2]"), /phải là một JSON object/);
});
