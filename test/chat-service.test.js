import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatService } from "../src/chat/chat-service.js";
import { FixtureCodex } from "../scripts/lib/chat-fixture.mjs";
import { approvalAnswer, approvalView, ChatError, displayItem, displayUserText, externalUrl, safeError } from "../src/chat/chat-protocol.js";
import { chatLink } from "../ui/chat-markdown.js";

async function fixture(t, options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-chat-service-"));
  const client = new FixtureCodex(options);
  const service = new ChatService({ projectRoot: join(workspace, "projects"), client });
  t.after(async () => { await service.close(); await rm(workspace, { recursive: true, force: true }); });
  await service.store.createProject({ projectId: "alpha", title: "Video đầu tiên" });
  await service.store.createProject({ projectId: "beta", title: "Video thứ hai" });
  return { workspace, client, service };
}
const message = (id = "request-0001", text = "Làm video giải thích") => ({ clientId: id, message: text });

test("chat connects without inference or leaking account data and binds threads to the selected project", async (t) => {
  const { client, service } = await fixture(t);
  const status = await service.connect();
  assert.equal(status.authenticated, true);
  assert.equal(JSON.stringify(status).includes("NEVER_SHOW"), false);
  assert.equal(JSON.stringify(status).includes("private@"), false);
  assert.equal(client.calls.some((call) => call.method === "turn/start"), false);
  await service.send("alpha", message());
  const start = client.calls.find((call) => call.method === "thread/start").params;
  assert.match(start.developerInstructions, /"id":"alpha"/);
  assert.match(start.developerInstructions, /PADSTUDIO-AGENT-RUNTIME/);
  assert.match(start.developerInstructions, /project:accept --from-agent-host/);
  assert.equal(start.sandbox, "workspace-write");
  assert.equal(start.approvalPolicy, "on-request");
  const alpha = await service.session("alpha");
  client.complete(alpha.threadId, "Đã dựng xong một đoạn tiếng Việt ✓");
  const snapshot = await service.read("alpha");
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.items.filter((item) => item.role === "user").length, 1);
  assert.equal(snapshot.items.at(-1).text, "Đã dựng xong một đoạn tiếng Việt ✓");
  assert.equal((await service.read("beta")).items.length, 0);
  await assert.rejects(service.read("missing"), { status: 404 });
  await assert.rejects(service.read("../alpha"));
});

test("the same submission is sent once, including after restarting the server", async (t) => {
  const { client, service } = await fixture(t);
  await service.send("alpha", message());
  client.complete((await service.session("alpha")).threadId);
  assert.equal((await service.send("alpha", message())).duplicate, true);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  await assert.rejects(service.send("alpha", message("request-0001", "Nội dung khác")), { status: 409 });
  const restored = new ChatService({ projectRoot: service.projectRoot, client });
  t.after(() => restored.close());
  await restored.connect();
  const read = await restored.read("alpha");
  assert.equal(read.items.at(-1).text, "Đã hoàn tất.");
  assert.equal((await restored.send("alpha", message())).duplicate, true);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  const saved = await readFile(join(service.sessionRoot, (await readdir(service.sessionRoot))[0]), "utf8");
  assert.equal(saved.includes("Đã hoàn tất"), false, "transcript stays with Codex, not in a second project store");
});

test("an ambiguous RPC failure persists its receipt and is never automatically replayed", async (t) => {
  const { client, service } = await fixture(t);
  client.failSend = true;
  await assert.rejects(service.send("alpha", message()), /ngắt/);
  client.failSend = false;
  assert.equal((await service.send("alpha", message())).duplicate, true);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
});

