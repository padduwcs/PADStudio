import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ElevenLabsClient, ElevenLabsError } from "../src/tools/elevenlabs-client.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { createSettingsService, safePreviewUrl } from "../src/web/settings-service.js";

const KEY = "sk_catalog_test_key_91ab";

function json(value, status = 200) {
  return { ok: status < 400, status, headers: new Headers(), json: async () => value };
}

/** A tiny ElevenLabs: records every request and answers the three read-only catalog routes. */
function fakeProvider({ voices = [], models = [], single = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), key: options.headers["xi-api-key"], method: options.method ?? "GET" });
    if (parsed.pathname === "/v2/voices") {
      const search = parsed.searchParams.get("search")?.toLowerCase();
      const rows = voices.filter((voice) => !search || voice.name.toLowerCase().includes(search));
      const token = parsed.searchParams.get("next_page_token");
      const start = token ? Number(token) : 0;
      const page = rows.slice(start, start + 2);
      return json({ voices: page, has_more: start + 2 < rows.length, next_page_token: start + 2 < rows.length ? String(start + 2) : null, total_count: rows.length });
    }
    if (parsed.pathname === "/v1/models") return json(models);
    const single_ = parsed.pathname.match(/^\/v1\/voices\/(.+)$/);
    if (single_) return single[single_[1]] ? json(single[single_[1]]) : json({ detail: "not found" }, 404);
    return json({ detail: "unexpected" }, 500);
  };
  return { fetchImpl, calls };
}

const MODELS = [
  { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true, languages: [{ language_id: "en", name: "English" }], model_rates: { character_cost_multiplier: 1 }, maximum_text_length_per_request: 10000 },
  { model_id: "eleven_v3", name: "Eleven v3", can_do_text_to_speech: true, languages: [{ language_id: "vi", name: "Vietnamese" }, { language_id: "en", name: "English" }], model_rates: { character_cost_multiplier: 1 }, maximum_text_length_per_request: 5000 },
  { model_id: "eleven_flash_x", name: "Flash", can_do_text_to_speech: true, languages: [{ language_id: "vi", name: "Vietnamese" }], maximum_text_length_per_request: 40000 },
  { model_id: "scribe_v1", name: "Scribe", can_do_text_to_speech: false, languages: [] }
];
const VOICES = [
  { voice_id: "v_minh_anh", name: "Minh Anh", category: "professional", description: "Giọng nữ rõ ràng", labels: { gender: "female", accent: "northern", extra: 5 }, verified_languages: [{ language: "vi" }], preview_url: "https://storage.googleapis.com/eleven-public-prod/abc/minh.mp3" },
  { voice_id: "v_quang", name: "Quang", category: "premade", labels: { gender: "male" }, preview_url: "http://insecure.example.com/quang.mp3" },
  { voice_id: "v_ha_my", name: "Hà My", category: "cloned", preview_url: "https://evil.example.com/tracker.mp3" },
  { voice_id: "v_costly", name: "Costly", category: "professional", sharing: { rate: 0.2 } }
];

