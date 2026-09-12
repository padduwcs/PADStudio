import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { importProjectInput } from "../src/resources/project-importer.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { normalizeSequence, compareSequences } from "../src/production/video-sequence.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

const exec = promisify(execFile);
const segment = (id, visual = null, rest = {}) => ({ id, title: id, intent: "Show the subject clearly", durationSeconds: 1, visual, ...rest });
const sequence = (segments, changeReason = "Initial proposal") => ({ version: "1.0", changeReason, format: { width: 320, height: 180, fps: 25 }, segments });
const briefData = (purpose) => ({
  version: "1.0",
  purpose,
  audience: "People learning the subject.",
  desiredOutcome: "The viewer understands the intended point.",
  constraints: [], knownFacts: [], assumptions: [], openQuestions: [],
});
const directionData = (briefArtifactId, principle) => ({
  version: "1.0",
  basis: { kind: "direct", briefArtifactId },
  selectionReason: "The direction is set directly for this production test.",
  principles: [principle],
  avoidances: [],
  reviewCriteria: ["The rendered segment serves its stated intent."],
  sample: null,
});
async function fixture(t, projectFolder = "projects") {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-sequence-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, projectFolder);
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Sequence test" });
  const save = (data, extra = {}) => store.recordArtifact("demo", { key: "film", type: "video.sequence", name: "Film", summary: "Test production", data, ...extra });
  return { workspace, rootDir, store, save };
}

test("sequence supports unresolved ideas, validates timing and rejects raw media paths", async (t) => {
  const { store, save } = await fixture(t);
  const first = await save(sequence([segment("opening", null, { narration: { text: "Hello" } })]));
  assert.equal(first.data.segments[0].visual, null);
  const assembler = new ProjectContextAssembler({ projectStore: store });
  const context = await assembler.build("demo");
  assert.deepEqual(context.production.sequences[0].segments[0].blockers, ["missing_visual", "missing_narration_audio"]);
  const summary = await assembler.buildSummary("demo");
  assert.equal(summary.checkpointFreshness.status, "missing");
  assert.equal(summary.production.activeSequences[0].artifactId, first.id);
  assert.deepEqual(
    summary.production.activeSequences[0].blockedSegments[0].blockers,
    ["missing_visual", "missing_narration_audio"]
  );
  assert.deepEqual(summary.production.pendingFinalizations, []);
  assert.deepEqual(summary.resumeView.affectedWorkItems, []);
  await assert.rejects(save({}, { expectedRevision: 1 }), /version/);
  assert.throws(() => normalizeSequence(sequence([segment("a"), segment("a")])), /unique/);
  assert.throws(() => normalizeSequence(sequence([segment("a", { source: { kind: "resource", id: "x", path: "C:/raw.mp4" } })])), /unsupported fields/);
  assert.throws(() => normalizeSequence(sequence([segment("a", null, { captions: [{ text: "Too late", startSeconds: 0, endSeconds: 2 }] })])), /between/);
  assert.throws(() => normalizeSequence(sequence([segment("a", null, { durationSeconds: 1.01 })])), /frame/);
  await assert.rejects(save(sequence([segment("a")]), { expectedRevision: 0 }), /revision conflict/);
  const second = await save(sequence([segment("a")], "Replace draft"), { expectedRevision: first.revision });
  assert.equal(second.revision, 2);
  assert.equal((await store.readArtifacts("demo")).length, 2);
});

test("dependency impact propagates without deleting historical approvals or selecting new work", async (t) => {
  const { store, save, rootDir } = await fixture(t);
  const brief = (message, expectedRevision) => store.recordArtifact("demo", {
    key: "brief", type: "project.brief", name: "Brief", summary: message,
    data: briefData(message), ...(expectedRevision ? { expectedRevision } : {}),
  });
  const a = await brief("A");
  const film = await save(sequence([segment("opening", null, { references: [{ kind: "artifact", id: a.id }] })]));
  await store.recordReview("demo", { target: { kind: "artifact", id: film.id }, verdict: "passed", summary: "Approved planning shape",
    criteria: [{ id: "intent", criterion: "intent", status: "passed", evidence: "Opening serves brief A." }] });
  await brief("B", a.revision);
  const reopened = await new ProjectContextAssembler({ projectStore: new ProjectStore(rootDir) }).build("demo");
  assert.equal(reopened.production.sequences[0].active, true);
  assert.equal(reopened.production.sequences[0].reasons[0].reason, "not_active_revision");
  assert.equal(reopened.reviews.length, 1);
  assert.equal(reopened.resumeView.activeWorkflowId, null);
  const draft = await save(sequence([segment("opening")], "Draft alternative"), { expectedRevision: film.revision, status: "draft" });
  const again = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(again.production.sequences.find((s) => s.active).artifactId, film.id);
  assert.equal(again.production.sequences.find((s) => s.artifactId === draft.id).active, false);
});

