import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutor } from "../src/execution/tool-executor.js";
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

const probeMp3 = JSON.stringify({
  streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 1 }],
  format: { duration: "0.1" }
});

function characterTimes(text, { endsAreDurations = false } = {}) {
  const characters = [...text];
  const starts = characters.map((_, index) => index * 0.005);
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: starts.map((value) => (endsAreDurations ? 0.005 : value + 0.005))
  };
}

// A stand-in for ElevenLabs: the voice's price per character, and what the timestamped variant answers with.
function provider({ rate = null, charge = (characters) => characters, timestamps = null, calls = [] } = {}) {
  return async (url, options = {}) => {
    const address = String(url);
    calls.push(address);
    if (address.endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (address.endsWith("/v1/models")) {
      return Response.json([{
        model_id: "eleven_v3", can_do_text_to_speech: true, languages: [{ language_id: "vi" }],
        model_rates: { character_cost_multiplier: 1 }
      }]);
    }
    if (address.includes("/v2/voices?")) {
      return Response.json({ voices: [{ voice_id: "voice_vi", name: "Giọng thử", ...(rate === null ? {} : { sharing: { rate } }) }] });
    }
    if (address.includes("/v1/text-to-speech/voice_vi")) {
      const body = JSON.parse(options.body);
      const headers = { "character-cost": String(charge([...body.text].length)), "request-id": `req-${calls.length}` };
      if (address.includes("/with-timestamps")) return Response.json(timestamps(body.text), { status: 200, headers });
      return new Response(silentWav(), { status: 200, headers });
    }
    return new Response(null, { status: 404 });
  };
}

async function setup(t, providerOptions) {
  const root = await mkdtemp(join(tmpdir(), "padstudio-tts-guardrails-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(join(root, "projects"));
  await store.createProject({ projectId: "p", title: "Guardrails" });
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key" } }),
    fetchImpl: provider(providerOptions), baseUrl: "https://example.test",
    executeCommand: async () => ({ stdout: probeMp3, stderr: "" })
  });
  return { store, executor: new ToolExecutor({ store, registry: new ToolRegistry([tool]) }) };
}

const requestFor = (inputs) => ({
  capability: "tts.synthesize", tool: "elevenlabs", purpose: "Narration",
  inputs: { modelId: "eleven_v3", voiceId: "voice_vi", ...inputs }
});

// Plan, approve exactly the planned ceiling, and run: what an Agent does for every paid request.
async function paidRun(executor, inputs) {
  const request = requestFor(inputs);
  const plan = await executor.plan("p", request);
  const authorization = await executor.authorize("p", request, {
    approvedBy: "user", maxCredits: plan.estimatedUsage.amount, reason: "Approve exactly this text"
  });
  const response = await executor.execute("p", { ...request, authorizationId: authorization.id });
  const settled = (await executor.store.readContext("p")).authorizations.find((entry) => entry.id === authorization.id);
  return { plan, authorization, response, settled };
}

test("planning shows what a voice may misread before any credit is spent, and the Result remembers it", async (t) => {
  const { executor } = await setup(t);
  const risky = requestFor({ text: "Tính 2^10 với n lần, duyệt BFS." });
  const plan = await executor.plan("p", risky);
  assert.equal(plan.inputReview.kind, "speech_text");
  assert.deepEqual(plan.inputReview.advisories.map((entry) => entry.code), ["digits", "symbols", "single_letters", "acronyms"]);
  assert.ok(plan.inputReview.notChecked.length >= 2);
  assert.equal(plan.estimatedUsage.amount, [...risky.inputs.text].length, "the review does not change the price");

  const clean = await executor.plan("p", requestFor({ text: "Ba mũ mười ba nghĩa là nhân mười ba thừa số ba." }));
  assert.equal(clean.inputReview.clean, true);

  // It advises and never blocks: the risky request can still be approved and run, and the Result records the review.
  const { response } = await paidRun(executor, { text: risky.inputs.text });
  assert.deepEqual(response.result.data.textReview, { clean: false, warnings: 4, notes: 1 });
  const cleanRun = await paidRun(executor, { text: "Ba mũ mười ba." });
  assert.deepEqual(cleanRun.response.result.data.textReview, { clean: true, warnings: 0, notes: 0 });
});

test("free narration is reviewed too, and a request with no text yet is not an error", async () => {
  const piper = createPiperTts({ loadConfig: async () => ({ piper: {}, elevenLabs: {} }) });
  const review = piper.reviewInputs({ inputs: { text: "Số 7 và x." } });
  assert.deepEqual(review.advisories.map((entry) => entry.code), ["digits", "single_letters"]);
  assert.equal(piper.reviewInputs({ inputs: {} }), null);
  assert.equal(createElevenLabsTts({ loadConfig: async () => ({}) }).reviewInputs({ inputs: { text: "  " } }), null);
});

test("a voice that costs less than listed is measured from a short sample, so the approved ceiling stays close to the real cost", async (t) => {
  // The shape of the Binary Exponentiation project: 154 characters cost 34 credits, then 3269 cost 718, not 3269.
  const { executor } = await setup(t, { rate: 1, charge: (characters) => Math.round(characters * 0.2208) });
  const sample = "đ".repeat(154);
  const full = "ê".repeat(3269);

  const before = await executor.plan("p", requestFor({ text: full }));
  assert.equal(before.estimatedUsage.amount, 3269, "with no measurement the listed figure stands");
  assert.equal(before.estimatedUsage.uncertain, true);
  assert.equal(before.estimatedUsage.calibrated, undefined);

  const first = await paidRun(executor, { text: sample });
  assert.equal(first.settled.actualUsage.amount, 34);

  const after = await executor.plan("p", requestFor({ text: full }));
  assert.equal(after.estimatedUsage.calibrated, true);
  assert.equal(after.estimatedUsage.uncertain, true, "still an extrapolation, so still flagged");
  assert.equal(after.estimatedUsage.amount, Math.ceil(3269 * 34.5 / 154));
  assert.match(after.estimatedUsage.basis, /observed_rate:34\/154/);
  assert.match(after.estimatedUsage.basis, /listed_estimate:3269/);

  // Running at that ceiling works (plan and run use the same figure) and the real cost stays under it.
  const second = await paidRun(executor, { text: full });
  assert.equal(second.settled.actualUsage.amount, 722);
  assert.equal(second.settled.exceededApprovedCeiling, false);
  assert.ok(second.authorization.maxCredits >= 722 && second.authorization.maxCredits < 750, `ceiling ${second.authorization.maxCredits}`);
  assert.equal(second.settled.estimatedUsage.calibrated, true, "the stored authorization keeps the flag");
});

test("a voice that costs more than listed is measured too, instead of exceeding the ceiling", async (t) => {
  const { executor } = await setup(t, { rate: 2, charge: (characters) => characters * 2 });
  await paidRun(executor, { text: "ơ".repeat(17) });
  const run = await paidRun(executor, { text: "ư".repeat(40) });
  assert.equal(run.plan.estimatedUsage.amount, Math.ceil(40 * 34.5 / 17));
  assert.equal(run.settled.actualUsage.amount, 80);
  assert.equal(run.settled.exceededApprovedCeiling, false, "the listed estimate of 40 would have been exceeded");
});

test("earlier requests that disagree are not extrapolated from", async (t) => {
  let call = 0;
  const { executor } = await setup(t, { rate: 1, charge: (characters) => (call++ === 0 ? characters * 2 : characters * 0.5) });
  await paidRun(executor, { text: "a".repeat(20) });
  await paidRun(executor, { text: "b".repeat(20) });
  const plan = await executor.plan("p", requestFor({ text: "c".repeat(100) }));
  assert.equal(plan.estimatedUsage.amount, 100, "the listed figure, because the two samples imply different rates");
  assert.equal(plan.estimatedUsage.calibrated, undefined);
  assert.equal(plan.estimatedUsage.uncertain, true);
});

test("a voice at the model's listed rate is never re-estimated", async (t) => {
  const { executor } = await setup(t, { rate: null, charge: (characters) => characters });
  await paidRun(executor, { text: "d".repeat(30) });
  const plan = await executor.plan("p", requestFor({ text: "e".repeat(90) }));
  assert.equal(plan.estimatedUsage.amount, 90);
  assert.equal(plan.estimatedUsage.uncertain, undefined);
  assert.equal(plan.estimatedUsage.calibrated, undefined);
});

test("word timing comes with the same request when asked for, and is stored as a Result file", async (t) => {
  const calls = [];
  const { store, executor } = await setup(t, {
    calls, timestamps: (text) => ({
      audio_base64: silentWav().toString("base64"), alignment: characterTimes(text), normalized_alignment: characterTimes(text)
    })
  });
  const text = "Xin chào các bạn";
  const { response } = await paidRun(executor, { text, withTimestamps: true });
  assert.ok(calls.some((address) => address.includes("/v1/text-to-speech/voice_vi/with-timestamps?")));
  assert.deepEqual(response.result.files.map((file) => [file.id, file.mediaType]), [["primary", "audio"], ["timing", "application/json"]]);
  assert.equal((await store.readResult("p", response.resultId)).files[1].available, true, "the file is really on disk");
  assert.equal(response.result.data.timing.available, true);
  assert.equal(response.result.data.timing.fileId, "timing");
  assert.equal(response.result.data.timing.words, 4);
  assert.equal(response.result.data.timing.endTimesAre, "end_times");
  assert.ok(response.result.verification.checks.includes("provider_alignment_consistent"));

  const stored = await store.verifyResultFile("p", response.resultId, "timing");
  const document = JSON.parse(await readFile(stored.filePath, "utf8"));
  assert.deepEqual(document.words.map((word) => word.text), ["Xin", "chào", "các", "bạn"]);
  assert.equal(document.alignment.characters.join(""), text);
  assert.equal(document.checks.textMatchesRequest, true);
});

test("a provider that sends durations in the end field is understood, not mis-timed", async (t) => {
  const { executor } = await setup(t, {
    timestamps: (text) => ({ audio_base64: silentWav().toString("base64"), alignment: characterTimes(text, { endsAreDurations: true }) })
  });
  const { response } = await paidRun(executor, { text: "Xin chào", withTimestamps: true });
  assert.equal(response.result.data.timing.available, true);
  assert.equal(response.result.data.timing.endTimesAre, "durations");
});

test("timing that cannot be trusted never costs the audio that was paid for", async (t) => {
  const { executor } = await setup(t, {
    timestamps: (text) => ({ audio_base64: silentWav().toString("base64"), alignment: { ...characterTimes(text), character_end_times_seconds: [] } })
  });
  const { response, settled } = await paidRun(executor, { text: "Xin chào", withTimestamps: true });
  assert.equal(response.status, "completed");
  assert.deepEqual(response.result.files.map((file) => file.id), ["primary"], "no timing file is stored for a refused alignment");
  assert.equal(response.result.data.timing.available, false);
  assert.match(response.result.data.timing.reason, /empty or differ in length/);
  assert.match(response.result.verification.details.timingUnavailable, /differ in length/);
  assert.equal(response.result.verification.status, "passed");
  assert.equal(settled.status, "consumed");
});

test("without withTimestamps the plain request is used and the Result says no timing was asked for", async (t) => {
  const calls = [];
  const { executor } = await setup(t, { calls });
  const { response } = await paidRun(executor, { text: "Xin chào" });
  assert.equal(calls.some((address) => address.includes("with-timestamps")), false);
  assert.deepEqual(response.result.data.timing, { requested: false });
  assert.deepEqual(response.result.files.map((file) => file.id), ["primary"]);
});

test("a timestamped answer without audio fails the run, but the credit it cost is still recorded", async (t) => {
  const { executor, store } = await setup(t, { timestamps: (text) => ({ alignment: characterTimes(text) }) });
  const request = requestFor({ text: "Xin chào", withTimestamps: true });
  const plan = await executor.plan("p", request);
  const authorization = await executor.authorize("p", request, { approvedBy: "user", maxCredits: plan.estimatedUsage.amount, reason: "One request" });
  await assert.rejects(executor.execute("p", { ...request, authorizationId: authorization.id }), (error) => error.code === "invalid_output");
  const settled = (await store.readContext("p")).authorizations.find((entry) => entry.id === authorization.id);
  assert.equal(settled.status, "consumed", "the provider answered, so the credit is spent and must show as spent");
  assert.equal(settled.actualUsage.amount, 8);
});
