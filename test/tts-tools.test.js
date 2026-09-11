import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor, ToolExecutorError } from "../src/execution/tool-executor.js";
import { settleExecutionAuthorization } from "../src/execution/execution-authorizations.js";
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
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx.json"), JSON.stringify({
      language: { code: "vi_VN" }, audio: { sample_rate: 44100 }, num_speakers: 1
    }))
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
    inputs: { text: "Xin chào từ PADStudio." }
  });
  const context = await store.readContext("tts-demo");
  const run = context.runs.find((entry) => entry.id === response.runId);
  assert.equal(run.status, "completed");
  assert.equal(response.result.type, "audio.tts");
  assert.equal(response.result.files[0].mediaType, "audio");
  assert.equal(context.results.find((entry) => entry.id === response.resultId).files[0].available, true);
  assert.equal(response.result.verification.status, "passed");
  const outputDirectory = join(store.rootDir, "tts-demo", "outputs", response.runId);
  assert.deepEqual(await readdir(outputDirectory), ["speech.wav"]);
  await access(join(store.rootDir, "tts-demo", response.result.files[0].path));
  const media = await store.resolveMediaSource("tts-demo", {
    kind: "result", id: response.resultId, file: "primary"
  });
  assert.equal(media.mediaType, "audio");
  assert.deepEqual(media.inputResults, [response.resultId]);
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
      return Response.json([{ model_id: "eleven_v3", name: "Eleven v3",
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
        headers: { "character-cost": "27", "request-id": "req-1", "x-trace-id": "trace-1" }
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
    inputs: { text: "Xin chào Việt Nam", modelId: "eleven_v3", voiceId: "voice_vi" }
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
  assert.equal(settled.actualUsage.amount, 27);
  assert.equal(settled.claimedByRun, response.runId);
  assert.equal(settled.exceededApprovedCeiling, true);
  assert.equal(context.runs.find((entry) => entry.id === response.runId).authorizationId, authorization.id);
  const postBody = JSON.parse(calls.find((call) => call.url.includes("/v1/text-to-speech/")).body);
  assert.equal(postBody.language_code, "vi");
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
    if (String(url).endsWith("/v1/models")) {
      return Response.json([{
        model_id: "eleven_v3", can_do_text_to_speech: true,
        model_rates: { character_cost_multiplier: 1 }
      }]);
    }
    if (String(url).includes("/v2/voices?")) return Response.json({ voices: [{ voice_id: "voice_vi", name: "Vietnamese" }] });
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
    inputs: { text: "Một câu", modelId: "eleven_v3", voiceId: "voice_vi" }
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
      model_id: "eleven_v3", can_do_text_to_speech: true,
      model_rates: { character_cost_multiplier: multiplier }
    }]);
    if (String(url).includes("/v2/voices?")) return Response.json({ voices: [{ voice_id: "voice_vi", name: "Vietnamese" }] });
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
    inputs: { text: "12345", modelId: "eleven_v3", voiceId: "voice_vi" }
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


test("ElevenLabs paginates Vietnamese voices and rejects an explicitly unsupported model", async () => {
  const voiceRequests = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (value.endsWith("/v1/models")) {
      return Response.json([{
        model_id: "english_only", can_do_text_to_speech: true,
        languages: [{ language_id: "en", name: "English" }],
        maximum_text_length_per_request: 20,
        can_use_style: false, can_use_speaker_boost: true
      }]);
    }
    if (value.includes("/v2/voices?")) {
      voiceRequests.push(value);
      return Response.json(voiceRequests.length === 1 ? {
        voices: [{ voice_id: "voice_1", name: "One" }],
        has_more: true, next_page_token: "page-2"
      } : {
        voices: [{ voice_id: "voice_2", name: "Two" }],
        has_more: false
      });
    }
    return new Response(null, { status: 404 });
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl, baseUrl: "https://example.test"
  });
  const catalog = await tool.inspect({ language: "vi" });
  assert.deepEqual(catalog.voices.map((voice) => voice.voiceId), ["voice_1", "voice_2"]);
  assert.match(voiceRequests[1], /next_page_token=page-2/);
  assert.equal(catalog.models[0].supportsRequestedLanguage, false);
  assert.equal(catalog.models[0].canUseStyle, false);
  await assert.rejects(
    tool.estimateUsage({ inputs: {
      text: "Xin chào", modelId: "english_only", voiceId: "voice_2", languageCode: "vi"
    }}),
    (error) => error.code === "invalid_input" && /does not advertise support/.test(error.message)
  );
});