test("sequence diff identifies moves, removals and local changes", () => {
  const before = normalizeSequence(sequence([segment("a"), segment("b"), segment("c")]));
  const after = normalizeSequence(sequence([segment("b"), segment("a", null, { narration: { text: "New line" } })]));
  const diff = compareSequences(before, after);
  assert.deepEqual(diff.removed, ["c"]);
  assert.deepEqual(diff.segments.map((s) => [s.id, s.status, s.moved]), [["b", "unchanged", true], ["a", "changed", true]]);
});

test("workflow completion requires the promised output kind and type", async (t) => {
  const { store, save } = await fixture(t);
  const film = await save(sequence([segment("a")]));
  const request = { name: "Render", purpose: "Deliver media", items: [{
    id: "render", title: "Render", purpose: "Deliver media", status: "completed",
    expectedOutputs: [{ kind: "result", type: "video.sequence-render", description: "Rendered video" }],
    outputReferences: [{ kind: "artifact", id: film.id }], review: { required: false, criteria: [] },
  }] };
  await assert.rejects(store.writeWorkflow("demo", request), /missing expected output/);
});

test("local production renders, reuses unchanged segments, preserves reviews and fails without output on invalid sources", async (t) => {
  try { await exec("ffmpeg", ["-version"]); await exec("ffprobe", ["-version"]); }
  catch { t.skip("ffmpeg/ffprobe required"); return; }
  const { store, save, workspace, rootDir } = await fixture(t, "projects with ' quote");
  const inputPath = join(workspace, "source.png");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", "-y", inputPath]);
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath: inputPath });
  const source = { kind: "resource", id: imported.resourceId };
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const brief = await store.recordArtifact("demo", {
    key: "production-brief", type: "project.brief", name: "Production brief",
    summary: "Ground the local production direction.", data: briefData("Render a small local production."),
  });
  const direction = await store.recordArtifact("demo", {
    key: "b-direction", type: "creative.direction", name: "B direction", summary: "First version",
    data: directionData(brief.id, "Keep the mood calm."), references: [{ kind: "artifact", id: brief.id }],
  });
  const first = await save(sequence([segment("a", { source }), segment("b", { source }, { references: [{ kind: "artifact", id: direction.id }] })]));
  const firstRun = await executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Render first cut", inputs: { artifactId: first.id } });
  const r1 = firstRun.result;
  assert.equal(r1.files.length, 5);
  assert.deepEqual(r1.inputArtifacts, [first.id]);
  assert.equal(r1.verification.details.creativeReview, "not_performed");
  assert.ok(r1.data.segments.every((s) => s.reusedFrom === null));
  await store.recordDecision("demo", {
    resultId: r1.id, outcome: "accepted", note: "User accepted this exact version.",
    feedbackTarget: { artifactId: first.id, revision: first.revision }
  });
  const changedDirection = await store.recordArtifact("demo", {
    key: "b-direction", type: "creative.direction", name: "B direction", summary: "Second version",
    data: directionData(brief.id, "Make the explanation precise."), references: [{ kind: "artifact", id: brief.id }],
    expectedRevision: direction.revision,
  });
  const nextData = sequence([segment("a", { source }), segment("b", { source }, {
    references: [{ kind: "artifact", id: changedDirection.id }],
    captions: [{ text: "Bản mới <test>", startSeconds: 0, endSeconds: 0.8 }],
  })], "Change caption and local direction in b only");
  const second = await save(nextData, { expectedRevision: first.revision });
  const secondRun = await executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Revise caption", inputs: { artifactId: second.id, reuseResultId: r1.id } });
  const r2 = secondRun.result;
  assert.equal(r2.data.segments[0].reusedFrom.resultId, r1.id);
  assert.equal(r2.data.segments[1].reusedFrom, null);
  assert.equal(r2.data.segments[0].sha256, r1.data.segments[0].sha256);
  const reopened = await new ProjectContextAssembler({ projectStore: new ProjectStore(rootDir) }).build("demo");
  assert.ok(reopened.production.resultStates.find((r) => r.resultId === r1.id).reasons.length);
  assert.deepEqual(reopened.production.resultStates.find((r) => r.resultId === r2.id).reasons, []);
  assert.equal(reopened.production.sequences.find((s) => s.artifactId === first.id).renders[0].decisions.length, 1);
  assert.equal(reopened.production.sequences.find((s) => s.artifactId === second.id).renders[0].decisions.length, 0);
  await assert.rejects(executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Accidental stale render", inputs: { artifactId: first.id } }), /not current/);

  // Folder item identity and raw path validation happen before a sequence can be saved.
  await assert.rejects(save(sequence([segment("bad", { source: { kind: "resource", id: "resource-missing" } })]), { expectedRevision: second.revision }), /Unknown references/);
  const unresolved = await save(sequence([segment("pending")]), { expectedRevision: second.revision });
  const resultsBefore = (await store.readResults("demo")).length;
  await assert.rejects(executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Render unresolved idea", inputs: { artifactId: unresolved.id } }), /unresolved/);
  assert.equal((await store.readResults("demo")).length, resultsBefore);
  assert.equal((await store.readRuns("demo")).find((run) => run.purpose === "Render unresolved idea").status, "failed");
  assert.ok((await readdir(join(rootDir, "demo", "outputs"))).every((name) => !name.startsWith(".")));

  // Observer reads production and only serves registered preview/frame IDs.
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(origin + "/api/projects/demo");
  const payload = await response.json();
  assert.equal(payload.context.production.sequences.length, 3);
  assert.equal((await fetch(origin + "/project-results/demo/" + r2.id + "/frame-1")).status, 200);
  assert.equal((await fetch(origin + "/api/projects/demo", { method: "POST" })).status, 404);
});


