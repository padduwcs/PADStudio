import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildProjectCard, projectStatus, runningLabel } from "../src/web/observer-card.js";
import { projectSnapshotInfo } from "../src/web/project-generation.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { ProjectStore } from "../src/project/project-store.js";

function context(overrides = {}) {
  return {
    project: { id: "demo", title: "Demo", createdAt: "2026-10-01T00:00:00.000Z" },
    runs: [], results: [], decisions: [], artifacts: [], resources: [], checkpoint: null,
    runRecovery: { pendingFinalizations: [] },
    intelligence: { currentWorkItems: [], pendingApprovals: [] },
    pendingFeedback: [],
    production: { sequences: [] }, animation: { compositions: [] },
    ...overrides
  };
}

const sequence = (overrides = {}) => ({
  artifactId: "artifact-a", key: "film", revision: 3, name: "Film", active: true, durationSeconds: 42,
  format: { width: 1080, height: 1920, fps: 30 },
  segments: [{ id: "intro", durationSeconds: 5 }, { id: "main", durationSeconds: 30 }],
  renders: [{
    resultId: "result-r1", createdAt: "2026-10-02T00:00:00.000Z",
    files: [{ id: "primary", available: true, mediaType: "video" }, { id: "frame-1", available: true, mediaType: "image" }, { id: "frame-0", available: true, mediaType: "image" }],
    segments: [{ id: "intro", frameFileId: "frame-0" }, { id: "main", frameFileId: "frame-1" }]
  }],
  ...overrides
});

test("running work is described in plain language and outranks everything else", () => {
  assert.deepEqual(projectStatus(context({ runs: [{ id: "r", status: "in_progress", capability: "video.render-sequence", startedAt: "2026-10-03T00:00:00.000Z" }] })),
    { kind: "working", label: "Đang dựng video" });
  assert.equal(runningLabel("tts.synthesize"), "Đang tạo giọng đọc");
  assert.equal(runningLabel("animation.verify-sync"), "Đang kiểm tra video");
  assert.equal(runningLabel("video.export-delivery"), "Đang chuẩn bị bản tải xuống");
  assert.equal(runningLabel("source.probe"), "Đang chuẩn bị tư liệu");
  assert.equal(runningLabel("something.else"), "Đang thực hiện");
  const busyAndWaiting = context({
    runs: [{ id: "r", status: "in_progress", capability: "video.render-sequence", startedAt: "2026-10-03T00:00:00.000Z" }],
    intelligence: { currentWorkItems: [], pendingApprovals: [{}] },
    results: [{ id: "bundle", type: "delivery.bundle", files: [] }]
  });
  assert.equal(projectStatus(busyAndWaiting).kind, "working", "a render in progress is not hidden by an approval or an older delivery");
});

test("planned, failed and finished runs never imply activity", () => {
  assert.equal(projectStatus(context({
    intelligence: { currentWorkItems: [{ status: "ready" }], pendingApprovals: [] },
    runs: [{ status: "failed" }, { status: "completed" }]
  })).kind, "empty");
});

test("output awaiting recovery is waiting rather than an active render", () => {
  assert.deepEqual(projectStatus(context({
    runs: [{ id: "render", status: "in_progress", capability: "video.render-sequence", startedAt: "2026-10-03T00:00:00.000Z" }],
    runRecovery: { pendingFinalizations: [{ runId: "render", recoverable: true }] }
  })), { kind: "waiting", label: "Chờ tiếp tục" });
});

test("workflow progress, approvals, reviews and feedback each have their own state", () => {
  const items = (status) => context({ intelligence: { currentWorkItems: [{ status }], pendingApprovals: [] } });
  assert.deepEqual(projectStatus(items("in_progress")), { kind: "working", label: "Đang thực hiện" });
  assert.deepEqual(projectStatus(items("blocked")), { kind: "waiting", label: "Chờ tiếp tục" });
  assert.deepEqual(projectStatus(items("awaiting_review")), { kind: "waiting", label: "Chờ kiểm tra" });
  assert.deepEqual(projectStatus(context({ intelligence: { currentWorkItems: [], pendingApprovals: [{}] } })), { kind: "waiting", label: "Chờ bạn xem" });
  assert.deepEqual(projectStatus(context({ pendingFeedback: [{ id: "decision-1" }] })), { kind: "feedback", label: "Chờ chỉnh theo phản hồi" });
});

