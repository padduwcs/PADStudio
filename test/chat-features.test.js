import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatService } from "../src/chat/chat-service.js";
import { FixtureCodex } from "../scripts/lib/chat-fixture.mjs";
import { approvalAnswer, approvalView, displayItem } from "../src/chat/chat-protocol.js";

async function setup(t) {
  const cwd = await mkdtemp(join(tmpdir(), "padstudio-chat-features-")); const client = new FixtureCodex();
  const service = new ChatService({ cwd, client }); const id = (await service.read()).conversationId;
  t.after(async () => { await service.close(); await rm(cwd, { recursive: true, force: true }); });
  await service.connect(); return { cwd, client, service, id };
}
const prompt = (message = "Giữ nguyên prompt", clientId = crypto.randomUUID()) => ({ message, clientId });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1XkAAAAASUVORK5CYII=";

test("explicit images, files, references, skills and native options do not introduce project context", async (t) => {
  const { cwd, client, service, id } = await setup(t);
  const image = await service.attachments.put({ name: "ảnh.png", data: png });
  const file = await service.attachments.put({ name: "../note.txt", data: Buffer.from("A user-selected note").toString("base64") });
  const path = join(cwd, "file.js"); await writeFile(path, "export default 1;"); client.files = [{ root: cwd, path: "file.js" }];
  assert.equal((await service.searchFiles("file"))[0].path, path);
  const options = { effort: "high", mode: "plan", permissions: ":read-only" };
  const body = { ...prompt("  nhìn ảnh và đọc file\n "), attachments: [image.id, file.id], references: [path], skills: ["fixture-skill"], options };
  await service.send(id, body);
  assert.deepEqual(client.calls.find((call) => call.method === "thread/start").params, { cwd });
  const sent = client.calls.find((call) => call.method === "turn/start").params;
  assert.deepEqual(sent.input, [
    { type: "text", text: body.message, text_elements: [] },
    { type: "localImage", path: (await service.attachments.get(image.id)).path },
    { type: "text", text: (await service.attachments.get(file.id)).path, text_elements: [] },
    { type: "text", text: path, text_elements: [] },
    { type: "skill", name: "fixture-skill", path: "C:/fixture/SKILL.md" }
  ]);
  assert.equal(sent.effort, "high"); assert.equal(sent.permissions, ":read-only");
  assert.deepEqual(sent.collaborationMode, { mode: "plan", settings: { model: "fixture-model", reasoning_effort: "high", developer_instructions: null } });
  assert.equal((await service.send(id, body)).duplicate, true);
  await assert.rejects(service.send(id, { ...body, options: { effort: "low" } }), { status: 409 });
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
  const session = await service.session(id); client.complete(session.threadId);
  const resumed = new ChatService({ cwd, client }); t.after(() => resumed.close()); await resumed.connect();
  assert.deepEqual((await resumed.read(id)).options, options);
  assert.equal((await resumed.read(id)).items[0].attachments.find((entry) => entry.kind === "image").id, image.id);
  assert.deepEqual(await readdir(join(cwd, ".padstudio")), ["chat"]);
});

test("file references work through a directory alias without exposing escaped targets or changing cwd", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-chat-alias-"));
  const directory = join(workspace, "actual"), cwd = join(workspace, "alias"), outside = join(workspace, "outside");
  await mkdir(directory); await mkdir(outside);
  await symlink(directory, cwd, process.platform === "win32" ? "junction" : "dir");
  await symlink(outside, join(directory, "escape"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(directory, "reference.md"), "Selected reference");
  await writeFile(join(directory, "..notes.md"), "A valid filename inside the workspace");
  await writeFile(join(outside, "secret.md"), "Must not be exposed");
  const client = new FixtureCodex(), service = new ChatService({ cwd, client });
  t.after(async () => { await service.close(); await rm(workspace, { recursive: true, force: true }); });
  const id = (await service.read()).conversationId;
  client.files = ["reference.md", "..notes.md", "escape/secret.md", "missing.md"].map(path => ({ root: cwd, path }));
  client.files.push({ root: outside, path: "secret.md" });
  const reference = join(cwd, "reference.md"), notes = join(cwd, "..notes.md");
  assert.deepEqual((await service.searchFiles("md")).map(entry => entry.path), [reference, notes]);
  await service.send(id, { ...prompt(), references: [reference, notes] });
  assert.equal(client.calls.find(call => call.method === "thread/start").params.cwd, cwd);
  const input = client.calls.find(call => call.method === "turn/start").params.input;
  assert.deepEqual(input.slice(1).map(entry => entry.text), [reference, notes], "native input retains the user-visible alias paths");
  client.complete((await service.session(id)).threadId);
  for (const reference of [join(cwd, "escape", "secret.md"), join(outside, "secret.md"), cwd, join(cwd, "missing.md")]) {
    await assert.rejects(service.send(id, { ...prompt(), references: [reference] }), { status: 400 });
  }
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 1);
});