test("narration is explicit, long audio is rejected, and source-byte changes invalidate segment reuse", async (t) => {
  try { await exec("ffmpeg", ["-version"]); await exec("ffprobe", ["-version"]); }
  catch { t.skip("ffmpeg/ffprobe required"); return; }
  const { store, save, workspace, rootDir } = await fixture(t);
  const videoPath = join(workspace, "clip.mp4");
  const voicePath = join(workspace, "voice.wav");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x120:r=25:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", videoPath]);
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=0.8", "-y", voicePath]);
  const video = await importProjectInput({ rootDir, projectId: "demo", sourcePath: videoPath });
  const voice = await importProjectInput({ rootDir, projectId: "demo", sourcePath: voicePath });
  const visual = { source: { kind: "resource", id: video.resourceId }, volume: 0.2 };
  const narration = { text: "Test narration; generated tone is only a test fixture", source: { kind: "resource", id: voice.resourceId } };
  const film = await save(sequence([segment("a", visual, { narration })]));
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const render = (artifactId, rest = {}) => executor.execute("demo", {
    capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Audio test", inputs: { artifactId, ...rest },
  });
  const first = await render(film.id);
  assert.equal(first.result.verification.details.speechContentReview, "not_performed");
  const storedVoice = await store.resolveMediaSource("demo", narration.source);
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=900:duration=0.8", "-y", storedVoice.filePath]);
  const second = await render(film.id, { reuseResultId: first.resultId });
  assert.equal(second.result.data.segments[0].reusedFrom, null);
  assert.notEqual(second.result.data.segments[0].sourceHashes.narration, first.result.data.segments[0].sourceHashes.narration);

  const invalid = await save(sequence([segment("bad", visual, { durationSeconds: 0.4, narration })], "Too short"), { expectedRevision: film.revision });
  const count = (await store.readResults("demo")).length;
  await assert.rejects(render(invalid.id), /Narration exceeds/);
  assert.equal((await store.readResults("demo")).length, count);
  const outputs = await readdir(join(rootDir, "demo", "outputs"));
  assert.equal(outputs.length, 2);
  assert.ok(outputs.every((name) => !name.startsWith(".")));

  // Exact older revision remains intentionally renderable, but only on explicit opt-in.
  const historical = await render(film.id, { allowHistorical: true });
  assert.equal(historical.result.data.historical, true);
});

