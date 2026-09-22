import assert from "node:assert/strict";
import test from "node:test";
import { ensureObserver, probeObserver } from "../src/web/observer-lifecycle.js";

test("observer probe accepts only the PADStudio project-list shape", async () => {
  assert.equal(await probeObserver("http://observer.test", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ projects: [] }) }),
  }), true);
  assert.equal(await probeObserver("http://observer.test", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ok" }) }),
  }), false);
});

test("observer ensure reuses a healthy process", async () => {
  let launches = 0;
  const result = await ensureObserver({
    projectId: "video demo",
    probe: async () => true,
    launch: () => { launches += 1; },
  });
  assert.equal(launches, 0);
  assert.equal(result.started, false);
  assert.equal(result.url, "http://127.0.0.1:7603/?project=video%20demo");
});

test("observer ensure starts once and waits until the endpoint is healthy", async () => {
  let probes = 0;
  let launches = 0;
  const result = await ensureObserver({
    port: 7610,
    attempts: 3,
    probe: async () => ++probes >= 3,
    launch: () => { launches += 1; },
    waitForNextAttempt: async () => {},
  });
  assert.equal(launches, 1);
  assert.equal(result.started, true);
  assert.equal(result.origin, "http://127.0.0.1:7610");
});