test("invalid attachments and runtime options are rejected before inference", async (t) => {
  const { service, client, id, cwd } = await setup(t);
  for (const body of [{ name: "a", data: "%%%%" }, { name: "a", data: "" }, { name: "a", data: "A".repeat(14 * 1024 * 1024) }]) await assert.rejects(service.attachments.put(body));
  await assert.rejects(service.attachments.get("../../secret"), { status: 400 });
  const html = await service.attachments.put({ name: "fake.png", data: Buffer.from("<svg onload=alert(1)>").toString("base64") });
  assert.equal(html.kind, "file"); await assert.rejects(service.attachments.image(html.id), { status: 415 });
  for (const extra of [
    { attachments: ["bad-id"] }, { references: [join(cwd, "..", "secret")] }, { references: ["relative.js"] }, { skills: ["unknown"] },
    { options: { permissions: ":danger-full-access" } }, { options: { effort: "ultra" } }, { options: { mode: "unknown" } },
    { options: { developerInstructions: "injection" } }, { options: { effort: 0 } }, { attachments: null }, { references: {} }
  ]) await assert.rejects(service.send(id, { ...prompt(), ...extra }), { status: 400 });
  assert.equal(client.calls.some((call) => call.method === "thread/start" || call.method === "turn/start"), false);
});

test("optional capability discovery fails closed while ordinary native chat stays available", async (t) => {
  const { service, client, id } = await setup(t); service.connecting = null;
  const request = client.request.bind(client);
  client.request = (method, params) => /collaborationMode|permissionProfile|skills|rateLimits/.test(method) ? Promise.reject(new Error("method not supported")) : request(method, params);
  const status = await service.connect();
  assert.deepEqual([status.modes, status.permissions, status.skills], [[], [], []]);
  await service.send(id, prompt());
  const sent = client.calls.find((call) => call.method === "turn/start").params;
  assert.equal("permissions" in sent, false); assert.equal("collaborationMode" in sent, false);
});

test("choosing a mode preserves the configured native model even when it differs from the catalog default", async (t) => {
  const { service, client, id } = await setup(t); const request = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === "thread/start") { result.model = "configured-native-model"; result.thread.model = result.model; }
    return result;
  };
  await service.send(id, { ...prompt(), options: { mode: "plan" } });
  const sent = client.calls.find((call) => call.method === "turn/start").params;
  assert.equal(sent.collaborationMode.settings.model, "configured-native-model");
  assert.equal("model" in client.calls.find((call) => call.method === "thread/start").params, false);
});

test("native history search, resume, rename and archive preserve cwd and native thread configuration", async (t) => {
  const { service, client, cwd } = await setup(t);
  for (let i = 0; i < 32; i++) { const result = await client.request("thread/start", { cwd }); result.thread.name = `CLI ${i}`; }
  await client.request("thread/start", { cwd: join(cwd, "other") });
  const first = await service.history(); assert.equal(first.data.length, 30); assert.ok(first.nextCursor);
  assert.equal((await service.history({ cursor: first.nextCursor })).data.length, 2);
  const filtered = await service.history({ query: "CLI 31" }); assert.equal(filtered.data.length, 1);
  const id = (await service.resume(filtered.data[0].threadId)).conversationId;
  assert.deepEqual(client.calls.findLast((call) => call.method === "thread/resume").params, { threadId: filtered.data[0].threadId });
  assert.equal((await service.resume(filtered.data[0].threadId)).conversationId, id);
  await assert.rejects(service.resume("unlisted"), { status: 400 });
  await service.changeConversation(id, "rename", { name: "Câu chuyện cây xanh" });
  assert.equal((await service.read(id)).conversations.find((entry) => entry.id === id).title, "Câu chuyện cây xanh");
  await service.changeConversation(id, "archive"); await assert.rejects(service.send(id, prompt()), { status: 409 });
  const archived = await service.history({ archived: true }); assert.equal(archived.data.length, 1);
  assert.equal((await service.restoreThread(archived.data[0].threadId)).archived, false);
  const saved = await readFile(join(service.sessionRoot, service.workspaceKey + ".json"), "utf8");
  assert.equal(saved.includes("Câu chuyện cây xanh"), true);
  assert.equal(client.calls.some((call) => call.method === "turn/start"), false);
});

test("fork before a turn preserves original history and never replays a prompt", async (t) => {
  const { service, client, id } = await setup(t);
  await service.send(id, prompt("First")); const original = await service.session(id); client.complete(original.threadId, "One");
  await service.send(id, prompt("Second")); client.complete(original.threadId, "Two");
  const before = original.items.find((item) => item.text === "Second").turnId;
  const fork = await service.changeConversation(id, "fork", { beforeTurnId: before });
  assert.equal(fork.items.some((item) => item.text === "First"), true); assert.equal(fork.items.some((item) => item.text === "Second"), false);
  assert.equal((await service.read(id)).items.some((item) => item.text === "Second"), true);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 2);
  assert.deepEqual(client.calls.find((call) => call.method === "thread/fork").params, { threadId: original.threadId, beforeTurnId: before });
  await assert.rejects(service.changeConversation(id, "fork", { beforeTurnId: "unrelated" }), { status: 400 });
  await service.send(id, prompt("Busy")); await assert.rejects(service.changeConversation(id, "archive"), { status: 409 });
});

