import assert from "node:assert/strict";
import test from "node:test";
import { ensureObserver, identifyObserver, probeObserver } from "../src/web/observer-lifecycle.js";
import { observerBuild } from "../src/web/observer-build.js";

test("observer probe accepts only the PADStudio project-list shape", async () => {
  assert.equal(await probeObserver("http://observer.test", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ projects: [] }) }),
  }), true);
  assert.equal(await probeObserver("http://observer.test", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ok" }) }),
  }), false);
});

test("observer ensure reuses a healthy process that runs the current code", async () => {
  let launches = 0;
  const result = await ensureObserver({
    projectId: "video demo",
    probe: async () => true,
    identify: async () => ({ app: "padstudio-observer", pid: 4242, build: "current" }),
    currentBuild: "current",
    stop: () => { throw new Error("must not stop a current observer"); },
    launch: () => { launches += 1; },
  });
  assert.equal(launches, 0);
  assert.equal(result.started, false);
  assert.equal(result.restarted, false);
  assert.equal(result.url, "http://127.0.0.1:7603/?project=video%20demo");
  assert.equal(result.toolsUrl, "http://127.0.0.1:7603/?panel=tools");
});

test("observer ensure replaces a server still running older code", async () => {
  let running = true;
  const stopped = [];
  let launches = 0;
  const result = await ensureObserver({
    probe: async () => running,
    identify: async () => ({ app: "padstudio-observer", pid: 4242, build: "yesterday" }),
    currentBuild: "today",
    stop: (pid) => { stopped.push(pid); running = false; },
    launch: () => { launches += 1; running = true; },
    waitForNextAttempt: async () => {},
  });
  assert.deepEqual(stopped, [4242]);
  assert.equal(launches, 1);
  assert.equal(result.started, true);
  assert.equal(result.restarted, true);

  const reportOnly = await ensureObserver({
    restart: false,
    probe: async () => true,
    identify: async () => ({ app: "padstudio-observer", pid: 4242, build: "yesterday" }),
    currentBuild: "today",
    stop: () => { throw new Error("--no-restart must not stop anything"); },
    launch: () => { throw new Error("--no-restart must not launch"); },
  });
  assert.equal(reportOnly.stale, true);
  assert.equal(reportOnly.pid, 4242);
});

test("observer ensure explains how to replace a server too old to identify itself", async () => {
  const result = await ensureObserver({
    probe: async () => true,
    identify: async () => null,
    currentBuild: "today",
    stop: () => { throw new Error("cannot stop an unidentified process"); },
    launch: () => { throw new Error("the port is taken"); },
  });
  assert.equal(result.stale, true);
  assert.equal(result.started, false);
  assert.match(result.message, /observer:ensure/);
});

test("the observer identity is checked strictly and the build follows the code", async () => {
  const reply = (body, ok = true) => async () => ({ ok, json: async () => body });
  assert.deepEqual(await identifyObserver("http://observer.test", { fetchImpl: reply({ app: "padstudio-observer", pid: 7, build: "abc" }) }),
    { app: "padstudio-observer", pid: 7, build: "abc" });
  assert.equal(await identifyObserver("http://observer.test", { fetchImpl: reply({ error: "Không tìm thấy." }, false) }), null);
  assert.equal(await identifyObserver("http://observer.test", { fetchImpl: reply({ app: "something-else", pid: 7, build: "abc" }) }), null);
  assert.equal(await identifyObserver("http://observer.test", { fetchImpl: reply({ app: "padstudio-observer", pid: "7", build: "abc" }) }), null);
  assert.match(observerBuild(), /^[a-f0-9]{16}$/);
  assert.equal(observerBuild(), observerBuild());
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
