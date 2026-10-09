import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LOCAL_CONFIG_ENV,
  LocalConfigError,
  USER_SERVICE_CATEGORIES,
  loadLocalConfig,
  localConfigPath,
  maskSecret,
  publicLocalSettings,
  updateLocalConfig
} from "../src/config/local-config.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-local-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "padstudio.local.json");
}

test("the local configuration lives beside the source unless PADSTUDIO_LOCAL_CONFIG names another file", () => {
  assert.equal(localConfigPath({ env: {} }), join(repository, "padstudio.local.json"));
  assert.equal(localConfigPath({ env: { [LOCAL_CONFIG_ENV]: "  D:/elsewhere/config.json " } }), "D:/elsewhere/config.json");
  assert.equal(localConfigPath({ env: { [LOCAL_CONFIG_ENV]: "   " } }), join(repository, "padstudio.local.json"));
});

test("a missing file reads as empty settings and declared services are normalised", async (t) => {
  const path = await temporary(t);
  const empty = await loadLocalConfig({ path });
  assert.equal(empty.elevenLabs.apiKey, null);
  assert.deepEqual(empty.services, { available: [], note: null });

  await writeFile(path, JSON.stringify({
    piper: { pythonCommand: "C:/Python/python.exe" },
    services: { available: ["music-generation", "image-generation"], note: "  ChatGPT Plus\nSuno  " }
  }));
  const loaded = await loadLocalConfig({ path });
  assert.deepEqual(loaded.services.available, ["image-generation", "music-generation"]);
  assert.equal(loaded.services.note, "ChatGPT Plus\nSuno");
  assert.equal(loaded.piper.pythonCommand, "C:/Python/python.exe");
});

test("invalid settings are refused instead of guessed", async (t) => {
  const path = await temporary(t);
  for (const value of [
    { services: { available: ["telepathy"] } },
    { services: { available: ["stock-media", "stock-media"] } },
    { services: { note: "x".repeat(501) } },
    { services: { note: "bell\u0007" } },
    { services: { extra: true } },
    { elevenLabs: { apiKey: "short" } },
    { elevenLabs: { apiKey: "has space inside the key" } },
    { somethingElse: {} }
  ]) {
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(loadLocalConfig({ path }), LocalConfigError, JSON.stringify(value));
  }
  await writeFile(path, "{ not json");
  await assert.rejects(loadLocalConfig({ path }), /không phải JSON hợp lệ/);
});

test("updates change only keys and services, keep runtime paths and never overwrite a broken file", async (t) => {
  const path = await temporary(t);
  await writeFile(path, JSON.stringify({
    piper: { pythonCommand: "D:/tools/python.exe", modelDirectory: "D:/models", defaultModel: "vi_VN-vais1000-medium" },
    elevenLabs: { apiKey: "" }
  }, null, 2));

  const key = "sk_test_1234567890abcdef";
  const saved = await updateLocalConfig({ elevenLabs: { apiKey: `  ${key}  ` } }, { path });
  assert.equal(saved.elevenLabs.apiKey, key);
  let raw = JSON.parse(await readFile(path, "utf8"));
  assert.equal(raw.elevenLabs.apiKey, key);
  assert.deepEqual(raw.piper, { pythonCommand: "D:/tools/python.exe", modelDirectory: "D:/models", defaultModel: "vi_VN-vais1000-medium" });

  await updateLocalConfig({ services: { available: ["video-generation"], note: "Có Sora" } }, { path });
  await updateLocalConfig({ services: { note: null } }, { path });
  raw = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(raw.services, { available: ["video-generation"] });
  assert.equal(raw.elevenLabs.apiKey, key);

  await updateLocalConfig({ elevenLabs: { apiKey: null } }, { path });
  assert.equal((await loadLocalConfig({ path })).elevenLabs.apiKey, null);

  // Runtime paths are not settable through an update, and unknown sections are refused.
  await assert.rejects(updateLocalConfig({ piper: { pythonCommand: "evil.exe" } }, { path }), /unsupported fields: piper/);
  await assert.rejects(updateLocalConfig({ elevenLabs: { apiKey: "x" } }, { path }), /8–256 ký tự/);
  assert.equal(JSON.parse(await readFile(path, "utf8")).piper.pythonCommand, "D:/tools/python.exe");

  await writeFile(path, JSON.stringify({ unknown: 1 }));
  await assert.rejects(updateLocalConfig({ services: { available: [] } }, { path }), /unsupported sections/);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { unknown: 1 });
});

test("concurrent updates do not lose each other's change", async (t) => {
  const path = await temporary(t);
  await Promise.all([
    updateLocalConfig({ elevenLabs: { apiKey: "sk_concurrent_key_0001" } }, { path }),
    updateLocalConfig({ services: { available: ["design-tools"] } }, { path }),
    updateLocalConfig({ services: { note: "Canva Pro" } }, { path })
  ]);
  const loaded = await loadLocalConfig({ path });
  assert.equal(loaded.elevenLabs.apiKey, "sk_concurrent_key_0001");
  assert.deepEqual(loaded.services, { available: ["design-tools"], note: "Canva Pro" });
});

test("what the web may show never contains a secret or a runtime path", async (t) => {
  assert.deepEqual(maskSecret(null), { configured: false, hint: null });
  assert.deepEqual(maskSecret("sk_live_abcdefgh1234"), { configured: true, hint: "…1234" });
  assert.deepEqual(maskSecret("shortkey"), { configured: true, hint: null });

  const path = await temporary(t);
  const secret = "sk_never_shown_9f3a";
  await writeFile(path, JSON.stringify({ piper: { pythonCommand: "D:/secret-path/python.exe" }, elevenLabs: { apiKey: secret } }));
  const shown = JSON.stringify(publicLocalSettings(await loadLocalConfig({ path })));
  assert.equal(shown.includes(secret), false);
  assert.equal(shown.includes("secret-path"), false);
  assert.equal(JSON.parse(shown).services.categories.length, USER_SERVICE_CATEGORIES.length);
});