test("older history and export walk native pagination without replay or exposing raw reasoning", async (t) => {
  const { service, client, id } = await setup(t); await service.send(id, prompt()); const session = await service.session(id); client.complete(session.threadId);
  const thread = client.threads.get(session.threadId); thread.historyMode = "paginated";
  thread.turns = Array.from({ length: 80 }, (_, index) => ({ id: "t" + index, status: "completed", items: [
    { id: "u" + index, type: "userMessage", content: [{ type: "text", text: "Prompt " + index }] },
    { id: "r" + index, type: "reasoning", summary: ["Public summary"], content: ["NEVER EXPOSE"] }
  ] }));
  session.loaded = false; let view = await service.read(id); assert.equal(view.items[0].text, "Prompt 30"); assert.equal(view.hasOlder, true);
  view = await service.older(id); assert.equal(view.items[0].text, "Prompt 5");
  view = await service.older(id); assert.equal(view.items[0].text, "Prompt 0"); assert.equal(view.hasOlder, false);
  const exported = await service.exportConversation(id); assert.equal(exported.items.length, 160); assert.equal(JSON.stringify(exported).includes("NEVER EXPOSE"), false);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, 1);
});

test("public streaming events show command output, plans, diffs and usage while excluding private reasoning", async (t) => {
  const { service, client, id } = await setup(t); await service.send(id, prompt()); const session = await service.session(id);
  const base = { threadId: session.threadId, turnId: session.turnId };
  client.notify("item/started", { ...base, item: { id: "command", type: "commandExecution", command: "node --version", status: "inProgress" } });
  client.notify("item/commandExecution/outputDelta", { ...base, itemId: "command", delta: "v24.0.0\n" });
  client.notify("item/reasoning/summaryTextDelta", { ...base, itemId: "summary", delta: "Public only" });
  client.notify("item/reasoning/textDelta", { ...base, itemId: "summary", delta: "PRIVATE REASONING" });
  client.notify("turn/plan/updated", { ...base, plan: [{ step: "Inspect", status: "completed" }, { step: "Build", status: "inProgress" }] });
  client.notify("turn/diff/updated", { ...base, diff: "+user-visible change" });
  client.notify("thread/tokenUsage/updated", { ...base, tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 100 }, modelContextWindow: 10000 } });
  const view = await service.read(id);
  assert.equal(view.items.find((item) => item.id === "command").output.includes("v24"), true);
  assert.equal(view.items.find((item) => item.kind === "plan").output.includes("✓ Inspect"), true);
  assert.equal(view.items.find((item) => item.kind === "files").output, "+user-visible change");
  assert.deepEqual(view.usage, { total: 1000, last: 100, contextWindow: 10000 });
  assert.equal(JSON.stringify(view).includes("PRIVATE REASONING"), false);
  assert.equal(JSON.stringify(service.status()).includes("PRIVATE"), false);
});

test("approval choices mirror native allowed decisions, including session permission and cancellation", () => {
  const method = "item/commandExecution/requestApproval"; const params = { command: "example", availableDecisions: ["acceptForSession", "decline"] };
  const view = approvalView(method, params, "r");
  assert.deepEqual(view.decisions, ["acceptForSession", "decline"]);
  assert.deepEqual(approvalAnswer({ method, params, view }, { decision: "acceptForSession" }), { decision: "acceptForSession" });
  assert.throws(() => approvalAnswer({ method, params, view }, { decision: "accept" }), { status: 400 });
  assert.equal(displayItem({ type: "reasoning", id: "r", summary: ["Public"], content: ["PRIVATE"] }, "t").output, "Public");
  const rule = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } };
  const ruleParams = { availableDecisions: ["decline", rule] }; const ruleView = approvalView(method, ruleParams, "r");
  assert.deepEqual(approvalAnswer({ method, params: ruleParams, view: ruleView }, { decision: "rule-1", rule: ["arbitrary"] }), { decision: rule });
  assert.throws(() => approvalAnswer({ method, params: ruleParams, view: ruleView }, { decision: "rule-0" }), { status: 400 });
  const permissionMethod = "item/permissions/requestApproval", permissionParams = { permissions: { network: { enabled: true } } };
  const permissionView = approvalView(permissionMethod, permissionParams, "p");
  assert.deepEqual(approvalAnswer({ method: permissionMethod, params: permissionParams, view: permissionView }, { decision: "acceptForSession", permissions: { arbitrary: true } }), { permissions: permissionParams.permissions, scope: "session" });
});