test("credit ceiling must be an exact integer and a free tool rejects authorization", async (t) => {
  const { root, store } = await fixture(t);
  const modelDirectory = join(root, "models");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(modelDirectory));
  await Promise.all([
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx"), "model"),
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx.json"), JSON.stringify({
      language: { code: "vi_VN" }, audio: { sample_rate: 44100 }, num_speakers: 1
    }))
  ]);
  const paid = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/v1/user/subscription")) return Response.json({});
      if (String(url).endsWith("/v1/models")) return Response.json([{
        model_id: "multi", can_do_text_to_speech: true, model_rates: { character_cost_multiplier: 1 }
      }]);
      return Response.json({ voices: [{ voice_id: "voice", name: "Vietnamese" }], has_more: false });
    },
    baseUrl: "https://example.test"
  });
  const paidExecutor = new ToolExecutor({ store, registry: new ToolRegistry([paid]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Integer ceiling",
    inputs: { text: "abc", modelId: "multi", voiceId: "voice" }
  };
  await assert.rejects(
    paidExecutor.authorize("tts-demo", request, {
      approvedBy: "user", maxCredits: 3.5, reason: "Must not round up"
    }),
    (error) => error.code === "authorization_invalid"
  );

  const local = createPiperTts({
    loadConfig: async () => ({
      piper: { pythonCommand: "python", modelDirectory, defaultModel: "vi_VN-vais1000-medium" }
    }),
    executeCommand: async () => ({ stdout: "ok", stderr: "" })
  });
  const localExecutor = new ToolExecutor({ store, registry: new ToolRegistry([local]) });
  await assert.rejects(
    localExecutor.execute("tts-demo", {
      capability: "tts.synthesize", tool: "piper-local", purpose: "No credit",
      inputs: { text: "Xin chào" }, authorizationId: "authorization-fake"
    }),
    (error) => error.code === "approval_not_required"
  );
});


test("a claimed authorization is released when preparation fails before the paid request", async (t) => {
  const { store } = await fixture(t);
  let configReads = 0;
  let posts = 0;
  const tool = createElevenLabsTts({
    loadConfig: async () => {
      configReads += 1;
      if (configReads === 5) throw new Error("local preparation failed");
      return { piper: {}, elevenLabs: { apiKey: "test-key" } };
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith("/v1/user/subscription")) return Response.json({});
      if (String(url).endsWith("/v1/models")) return Response.json([{
        model_id: "multi", can_do_text_to_speech: true, model_rates: { character_cost_multiplier: 1 }
      }]);
      if (String(url).includes("/v2/voices?")) return Response.json({ voices: [{ voice_id: "voice", name: "Vietnamese" }], has_more: false });
      posts += 1;
      return new Response(silentWav());
    },
    baseUrl: "https://example.test"
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Pre-request failure",
    inputs: { text: "abc", modelId: "multi", voiceId: "voice" }
  };
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 3, reason: "One request only"
  });
  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: authorization.id }),
    /local preparation failed/
  );
  assert.equal(posts, 0);
  const record = (await store.readContext("tts-demo")).authorizations
    .find((entry) => entry.id === authorization.id);
  assert.equal(record.status, "released");
});


