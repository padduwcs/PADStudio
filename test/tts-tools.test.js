import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor, ToolExecutorError } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createElevenLabsTts } from "../src/tools/elevenlabs-tts.js";
import { createPiperTts } from "../src/tools/piper-tts.js";

function silentWav() {
  const output = Buffer.alloc(1644);
  output.write("RIFF", 0); output.writeUInt32LE(1636, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(8000, 24); output.writeUInt32LE(16000, 28); output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34); output.write("data", 36); output.writeUInt32LE(1600, 40);
  return output;
}

function probeOutput(codec = "mp3") {
  return JSON.stringify({
    streams: [{ codec_type: "audio", codec_name: codec, sample_rate: "44100", channels: 1 }],
    format: { duration: "0.1" }
  });
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "padstudio-tts-"));
  t.after(async () => { await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })); });
  const store = new ProjectStore(join(root, "projects"));
  await store.createProject({ projectId: "tts-demo", title: "TTS Demo" });
  return { root, store };
}

async function allTextFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await allTextFiles(path));
    else output.push(await readFile(path, "utf8").catch(() => ""));
  }
  return output;
}

test("Piper and ElevenLabs share one explicit TTS capability without fallback", async () => {
  const missing = async () => ({ piper: {}, elevenLabs: {} });
  const registry = new ToolRegistry([
    createPiperTts({ loadConfig: missing }),
    createElevenLabsTts({ loadConfig: missing })
  ]);
  const description = await registry.describeCapabilities();
  const tts = description.capabilities.find((entry) => entry.id === "tts.synthesize");
  assert.deepEqual(tts.tools.map((tool) => tool.name).sort(), ["elevenlabs", "piper-local"]);
  assert.equal(tts.available, false);
  assert.ok(tts.tools.every((tool) => tool.availability.status === "unavailable"));
});

test("Piper creates a verified, reusable audio Result through Registry and Executor", async (t) => {
  const { root, store } = await fixture(t);
  const modelDirectory = join(root, "models");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(modelDirectory));
  await Promise.all([
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx"), "model"),
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx.json"), "{}")
  ]);
  const executeCommand = async (executable, args) => {
    if (args.includes("--output-file")) {
      await writeFile(args[args.indexOf("--output-file") + 1], silentWav());
      return { stdout: "", stderr: "" };
    }
    if (executable === "ffprobe") return { stdout: probeOutput("pcm_s16le"), stderr: "" };
    return { stdout: "piper help", stderr: "" };
  };
  const tool = createPiperTts({
    loadConfig: async () => ({
      piper: { pythonCommand: "python", modelDirectory, defaultModel: "vi_VN-vais1000-medium" },
      elevenLabs: {}
    }),
    executeCommand
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const response = await executor.execute("tts-demo", {
    capability: "tts.synthesize", tool: "piper-local", purpose: "Vietnamese narration",
    inputs: { text: "Xin ch?o t? PADStudio." }
  });
  const context = await store.readContext("tts-demo");
  const run = context.runs.find((entry) => entry.id === response.runId);
  assert.equal(run.status, "completed");
  assert.equal(response.result.type, "audio.tts");
  assert.equal(response.result.files[0].mediaType, "audio");
  assert.equal(context.results.find((entry) => entry.id === response.resultId).files[0].available, true);
  assert.equal(response.result.verification.status, "passed");
  await access(join(store.rootDir, "tts-demo", response.result.files[0].path));
});

test("ElevenLabs inspects Vietnamese choices and consumes one exact credit authorization", async (t) => {
  const { store } = await fixture(t);
  const secret = "SECRET_KEY_MUST_NOT_PERSIST";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, key: options.headers["xi-api-key"], body: options.body });
    if (String(url).endsWith("/v1/user/subscription")) {
      return Response.json({ status: "active", character_count: 10, character_limit: 1000 });
    }
    if (String(url).endsWith("/v1/models")) {
      return Response.json([{ model_id: "eleven_multilingual_v2", name: "Multilingual v2",
        can_do_text_to_speech: true, languages: [{ language_id: "vi", name: "Vietnamese" }],
        model_rates: { character_cost_multiplier: 1 } }]);
    }
    if (String(url).includes("/v2/voices?")) {
      return Response.json({ voices: [{ voice_id: "voice_vi", name: "Vietnamese voice",
        verified_languages: [{ language: "vi" }], preview_url: "https://example.test/preview.mp3" }] });
    }
    if (String(url).includes("/v1/text-to-speech/voice_vi")) {
      return new Response(silentWav(), {
        status: 200,
        headers: { "character-cost": "17", "request-id": "req-1", "x-trace-id": "trace-1" }
      });
    }
    return new Response(null, { status: 404 });
  };
  const executeCommand = async () => ({ stdout: probeOutput("mp3"), stderr: "" });
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: secret } }),
    fetchImpl, baseUrl: "https://example.test", executeCommand
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Approved Vietnamese narration",
    inputs: { text: "Xin ch?o Vi?t Nam", modelId: "eleven_multilingual_v2", voiceId: "voice_vi" }
  };

  const catalog = await tool.inspect({ language: "vi" });
  assert.equal(catalog.status, "connected");
  assert.equal(catalog.models[0].languages[0].languageId, "vi");
  assert.equal(catalog.voices[0].voiceId, "voice_vi");

  const plan = await executor.plan("tts-demo", request);
  assert.equal(plan.estimatedUsage.amount, [...request.inputs.text].length);
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: plan.estimatedUsage.amount, reason: "Approve this narration only"
  });
  await assert.rejects(
    executor.execute("tts-demo", { ...request, inputs: { ...request.inputs, text: request.inputs.text + "!" }, authorizationId: authorization.id }),
    (error) => error instanceof ToolExecutorError && error.code === "authorization_mismatch"
  );
  const response = await executor.execute("tts-demo", { ...request, authorizationId: authorization.id });
  assert.equal(response.result.files[0].mediaType, "audio");
  assert.equal(response.result.data.providerRequestId, "req-1");
  const context = await store.readContext("tts-demo");
  const settled = context.authorizations.find((entry) => entry.id === authorization.id);
  assert.equal(settled.status, "consumed");
  assert.equal(settled.actualUsage.amount, 17);
  assert.equal(settled.claimedByRun, response.runId);
  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: authorization.id }),
    (error) => error.code === "authorization_already_used"
  );
  assert.equal(calls.filter((call) => call.url.includes("/v1/text-to-speech/")).length, 1);
  assert.ok(calls.every((call) => call.key === secret));
  const persisted = (await allTextFiles(join(store.rootDir, "tts-demo"))).join("\n");
  assert.equal(persisted.includes(secret), false);
});