test("an executor finalization failure preserves sequence media and is recoverable without rendering twice", async (t) => {
  try { await exec("ffmpeg", ["-version"]); await exec("ffprobe", ["-version"]); }
  catch { t.skip("ffmpeg/ffprobe required"); return; }
  const { store, save, workspace, rootDir } = await fixture(t);
  const imagePath = join(workspace, "image.png");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=green:s=160x120", "-frames:v", "1", "-y", imagePath]);
  const source = await importProjectInput({ rootDir, projectId: "demo", sourcePath: imagePath });
  const film = await save(sequence([segment("one", { source: { kind: "resource", id: source.resourceId } })]));
  const finish = store.finishRun.bind(store);
  store.finishRun = async (...args) => {
    if (args[2].status === "completed") throw new Error("Injected finalization failure");
    return finish(...args);
  };
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const response = await executor.execute("demo", { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Recovery",
    inputs: { artifactId: film.id } });
  assert.equal(response.status, "finalization_pending");
  store.finishRun = finish;
  const recovered = await store.recoverRunFinalization("demo", response.runId);
  assert.equal(recovered.status, "completed");
  const result = await store.readResult("demo", response.resultId);
  assert.ok(result.files.every((f) => f.available));
  assert.equal((await store.readResults("demo")).length, 1);
});


test("many frame-aligned short segments preserve the requested total duration", async (t) => {
  try { await exec("ffmpeg", ["-version"]); await exec("ffprobe", ["-version"]); }
  catch { t.skip("ffmpeg/ffprobe required"); return; }
  const { store, save, workspace, rootDir } = await fixture(t);
  const inputPath = join(workspace, "short.png");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=orange:s=160x120", "-frames:v", "1", "-y", inputPath]);
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath: inputPath });
  const data = sequence(Array.from({ length: 12 }, (_, index) => segment("s" + index, {
    source: { kind: "resource", id: imported.resourceId },
  }, { durationSeconds: 0.12 })));
  const film = await save(data);
  const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
  const response = await executor.execute("demo", {
    capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Precise short sequence", inputs: { artifactId: film.id },
  });
  const path = await store.resolveResultFile("demo", response.resultId, "primary");
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.filePath]);
  const probe = JSON.parse(stdout);
  assert.ok(Math.abs(Number(probe.format.duration) - 1.44) <= 0.08);
  assert.equal(Number(probe.streams.find((s) => s.codec_type === "video").nb_frames), 36);
});


test("missing selected folder media is visible on the segment and historical sequence can still be retired", async (t) => {
  const { store, save, workspace, rootDir } = await fixture(t);
  const folder = join(workspace, "folder");
  await mkdir(folder);
  await writeFile(join(folder, "frame.png"), "registered test bytes");
  await writeFile(join(folder, "other.png"), "another registered file");
  const imported = await importProjectInput({ rootDir, projectId: "demo", sourcePath: folder });
  const source = { kind: "resource", id: imported.resourceId, itemPath: "frame.png" };
  const first = await save(sequence([segment("a", { source })]));
  const selected = await store.resolveMediaSource("demo", source);
  await rm(selected.filePath);
  const context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.resources[0].available, true);
  assert.deepEqual(context.production.sequences[0].segments[0].blockers, ["missing_visual_media"]);
  assert.ok(context.production.sequences[0].reasons.some((r) => r.reason === "missing_media" && r.itemPath === "frame.png"));
  const retired = await save({ ...first.data, changeReason: "Retire lost source sequence" }, { expectedRevision: 1, status: "retired" });
  assert.equal(retired.status, "retired");
  assert.equal((await store.intelligence.readActiveArtifacts("demo")).length, 0);
});
