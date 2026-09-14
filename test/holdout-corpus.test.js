import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lockHoldoutCorpus } from "../src/release/holdout-corpus.js";

const characteristics = { audioMinutes: 90, clipCount: 36, cleanVietnameseMinutes: 20, hardVietnameseMinutes: 20, noSpeechMinutes: 10, timingBoundaryCount: 300, sceneClipCount: 12, hardCutCount: 100, splitBySpeakerAndSource: true, humanVerifiedGold: true };

test("holdout locker binds media, gold labels, rights and characteristics to one digest", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-holdout-")); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "clip.mp4"), "media"); await writeFile(join(root, "gold.json"), "{}");
  const input = { id: "holdout-1", description: "Independent corpus", rights: { confirmed: true, basis: "Owner-cleared", verifiedBy: "owner" }, characteristics,
    entries: [{ id: "clip-1", kind: "video", path: "clip.mp4", goldFiles: ["gold.json"] }] };
  const first = await lockHoldoutCorpus(input, { baseDirectory: root, now: () => "2026-09-14T00:00:00.000Z" });
  const second = await lockHoldoutCorpus(input, { baseDirectory: root, now: () => "2026-09-14T00:00:00.000Z" });
  assert.equal(first.corpus.manifestSha256, second.corpus.manifestSha256);
  assert.match(first.corpus.manifestSha256, /^[a-f0-9]{64}$/); assert.equal(first.corpus.rightsConfirmed, true);
  await writeFile(join(root, "clip.mp4"), "changed");
  assert.notEqual((await lockHoldoutCorpus(input, { baseDirectory: root, now: () => "2026-09-14T00:00:00.000Z" })).corpus.manifestSha256, first.corpus.manifestSha256);
});

test("holdout locker rejects unconfirmed rights and missing human gold", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-holdout-invalid-")); t.after(() => rm(root, { recursive: true, force: true })); await writeFile(join(root, "clip.mp4"), "media");
  const input = { id: "holdout", description: "x", rights: { confirmed: false }, characteristics, entries: [{ id: "clip", kind: "video", path: "clip.mp4", goldFiles: [] }] };
  await assert.rejects(lockHoldoutCorpus(input, { baseDirectory: root }), /rights/);
  input.rights = { confirmed: true, basis: "owner", verifiedBy: "owner" };
  await assert.rejects(lockHoldoutCorpus(input, { baseDirectory: root }), /gold file/);
});

test("holdout locker rejects ambiguous fields, invalid counts and timestamps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "padstudio-holdout-contract-")); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "clip.mp4"), "media"); await writeFile(join(root, "gold.json"), "{}");
  const input = { id: "holdout", description: "x", rights: { confirmed: true, basis: "owner", verifiedBy: "owner" }, characteristics,
    entries: [{ id: "clip", kind: "video", path: "clip.mp4", goldFiles: ["gold.json"] }] };
  await assert.rejects(lockHoldoutCorpus({ ...input, extra: true }, { baseDirectory: root }), /unsupported fields/);
  await assert.rejects(lockHoldoutCorpus({ ...input, characteristics: { ...characteristics, clipCount: 1.5 } }, { baseDirectory: root }), /must be an integer/);
  await assert.rejects(lockHoldoutCorpus(input, { baseDirectory: root, now: () => "not-a-date" }), /canonical ISO timestamp/);
});
