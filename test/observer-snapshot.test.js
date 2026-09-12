import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-observer-snapshot-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Observer demo" });
  await store.writeCheckpoint("demo", {
    goal: "Keep the observer light and fresh.",
    selectedResources: [],
    pending: [],
    next: "Wait for a durable change.",
  });
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, origin: `http://127.0.0.1:${server.address().port}` };
}

test("observer snapshots are sectioned, conditional and invalidated by durable changes", async (t) => {
  const { store, origin } = await fixture(t);

  const list = await fetch(`${origin}/api/projects`);
  const listEtag = list.headers.get("etag");
  const listBody = await list.json();
  assert.match(listEtag, /^"padstudio-/);
  assert.match(listBody.projects[0].generation, /^[a-f0-9]{64}$/);
  const unchangedList = await fetch(`${origin}/api/projects`, {
    headers: { "If-None-Match": listEtag },
  });
  assert.equal(unchangedList.status, 304);
  assert.equal(await unchangedList.text(), "");

  const summary = await fetch(`${origin}/api/projects/demo/observer/summary`);
  const summaryEtag = summary.headers.get("etag");
  const summaryText = await summary.text();
  const summaryBody = JSON.parse(summaryText);
  assert.equal(summaryBody.context.view, "observer-summary");
  assert.equal(summaryBody.context.generation, listBody.projects[0].generation);
  assert.equal("results" in summaryBody.context, false);
  assert.equal("runs" in summaryBody.context, false);
  const unchangedSummary = await fetch(`${origin}/api/projects/demo/observer/summary`, {
    headers: { "If-None-Match": summaryEtag },
  });
  assert.equal(unchangedSummary.status, 304);

  const full = await fetch(`${origin}/api/projects/demo`);
  const fullText = await full.text();
  assert.ok(Buffer.byteLength(summaryText) < Buffer.byteLength(fullText));

  await store.writeCheckpoint("demo", {
    goal: "Keep the observer light and fresh.",
    selectedResources: [],
    pending: [],
    next: "Render only after this durable change.",
  });
  const changedList = await fetch(`${origin}/api/projects`, {
    headers: { "If-None-Match": listEtag },
  });
  assert.equal(changedList.status, 200);
  const changedListBody = await changedList.json();
  assert.notEqual(changedListBody.projects[0].generation, listBody.projects[0].generation);

  const changedSummary = await fetch(`${origin}/api/projects/demo/observer/summary`, {
    headers: { "If-None-Match": summaryEtag },
  });
  assert.equal(changedSummary.status, 200);
  const changedSummaryBody = await changedSummary.json();
  assert.equal(changedSummaryBody.context.checkpoint.next, "Render only after this durable change.");
  assert.notEqual(changedSummary.headers.get("etag"), summaryEtag);
});

test("observer detail sections expose only the data needed by their view", async (t) => {
  const { origin } = await fixture(t);
  const sections = {};
  for (const section of ["source", "creative", "production", "delivery", "health", "activity"]) {
    const response = await fetch(`${origin}/api/projects/demo/observer/${section}`);
    assert.equal(response.status, 200);
    sections[section] = (await response.json()).context;
    assert.equal(sections[section].view, `observer-${section}`);
  }
  assert.deepEqual(Object.keys(sections.source).sort(), ["analysis", "generation", "intelligence", "project", "resources", "results", "version", "view"]);
  assert.equal("results" in sections.creative, false);
  assert.equal("resources" in sections.production, false);
  assert.deepEqual(sections.delivery.delivery.bundles, []);
  assert.equal(sections.health.health.status, "ready");
  assert.ok(Array.isArray(sections.activity.results));
  assert.ok(Array.isArray(sections.activity.runs));
});

test("observer retries when the project changes while a snapshot is assembled", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-observer-race-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Race" });
  await store.writeCheckpoint("demo", {
    goal: "Before", selectedResources: [], pending: [], next: "Before"
  });
  const reader = new ProjectReader(rootDir);
  const original = reader.readProject.bind(reader);
  let mutateOnce = true;
  reader.readProject = async (projectId) => {
    const context = await original(projectId);
    if (mutateOnce) {
      mutateOnce = false;
      await store.writeCheckpoint("demo", {
        goal: "After", selectedResources: [], pending: [], next: "After"
      });
    }
    return context;
  };
  const before = await reader.generation("demo");
  const snapshot = await reader.readObserverSection("demo", "summary", before);
  assert.equal(snapshot.checkpoint.goal, "After");
  assert.notEqual(snapshot.generation, before);
});
