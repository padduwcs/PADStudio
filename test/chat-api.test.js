import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import test from "node:test";
import { ChatService } from "../src/chat/chat-service.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { FixtureCodex } from "../scripts/lib/chat-fixture.mjs";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-chat-api-"));
  const client = new FixtureCodex();
  const service = new ChatService({ projectRoot: join(workspace, "projects"), client });
  await service.store.createProject({ projectId: "demo", title: "Video thử nghiệm" });
  const server = createPadStudioServer({ reader: new ProjectReader(service.projectRoot), chat: service });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, "Content-Type": "application/json", "X-PADStudio-Intent": "chat" };
  t.after(async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await service.close(); await rm(workspace, { recursive: true, force: true });
  });
  const post = async (path, body = {}, extra = {}) => {
    const response = await fetch(origin + path, { method: "POST", body: JSON.stringify(body), headers: { ...headers, ...extra } });
    return { status: response.status, body: await response.json() };
  };
  return { client, service, origin, headers, post };
}

test("chat writes require the PADStudio page, JSON and an explicit intent; unknown RPC routes do not exist", async (t) => {
  const { client, origin, post } = await fixture(t);
  const route = "/api/chat/connect";
  for (const overrides of [{ Origin: "https://evil.example" }, { Origin: "" }, { "X-PADStudio-Intent": "settings" }, { "Content-Type": "text/plain" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const result = await post(route, {}, overrides);
    assert.ok([403, 415].includes(result.status));
  }
  assert.equal(client.calls.length, 0);
  assert.equal((await post("/api/chat/rpc", { method: "thread/shellCommand", command: "should-never-run" })).status, 404);
  const otherSite = await fetch(origin + "/api/chat/status", { headers: { Origin: "https://evil.example" } });
  assert.equal(otherSite.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    get(origin + "/api/chat/status", { headers: { Host: "evil.example" } }, (response) => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(origin + "/api/chat/status")).headers.get("cache-control"), "no-store");
  const document = await fetch(origin + "/");
  assert.equal(document.headers.get("x-frame-options"), "DENY");
  assert.equal(document.headers.get("content-security-policy"), "frame-ancestors 'none'");
});

test("chat routes validate input and expose session state without changing project bytes", async (t) => {
  const { service, origin, headers, post } = await fixture(t);
  const file = join(service.projectRoot, "demo", "project.json"); const before = await readFile(file, "utf8");
  assert.equal((await post("/api/chat/connect")).status, 200);
  for (const body of [[], null, { message: "" }, { message: "x", clientId: "invalid!" }, { message: "x", clientId: "valid-client-id", attachments: null }, { message: "x".repeat(32_001), clientId: "valid-client-id" }]) {
    assert.equal((await post("/api/chat/projects/demo/messages", body)).status, 400);
  }
  const badJson = await fetch(origin + "/api/chat/connect", { method: "POST", headers, body: "{bad" }); assert.equal(badJson.status, 400);
  const large = await post("/api/chat/projects/demo/messages", { message: "x".repeat(130 * 1024) }); assert.equal(large.status, 413);
  const send = await post("/api/chat/projects/demo/messages", { message: "Làm video", clientId: "valid-client-id" });
  assert.equal(send.status, 200); assert.equal(send.body.session.active, true);
  assert.equal((await post("/api/chat/projects/demo/messages", { message: "Làm video", clientId: "valid-client-id" })).body.duplicate, true);
  assert.equal((await fetch(origin + "/api/chat/projects/missing")).status, 404);
  assert.equal((await fetch(origin + "/api/chat/projects/%2Fetc")).status, 400);
  assert.equal(await readFile(file, "utf8"), before);
});

test("SSE delivers Unicode progress and pending approvals, isolates projects and reconnects from a snapshot", async (t) => {
  const { service, client, origin, post } = await fixture(t);
  await post("/api/chat/connect");
  const controller = new AbortController();
  const response = await fetch(origin + "/api/chat/events?project=demo", { signal: controller.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let buffer = "";
  const next = async () => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = event.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
      }
      const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  try {
    assert.equal((await next()).session.projectId, "demo");
    await post("/api/chat/projects/demo/messages", { message: "Làm video tiếng Việt", clientId: "stream-client-id" });
    const session = await service.session("demo");
    const approval = client.ask(session.threadId, "item/commandExecution/requestApproval", { command: "render", reason: "Thử quyền" });
    let state;
    do { state = await next(); } while (!state.session.requests.length);
    assert.match(state.session.items[0].text, /tiếng Việt/);
    assert.equal(client.responses.length, 0);
    await post("/api/chat/projects/demo/answer", { requestId: state.session.requests[0].id, decision: "accept" });
    assert.deepEqual(client.responses[0], { id: approval.id, result: { decision: "accept" } });
    client.complete(session.threadId, "Đã dựng xong ✓");
    do { state = await next(); } while (state.session.active);
    assert.equal(state.session.items.at(-1).text, "Đã dựng xong ✓");
    const restored = await (await fetch(origin + "/api/chat/projects/demo")).json();
    assert.deepEqual(restored.session.items, state.session.items);
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
});

test("UI file uploads use the existing import contract, reject path tricks and preserve same-name inputs", async (t) => {
  const { service, origin, headers } = await fixture(t);
  const upload = (name, body, extra = {}) => fetch(origin + "/api/chat/projects/demo/attachments", {
    method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream", "X-PADStudio-Filename": encodeURIComponent(name), ...extra }, body
  });
  for (const name of ["../secret.txt", "folder\\secret.txt", "CON", "bad:name", "file."]) assert.equal((await upload(name, "hello")).status, 400);
  assert.equal((await upload("empty.txt", "")).status, 400);
  const one = await upload("lời dẫn.txt", "Nội dung thứ nhất"); assert.equal(one.status, 201);
  const first = (await one.json()).attachment;
  const two = await upload("lời dẫn.txt", "Nội dung thứ hai"); assert.equal(two.status, 201);
  const second = (await two.json()).attachment;
  assert.notEqual(first.resourceId, second.resourceId);
  const context = await service.store.readContext("demo");
  assert.equal(context.resources.length, 2);
  assert.equal(context.runs.filter((run) => run.status === "completed" && run.capability === "project.input.import").length, 2);
  assert.equal(await readFile(join(service.projectRoot, "demo", "inputs", first.name), "utf8"), "Nội dung thứ nhất");
  assert.equal(await readFile(join(service.projectRoot, "demo", "inputs", second.name), "utf8"), "Nội dung thứ hai");
});

test("explicit conversation IDs keep HTTP and SSE clients on their own tab when another client opens a conversation", async (t) => {
  const { origin, service, client, post } = await fixture(t);
  await post("/api/chat/connect");
  const first = (await (await fetch(origin + "/api/chat/projects/demo")).json()).session;
  const second = (await post("/api/chat/projects/demo/new")).body.session;
  for (const [conversationId, message] of [[first.conversationId, "Hội thoại đầu"], [second.conversationId, "Hội thoại sau"]]) {
    const sent = await post("/api/chat/projects/demo/messages", { conversationId, message, clientId: "http-" + conversationId });
    assert.equal(sent.status, 200); assert.equal(sent.body.session.conversationId, conversationId);
  }
  const one = await service.session("demo", first.conversationId); const two = await service.session("demo", second.conversationId);
  const controller = new AbortController();
  const response = await fetch(origin + "/api/chat/events?project=demo&conversation=" + first.conversationId, { signal: controller.signal });
  const reader = response.body.getReader();
  try {
    const chunk = await reader.read();
    const event = JSON.parse(new TextDecoder().decode(chunk.value).split("data: ")[1].trim());
    assert.equal(event.session.conversationId, first.conversationId);
    assert.equal(event.session.items[0].text, "Hội thoại đầu");
    assert.equal(event.session.conversations.filter((entry) => entry.active).length, 2);
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
  client.ask(one.threadId, "item/commandExecution/requestApproval", { command: "only-one" });
  const request = (await service.read("demo", first.conversationId)).requests[0];
  assert.equal((await post("/api/chat/projects/demo/answer", { conversationId: second.conversationId, requestId: request.id, decision: "accept" })).status, 409);
  assert.equal(client.responses.length, 0);
  await post("/api/chat/projects/demo/interrupt", { conversationId: first.conversationId });
  assert.equal(one.active, false); assert.equal(two.active, true);
  assert.equal((await fetch(origin + "/api/chat/projects/demo?conversation=foreign-conversation")).status, 404);
  assert.equal((await fetch(origin + "/api/chat/events?project=demo&conversation=foreign-conversation")).status, 404);
  assert.equal((await post("/api/chat/projects/demo/messages", { conversationId: "", message: "No fallback", clientId: "http-empty-id" })).status, 400);
});

test("the new-project action creates exactly a normal empty project and model selection stays bounded", async (t) => {
  const { service, client, post } = await fixture(t);
  assert.equal((await post("/api/chat/projects", { title: "" })).status, 400);
  const created = await post("/api/chat/projects", { title: "  Một ý tưởng mới  ", projectId: "../wrong" });
  assert.equal(created.status, 201); assert.equal(created.body.project.title, "Một ý tưởng mới");
  assert.match(created.body.project.id, /^video-\d{8}-[a-f0-9]{8}$/);
  const context = await service.store.readContext(created.body.project.id);
  assert.equal(context.results.length, 0); assert.equal(context.resources.length, 0);
  await post("/api/chat/connect");
  assert.equal((await post("/api/chat/projects/demo/messages", { message: "hello", clientId: "model-request-id", model: "arbitrary-model" })).status, 400);
  assert.equal(client.calls.some((call) => call.method === "turn/start"), false);
});