test("Piper rejects an out-of-range speaker and output sample-rate drift", async (t) => {
  const { root, store } = await fixture(t);
  const modelDirectory = join(root, "models");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(modelDirectory));
  await Promise.all([
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx"), "model"),
    writeFile(join(modelDirectory, "vi_VN-vais1000-medium.onnx.json"), JSON.stringify({
      language: { code: "vi_VN" }, audio: { sample_rate: 22050 }, num_speakers: 1
    }))
  ]);
  let syntheses = 0;
  const tool = createPiperTts({
    loadConfig: async () => ({
      piper: { pythonCommand: "python", modelDirectory, defaultModel: "vi_VN-vais1000-medium" }
    }),
    executeCommand: async (_executable, args) => {
      if (args.includes("--output-file")) {
        syntheses += 1;
        await writeFile(args[args.indexOf("--output-file") + 1], silentWav());
        return { stdout: "", stderr: "" };
      }
      if (args.includes("-show_format")) {
        return { stdout: probeOutput("pcm_s16le"), stderr: "" };
      }
      return { stdout: "ok", stderr: "" };
    }
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const base = {
    capability: "tts.synthesize", tool: "piper-local", purpose: "Validate voice",
    inputs: { text: "Xin chào" }
  };
  await assert.rejects(
    executor.execute("tts-demo", { ...base, inputs: { ...base.inputs, speakerId: 1 } }),
    (error) => error.code === "invalid_input" && /speaker range/.test(error.message)
  );
  assert.equal(syntheses, 0);
  await assert.rejects(
    executor.execute("tts-demo", base),
    (error) => error.code === "invalid_output"
  );
  assert.equal(syntheses, 1);
  assert.equal((await store.readResults("tts-demo")).length, 0);
});


test("ElevenLabs excludes custom-rate voices and refuses one returned contrary to the filter", async () => {
  const voiceUrls = [];
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    executeCommand: async () => ({ stdout: "ffprobe version test", stderr: "" }),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/v1/user/subscription")) return Response.json({});
      if (value.endsWith("/v1/models")) return Response.json([{
        model_id: "eleven_v3", can_do_text_to_speech: true,
        languages: [{ language_id: "vi", name: "Vietnamese" }],
        model_rates: { character_cost_multiplier: 1 }
      }]);
      if (value.includes("/v2/voices?")) {
        voiceUrls.push(value);
        return Response.json({
          voices: [{
            voice_id: "custom_voice", name: "Custom",
            sharing: { rate: 0.05 }
          }],
          has_more: false
        });
      }
      return new Response(null, { status: 404 });
    },
    baseUrl: "https://example.test"
  });
  const catalog = await tool.inspect({ language: "vi" });
  assert.match(voiceUrls[0], /include_custom_rates=false/);
  assert.equal(catalog.voices[0].customRate, 0.05);
  await assert.rejects(
    tool.estimateUsage({ inputs: {
      text: "Xin chào", modelId: "eleven_v3", voiceId: "custom_voice"
    }}),
    (error) => error.code === "approval_limit_unknown"
  );
});

