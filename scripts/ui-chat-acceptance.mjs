// Real browser, actual HTTP/SSE endpoints and ProjectStore; the protocol peer never makes a model call.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ProjectStore } from "../src/project/project-store.js";
import { ChatService } from "../src/chat/chat-service.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { launchBrowser } from "./lib/browser.mjs";
import { FixtureCodex } from "./lib/chat-fixture.mjs";

const workspace = await mkdtemp(join(tmpdir(), "padstudio-chat-ui-"));
const shots = resolve(".cache/chat-ui"); await mkdir(shots, { recursive: true });
const client = new FixtureCodex({ automatic: true });
const chat = new ChatService({ cwd: join(workspace, "PADStudio"), client });
const store = new ProjectStore(join(workspace, "projects"));
await store.createProject({ projectId: "alpha", title: "Câu chuyện đầu tiên" });
await store.createProject({ projectId: "beta", title: "Một dự án khác" });
const server = createPadStudioServer({ reader: new ProjectReader(join(workspace, "projects")), chat });
await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(); const { page } = browser;
const waitText = (selector, value) => page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(value)})`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function seedVideo() {
  const artifact = await store.recordArtifact("alpha", {
    key: "film", type: "video.sequence", name: "Bản xem thử", summary: "Chat feedback fixture", status: "active", createdBy: "agent",
    data: { version: "1.0", changeReason: "browser fixture", format: { width: 320, height: 180, fps: 25 },
      segments: [{ id: "opening", title: "Mở đầu", intent: "Test exact feedback", durationSeconds: 2, visual: null, narration: null, captions: [], references: [] }] }
  });
  const run = await store.startRun("alpha", { capability: "video.render-sequence", purpose: "Chat browser fixture", tool: { name: "fixture", version: "1", provider: "test" } });
  const output = await store.createRunOutputWorkspace("alpha", run.id);
  const video = join(output.temporaryDirectory, "preview.mp4");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x006b8a:s=320x180:r=25:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", video], { windowsHide: true });
  const size = (await stat(video)).size;
  await store.commitRunOutputWorkspace(output);
  const result = await store.addResult("alpha", {
    runId: run.id, capability: "video.render-sequence", tool: run.tool, type: "video.sequence-render", name: "Bản xem thử",
    inputArtifacts: [artifact.id], files: [{ id: "primary", role: "primary", path: `${output.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: size }],
    data: { sequence: { artifactId: artifact.id, revision: artifact.revision, key: "film" }, durationSeconds: 2, hasAudio: false },
    verification: { status: "passed", checks: ["fixture"] }
  });
  await store.finishRun("alpha", run.id, { status: "completed", outputs: [result.id] });
  return result;
}
const input = (value) => page.evaluate(`(() => { const field=document.querySelector('#chat-input'); field.value=${JSON.stringify(value)}; field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
async function send(value) {
  await input(value);
  await page.waitFor("!document.querySelector('#chat-send').disabled");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()");
  await page.waitFor("document.querySelector('#chat-input').value === '' && document.querySelector('#chat-send').getAttribute('aria-label') !== 'Đang gửi…'", { label: "message accepted by the backend" });
}
async function chooseProject(id) {
  await click("#library-button");
  await page.waitFor(`document.querySelector('#library [data-project-id="${id}"]')`);
  await click(`#library [data-project-id="${id}"]`);
  await page.waitFor(`new URL(location.href).searchParams.get('project') === '${id}'`);
}