test("the client searches voices a page at a time, looks up one voice and lists text-to-speech models", async () => {
  const { fetchImpl, calls } = fakeProvider({ voices: VOICES, models: MODELS, single: { v_minh_anh: VOICES[0], v_costly: VOICES[3] } });
  const client = new ElevenLabsClient({ apiKey: KEY, fetchImpl });

  const first = await client.searchVoices({ language: "vi", search: " Minh ", pageSize: 500 });
  assert.deepEqual(first.voices.map((voice) => voice.voiceId), ["v_minh_anh"]);
  assert.equal(calls[0].query.search, "Minh");
  assert.equal(calls[0].query.page_size, "100", "page size is capped");
  assert.equal(calls[0].query.include_custom_rates, "false");
  assert.equal(calls[0].query.language, "vi");
  assert.equal(calls[0].key, KEY);

  const all = await client.searchVoices({ language: "vi" });
  assert.equal(all.hasMore, true);
  assert.equal(all.nextPageToken, "2");
  const second = await client.searchVoices({ language: "vi", pageToken: all.nextPageToken });
  assert.deepEqual(second.voices.map((voice) => voice.voiceId), ["v_ha_my", "v_costly"]);
  assert.equal(second.nextPageToken, null);
  assert.equal(second.voices[1].customRate, 0.2);

  assert.equal((await client.getVoice("v_minh_anh")).name, "Minh Anh");
  await assert.rejects(client.getVoice("v_missing"), (error) => error instanceof ElevenLabsError && error.status === 404);
  await assert.rejects(client.getVoice("../escape"), /voiceId is invalid/);

  const models = await client.listModels({ language: "vi" });
  assert.deepEqual(models.map((model) => model.modelId), ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_x"]);
  assert.deepEqual(models.map((model) => model.supportsRequestedLanguage), [false, true, true]);
  await assert.rejects(client.searchVoices({ language: "Vietnamese" }), /ISO 639-1/);
});

test("preview links are passed on only when they point at ElevenLabs storage over https", () => {
  assert.ok(safePreviewUrl("https://storage.googleapis.com/eleven-public-prod/a/b.mp3"));
  assert.ok(safePreviewUrl("https://eleven-public-cdn.elevenlabs.io/x.mp3"));
  for (const bad of ["http://storage.googleapis.com/eleven-public-prod/a.mp3", "https://storage.googleapis.com/other-bucket/a.mp3",
    "https://evil.example.com/a.mp3", "https://elevenlabs.io.evil.example.com/a.mp3", "https://user:pw@elevenlabs.io/a.mp3",
    "javascript:alert(1)", "data:audio/mp3;base64,AAAA", "not a url", null, undefined]) {
    assert.equal(safePreviewUrl(bad), null, String(bad));
  }
});

async function app(t, provider) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-catalog-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir);
  const configPath = join(workspace, "padstudio.local.json");
  await writeFile(configPath, JSON.stringify({ piper: { pythonCommand: "D:/python/python.exe" } }));
  const settings = createSettingsService({
    configPath, registryFactory: () => ({ describeCapabilities: async () => ({ capabilities: [] }) }),
    createClient: (apiKey) => new ElevenLabsClient({ apiKey, fetchImpl: provider.fetchImpl })
  });
  const server = createPadStudioServer({ reader: new ProjectReader(rootDir), settings });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  const headers = { Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json", "X-PADStudio-Intent": "settings", "Sec-Fetch-Site": "same-origin" };
  const post = (path, body, extra = {}) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const request = httpRequest({ host: "127.0.0.1", port, path, method: "POST", headers: { ...headers, ...extra, "Content-Length": Buffer.byteLength(payload) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: response.statusCode, text, json: text ? JSON.parse(text) : null }); });
    });
    request.on("error", reject);
    request.end(payload);
  });
  const put = (body) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpRequest({ host: "127.0.0.1", port, path: "/api/settings", method: "PUT", headers: { ...headers, "Content-Length": Buffer.byteLength(payload) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: response.statusCode, text, json: JSON.parse(text) }); });
    });
    request.on("error", reject);
    request.end(payload);
  });
  return { post, put, configPath, headers };
}