test("ElevenLabs refuses to plan or POST when ffprobe is unavailable", async (t) => {
  const { store } = await fixture(t);
  let requests = 0;
  const missing = new Error("missing ffprobe");
  missing.code = "ENOENT";
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    executeCommand: async () => { throw missing; },
    fetchImpl: async () => {
      requests += 1;
      throw new Error("must not call ElevenLabs");
    },
    baseUrl: "https://example.test"
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  await assert.rejects(
    executor.plan("tts-demo", {
      capability: "tts.synthesize", tool: "elevenlabs", purpose: "Dependency gate",
      inputs: { text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi" }
    }),
    (error) => error.code === "tool_unavailable" && /ffprobe/.test(error.message)
  );
  assert.equal(requests, 0);
});

test("paid audio survives Result persistence failure and recovers without another POST", async (t) => {
  const { store } = await fixture(t);
  let posts = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (value.endsWith("/v1/models")) return Response.json([{
      model_id: "eleven_v3", can_do_text_to_speech: true,
      languages: [{ language_id: "vi", name: "Vietnamese" }],
      model_rates: { character_cost_multiplier: 1 }
    }]);
    if (value.includes("/v2/voices?")) {
      return Response.json({
        voices: [{ voice_id: "voice_vi", name: "Vietnamese" }],
        has_more: false
      });
    }
    if (value.includes("/v1/text-to-speech/voice_vi")) {
      posts += 1;
      return new Response(silentWav(), {
        status: 200,
        headers: { "character-cost": "9", "request-id": "req-paid", "x-trace-id": "trace-paid" }
      });
    }
    return new Response(null, { status: 404 });
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl,
    baseUrl: "https://example.test",
    executeCommand: async (_executable, args) => ({
      stdout: args.includes("-show_format") ? probeOutput("mp3") : "ffprobe version test",
      stderr: ""
    })
  });
  let failResultOnce = true;
  const failingStore = new Proxy(store, {
    get(target, property) {
      if (property === "addResult") {
        return async (...args) => {
          if (failResultOnce) {
            failResultOnce = false;
            throw new Error("simulated Result persistence failure");
          }
          return target.addResult(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const executor = new ToolExecutor({ store: failingStore, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Durable paid narration",
    inputs: { text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi" }
  };
  const plan = await executor.plan("tts-demo", request);
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: plan.estimatedUsage.amount, reason: "One durable request"
  });
  const pending = await executor.execute("tts-demo", {
    ...request, authorizationId: authorization.id
  });
  assert.equal(pending.status, "finalization_pending");
  assert.equal(pending.resultId, null);
  assert.equal(posts, 1);

  const context = await store.readContext("tts-demo");
  const run = context.runs.find((entry) => entry.id === pending.runId);
  const settled = context.authorizations.find((entry) => entry.id === authorization.id);
  assert.equal(run.status, "in_progress");
  assert.ok(run.pendingResult);
  assert.equal(settled.status, "consumed");
  assert.equal(settled.actualUsage.amount, 9);
  assert.equal(settled.providerRequestId, "req-paid");
  assert.deepEqual(context.runRecovery.pendingFinalizations, [{
    runId: pending.runId, resultIds: [], recoverable: true
  }]);
  assert.deepEqual(await readdir(join(store.rootDir, "tts-demo", "outputs", pending.runId)), ["speech.mp3"]);

  const authorizationDirectory = join(store.rootDir, "tts-demo", "authorizations");
  const authorizationPath = join(authorizationDirectory, authorization.id + ".json");
  const interruptedAuthorization = JSON.parse(await readFile(authorizationPath, "utf8"));
  interruptedAuthorization.status = "claimed";
  interruptedAuthorization.finishedAt = null;
  await writeFile(authorizationPath, JSON.stringify(interruptedAuthorization, null, 2) + "\n", "utf8");
  const claimPath = join(authorizationDirectory, authorization.id + ".claim");
  await mkdir(claimPath);

  const recovered = await store.recoverRunFinalization("tts-demo", pending.runId);
  assert.equal(recovered.status, "completed");
  assert.equal(posts, 1);
  const reopened = await store.readContext("tts-demo");
  const result = reopened.results.find((entry) => entry.createdByRun === pending.runId);
  const recoveredAuthorization = reopened.authorizations.find((entry) => entry.id === authorization.id);
  assert.ok(result);
  assert.equal(result.files[0].available, true);
  assert.equal(result.data.providerRequestId, "req-paid");
  assert.equal(recoveredAuthorization.status, "consumed");
  await assert.rejects(access(claimPath), (error) => error.code === "ENOENT");

  await mkdir(claimPath);
  const repeatedSettlement = await settleExecutionAuthorization(store, "tts-demo", authorization.id, {
    status: "consumed"
  });
  assert.equal(repeatedSettlement.status, "consumed");
  await assert.rejects(access(claimPath), (error) => error.code === "ENOENT");
});


test("ElevenLabs rechecks ffprobe after approval and releases authorization without POST", async (t) => {
  const { store } = await fixture(t);
  let versionChecks = 0;
  let posts = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith("/v1/user/subscription")) return Response.json({});
    if (value.endsWith("/v1/models")) return Response.json([{
      model_id: "eleven_v3", can_do_text_to_speech: true,
      languages: [{ language_id: "vi" }],
      model_rates: { character_cost_multiplier: 1 }
    }]);
    if (value.includes("/v2/voices?")) {
      return Response.json({ voices: [{ voice_id: "voice_vi" }], has_more: false });
    }
    posts += 1;
    return new Response(silentWav());
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl,
    baseUrl: "https://example.test",
    executeCommand: async (_executable, args) => {
      if (args.includes("-version")) {
        versionChecks += 1;
        if (versionChecks === 3) {
          const error = new Error("ffprobe disappeared");
          error.code = "ENOENT";
          throw error;
        }
      }
      return { stdout: "ffprobe version test", stderr: "" };
    }
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Dependency recheck",
    inputs: { text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi" }
  };
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 8, reason: "Only if dependencies remain ready"
  });
  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: authorization.id }),
    (error) => /ffprobe disappeared/.test(error.message)
  );
  assert.equal(posts, 0);
  const record = (await store.readContext("tts-demo")).authorizations
    .find((entry) => entry.id === authorization.id);
  assert.equal(record.status, "released");
});

