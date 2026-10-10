import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCreditBudget, clearCreditBudget, configureCreditBudget, creditBudgetSnapshot, readCreditBudget
} from "../src/execution/credit-budget.js";
import { settleExecutionAuthorization } from "../src/execution/execution-authorizations.js";
import { ToolExecutor, ToolExecutorError } from "../src/execution/tool-executor.js";
import { ToolRegistry } from "../src/execution/tool-registry.js";
import { ProjectStore } from "../src/project/project-store.js";
import { createElevenLabsTts } from "../src/tools/elevenlabs-tts.js";

function silentWav() {
  const output = Buffer.alloc(1644);
  output.write("RIFF", 0); output.writeUInt32LE(1636, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(8000, 24); output.writeUInt32LE(16000, 28); output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34); output.write("data", 36); output.writeUInt32LE(1600, 40);
  return output;
}

async function fixture(t, { characterCost = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "padstudio-credits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(join(root, "projects"));
  await store.createProject({ projectId: "demo", title: "Demo" });
  const posts = [];
  const fetchImpl = async (url, options) => {
    const text = String(url);
    if (text.endsWith("/v1/user/subscription")) return Response.json({ status: "active" });
    if (text.endsWith("/v1/models")) {
      return Response.json([{ model_id: "eleven_v3", name: "v3", can_do_text_to_speech: true, languages: [{ language_id: "vi" }], model_rates: { character_cost_multiplier: 1 } }]);
    }
    if (text.includes("/v2/voices?")) return Response.json({ voices: [{ voice_id: "voice_vi", name: "Giọng Việt" }] });
    if (text.includes("/v1/text-to-speech/")) {
      const body = JSON.parse(options.body);
      posts.push(body.text);
      return new Response(silentWav(), { status: 200, headers: { "character-cost": String(characterCost ?? [...body.text].length), "request-id": "req-" + posts.length } });
    }
    return new Response(null, { status: 404 });
  };
  const tool = createElevenLabsTts({
    loadConfig: async () => ({ piper: {}, elevenLabs: { apiKey: "test-key-123456" } }), fetchImpl, baseUrl: "https://example.test",
    executeCommand: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3" }], format: { duration: "0.1" } }), stderr: "" })
  });
  const executor = new ToolExecutor({ store, registry: new ToolRegistry([tool]) });
  const request = (text) => ({ capability: "tts.synthesize", tool: "elevenlabs", purpose: "Lời đọc", inputs: { text, modelId: "eleven_v3", voiceId: "voice_vi" } });
  const authorize = (text) => executor.authorize("demo", request(text), { approvedBy: "user", maxCredits: [...text].length, reason: "Đã hỏi người dùng" });
  return { store, executor, request, authorize, posts };
}

test("a credit cap is a plain whole number, can be changed and cleared, and is stored per project", async (t) => {
  const { store } = await fixture(t);
  assert.equal(await readCreditBudget(store, "demo"), null);
  assert.deepEqual((await creditBudgetSnapshot(store, "demo")).policy, null);
  assert.equal((await creditBudgetSnapshot(store, "demo")).remainingCredits, null);

  const policy = await configureCreditBudget(store, "demo", { maxCredits: 500 });
  assert.equal(policy.maxCredits, 500);
  assert.equal((await readCreditBudget(store, "demo")).maxCredits, 500);
  assert.equal((await creditBudgetSnapshot(store, "demo")).remainingCredits, 500);
  await configureCreditBudget(store, "demo", { maxCredits: 0 });
  assert.equal((await creditBudgetSnapshot(store, "demo")).remainingCredits, 0);

  for (const bad of [{ maxCredits: -1 }, { maxCredits: 1.5 }, { maxCredits: "100" }, { maxCredits: 100, extra: 1 }, {}, null, []]) {
    await assert.rejects(configureCreditBudget(store, "demo", bad), (error) => error.name === "CreditBudgetError", JSON.stringify(bad));
  }
  assert.equal((await readCreditBudget(store, "demo")).maxCredits, 0, "a refused change leaves the cap as it was");

  await clearCreditBudget(store, "demo");
  assert.equal(await readCreditBudget(store, "demo"), null);
  assert.doesNotThrow(() => assertCreditBudget({ maxCredits: null, remainingCredits: null }, 10 ** 9));
});

test("authorizing and running stop at the project's credit cap, counting what was really spent", async (t) => {
  const { store, executor, request, authorize, posts } = await fixture(t, { characterCost: 12 });
  await configureCreditBudget(store, "demo", { maxCredits: 30 });

  const plan = await executor.plan("demo", request("Xin chào bạn"));
  assert.deepEqual([plan.creditBudget.maxCredits, plan.creditBudget.usedCredits, plan.creditBudget.remainingCredits], [30, 0, 30]);

  const first = await authorize("Xin chào bạn");
  await executor.execute("demo", { ...request("Xin chào bạn"), authorizationId: first.id });
  let snapshot = await creditBudgetSnapshot(store, "demo");
  assert.equal(snapshot.usedCredits, 12, "the provider's own character-cost is what counts, not the estimate");
  assert.equal(snapshot.remainingCredits, 18);
  assert.equal(snapshot.authorizations.consumed, 1);

  // Too long for what is left: refused at authorization, before anything is approved.
  const long = "Đây là một đoạn lời dẫn khá dài vượt quá phần credit còn lại";
  await assert.rejects(authorize(long), (error) => error instanceof ToolExecutorError && error.code === "credit_budget_exceeded" && /18 of 30/.test(error.message));
  assert.equal((await creditBudgetSnapshot(store, "demo")).authorizations.approved, 0);

  // Authorizations made earlier still cannot run past the cap: it is checked again when the request runs.
  const a = await authorize("Câu một hai ba");
  const b = await authorize("Câu bốn năm sáu");
  await executor.execute("demo", { ...request("Câu một hai ba"), authorizationId: a.id });
  snapshot = await creditBudgetSnapshot(store, "demo");
  assert.equal(snapshot.usedCredits, 24);
  await assert.rejects(
    executor.execute("demo", { ...request("Câu bốn năm sáu"), authorizationId: b.id }),
    (error) => error.code === "credit_budget_exceeded"
  );
  assert.equal(posts.length, 2, "the over-cap request never reached the provider");
  const stillApproved = (await store.readContext("demo")).authorizations.find((entry) => entry.id === b.id);
  assert.equal(stillApproved.status, "approved", "a refused run does not consume the authorization");

  // Raising the cap lets exactly that authorization run.
  await configureCreditBudget(store, "demo", { maxCredits: 40 });
  await executor.execute("demo", { ...request("Câu bốn năm sáu"), authorizationId: b.id });
  assert.equal((await creditBudgetSnapshot(store, "demo")).usedCredits, 36);
  assert.equal(posts.length, 3);
});

test("uncertain and in-flight credit use counts against the cap; released use does not; no cap changes nothing", async (t) => {
  const { store, executor, request, authorize } = await fixture(t);
  await configureCreditBudget(store, "demo", { maxCredits: 100 });
  const unknown = await authorize("Lời đọc một");
  const released = await authorize("Lời đọc hai");
  const { claimExecutionAuthorization } = await import("../src/execution/execution-authorizations.js");
  const binding = (record, text) => ({ requestHash: record.requestHash, tool: record.tool, runId: "run-test", currentUsage: { unit: "credits", amount: [...text].length } });
  await claimExecutionAuthorization(store, "demo", unknown.id, binding(unknown, "Lời đọc một"));
  await settleExecutionAuthorization(store, "demo", unknown.id, { status: "usage_unknown" });
  await claimExecutionAuthorization(store, "demo", released.id, binding(released, "Lời đọc hai"));
  await settleExecutionAuthorization(store, "demo", released.id, { status: "released" });
  const snapshot = await creditBudgetSnapshot(store, "demo");
  assert.equal(snapshot.usedCredits, [..."Lời đọc một"].length, "an unknown outcome is counted as spent; a released one is not");
  assert.deepEqual([snapshot.authorizations.usageUnknown, snapshot.authorizations.released], [1, 1]);

  await clearCreditBudget(store, "demo");
  const free = await executor.plan("demo", request("x".repeat(5000)));
  assert.equal(free.creditBudget.maxCredits, null);
  const approved = await authorize("Không có trần");
  assert.ok(approved.id);
});
