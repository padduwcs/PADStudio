import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { createSettingsService } from "../src/web/settings-service.js";

const SECRET = "sk_settings_api_secret_7f2c";

function fakeRegistry(state) {
  return {
    describeCapabilities: async () => {
      state.checks += 1;
      return { capabilities: [{ id: "tts.synthesize", available: true, tools: [
        { name: "piper-local", provider: "Piper", availability: { status: "available" } },
        { name: "elevenlabs", provider: "ElevenLabs", availability: state.keyed
          ? { status: "available", credentialConfigured: true }
          : { status: "unavailable", credentialConfigured: false, reason: "No ElevenLabs API key yet." } }
      ] }] };
    }
  };
}

async function fixture(t, { checkElevenLabs } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-settings-api-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir);
  await new ProjectStore(rootDir).createProject({ projectId: "demo", title: "Demo" });
  const configPath = join(workspace, "padstudio.local.json");
  await writeFile(configPath, JSON.stringify({ piper: { pythonCommand: "D:/python/python.exe" } }));
  const state = { checks: 0, keyed: false };
  const settings = createSettingsService({ configPath, registryFactory: () => fakeRegistry(state), checkElevenLabs });
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir), settings });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const call = (method, path, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const request = httpRequest({ host: "127.0.0.1", port, path, method, headers: {
      ...(payload !== null ? { "Content-Length": Buffer.byteLength(payload) } : {}), ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, text, json: text ? JSON.parse(text) : null, headers: response.headers });
      });
    });
    request.on("error", reject);
    if (payload !== null) request.write(payload);
    request.end();
  });
  const pageHeaders = { Origin: origin, "Content-Type": "application/json", "X-PADStudio-Intent": "settings", "Sec-Fetch-Site": "same-origin" };
  return { workspace, rootDir, configPath, state, call, pageHeaders, origin };
}

test("the Tools page reads tool status and masked settings, cached until a key changes", async (t) => {
  const { call, state } = await fixture(t);
  const first = await call("GET", "/api/tools");
  assert.equal(first.status, 200);
  assert.equal(first.headers["cache-control"], "no-store");
  const items = first.json.tools.groups.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.id === "elevenlabs").status, "needs_key");
  assert.deepEqual(first.json.settings.elevenLabs.apiKey, { configured: false, hint: null });
  assert.equal(first.text.includes("D:/python"), false);

  await call("GET", "/api/tools");
  assert.equal(state.checks, 1, "a second read within the cache window must not re-check every tool");
  await call("GET", "/api/tools?refresh=1");
  assert.equal(state.checks, 2);
});

test("only the PADStudio page itself can save settings, and a saved key is never sent back", async (t) => {
  const { call, pageHeaders, configPath, state, rootDir } = await fixture(t);
  const projectBefore = (await readdir(join(rootDir, "demo"), { recursive: true })).sort();
  const body = { elevenLabs: { apiKey: SECRET } };

  for (const [label, headers, status] of [
    ["no Origin", { ...pageHeaders, Origin: undefined }, 403],
    ["another site", { ...pageHeaders, Origin: "http://evil.example.com" }, 403],
    ["another local port", { ...pageHeaders, Origin: "http://127.0.0.1:1" }, 403],
    ["cross-site fetch metadata", { ...pageHeaders, "Sec-Fetch-Site": "cross-site" }, 403],
    ["no intent header", { ...pageHeaders, "X-PADStudio-Intent": undefined }, 403],
    ["form post", { ...pageHeaders, "Content-Type": "application/x-www-form-urlencoded" }, 415]
  ]) {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined));
    const response = await call("PUT", "/api/settings", { body, headers: clean });
    assert.equal(response.status, status, label);
  }
  assert.equal((await readFile(configPath, "utf8")).includes(SECRET), false, "a refused request wrote the key");

  assert.equal((await call("PUT", "/api/settings", { body: "{broken", headers: pageHeaders })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { body: { elevenLabs: { apiKey: "x" } }, headers: pageHeaders })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { body: { piper: { pythonCommand: "evil.exe" } }, headers: pageHeaders })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { body: { services: { note: "x".repeat(17 * 1024) } }, headers: pageHeaders })).status, 413);

  await call("GET", "/api/tools");
  const checksBefore = state.checks;
  const saved = await call("PUT", "/api/settings", { body, headers: pageHeaders });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.settings.elevenLabs.apiKey, { configured: true, hint: "…7f2c" });
  assert.equal(saved.text.includes(SECRET), false);
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(stored.elevenLabs.apiKey, SECRET);
  assert.equal(stored.piper.pythonCommand, "D:/python/python.exe");

  state.keyed = true;
  const after = await call("GET", "/api/tools");
  assert.equal(state.checks, checksBefore + 1, "a new key must re-check the tools");
  assert.equal(after.json.tools.groups.flatMap((group) => group.items).find((item) => item.id === "elevenlabs").status, "ready");
  for (const path of ["/api/tools", "/api/settings"]) {
    assert.equal((await call("GET", path)).text.includes(SECRET), false, path);
  }

  const services = await call("PUT", "/api/settings", { headers: pageHeaders,
    body: { services: { available: ["image-generation", "music-generation"], note: "ChatGPT Plus, Suno" } } });
  assert.equal(services.status, 200);
  assert.deepEqual(services.json.settings.services.available, ["image-generation", "music-generation"]);
  assert.equal(state.checks, checksBefore + 1, "declaring services must not re-check every tool");

  // Settings never touch a project.
  assert.deepEqual((await readdir(join(rootDir, "demo"), { recursive: true })).sort(), projectBefore);
  assert.equal((await call("POST", "/api/projects", { body: {}, headers: pageHeaders })).status, 404);
  assert.equal((await call("DELETE", "/api/settings", { headers: pageHeaders })).status, 404);
});

test("checking the ElevenLabs key is explicit, guarded and reports without the key", async (t) => {
  const seen = [];
  const { call, pageHeaders } = await fixture(t, { checkElevenLabs: async (key) => {
    seen.push(key);
    return { voices: [{}, {}, {}], models: [{}], subscription: { characterCount: 1200, characterLimit: 10000 } };
  } });
  const empty = await call("POST", "/api/settings/elevenlabs/check", { body: {}, headers: pageHeaders });
  assert.deepEqual(empty.json, { ok: false, message: "Chưa có khóa ElevenLabs để kiểm tra." });
  assert.equal(seen.length, 0);

  await call("PUT", "/api/settings", { body: { elevenLabs: { apiKey: SECRET } }, headers: pageHeaders });
  assert.equal((await call("POST", "/api/settings/elevenlabs/check", { body: {}, headers: { ...pageHeaders, Origin: "http://evil.example.com" } })).status, 403);
  assert.equal(seen.length, 0);
  const checked = await call("POST", "/api/settings/elevenlabs/check", { body: {}, headers: pageHeaders });
  assert.equal(checked.json.ok, true);
  assert.match(checked.json.message, /3 giọng, 1 model/);
  assert.equal(checked.text.includes(SECRET), false);
  assert.deepEqual(seen, [SECRET]);
});