test("messages steer an active turn, concurrent sends cannot start two turns, and interrupt uses the exact turn", async (t) => {
  const { client, service } = await fixture(t);
  const results = await Promise.allSettled([service.send("alpha", message()), service.send("alpha", message("request-0002"))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const current = await service.session("alpha"); const turnId = current.turnId;
  await service.send("alpha", message("request-0003", "Chậm hơn một chút"));
  const steer = client.calls.find((call) => call.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, turnId);
  await assert.rejects(service.newConversation("alpha"), { status: 409 });
  await service.interrupt("alpha");
  assert.equal((await service.read("alpha")).active, false);
  assert.equal(client.calls.find((call) => call.method === "turn/interrupt").params.turnId, turnId);
});

test("approval prompts are scoped, require an explicit answer and expire with the turn", async (t) => {
  const { client, service } = await fixture(t);
  await service.send("alpha", message());
  const session = await service.session("alpha");
  const request = client.ask(session.threadId, "item/commandExecution/requestApproval", { command: "render-video", reason: "Đọc file ngoài dự án" });
  const prompt = (await service.read("alpha")).requests[0];
  assert.equal(client.responses.length, 0);
  await assert.rejects(service.answer("beta", prompt.id, { decision: "accept" }), { status: 409 });
  await assert.rejects(service.answer("alpha", prompt.id, { decision: "acceptForSession" }), { status: 400 });
  await service.answer("alpha", prompt.id, { decision: "decline" });
  assert.deepEqual(client.responses, [{ id: request.id, result: { decision: "decline" } }]);
  await assert.rejects(service.answer("alpha", prompt.id, { decision: "accept" }), { status: 409 });
  client.ask(session.threadId, "item/tool/requestUserInput", { questions: [{ id: "look", question: "Phong cách?", header: "Hình" }] });
  const question = (await service.read("alpha")).requests[0];
  await assert.rejects(service.answer("alpha", question.id, { decision: "accept", answers: {} }), { status: 400 });
  await service.answer("alpha", question.id, { decision: "accept", answers: { look: "Tối giản" } });
  assert.deepEqual(client.responses.at(-1).result, { answers: { look: { answers: ["Tối giản"] } } });
  client.ask(session.threadId, "item/permissions/requestApproval", { permissions: { network: { enabled: true } } });
  const permission = (await service.read("alpha")).requests[0];
  await service.answer("alpha", permission.id, { decision: "accept", permissions: { fileSystem: { write: ["C:/"] } } });
  assert.deepEqual(client.responses.at(-1).result, { permissions: { network: { enabled: true } }, scope: "turn" });
  client.ask(session.threadId, "unknown/method"); assert.equal(client.rejections.length, 1);
  client.ask(session.threadId, "item/fileChange/requestApproval", { grantRoot: "example" });
  client.complete(session.threadId);
  assert.equal((await service.read("alpha")).requests.length, 0);
});

test("disconnection keeps project and transcript, resumes without replay and reports login needs", async (t) => {
  const { client, service } = await fixture(t);
  await service.send("alpha", message());
  const current = await service.session("alpha");
  client.emit("disconnect", new Error("Connection lost"));
  assert.equal(service.status().connected, false);
  assert.equal((await service.read("alpha")).items.length, 1);
  client.complete(current.threadId, "Hoàn tất khi trình duyệt mất kết nối");
  await service.connect();
  assert.equal((await service.read("alpha")).items.at(-1).text, "Hoàn tất khi trình duyệt mất kết nối");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  client.authenticated = false; service.connecting = null;
  await service.connect();
  await assert.rejects(service.send("beta", message()), { status: 401 });
  const login = await service.startLogin();
  assert.equal(login.login.url, "https://auth.openai.com/authorize?fixture=1");
  assert.equal(JSON.stringify(login).includes("private-login-id"), false);
  await service.cancelLogin(); assert.equal(service.status().login, null);
});

test("attachments must belong to the chosen project and malformed saved state is preserved", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(service.send("alpha", { ...message(), attachments: ["resource-other-project"] }), { status: 400 });
  await service.send("alpha", message());
  const savedPath = join(service.sessionRoot, (await readdir(service.sessionRoot))[0]);
  await writeFile(savedPath, "{broken");
  const other = new ChatService({ projectRoot: service.projectRoot, client: new FixtureCodex() }); t.after(() => other.close());
  await assert.rejects(other.read("alpha"), { code: "session_read_failed" });
  assert.equal(await readFile(savedPath, "utf8"), "{broken");
});

test("display projection and links exclude raw reasoning, credentials and executable URLs", () => {
  assert.equal(displayUserText('Sửa đoạn này\n\n<PADStudio-context>\n{"version":"1.0","attachments":[{"name":"Lời dẫn.txt","resourceId":"private-id"}],"video":"result=private-render"}\n</PADStudio-context>'), "Sửa đoạn này\n\nTư liệu: Lời dẫn.txt\n\nĐã kèm mốc video đang xem.");
  assert.equal(displayUserText("Một ví dụ <PADStudio-context>không phải dữ liệu</PADStudio-context>"), "Một ví dụ <PADStudio-context>không phải dữ liệu</PADStudio-context>");
  assert.equal(displayItem({ type: "reasoning", id: "x", text: "secret reasoning" }, "t"), null);
  assert.equal(displayItem({ type: "mcpToolCall", id: "x", tool: "list", arguments: { key: "private" } }, "t").arguments, undefined);
  assert.equal(externalUrl("javascript:alert(1)"), null);
  assert.equal(externalUrl("https://evil.example", { login: true }), null);
  assert.equal(chatLink("javascript:alert(1)"), null);
  assert.equal(chatLink("//evil.example"), null);
  assert.equal(chatLink("/project-results/p/r/primary"), "/project-results/p/r/primary");
  assert.equal(safeError(new Error("Bearer PRIVATE_TOKEN sk-12345678901234567890")).includes("PRIVATE_TOKEN"), false);
  const form = approvalView("mcpServer/elicitation/request", { mode: "form", requestedSchema: { properties: { count: { type: "integer" } }, required: ["count"] } }, "request");
  const request = { method: "mcpServer/elicitation/request", params: {}, view: form };
  assert.throws(() => approvalAnswer(request, { decision: "accept", content: { count: 1.5 } }), ChatError);
  assert.deepEqual(approvalAnswer(request, { decision: "accept", content: { count: 3, unexpected: "ignored" } }), { action: "accept", content: { count: 3 } });
});

test("new conversations preserve the earlier thread and only this project's history can be reopened", async (t) => {
  const { client, service } = await fixture(t);
  await service.send("alpha", message());
  const first = (await service.session("alpha")).threadId;
  client.complete(first, "Nội dung hội thoại đầu");
  await service.newConversation("alpha");
  await service.send("alpha", message("second-conversation", "Một ý tưởng nữa"));
  const second = (await service.session("alpha")).threadId;
  client.complete(second, "Nội dung hội thoại thứ hai");
  const snapshot = await service.selectConversation("alpha", first);
  assert.equal(snapshot.conversations.length, 2);
  assert.equal(snapshot.items.at(-1).text, "Nội dung hội thoại đầu");
  await assert.rejects(service.selectConversation("beta", first), { status: 404 });
  assert.equal((await service.selectConversation("alpha", second)).items.at(-1).text, "Nội dung hội thoại thứ hai");
});