try {
  await page.goto(origin + "/?project=alpha");
  await page.waitFor("!document.querySelector('#project').hidden");
  assert.equal(client.calls.length, 0, "viewing videos does not launch or call an agent");
  await click("#chat-button");
  await waitText("#chat-status", "Sẵn sàng");
  const firstConversationId = (await chat.read()).conversationId;
  assert.equal(client.calls.some((call) => call.method === "turn/start"), false);
  await send("Tôi muốn giải thích cách một chiếc lá quang hợp.");
  await waitText("#chat-history", "Đã nhận ý tưởng");
  await waitText("#chat-status", "Sẵn sàng");
  const rendered = await page.evaluate(`({
    strong: !!document.querySelector('#chat-history strong'), code: !!document.querySelector('#chat-history pre code'),
    list: !!document.querySelector('#chat-history ul li'), image: !!document.querySelector('#chat-history img'),
    unsafe: !!document.querySelector('#chat-history a[href^="javascript:"]'), userMessages: document.querySelectorAll('.chat-message-user').length
  })`);
  assert.deepEqual(rendered, { strong: true, code: true, list: true, image: false, unsafe: false, userMessages: 1 });
  const beforeReload = client.calls.filter((call) => call.method === "turn/start").length;
  await input("Bản nháp chưa gửi của tôi");
  await page.goto(origin + "/?project=alpha&chat=1");
  await waitText("#chat-history", "Đã nhận ý tưởng");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Bản nháp chưa gửi của tôi");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, beforeReload);

  await seedVideo();
  await page.waitFor("document.querySelector('#theatre video')?.readyState >= 1", { timeout: 30_000 });
  assert.equal(await page.evaluate("!!document.querySelector('[data-ui=chat-anchor], #chat-new-project')"), false);
  assert.equal(await page.evaluate("!!document.querySelector('#chat-add')"), true);
  const plainPrompt = "Create project A and project B. I will decide which one to work on.";
  await send(plainPrompt); await waitText("#chat-history", "Create project A and project B");
  assert.equal(client.calls.findLast((call) => call.method === "turn/start").params.input[0].text, plainPrompt);
  await page.waitFor("document.querySelector('#chat-stop').hidden");

  await send("[question] Hỏi tôi phong cách trước khi tiếp tục.");
  await waitText("#chat-requests", "Bạn chọn phong cách nào?");
  await page.goto(origin + "/?project=alpha&chat=1");
  await waitText("#chat-requests", "Bạn chọn phong cách nào?");
  await page.evaluate("(() => {const select=document.querySelector('#chat-requests select'); select.value='Nhẹ nhàng'; select.dispatchEvent(new Event('change')); select.focus();})()");
  // An unrelated streamed event must not destroy the user's partially completed answer.
  const alpha = await chat.session();
  client.notify("item/completed", { threadId: alpha.threadId, turnId: alpha.turnId,
    item: { type: "agentMessage", id: "while-answering", text: "Tôi đang chờ lựa chọn của bạn." } });
  await waitText("#chat-history", "Tôi đang chờ lựa chọn");
  assert.equal(await page.evaluate("document.querySelector('#chat-requests select').value"), "Nhẹ nhàng");
  await page.evaluate("document.querySelector('#chat-requests form').requestSubmit()");
  await waitText("#chat-history", "Đã ghi nhận lựa chọn: Nhẹ nhàng");
  await waitText("#chat-status", "Sẵn sàng");

  await send("[approval] Dựng bản xem thử.");
  await waitText("#chat-requests", "Cho phép thực hiện thao tác?");
  const approvalCount = client.responses.length;
  await page.goto(origin + "/?project=alpha&chat=1");
  await waitText("#chat-requests", "node render-preview.js");
  assert.equal(client.responses.length, approvalCount, "reload cannot approve a command");
  await page.evaluate("document.querySelector('#chat-requests form').requestSubmit()");
  await waitText("#chat-history", "Bạn đã cho phép thao tác.");
  await waitText("#chat-status", "Sẵn sàng");

  await send("[wait] Đợi tôi bổ sung.");
  await waitText("#chat-status", "Agent đang làm việc");
  await send("Bổ sung yêu cầu trong lúc đang làm.");
  assert.ok(client.calls.some((call) => call.method === "turn/steer"));
  await click("#chat-stop");
  await waitText("#chat-notice", "Đã dừng lượt");
  assert.equal((await chat.read()).active, false);

  // Several real conversations remain open. Switching, closing and reloading never interrupt or retarget an agent.
  await click("#chat-new-conversation");
  await page.waitFor("document.querySelectorAll('#chat-tabs [role=tab]').length === 2 && document.querySelectorAll('#chat .chat-message').length === 0");
  await send("[wait] Một phương án mở đầu khác."); await waitText("#chat-status", "Agent đang làm việc");
  const secondSession = await chat.session(); const secondConversationId = secondSession.id;
  await input("Nháp riêng tab thứ hai");
  const chooseTab = async (id) => {
    await click(`#chat-tabs [role=tab][data-conversation-id="${id}"]`);
    await page.waitFor(`document.querySelector('#chat-tabs [aria-selected="true"]')?.dataset.conversationId === ${JSON.stringify(id)}`);
  };
  await chooseTab(firstConversationId); await waitText("#chat-history", "Bạn đã cho phép thao tác.");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "");
  const requestNormally = client.request.bind(client); let releaseSend;
  const delayedSend = new Promise((resolveSend) => { releaseSend = resolveSend; });
  client.request = async (method, params) => { const result = await requestNormally(method, params); if (method === "turn/start") await delayedSend; return result; };
  try {
    await input("[wait] Tiếp tục phương án ban đầu.");
    await page.evaluate("document.querySelector('#chat-composer').requestSubmit()"); await waitText("#chat-status", "Đang gửi");
    await input("Nháp riêng tab đầu tiên");
    await chooseTab(secondConversationId);
    releaseSend();
    await page.waitFor(`fetch('/api/chat/conversations/${firstConversationId}').then(response => response.json()).then(value => value.session.items.some(item => item.text.includes('Tiếp tục phương án ban đầu')))`, { label: "background send remains on its original tab" });
    assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab thứ hai");
    await chooseTab(firstConversationId); await waitText("#chat-status", "Agent đang làm việc");
    assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab đầu tiên", "a delayed send must not clear a newly typed draft");
  } finally { releaseSend(); client.request = requestNormally; }
  assert.equal((await chat.read()).conversations.filter((entry) => entry.active).length, 2);
  const firstSession = await chat.session(firstConversationId);
  client.ask(firstSession.threadId, "item/tool/requestUserInput", { questions: [{ id: "style", question: "Chọn nhịp cho phương án đầu?", options: [{ label: "Chậm", description: "Đủ thời gian quan sát" }] }] });
  await waitText("#chat-requests", "Chọn nhịp");
  await page.evaluate("(() => {const field=document.querySelector('#chat-requests select'); field.value='Chậm'; field.dispatchEvent(new Event('change'));})()");
  await input("Nháp riêng tab đầu tiên");
  await chooseTab(secondConversationId);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab thứ hai");
  assert.equal(await page.evaluate("document.querySelector('#chat-requests').textContent"), "");
  await chooseTab(firstConversationId);
  assert.equal(await page.evaluate("document.querySelector('#chat-requests select').value"), "Chậm", "switching tabs preserves partially answered prompts");
  await chooseTab(secondConversationId);
  await page.goto(origin + "/?project=alpha&chat=1");
  await waitText("#chat-history", "Một phương án mở đầu khác");
  assert.equal(await page.evaluate("document.querySelectorAll('#chat-tabs [role=tab]').length"), 2);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab thứ hai");
  await chooseTab(firstConversationId); await waitText("#chat-requests", "Chọn nhịp");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab đầu tiên");
  assert.equal(await page.evaluate("document.querySelector('#chat-history').textContent.includes('Một phương án mở đầu khác')"), false);
  await page.evaluate("document.querySelector('#chat-requests button[type=button]').click()");
  await waitText("#chat-status", "Sẵn sàng");
  await click(`#chat-tabs .chat-tab-close[data-conversation-id="${secondConversationId}"]`);
  assert.equal(secondSession.active, true, "closing an active tab does not stop it");
  client.complete(secondSession.threadId, "Phương án thứ hai đã xong ở nền.");
  await click("#chat-history-button");
  await click(`#chat-native-results [data-conversation-id="${secondConversationId}"]`);
  await waitText("#chat-history", "Phương án thứ hai đã xong ở nền.");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp riêng tab thứ hai");
  await chooseTab(firstConversationId); await input("");

  // Visual review uses a representative conversation, without protocol test markers.
  await click("#chat-new-conversation");
  await page.waitFor("document.querySelectorAll('#chat .chat-message').length === 0");
  await page.screenshot(join(shots, "chat-empty-desktop.png"));
  client.automatic = false;
  await send("Mình muốn làm một video 60 giây giải thích vì sao lá cây có màu xanh. Phong cách nhẹ nhàng, dễ hiểu nhé.");
  const visualSession = await chat.session();
  client.complete(visualSession.threadId, "Mình sẽ kể câu chuyện qua một chiếc lá, với hình ảnh gần gũi và chuyển động chậm.\n\n**Một hướng mở đầu**\n\nÁnh nắng đi qua tán cây. Máy quay đến gần một chiếc lá, rồi đưa người xem vào thế giới nhỏ bên trong.\n\n- **Mở đầu:** Vì sao lá cây lại có màu xanh?\n- **Giải thích:** Lá hấp thụ ánh sáng để tạo năng lượng.\n- **Kết:** Màu xanh là phần ánh sáng được phản chiếu lại.\n\nBạn muốn giọng kể ấm áp hay tươi vui hơn một chút?");
  await waitText("#chat-history", "Bạn muốn giọng kể"); await waitText("#chat-status", "Sẵn sàng");
  client.automatic = true;
  await input("Giọng kể ấm áp nhé");

  // Resize the actual divider with the pointer, then reopen and use its keyboard controls.
  await page.viewport(1440, 1000);
  const turnsBeforeResize = client.calls.filter((call) => call.method === "turn/start").length;
  await page.evaluate("(async () => {window.videoBeforeResize=document.querySelector('#theatre video'); videoBeforeResize.muted=true; videoBeforeResize.loop=true; await videoBeforeResize.play();})()");
  const divider = await page.evaluate("(() => {const r=document.querySelector('#chat-resize-handle').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+200};})()");
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: divider.x, y: divider.y, buttons: 0 });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: divider.x, y: divider.y, button: "left", buttons: 1, clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 740, y: divider.y, buttons: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 740, y: divider.y, button: "left", buttons: 0, clickCount: 1 });
  await page.waitFor("Math.abs(document.querySelector('#chat').getBoundingClientRect().width - 700) < 1 && !document.body.classList.contains('chat-is-resizing')");
  assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
  assert.equal(await page.evaluate("document.querySelector('#theatre video') === window.videoBeforeResize && !videoBeforeResize.paused"), true, "resizing must not replace or interrupt the video player");
  await page.screenshot(join(shots, "chat-resized-wide.png"));
  await page.goto(origin + "/?project=alpha&chat=1"); await waitText("#chat-history", "Bạn muốn giọng kể");
  assert.equal(await page.evaluate("document.querySelector('#chat').getBoundingClientRect().width"), 700);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Giọng kể ấm áp nhé");
  await page.evaluate("document.querySelector('#chat-resize-handle').focus()");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
  assert.equal(await page.evaluate("document.querySelector('#chat').getBoundingClientRect().width"), 716);
  for (const [key, code] of [["Home", 36], ["End", 35]]) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    const metrics = await page.evaluate("({width:document.querySelector('#chat').getBoundingClientRect().width, overflow:document.documentElement.scrollWidth-innerWidth, min:Number(document.querySelector('#chat-resize-handle').getAttribute('aria-valuemin')),max:Number(document.querySelector('#chat-resize-handle').getAttribute('aria-valuemax'))})");
    assert.equal(metrics.width, key === "Home" ? metrics.min : metrics.max); assert.ok(metrics.overflow <= 1);
    await page.screenshot(join(shots, key === "Home" ? "chat-resized-narrow.png" : "chat-resized-max.png"));
  }
  await page.evaluate("document.querySelector('#chat-resize-handle').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  assert.equal(await page.evaluate("document.querySelector('#chat').getBoundingClientRect().width"), 490);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, turnsBeforeResize);

  for (const [width, height] of [[320, 780], [390, 844], [768, 900], [1024, 900], [1440, 1000]]) {
    await page.viewport(width, height, { mobile: width < 800 });
    await page.waitFor(`document.querySelector('#main').inert === ${width <= 900}`, { label: `chat responsive mode at ${width}px` });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await page.waitFor("document.getAnimations().every((animation) => animation.playState !== 'running')", { label: "theme transition finishes" });
      const layout = await page.evaluate(`(() => { const panel=document.querySelector('#chat'); const input=document.querySelector('#chat-input'); return {
        overflow:document.documentElement.scrollWidth-innerWidth, panel:panel.scrollWidth-panel.clientWidth,
        input:input.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom,
        modal:panel.getAttribute('aria-modal'), mainInert:document.querySelector('#main').inert
      }; })()`);
      assert.ok(layout.overflow <= 1 && layout.panel <= 1 && layout.input, `${width}/${theme}: unusable chat layout ${JSON.stringify(layout)}`);
      assert.equal(layout.mainInert, width <= 900);
      if (width <= 900) assert.equal(layout.modal, "true");
      await page.waitFor(`(() => { const area=document.querySelector('#chat-tabs').getBoundingClientRect(); const tab=document.querySelector('#chat-tabs [aria-selected="true"]').parentElement.getBoundingClientRect(); return tab.left >= area.left - 1 && tab.right <= area.right + 1; })()`, { label: `selected conversation tab remains visible at ${width}px` });
      await page.screenshot(join(shots, `chat-${width}-${theme}.png`));
    }
  }
  // Mobile focus stays in the chat, and closing returns it to the launcher.
  await page.viewport(390, 844, { mobile: true });
  await page.evaluate("document.querySelector('#chat-input').focus()");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.waitFor("document.querySelector('#chat').hidden");
  assert.equal(await page.evaluate("document.querySelector('#main').inert"), false);
  assert.equal(await page.evaluate("document.activeElement.id"), "chat-button");

  await page.viewport(1440, 1000);
  await click("#chat-button"); await waitText("#chat-history", "Bạn muốn giọng kể");
  await click("#library-button");
  await page.viewport(390, 844, { mobile: true });
  await page.waitFor("document.querySelector('#chat').classList.contains('is-covered') && document.querySelector('#chat').inert");
  await page.evaluate("document.querySelector('[data-library-close]').click()");
  await page.waitFor("!document.querySelector('#chat').classList.contains('is-covered') && document.querySelector('#main').inert && !document.querySelector('#chat').inert");
  await page.viewport(1440, 1000);
  await page.waitFor("!document.querySelector('#main').inert");
  const selectedBeforeProjectSwitch = await page.evaluate("document.querySelector('#chat-tabs [aria-selected=true]').dataset.conversationId");
  const turnsBeforeProjectSwitch = client.calls.filter((call) => call.method === "turn/start").length;
  await chooseProject("beta");
  assert.equal(await page.evaluate("document.querySelector('#chat-tabs [aria-selected=true]').dataset.conversationId"), selectedBeforeProjectSwitch);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value.length > 0"), true);
  await chooseProject("alpha");
  assert.equal(await page.evaluate("document.querySelector('#chat-tabs [aria-selected=true]').dataset.conversationId"), selectedBeforeProjectSwitch);
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, turnsBeforeProjectSwitch);
  assert.equal((await store.listProjects()).length, 2);

  const inferenceBeforeOffline = client.calls.filter((call) => call.method === "turn/start").length;
  await input("Tin nhắn giữ lại khi mất mạng");
  await page.offline(true);
  await page.evaluate("document.querySelector('#chat button[aria-label=\"Đóng trò chuyện\"]').click(); document.querySelector('#chat-button').click()");
  await waitText("#chat-status", "Mất kết nối");
  await page.offline(false);
  await page.waitFor("document.querySelector('#chat-status').textContent === 'Sẵn sàng'", { timeout: 20_000 });
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Tin nhắn giữ lại khi mất mạng");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, inferenceBeforeOffline);

  // First-time authentication and a failed runtime connection do not lose the conversation or expose credentials.
  client.authenticated = false; client.notify("account/updated", {});
  await waitText("#chat .chat-connection", "Đăng nhập tài khoản ChatGPT");
  await page.evaluate("document.querySelector('#chat .chat-connection button').click()");
  await page.waitFor("document.querySelector('#chat .chat-connection a')?.href.startsWith('https://auth.openai.com/')");
  assert.equal(await page.evaluate("document.querySelector('#chat').textContent.includes('NEVER_SHOW_TOKEN')"), false);
  client.authenticated = true; client.notify("account/login/completed", { success: true });
  await waitText("#chat-status", "Sẵn sàng");
  await input("Nháp vẫn còn khi Codex bị tắt");
  client.failStart = true; client.emit("disconnect", new Error("Codex thử nghiệm đã tắt"));
  await page.waitFor("!document.querySelector('#chat .chat-connection').hidden");
  await page.evaluate("document.querySelector('#chat .chat-connection button').click()");
  await waitText("#chat .chat-connection", "không khởi động được");
  client.failStart = false;
  await page.evaluate("document.querySelector('#chat .chat-connection button').click()");
  await waitText("#chat-status", "Sẵn sàng");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Nháp vẫn còn khi Codex bị tắt");

  assert.equal(page.errors.length, 0, page.errors.join("\n"));
  // Offline requests intentionally produce fetch failures; all other browser errors are forbidden.
  const unexpectedErrors = page.consoleErrors.filter((entry) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|EventSource/i.test(entry));
  assert.equal(unexpectedErrors.length, 0, unexpectedErrors.join("\n"));

  // Chat works with an empty video library. Sending a prompt does not create a project.
  const emptyChat = new ChatService({ cwd: join(workspace, "empty"), client: new FixtureCodex({ automatic: true }) });
  const emptyServer = createPadStudioServer({ reader: new ProjectReader(join(workspace, "empty", "projects")), chat: emptyChat });
  await new Promise((resolveEmpty) => emptyServer.listen(0, "127.0.0.1", resolveEmpty));
  try {
    await page.goto(`http://127.0.0.1:${emptyServer.address().port}/`);
    await page.waitFor("!document.querySelector('#welcome').hidden");
    await click("#welcome-chat"); await waitText("#chat-status", "Sẵn sàng");
    await send("Làm một video về những chiếc lá.");
    await waitText("#chat-history", "Đã nhận ý tưởng");
    const projects = await new ProjectStore(join(workspace, "empty", "projects")).listProjects();
    assert.equal(projects.length, 0, "a prompt does not create a video project behind the user");
    assert.equal((await emptyChat.read()).items.filter((item) => item.role === "user").length, 1);
    assert.equal(await page.evaluate("new URL(location.href).searchParams.has('project')"), false);
    assert.equal(page.errors.length, 0, page.errors.join("\n"));
  } finally {
    await page.goto("about:blank"); emptyServer.closeAllConnections(); await new Promise((resolveEmpty) => emptyServer.close(resolveEmpty)); await emptyChat.close();
  }
  console.log("Chat UI: passed (plain workspace Codex, no project binding/creation/import/context, parallel tabs, background completion, drafts, questions, permissions, steer/stop, pointer/keyboard resizing, persisted width, adaptive layout, reload/offline, 320/390/768/1024/1440 px, light/dark)");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise((resolveServer) => server.close(resolveServer)); await chat.close();
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-chat-ui-")) throw new Error("Refusing to remove a fixture outside the temporary directory.");
  await rm(target, { recursive: true, force: true });
}
