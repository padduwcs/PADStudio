import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeOutputEntries, scanOutputDirectory } from "../src/project/output-sweep.js";

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-sweep-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function put(directory, relative, content = "x") {
  const path = join(directory, ...relative.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

test("a scan keeps registered files and reports unregistered ones, collapsing whole directories", async (t) => {
  const directory = await workspace(t);
  await put(directory, "animation.mp4", "video!");
  await put(directory, "poster.jpg", "jpg");
  await put(directory, "workspace/src/film.tsx", "source");
  await put(directory, "workspace/node_modules/.cache/pack.bin", "cachecache");
  await put(directory, "home/app-data/x", "h");
  await put(directory, "frames/frame-1.png", "png-registered");
  await put(directory, "frames/scratch.tmp", "tmp");

  const scan = await scanOutputDirectory(directory, ["animation.mp4", "poster.jpg", "frames/frame-1.png"]);

  assert.deepEqual(scan.registered, { bytes: 6 + 3 + 14, files: 3 });
  const paths = scan.unregistered.entries.map((entry) => `${entry.kind}:${entry.path}`).sort();
  assert.deepEqual(paths, ["directory:home", "directory:workspace", "file:frames/scratch.tmp"]);
  const workspaceEntry = scan.unregistered.entries.find((entry) => entry.path === "workspace");
  assert.equal(workspaceEntry.bytes, "source".length + "cachecache".length);
  assert.equal(workspaceEntry.files, 2);
  assert.equal(scan.unregistered.bytes, "source".length + "cachecache".length + 1 + 3);
  assert.equal(scan.unregistered.files, 4);
});

test("registered paths match regardless of letter case and slash style, so a file is never wrongly removed", async (t) => {
  const directory = await workspace(t);
  await put(directory, "Output/Video.MP4", "v");
  const scan = await scanOutputDirectory(directory, ["output\\video.mp4"]);
  assert.equal(scan.registered.files, 1);
  assert.deepEqual(scan.unregistered.entries, []);
});

test("a directory that holds no registered file but is empty is still an entry to remove", async (t) => {
  const directory = await workspace(t);
  await put(directory, "keep.bin", "k");
  await mkdir(join(directory, "empty", "nested"), { recursive: true });
  const scan = await scanOutputDirectory(directory, ["keep.bin"]);
  assert.deepEqual(scan.unregistered.entries.map((entry) => [entry.path, entry.bytes, entry.files]), [["empty", 0, 0]]);
});

test("removal deletes only the listed entries and leaves registered files byte-identical", async (t) => {
  const directory = await workspace(t);
  await put(directory, "animation.mp4", "the real video");
  await put(directory, "workspace/a/b/c.txt", "scratch");
  await put(directory, "report.json", "{}");
  await put(directory, "frames/keep.png", "png");
  await put(directory, "frames/drop.png", "png2");

  const scan = await scanOutputDirectory(directory, ["animation.mp4", "report.json", "frames/keep.png"]);
  const outcome = await removeOutputEntries(directory, scan.unregistered.entries);

  assert.deepEqual(outcome.failed, []);
  assert.equal(outcome.removed.length, 2);
  assert.deepEqual((await readdir(directory)).sort(), ["animation.mp4", "frames", "report.json"]);
  assert.deepEqual(await readdir(join(directory, "frames")), ["keep.png"]);
  assert.equal(await readFile(join(directory, "animation.mp4"), "utf8"), "the real video");

  const again = await removeOutputEntries(directory, scan.unregistered.entries);
  assert.ok(again.removed.every((entry) => entry.alreadyGone), "repeating a removal is harmless");
});

test("removal refuses traversal, empty paths and anything outside the directory", async (t) => {
  const directory = await workspace(t);
  const outside = await workspace(t);
  await put(outside, "precious.txt", "do not delete");
  await put(directory, "ok.txt", "ok");
  const outcome = await removeOutputEntries(directory, [
    { path: "../" + outside.split(/[\\/]/).at(-1) + "/precious.txt", kind: "file", bytes: 1, files: 1 },
    { path: "", kind: "directory", bytes: 0, files: 0 },
    { path: "a//b", kind: "file", bytes: 0, files: 0 },
    { path: "..", kind: "directory", bytes: 0, files: 0 },
    { path: "ok.txt", kind: "file", bytes: 2, files: 1 }
  ]);
  assert.equal(outcome.failed.length, 4);
  assert.equal(outcome.removed.length, 1);
  assert.equal(await readFile(join(outside, "precious.txt"), "utf8"), "do not delete");
  await assert.rejects(stat(join(directory, "ok.txt")), { code: "ENOENT" });
});

test("symbolic links are neither followed nor removed", async (t) => {
  const directory = await workspace(t);
  const target = await workspace(t);
  await put(target, "data.txt", "outside data");
  await put(directory, "keep.bin", "k");
  try {
    await symlink(target, join(directory, "link"), "junction");
  } catch (error) {
    t.skip("symbolic links are not available here: " + error.code);
    return;
  }
  const scan = await scanOutputDirectory(directory, ["keep.bin"]);
  assert.deepEqual(scan.symbolicLinks, ["link"]);
  assert.deepEqual(scan.unregistered.entries, []);
  const outcome = await removeOutputEntries(directory, [{ path: "link", kind: "directory", bytes: 0, files: 0 }]);
  assert.equal(outcome.failed.length, 1, "a link entry is refused");
  assert.equal(await readFile(join(target, "data.txt"), "utf8"), "outside data");
});