test("a finished project is draft, accepted or delivered, in that order of progress", () => {
  const withVideo = { production: { sequences: [sequence()] } };
  assert.deepEqual(projectStatus(context(withVideo)), { kind: "draft", label: "Bản nháp" });
  const accepted = context({ ...withVideo, decisions: [{ id: "d", resultId: "result-r1", outcome: "accepted" }] });
  assert.deepEqual(projectStatus(accepted), { kind: "accepted", label: "Đã duyệt" });
  const delivered = context({ ...withVideo, decisions: accepted.decisions, results: [{ id: "bundle", type: "delivery.bundle", files: [] }] });
  assert.deepEqual(projectStatus(delivered), { kind: "delivered", label: "Đã giao" });
  const projectDecision = context({ decisions: [{ id: "d", kind: "project_decision", outcome: "accepted" }] });
  assert.equal(projectStatus(projectDecision).kind, "empty", "a project-level choice is not an accepted video");
});

test("the card picks the longest segment's frame as cover and describes the first playable video", () => {
  const card = buildProjectCard(context({ production: { sequences: [sequence()] }, resources: [{}, {}] }));
  assert.deepEqual(card.cover, { resultId: "result-r1", fileId: "frame-1" });
  assert.deepEqual(card.video, {
    source: "sequence", resultId: "result-r1", revision: 3, name: "Film", durationSeconds: 42, width: 1080, height: 1920, orientation: "portrait"
  });
  assert.equal(card.counts.sources, 2);
  assert.equal(card.status.kind, "draft");
});

test("a missing frame or missing video never becomes a cover or a playable video", () => {
  const missing = sequence({ renders: [{
    resultId: "result-gone", files: [{ id: "primary", available: false, mediaType: "video" }, { id: "frame-1", available: false, mediaType: "image" }],
    segments: [{ id: "main", frameFileId: "frame-1" }]
  }] });
  const card = buildProjectCard(context({ production: { sequences: [missing] } }));
  assert.equal(card.cover, null);
  assert.equal(card.video, null);
  assert.equal(card.status.kind, "empty");
});

test("a code animation without a sequence still provides cover and video", () => {
  const composition = {
    role: "current", revision: 2, name: "Animation", format: { width: 1920, height: 1080 }, durationSeconds: 30,
    renders: [{ resultId: "result-anim", durationSeconds: 29.9, files: [{ id: "primary", available: true, mediaType: "video" }, { id: "poster", available: true, mediaType: "image" }] }],
    previews: []
  };
  const card = buildProjectCard(context({ animation: { compositions: [composition] } }));
  assert.deepEqual(card.cover, { resultId: "result-anim", fileId: "poster" });
  assert.equal(card.video.orientation, "landscape");
  assert.equal(card.video.durationSeconds, 29.9);
});

test("last activity is the newest timestamp across runs, results, decisions, artifacts and the checkpoint", () => {
  const card = buildProjectCard(context({
    runs: [{ startedAt: "2026-10-01T10:00:00.000Z", finishedAt: "2026-10-01T10:05:00.000Z" }],
    results: [{ createdAt: "2026-10-02T09:00:00.000Z", type: "x", files: [] }],
    decisions: [{ createdAt: "2026-10-03T08:00:00.000Z", outcome: "recorded" }],
    artifacts: [{ createdAt: "2026-09-30T00:00:00.000Z" }],
    checkpoint: { updatedAt: "2026-10-03T07:00:00.000Z" }
  }));
  assert.equal(card.lastActivityAt, "2026-10-03T08:00:00.000Z");
  assert.equal(buildProjectCard(context()).lastActivityAt, null);
});

test("the observer serves the card and a modification time without reading any media", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-card-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Một câu chuyện" });
  await writeFile(join(rootDir, "demo", "overview.md"), "# x\n");

  const before = await projectSnapshotInfo(rootDir, "demo");
  assert.match(before.generation, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(before.modifiedAt) > Date.parse("2026-01-01"));

  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const list = await (await fetch(`${origin}/api/projects`)).json();
  assert.equal(list.projects[0].id, "demo");
  assert.equal(list.projects[0].generation, before.generation);
  assert.equal(list.projects[0].modifiedAt, before.modifiedAt);

  const response = await fetch(`${origin}/api/projects/demo/observer/card`);
  assert.equal(response.status, 200);
  const { context: body } = await response.json();
  assert.equal(body.view, "observer-card");
  assert.equal(body.card.project.title, "Một câu chuyện");
  assert.deepEqual(body.card.status, { kind: "empty", label: "Chưa có video" });
  assert.equal(body.card.cover, null);

  const etag = response.headers.get("etag");
  assert.equal((await fetch(`${origin}/api/projects/demo/observer/card`, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await fetch(`${origin}/api/projects/demo/observer/card`, { method: "POST" })).status, 404, "the observer still has no write route");
});
