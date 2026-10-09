import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyProjectFinish, planProjectFinish, ProjectFinishError, readProjectReleases } from "../src/operations/project-finish.js";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";

const tool = { name: "finish-tool", version: "1", provider: "test" };

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-finish-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new ProjectStore(join(workspace, "projects"));
  await store.createProject({ projectId: "demo", title: "Demo" });
  return { store, root: join(workspace, "projects", "demo") };
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

// A completed Run with one Result holding the given files.
async function completedRun(store, { type = "media.metadata", files = { "clip.mp4": "video-bytes" }, data = {}, finish = true } = {}) {
  const run = await store.startRun("demo", { capability: "media.inspect", purpose: "test", tool });
  const output = await store.createRunOutputWorkspace("demo", run.id);
  const registered = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(output.temporaryDirectory, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
    registered.push({ id: name.replace(/[^a-z0-9]/gi, "-"), role: "primary", path: `outputs/${run.id}/${name}`,
      name, mediaType: /.wav$/.test(name) ? "audio" : /.tsx$/.test(name) ? "text/tsx" : "video", sizeBytes: Buffer.byteLength(content) });
  }
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult("demo", {
    runId: run.id, type, name: "Result", capability: "media.inspect", inputResources: [],
    files: registered, tool, data, verification: { status: "passed", checks: [] }
  });
  if (finish) await store.finishRun("demo", run.id, { status: "completed", outputs: [result.id] });
  return { run, result };
}

// Old drafts, the approved render, and a Delivery bundle exported from it.
async function deliveredProject(store) {
  const draft = await completedRun(store, { files: { "draft.mp4": "draft-bytes-1", "frames/a.png": "frame" } });
  const draft2 = await completedRun(store, { files: { "draft2.mp4": "draft-bytes-2" } });
  const final = await completedRun(store, { files: { "final.mp4": "final-bytes", "frames/f.png": "final-frame" } });
  const decision = await store.recordDecision("demo", { resultId: final.result.id, outcome: "accepted" });
  const delivery = await completedRun(store, {
    type: "delivery.bundle", files: { "video/output.mp4": "final-bytes", "metadata/manifest.json": "{}" },
    data: { sourceResultId: final.result.id, approvalDecisionId: decision.id }
  });
  return { draft, draft2, final, delivery, decision };
}

test("a project without a chosen final version is not finishable", async (t) => {
  const { store } = await fixture(t);
  await completedRun(store);
  const plan = await planProjectFinish(store, "demo");
  assert.equal(plan.status, "not_finishable");
  assert.equal(plan.reason, "no_delivery");
  await assert.rejects(applyProjectFinish(store, "demo"), (error) => error instanceof ProjectFinishError && error.code === "no_delivery");
});

test("a Delivery whose approval is missing is refused", async (t) => {
  const { store } = await fixture(t);
  const final = await completedRun(store, { files: { "final.mp4": "final-bytes" } });
  await completedRun(store, { type: "delivery.bundle", files: { "video/output.mp4": "final-bytes" },
    data: { sourceResultId: final.result.id, approvalDecisionId: "decision-missing" } });
  assert.equal((await planProjectFinish(store, "demo")).reason, "not_accepted");
});

test("a Run still in progress blocks finishing", async (t) => {
  const { store } = await fixture(t);
  await deliveredProject(store);
  await store.startRun("demo", { capability: "media.inspect", purpose: "busy", tool });
  assert.equal((await planProjectFinish(store, "demo")).reason, "run_in_progress");
});

test("a damaged Delivery is never treated as the final version", async (t) => {
  const { store, root } = await fixture(t);
  const { delivery } = await deliveredProject(store);
  await writeFile(join(root, "outputs", delivery.run.id, "video", "output.mp4"), "tampered-bytes");
  const plan = await planProjectFinish(store, "demo");
  assert.equal(plan.reason, "delivery_not_intact");
});

test("the plan keeps the Delivery and its source and lists everything else", async (t) => {
  const { store } = await fixture(t);
  const { final, delivery } = await deliveredProject(store);
  const plan = await planProjectFinish(store, "demo");
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.keep.deliveryResultId, delivery.result.id);
  assert.deepEqual(plan.keep.sourceResultId, final.result.id);
  assert.equal(plan.release.files, 3);
  assert.equal(plan.release.bytes, Buffer.byteLength("draft-bytes-1") + Buffer.byteLength("frame") + Buffer.byteLength("draft-bytes-2"));
  assert.ok(plan.files.every((file) => ![delivery.result.id, final.result.id].includes(file.resultId)));
});

