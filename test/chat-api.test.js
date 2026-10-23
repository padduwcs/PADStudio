import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import test from "node:test";
import { ChatService } from "../src/chat/chat-service.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { FixtureCodex } from "../scripts/lib/chat-fixture.mjs";

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "padstudio-chat-http-")); const client = new FixtureCodex();
  const service = new ChatService({ cwd, client }); const server = createPadStudioServer({ reader: new ProjectReader(join(cwd, ".padstudio", "projects")), chat: service });
  await new Promise((done) => server.listen(0, "127.0.0.1", done)); const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, "Content-Type": "application/json", "X-PADStudio-Intent": "chat" };
  const post = async (path, body = {}, extra = {}) => { const response = await fetch(origin + path, { method: "POST", body: JSON.stringify(body), headers: { ...headers, ...extra } }); return { status: response.status, body: await response.json() }; };
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await service.close(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, origin, service, client, headers, post };
}

test("chat is available without any video project and cannot create projects, import assets or accept injected context", async (t) => {
  const { cwd, origin, service, client, post } = await fixture(t);
  await post("/api/chat/connect"); const snapshot = await (await fetch(origin + "/api/chat/conversations")).json(); const id = snapshot.session.conversationId;
  const sent = await post(`/api/chat/conversations/${id}/messages`, { clientId: "plain-http-client", message: "Tạo hai project video, tùy tôi chọn tên" });
  assert.equal(sent.status, 200); assert.equal(sent.body.session.conversationId, id);
  assert.deepEqual(client.calls.find((call) => call.method === "thread/start").params, { cwd });
  for (const path of ["/api/chat/projects", "/api/chat/projects/alpha/messages", "/api/chat/projects/alpha/attachments", "/api/chat/rpc"]) assert.equal((await post(path)).status, 404);
  assert.equal((await post(`/api/chat/conversations/${id}/messages`, { clientId: "context-http-id", message: "Hi", projectId: "alpha" })).status, 400);
  assert.equal((await fetch(origin + "/api/chat/events?project=alpha")).status, 400);
  assert.deepEqual(await readdir(join(cwd, ".padstudio")), ["chat"]);
  assert.equal((await service.read(id)).conversations.length, 1);
});

test("chat enforces origin, intent, size and JSON guards and has no arbitrary RPC endpoint", async (t) => {
  const { origin, client, headers, post } = await fixture(t);
  for (const extra of [{ Origin: "https://evil.example" }, { Origin: "" }, { "X-PADStudio-Intent": "settings" }, { "Content-Type": "text/plain" }, { "Sec-Fetch-Site": "cross-site" }]) assert.ok([403, 415].includes((await post("/api/chat/connect", {}, extra)).status));
  assert.equal(client.calls.length, 0);
  assert.equal((await fetch(origin + "/api/chat/status", { headers: { Origin: "https://evil.example" } })).status, 403);
  const hostStatus = await new Promise((done, reject) => get(origin + "/api/chat/status", { headers: { Host: "evil.example" } }, (response) => { response.resume(); done(response.statusCode); }).on("error", reject)); assert.equal(hostStatus, 403);
  assert.equal((await fetch(origin + "/api/chat/connect", { method: "POST", headers, body: "{bad" })).status, 400);
  assert.equal((await post("/api/chat/connect", { value: "x".repeat(130 * 1024) })).status, 413);
  const doc = await fetch(origin + "/"); assert.equal(doc.headers.get("x-frame-options"), "DENY");
  assert.equal(doc.headers.get("content-security-policy"), "frame-ancestors 'none'");
});

test("HTTP and SSE conversations remain independent when other tabs open, send or ask for approval", async (t) => {
  const { origin, client, service, post } = await fixture(t); await post("/api/chat/connect");
  const one = (await (await fetch(origin + "/api/chat/conversations")).json()).session;
  const two = (await post("/api/chat/conversations")).body.session;
  for (const [id, message] of [[one.conversationId, "Cuộc đầu tiên"], [two.conversationId, "Cuộc thứ hai"]]) assert.equal((await post(`/api/chat/conversations/${id}/messages`, { clientId: "http-" + id, message })).status, 200);
  const session = await service.session(one.conversationId); const approval = client.ask(session.threadId, "item/commandExecution/requestApproval", { command: "example" });
  const controller = new AbortController(); const response = await fetch(origin + "/api/chat/events?conversation=" + one.conversationId, { signal: controller.signal }); const reader = response.body.getReader();
  try {
    const chunk = await reader.read(); const event = JSON.parse(new TextDecoder().decode(chunk.value).split("data: ")[1].trim());
    assert.equal(event.session.conversationId, one.conversationId); assert.equal(event.session.items[0].text, "Cuộc đầu tiên");
    assert.equal(event.session.conversations.filter((entry) => entry.active).length, 2);
    const requestId = event.session.requests[0].id;
    assert.equal((await post(`/api/chat/conversations/${two.conversationId}/answer`, { requestId, decision: "accept" })).status, 409);
    assert.equal(client.responses.length, 0);
    assert.equal((await post(`/api/chat/conversations/${one.conversationId}/answer`, { requestId, decision: "decline" })).status, 200);
    assert.deepEqual(client.responses[0], { id: approval.id, result: { decision: "decline" } });
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
  await post(`/api/chat/conversations/${one.conversationId}/interrupt`);
  assert.equal((await service.read(one.conversationId)).active, false); assert.equal((await service.read(two.conversationId)).active, true);
  assert.equal((await fetch(origin + "/api/chat/conversations/unknown")).status, 404);
  assert.equal((await fetch(origin + "/api/chat/events?conversation=unknown")).status, 404);
});