test("provider usage and request IDs persist when local verification fails after response", async (t) => {
  const { store } = await fixture(t);
  let posts = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith("/v1/user/subscription")) return Response.json({});
    if (value.endsWith("/v1/models")) return Response.json([{
      model_id: "eleven_v3", can_do_text_to_speech: true,
      languages: [{ language_id: "vi" }],
      model_rates: { character_cost_multiplier: 1 }
    }]);
    if (value.includes("/v2/voices?")) {
      return Response.json({ voices: [{ voice_id: "voice_vi" }], has_more: false });
    }
    posts += 1;
    return new Response(silentWav(), {
      headers: { "character-cost": "11", "request-id": "req-receipt", "x-trace-id": "trace-receipt" }
    });
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl,
    baseUrl: "https://example.test",
    executeCommand: async (_executable, args) => {
      if (args.includes("-show_format")) {
        const error = new Error("verification failed locally");
        error.code = "ENOENT";
        throw error;
      }
      return { stdout: "ffprobe version test", stderr: "" };
    }
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize", tool: "elevenlabs", purpose: "Durable provider receipt",
    inputs: { text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi" }
  };
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 11, reason: "Record the provider response"
  });
  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: authorization.id }),
    (error) => /verification failed locally/.test(error.message)
  );
  assert.equal(posts, 1);
  const context = await store.readContext("tts-demo");
  const record = context.authorizations.find((entry) => entry.id === authorization.id);
  assert.equal(record.status, "consumed");
  assert.equal(record.actualUsage.amount, 11);
  assert.equal(record.providerRequestId, "req-receipt");
  assert.equal(record.traceId, "trace-receipt");
  assert.ok(record.providerResponseReceivedAt);
  assert.equal(context.results.length, 0);
});

test("ElevenLabs refuses approval when the model credit multiplier is unknown", async () => {
  let posts = 0;
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    executeCommand: async () => ({ stdout: "ffprobe version test", stderr: "" }),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/v1/user/subscription")) return Response.json({});
      if (value.endsWith("/v1/models")) {
        return Response.json([{
          model_id: "eleven_v3",
          can_do_text_to_speech: true,
          languages: [{ language_id: "vi" }]
        }]);
      }
      if (value.includes("/v2/voices?")) {
        return Response.json({ voices: [{ voice_id: "voice_vi" }], has_more: false });
      }
      posts += 1;
      return new Response(silentWav());
    },
    baseUrl: "https://example.test"
  });

  await assert.rejects(
    tool.estimateUsage({ inputs: {
      text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi"
    }}),
    (error) => error.code === "approval_limit_unknown"
  );
  assert.equal(posts, 0);
});

test("provider receipt persists before a paid audio response body fails", async (t) => {
  const { store } = await fixture(t);
  let posts = 0;
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/v1/user/subscription")) return Response.json({});
      if (value.endsWith("/v1/models")) {
        return Response.json([{
          model_id: "eleven_v3",
          can_do_text_to_speech: true,
          languages: [{ language_id: "vi" }],
          model_rates: { character_cost_multiplier: 1 }
        }]);
      }
      if (value.includes("/v2/voices?")) {
        return Response.json({ voices: [{ voice_id: "voice_vi" }], has_more: false });
      }
      posts += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "character-cost": "13",
          "request-id": "req-body-failed",
          "x-trace-id": "trace-body-failed"
        }),
        async arrayBuffer() {
          throw new Error("response body interrupted");
        }
      };
    },
    baseUrl: "https://example.test",
    executeCommand: async () => ({ stdout: "ffprobe version test", stderr: "" })
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = {
    capability: "tts.synthesize",
    tool: "elevenlabs",
    purpose: "Persist response headers before body",
    inputs: { text: "Xin chào", modelId: "eleven_v3", voiceId: "voice_vi" }
  };
  const authorization = await executor.authorize("tts-demo", request, {
    approvedBy: "user", maxCredits: 13, reason: "One body-read attempt"
  });

  await assert.rejects(
    executor.execute("tts-demo", { ...request, authorizationId: authorization.id }),
    (error) => error.code === "provider_error" && error.requestSubmitted
  );
  assert.equal(posts, 1);
  const context = await store.readContext("tts-demo");
  const record = context.authorizations.find((entry) => entry.id === authorization.id);
  assert.equal(record.status, "consumed");
  assert.equal(record.actualUsage.amount, 13);
  assert.equal(record.providerRequestId, "req-body-failed");
  assert.equal(record.traceId, "trace-body-failed");
  assert.ok(record.providerResponseReceivedAt);
  assert.equal(context.results.length, 0);
});