test("finishing releases every other file, keeps the final ones and leaves all records", async (t) => {
  const { store, root } = await fixture(t);
  const { draft, draft2, final, delivery } = await deliveredProject(store);
  const resultsBefore = (await readdir(join(root, "results"))).sort();

  const outcome = await applyProjectFinish(store, "demo");
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.integrity, "verified");
  assert.equal(outcome.releasedFiles, 3);

  assert.equal(await exists(join(root, "outputs", draft.run.id)), false, "empty output directories are removed");
  assert.equal(await exists(join(root, "outputs", draft2.run.id)), false);
  assert.equal(await exists(join(root, "outputs", final.run.id, "final.mp4")), true);
  assert.equal(await exists(join(root, "outputs", final.run.id, "frames", "f.png")), true);
  assert.equal(await exists(join(root, "outputs", delivery.run.id, "video", "output.mp4")), true);
  assert.deepEqual((await readdir(join(root, "results"))).sort(), resultsBefore, "Result records are immutable and stay");

  const results = new Map((await store.readResults("demo")).map((result) => [result.id, result]));
  assert.ok(results.get(draft.result.id).files.every((file) => file.released && !file.available));
  assert.ok(results.get(final.result.id).files.every((file) => file.available && !file.released));
  for (const file of delivery.result.files) await store.verifyResultFile("demo", delivery.result.id, file.id);

  const [record] = await readProjectReleases(store, "demo");
  assert.equal(record.kind, "project_finish");
  assert.equal(record.files.length, 3);
  assert.equal(record.outcome.integrity, "verified");
  assert.equal(record.kept.deliveryResultId, delivery.result.id);
});

test("finishing twice changes nothing the second time", async (t) => {
  const { store } = await fixture(t);
  await deliveredProject(store);
  await applyProjectFinish(store, "demo");
  const again = await applyProjectFinish(store, "demo");
  assert.equal(again.status, "nothing_to_do");
  assert.equal(again.bytesFreed, 0);
  assert.equal((await readProjectReleases(store, "demo")).length, 1);
});

test("only the newest Delivery survives when a project was delivered more than once", async (t) => {
  const { store } = await fixture(t);
  const { final } = await deliveredProject(store);
  const decision = await store.recordDecision("demo", { resultId: final.result.id, outcome: "accepted" });
  const newest = await completedRun(store, { type: "delivery.bundle", files: { "video/output.mp4": "final-bytes" },
    data: { sourceResultId: final.result.id, approvalDecisionId: decision.id } });
  const plan = await planProjectFinish(store, "demo");
  assert.equal(plan.keep.deliveryResultId, newest.result.id);
  await applyProjectFinish(store, "demo");
  const bundles = (await store.readResults("demo")).filter((result) => result.type === "delivery.bundle");
  assert.equal(bundles.filter((bundle) => bundle.files.every((file) => file.available)).length, 1);
});

test("after finishing, the observer shows only what still exists and reports a healthy project", async (t) => {
  const { store } = await fixture(t);
  const { draft, final, delivery } = await deliveredProject(store);
  const reader = new ProjectReader(store.rootDir);
  assert.ok((await reader.readObserverSection("demo", "activity")).results.some((result) => result.id === draft.result.id));
  await applyProjectFinish(store, "demo");
  const ids = (await reader.readObserverSection("demo", "activity")).results.map((result) => result.id);
  assert.ok(!ids.includes(draft.result.id));
  assert.ok(ids.includes(final.result.id) && ids.includes(delivery.result.id));
  const health = (await reader.readObserverSection("demo", "health")).health;
  assert.ok(!health.issues.some((issue) => ["missing_result_files", "blocked_active_production"].includes(issue.code)));
});

test("audio and text the final render was made from survive; video and image intermediates do not", async (t) => {
  const { store, root } = await fixture(t);
  const narration = await completedRun(store, { type: "audio.tts", files: { "narration.wav": "voice" } });
  const script = await completedRun(store, { type: "animation.source-package", files: { "Scene.tsx": "code" } });
  const clip = await completedRun(store, { type: "animation.render", files: { "clip.mp4": "clip-bytes" },
    data: { sourceResultId: script.result.id } });
  const unrelated = await completedRun(store, { type: "audio.tts", files: { "old-take.wav": "old-voice" } });
  const final = await completedRun(store, { files: { "final.mp4": "final-bytes" }, data: { narrationResultId: narration.result.id } });
  const decision = await store.recordDecision("demo", { resultId: final.result.id, outcome: "accepted" });
  await completedRun(store, { type: "delivery.bundle", files: { "video/output.mp4": "final-bytes" },
    data: { sourceResultId: final.result.id, approvalDecisionId: decision.id } });
  // The final render also used the animation clip.
  const finalRecord = JSON.parse(await readFile(join(root, "results", final.result.id + ".json"), "utf8"));
  finalRecord.inputResults = [clip.result.id];
  await writeFile(join(root, "results", final.result.id + ".json"), JSON.stringify(finalRecord));

  const plan = await planProjectFinish(store, "demo");
  assert.deepEqual(plan.keep.assets.map((asset) => asset.name).sort(), ["Scene.tsx", "narration.wav"]);
  await applyProjectFinish(store, "demo");
  const byId = new Map((await store.readResults("demo")).map((result) => [result.id, result]));
  assert.ok(byId.get(narration.result.id).files.every((file) => file.available), "narration is kept");
  assert.ok(byId.get(script.result.id).files.every((file) => file.available), "animation source is kept");
  assert.ok(byId.get(clip.result.id).files.every((file) => file.released), "the intermediate clip is released");
  assert.ok(byId.get(unrelated.result.id).files.every((file) => file.released), "audio the final never used is released");
});
