import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { annotationFor, escapeData, escapeProperty } from "../scripts/lib/github-test-reporter.mjs";

const reporter = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lib", "github-test-reporter.mjs");

test("annotations escape GitHub workflow-command characters", () => {
  assert.equal(escapeData("50% done\r\nnext"), "50%25 done%0D%0Anext");
  assert.equal(escapeProperty("a:b,c"), "a%3Ab%2Cc");
  assert.equal(annotationFor({ name: "no file", details: { error: new Error("boom") } }), "::error title=Test failed%3A no file::boom\n");
});

test("each failing test becomes one error annotation pointing at its file and line", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-reporter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "sample.test.mjs");
  await writeFile(file, [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'test("passes", () => {});',
    'test("fails, with: punctuation", () => { assert.equal(1, 2, "one is not two\\nsecond line"); });',
    'test("group", async (t) => { await t.test("inner fails", () => { throw new Error("inner"); }); });'
  ].join("\n"));
  // A child of the test runner inherits NODE_TEST_CONTEXT and would report to the parent instead of using reporters.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  const output = await new Promise((resolveRun) => execFile(process.execPath,
    ["--test", "--test-reporter", pathToFileURL(reporter).href, "--test-reporter-destination", "stdout", file],
    { cwd: directory, env, windowsHide: true }, (_error, stdout) => resolveRun(stdout)));
  const lines = output.trim().split("\n").filter(Boolean);
  assert.ok(lines.every((line) => line.startsWith("::error file=sample.test.mjs,line=")), output);
  assert.ok(lines.some((line) => line.includes("title=Test failed%3A fails%2C with%3A punctuation::one is not two%0Asecond line")), output);
  assert.ok(lines.some((line) => line.includes("title=Test failed%3A inner fails::inner")), output);
  assert.equal(lines.some((line) => line.includes("passes")), false);
});
