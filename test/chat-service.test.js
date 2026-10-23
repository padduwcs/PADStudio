import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatService } from "../src/chat/chat-service.js";
import { FixtureCodex } from "../scripts/lib/chat-fixture.mjs";
import { approvalAnswer, approvalView, ChatError, displayItem, externalUrl, safeError } from "../src/chat/chat-protocol.js";
import { chatLink } from "../ui/chat-markdown.js";

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "padstudio-workspace-chat-"));
  const client = new FixtureCodex(); const service = new ChatService({ cwd, client });
  t.after(async () => { await service.close(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, client, service, id: (await service.read()).conversationId };
}
const message = (id = "request-0001", value = "Làm hai project video khác nhau") => ({ clientId: id, message: value });

test("Codex starts in the folder with native defaults and exact user text, without project binding or injected instructions", async (t) => {
  const { cwd, client, service, id } = await fixture(t); const status = await service.connect();
  assert.equal(status.authenticated, true); assert.equal(status.workspace.path, cwd);
  assert.equal(JSON.stringify(status).includes("NEVER_SHOW"), false); assert.equal(JSON.stringify(status).includes("private@"), false);
  assert.equal(client.calls.some((call) => call.method === "turn/start"), false);
  const value = "  Tạo project A rồi project B.\n\n<PADStudio-context>\n{\"version\":\"1.0\",\"attachments\":[],\"video\":\"literal example\"}\n</PADStudio-context>\n  ";
  await service.send(id, message("plain-user-input", value));
  assert.deepEqual(client.calls.find((call) => call.method === "thread/start").params, { cwd });
  assert.equal(client.calls.find((call) => call.method === "turn/start").params.input[0].text, value);
  assert.equal((await service.read(id)).items[0].text, value); assert.equal("projectId" in (await service.read(id)), false);
  assert.equal("store" in service, false);
  const native = new ChatService({ cwd }); t.after(() => native.close());
  assert.equal(native.client.env, process.env); assert.equal(native.client.args.includes("-c"), false);
  assert.deepEqual(await readdir(join(cwd, ".padstudio")), ["chat"]);
});

test("blank tabs and send receipts survive restart; reopening preserves native configuration and never replays", async (t) => {
  const { cwd, client, service, id } = await fixture(t);
  const restored = new ChatService({ cwd, client }); t.after(() => restored.close());
  assert.equal((await restored.read(id)).conversationId, id);
  await service.send(id, message()); client.complete((await service.session(id)).threadId, "Đã xong ✓");
  const reopened = new ChatService({ cwd, client }); t.after(() => reopened.close()); await reopened.connect();
  assert.equal((await reopened.read(id)).items.at(-1).text, "Đã xong ✓");
  assert.deepEqual(client.calls.findLast((call) => call.method === "thread/resume").params, { threadId: (await service.session(id)).threadId });
  assert.equal((await reopened.send(id, message())).duplicate, true);
  await assert.rejects(reopened.send(id, message("request-0001", "Khác")), { status: 409 });
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  const saved = await readFile(join(service.sessionRoot, service.workspaceKey + ".json"), "utf8"); assert.equal(saved.includes("Đã xong"), false);
});

test("ambiguous RPC failures keep a durable receipt and are not replayed", async (t) => {
  const { client, service, id } = await fixture(t); client.failSend = true;
  await assert.rejects(service.send(id, message()), /ngắt/); client.failSend = false;
  assert.equal((await service.send(id, message())).duplicate, true);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
});

test("parallel conversations keep separate turns, approvals, steering and results", async (t) => {
  const { client, service, id } = await fixture(t); const two = await service.newConversation();
  await Promise.all([service.send(id, message()), service.send(two.conversationId, message("parallel-second", "Tạo project khác"))]);
  const one = await service.session(id), second = await service.session(two.conversationId);
  assert.notEqual(one.threadId, second.threadId); assert.equal(one.active && second.active, true);
  const approval = client.ask(one.threadId, "item/commandExecution/requestApproval", { command: "example-command" });
  const request = (await service.read(id)).requests[0];
  await assert.rejects(service.answer(second.id, request.id, { decision: "accept" }), { status: 409 });
  await service.answer(id, request.id, { decision: "decline" });
  assert.deepEqual(client.responses.at(-1), { id: approval.id, result: { decision: "decline" } });
  await service.send(id, message("first-steer", "Bổ sung cho cuộc đầu"));
  assert.equal(client.calls.findLast((call) => call.method === "turn/steer").params.expectedTurnId, one.turnId);
  await service.interrupt(id); assert.equal(one.active, false); assert.equal(second.active, true);
  client.complete(second.threadId, "Kết quả riêng cuộc thứ hai");
  assert.equal((await service.read(id)).items.some((item) => item.text.includes("Kết quả riêng")), false);
  assert.equal((await service.read(second.id)).items.at(-1).text, "Kết quả riêng cuộc thứ hai");
  await assert.rejects(service.read("unknown"), { status: 404 });
});

test("simultaneous sends on one conversation cannot start duplicate turns", async (t) => {
  const { service, client, id } = await fixture(t);
  const sent = await Promise.allSettled([service.send(id, message()), service.send(id, message("concurrent-2"))]);
  assert.equal(sent.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
});

test("Codex questions and requested permissions are explicit and scoped to their conversation", async (t) => {
  const { service, client, id } = await fixture(t); await service.send(id, message()); const current = await service.session(id);
  client.ask(current.threadId, "item/tool/requestUserInput", { questions: [{ id: "style", question: "Phong cách?" }] });
  const question = (await service.read(id)).requests[0];
  await assert.rejects(service.answer(id, question.id, { decision: "accept", answers: {} }), { status: 400 });
  await service.answer(id, question.id, { decision: "accept", answers: { style: "Tối giản" } });
  assert.deepEqual(client.responses.at(-1).result, { answers: { style: { answers: ["Tối giản"] } } });
  client.ask(current.threadId, "item/permissions/requestApproval", { permissions: { network: { enabled: true } } });
  const permission = (await service.read(id)).requests[0];
  await service.answer(id, permission.id, { decision: "accept", permissions: { fileSystem: { write: ["C:/"] } } });
  assert.deepEqual(client.responses.at(-1).result, { permissions: { network: { enabled: true } }, scope: "turn" });
  client.ask(current.threadId, "unknown/method"); assert.equal(client.rejections.length, 1);
  client.complete(current.threadId); assert.equal((await service.read(id)).requests.length, 0);
});

test("disconnection and login preserve the conversation without replaying work", async (t) => {
  const { service, client, id } = await fixture(t); await service.send(id, message());
  const current = await service.session(id); client.emit("disconnect", new Error("Lost connection")); assert.equal(service.status().connected, false);
  client.complete(current.threadId, "Xong ở nền"); await service.connect(); assert.equal((await service.read(id)).items.at(-1).text, "Xong ở nền");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  client.authenticated = false; service.connecting = null; await service.connect(); const other = await service.newConversation();
  await assert.rejects(service.send(other.conversationId, message()), { status: 401 });
  assert.equal((await service.startLogin()).login.url, "https://auth.openai.com/authorize?fixture=1");
  await service.cancelLogin(); assert.equal(service.status().login, null);
});

test("earlier project-bound chat metadata is untouched and never silently resumed; malformed new data is preserved", async (t) => {
  const { cwd, client, service, id } = await fixture(t); const legacyRoot = join(cwd, ".padstudio", "chat", "old-project-links"); await mkdir(legacyRoot);
  const legacy = '{"version":"2.0","projectId":"old","conversations":[{"threadId":"old-restricted-thread"}]}';
  await writeFile(join(legacyRoot, "old.json"), legacy); await service.send(id, message());
  assert.equal(await readFile(join(legacyRoot, "old.json"), "utf8"), legacy);
  assert.equal(client.calls.some((call) => call.params.threadId === "old-restricted-thread"), false);
  const path = join(service.sessionRoot, service.workspaceKey + ".json"); await writeFile(path, "{broken");
  const other = new ChatService({ cwd, client: new FixtureCodex() }); t.after(() => other.close());
  await assert.rejects(other.read(), { code: "session_read_failed" }); assert.equal(await readFile(path, "utf8"), "{broken");
});

test("project context, imports and invalid input are not accepted as chat features", async (t) => {
  const { service, id } = await fixture(t);
  for (const extra of [{ projectId: "some-project" }, { anchor: {} }, { attachments: [] }, { developerInstructions: "injected" }]) await assert.rejects(service.send(id, { ...message(), ...extra }), { status: 400 });
  await assert.rejects(service.send(id, message("bad!")), { status: 400 });
  await assert.rejects(service.send(id, message("empty-message", "  ")), { status: 400 });
  await assert.rejects(service.send(id, { ...message(), model: "unknown" }), { status: 400 });
});

test("display preserves user text and excludes raw reasoning, credentials and executable links", () => {
  const value = '<PADStudio-context>{"literal":true}</PADStudio-context>';
  assert.equal(displayItem({ type: "userMessage", id: "u", content: [{ type: "text", text: value }] }, "t").text, value);
  assert.equal(displayItem({ type: "reasoning", id: "x", text: "secret" }, "t"), null);
  assert.equal(displayItem({ type: "mcpToolCall", id: "x", tool: "list", arguments: { secret: "private" } }, "t").arguments, undefined);
  assert.equal(externalUrl("javascript:alert(1)"), null); assert.equal(externalUrl("https://evil.example", { login: true }), null);
  assert.equal(chatLink("javascript:alert(1)"), null); assert.equal(chatLink("//evil.example"), null);
  assert.equal(safeError(new Error("Bearer PRIVATE_TOKEN sk-12345678901234567890")).includes("PRIVATE_TOKEN"), false);
  const form = approvalView("mcpServer/elicitation/request", { mode: "form", requestedSchema: { properties: { count: { type: "integer" } }, required: ["count"] } }, "request");
  const request = { method: "mcpServer/elicitation/request", params: {}, view: form };
  assert.throws(() => approvalAnswer(request, { decision: "accept", content: { count: 1.5 } }), ChatError);
  assert.deepEqual(approvalAnswer(request, { decision: "accept", content: { count: 3, unexpected: "ignored" } }), { action: "accept", content: { count: 3 } });
});