test("the pickers need a saved key, the page guard and valid input, and return only what the page may show", async (t) => {
  const provider = fakeProvider({ voices: VOICES, models: MODELS, single: { v_minh_anh: VOICES[0], v_costly: VOICES[3] } });
  const { post, put, headers } = await app(t, provider);

  const noKey = await post("/api/settings/elevenlabs/voices", { search: "minh" });
  assert.equal(noKey.status, 409);
  assert.match(noKey.json.error, /Chưa có khóa ElevenLabs/);
  assert.equal(provider.calls.length, 0, "nothing is sent to ElevenLabs without a key");

  await put({ elevenLabs: { apiKey: KEY } });
  for (const path of ["models", "voices", "voice"]) {
    assert.equal((await post(`/api/settings/elevenlabs/${path}`, {}, { Origin: "http://evil.example.com" })).status, 403, path);
    assert.equal((await post(`/api/settings/elevenlabs/${path}`, {}, { "X-PADStudio-Intent": "" })).status, 403, path);
  }
  assert.equal(provider.calls.length, 0, "a refused request never reaches ElevenLabs");

  const models = await post("/api/settings/elevenlabs/models", { language: "vi" });
  assert.equal(models.status, 200);
  assert.deepEqual(models.json.models.map((model) => [model.modelId, model.usable]), [["eleven_v3", true], ["eleven_flash_x", false], ["eleven_multilingual_v2", false]]);
  assert.equal(models.json.models.find((model) => model.modelId === "eleven_multilingual_v2").supportsLanguage, false);
  assert.equal(models.json.models.find((model) => model.modelId === "eleven_flash_x").creditMultiplier, null);
  assert.equal(models.json.models.find((model) => model.modelId === "eleven_flash_x").usable, false);
  assert.equal(models.text.includes(KEY), false);

  const voices = await post("/api/settings/elevenlabs/voices", { search: "", language: "vi" });
  assert.equal(voices.status, 200);
  const [minh, quang] = voices.json.voices;
  assert.deepEqual(minh.labels, [{ key: "gender", value: "female" }, { key: "accent", value: "northern" }]);
  assert.equal(minh.previewUrl, "https://storage.googleapis.com/eleven-public-prod/abc/minh.mp3");
  assert.equal(quang.previewUrl, null, "an http link is dropped");
  assert.equal(voices.json.nextPageToken, "2");
  assert.equal(voices.text.includes(KEY), false);
  const page2 = await post("/api/settings/elevenlabs/voices", { pageToken: "2" });
  assert.equal(page2.json.voices.find((voice) => voice.voiceId === "v_ha_my").previewUrl, null, "a foreign host is dropped");
  const costly = page2.json.voices.find((voice) => voice.voiceId === "v_costly");
  assert.equal(costly.usable, false);
  assert.match(costly.unusableReason, /trần credit/);

  assert.deepEqual((await post("/api/settings/elevenlabs/voices", { search: "quang" })).json.voices.map((voice) => voice.voiceId), ["v_quang"]);
  assert.equal(provider.calls.every((call) => call.key === KEY && call.method === "GET"), true, "only read-only requests, always with the saved key");

  const found = await post("/api/settings/elevenlabs/voice", { voiceId: " v_minh_anh " });
  assert.equal(found.json.voice.name, "Minh Anh");
  const missing = await post("/api/settings/elevenlabs/voice", { voiceId: "v_gone" });
  assert.equal(missing.status, 404);
  assert.match(missing.json.error, /My Voices/);
  for (const [path, body] of [
    ["voice", { voiceId: "../etc" }], ["voice", { voiceId: "" }], ["voice", {}], ["voice", { voiceId: 7 }],
    ["voices", { language: "Vietnamese" }], ["voices", { search: "x".repeat(101) }], ["voices", { pageToken: 5 }], ["voices", []],
    ["models", { language: "VI" }]
  ]) {
    assert.equal((await post("/api/settings/elevenlabs/" + path, body)).status, 400, path + " " + JSON.stringify(body));
  }
});

test("the default voice and model are saved with the key and never sent anywhere but back to the page", async (t) => {
  const provider = fakeProvider({ voices: VOICES, models: MODELS });
  const { put, configPath } = await app(t, provider);
  const saved = await put({ elevenLabs: { apiKey: KEY, voiceId: "v_minh_anh", voiceName: "Minh Anh", modelId: "eleven_v3" } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.settings.elevenLabs.voice, { id: "v_minh_anh", name: "Minh Anh" });
  assert.equal(saved.json.settings.elevenLabs.modelId, "eleven_v3");
  assert.equal(saved.text.includes(KEY), false);
  let stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored.elevenLabs, { apiKey: KEY, voiceId: "v_minh_anh", voiceName: "Minh Anh", modelId: "eleven_v3" });
  assert.equal(stored.piper.pythonCommand, "D:/python/python.exe");

  // Changing only the model keeps the voice and the key; clearing the voice also drops its name.
  await put({ elevenLabs: { modelId: "eleven_flash_x" } });
  stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored.elevenLabs, { apiKey: KEY, voiceId: "v_minh_anh", voiceName: "Minh Anh", modelId: "eleven_flash_x" });
  const cleared = await put({ elevenLabs: { voiceId: null } });
  assert.equal(cleared.json.settings.elevenLabs.voice, null);
  stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored.elevenLabs, { apiKey: KEY, modelId: "eleven_flash_x" });

  for (const bad of [{ voiceId: "../x" }, { voiceId: "a b" }, { modelId: "x".repeat(101) }, { voiceName: "line\nbreak" }, { voiceName: "x".repeat(121) }, { voice: "x" }]) {
    assert.equal((await put({ elevenLabs: bad })).status, 400, JSON.stringify(bad));
  }
});