test("ElevenLabs never submits without approval and preserves uncertain credit state", async (t) => {
  const { store } = await fixture(t);
  let posts = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (String(url).endsWith("/v1/models")) return Response.json([{ model_id: "eleven_multilingual_v2", can_do_text_to_speech: true }]);
    if (String(url).includes("/v2/voices?")) return Response.json({ voices: [] });
    posts += 1;
    throw new Error("network outcome unknown");
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl, baseUrl: "https://example.test"
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Cloud narration",
    inputs: { text: "M?t c?u", modelId: "eleven_multilingual_v2", voiceId: "voice_vi" }
  };
  await assert.rejects(executor.execute("tts-demo", request), (error) => error.code === "approval_required");
  assert.equal(posts, 0);
  const auth = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 7, reason: "One cloud request"
  });
  await assert.rejects(executor.execute("tts-demo", { ...request, authorizationId: auth.id }), (error) => error.code === "provider_unreachable");
  assert.equal(posts, 1);
  const settled = (await store.readContext("tts-demo")).authorizations.find((entry) => entry.id === auth.id);
  assert.equal(settled.status, "usage_unknown");
});

test("a changed provider estimate cannot exceed the approved credit ceiling", async (t) => {
  const { store } = await fixture(t);
  let multiplier = 1;
  let posts = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (String(url).endsWith("/v1/models")) return Response.json([{
      model_id: "eleven_multilingual_v2", can_do_text_to_speech: true,
      model_rates: { character_cost_multiplier: multiplier }
    }]);
    if (String(url).includes("/v2/voices?")) return Response.json({ voices: [] });
    posts += 1;
    return new Response(silentWav());
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl, baseUrl: "https://example.test"
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Bounded credits",
    inputs: { text: "12345", modelId: "eleven_multilingual_v2", voiceId: "voice_vi" }
  };
  const auth = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 5, reason: "At most five credits"
  });
  multiplier = 2;
  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: auth.id }),
    (error) => error.code === "approval_limit_exceeded"
  );
  assert.equal(posts, 0);
  const record = (await store.readContext("tts-demo")).authorizations.find((entry) => entry.id === auth.id);
  assert.equal(record.status, "approved");
});
