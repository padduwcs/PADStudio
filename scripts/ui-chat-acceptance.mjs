// Real browser, actual HTTP/SSE endpoints and ProjectStore; the protocol peer never makes a model call.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ChatService } from "../src/chat/chat-service.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { launchBrowser } from "./lib/browser.mjs";
import { FixtureCodex } from "./lib/chat-fixture.mjs";

const workspace = await mkdtemp(join(tmpdir(), "padstudio-chat-ui-"));
const shots = resolve(".cache/chat-ui"); await mkdir(shots, { recursive: true });
const client = new FixtureCodex({ automatic: true });
const chat = new ChatService({ projectRoot: join(workspace, "projects"), client });
await chat.store.createProject({ projectId: "alpha", title: "Câu chuyện đầu tiên" });
await chat.store.createProject({ projectId: "beta", title: "Một dự án khác" });
const server = createPadStudioServer({ reader: new ProjectReader(chat.projectRoot), chat });
await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(); const { page } = browser;
const waitText = (selector, value) => page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(value)})`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function seedVideo() {
  const artifact = await chat.store.recordArtifact("alpha", {
    key: "film", type: "video.sequence", name: "Bản xem thử", summary: "Chat feedback fixture", status: "active", createdBy: "agent",
    data: { version: "1.0", changeReason: "browser fixture", format: { width: 320, height: 180, fps: 25 },
      segments: [{ id: "opening", title: "Mở đầu", intent: "Test exact feedback", durationSeconds: 2, visual: null, narration: null, captions: [], references: [] }] }
  });
  const run = await chat.store.startRun("alpha", { capability: "video.render-sequence", purpose: "Chat browser fixture", tool: { name: "fixture", version: "1", provider: "test" } });
  const output = await chat.store.createRunOutputWorkspace("alpha", run.id);
  const video = join(output.temporaryDirectory, "preview.mp4");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x006b8a:s=320x180:r=25:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", video], { windowsHide: true });
  const size = (await stat(video)).size;
  await chat.store.commitRunOutputWorkspace(output);
  const result = await chat.store.addResult("alpha", {
    runId: run.id, capability: "video.render-sequence", tool: run.tool, type: "video.sequence-render", name: "Bản xem thử",
    inputArtifacts: [artifact.id], files: [{ id: "primary", role: "primary", path: `${output.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: size }],
    data: { sequence: { artifactId: artifact.id, revision: artifact.revision, key: "film" }, durationSeconds: 2, hasAudio: false },
    verification: { status: "passed", checks: ["fixture"] }
  });
  await chat.store.finishRun("alpha", run.id, { status: "completed", outputs: [result.id] });
  return result;
}
const input = (value) => page.evaluate(`(() => { const field=document.querySelector('#chat-input'); field.value=${JSON.stringify(value)}; field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
async function send(value) {
  await input(value);
  await page.waitFor("!document.querySelector('#chat-send').disabled");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()");
  await page.waitFor("document.querySelector('#chat-input').value === '' && document.querySelector('#chat-send').textContent !== 'Đang gửi…'", { label: "message accepted by the backend" });
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

  const render = await seedVideo();
  await page.waitFor("document.querySelector('#theatre video')?.readyState >= 1", { timeout: 30_000, label: "video appears beside chat" });
  await page.evaluate("document.querySelector('#theatre video').currentTime = 0.8");
  await click('[data-ui="chat-anchor"]');
  await waitText("#chat-attachments", "Đã gắn mốc video");
  await send("Đoạn này cần chậm hơn.");
  await waitText("#chat-status", "Sẵn sàng");
  const feedback = client.calls.findLast((call) => call.method === "turn/start").params.input[0].text;
  assert.ok(feedback.includes(render.id) && feedback.includes("at=0.800"), "feedback must identify the exact video and playhead");
  assert.equal(await page.evaluate(`document.querySelector('#chat-history').textContent.includes(${JSON.stringify(render.id)})`), false, "implementation IDs stay out of the conversation display");

  // Add a real file through the file picker; verify it became a normal Resource before it is sent to Codex.
  const narration = join(workspace, "lời dẫn.txt"); await writeFile(narration, "Ánh sáng giúp chiếc lá tạo năng lượng.");
  const document = await page.send("DOM.getDocument", {});
  const fileNode = await page.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#chat-files" });
  await page.send("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [narration] });
  await waitText("#chat-attachments", "lời dẫn.txt");
  const context = await chat.store.readContext("alpha"); assert.equal(context.resources.length, 1);
  assert.equal(await readFile(join(chat.projectRoot, "alpha", "inputs", "lời dẫn.txt"), "utf8"), "Ánh sáng giúp chiếc lá tạo năng lượng.");
  await send("Dùng tư liệu tôi vừa thêm.");
  await waitText("#chat-status", "Sẵn sàng");
  assert.ok(client.calls.findLast((call) => call.method === "turn/start").params.input[0].text.includes(context.resources[0].id));

  await send("[question] Hỏi tôi phong cách trước khi tiếp tục.");
  await waitText("#chat-requests", "Bạn chọn phong cách nào?");
  await page.goto(origin + "/?project=alpha&chat=1");
  await waitText("#chat-requests", "Bạn chọn phong cách nào?");
  await page.evaluate("(() => {const select=document.querySelector('#chat-requests select'); select.value='Nhẹ nhàng'; select.dispatchEvent(new Event('change')); select.focus();})()");
  // An unrelated streamed event must not destroy the user's partially completed answer.
  const alpha = await chat.session("alpha");
  const firstThreadId = alpha.threadId;
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
  assert.equal((await chat.read("alpha")).active, false);

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
  await click("#chat-button"); await waitText("#chat-history", "Bạn đã cho phép thao tác.");
  await click("#library-button");
  await page.viewport(390, 844, { mobile: true });
  await page.waitFor("document.querySelector('#chat').classList.contains('is-covered') && document.querySelector('#chat').inert");
  await page.evaluate("document.querySelector('[data-library-close]').click()");
  await page.waitFor("!document.querySelector('#chat').classList.contains('is-covered') && document.querySelector('#main').inert && !document.querySelector('#chat').inert");
  await page.viewport(1440, 1000);
  await page.waitFor("!document.querySelector('#main').inert");
  await chooseProject("beta");
  await waitText("#chat-project-name", "Một dự án khác");
  assert.equal(await page.evaluate("document.querySelectorAll('#chat .chat-message').length"), 0);
  await input("Nháp riêng dự án beta");
  await chooseProject("alpha");
  await waitText("#chat-history", "Bạn đã cho phép thao tác.");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "");

  await click("#chat-new-conversation");
  await page.evaluate("document.querySelector('#chat .chat-reset .button').click()");
  await page.waitFor("document.querySelectorAll('#chat .chat-message').length === 0 && !document.querySelector('#chat-conversations').hidden");
  await send("Một cuộc trò chuyện mới trong cùng dự án.");
  await waitText("#chat-status", "Sẵn sàng");
  await page.evaluate(`(() => {const select=document.querySelector('#chat-conversations'); select.value=${JSON.stringify(firstThreadId)}; select.dispatchEvent(new Event('change'));})()`);
  await waitText("#chat-history", "Bạn đã cho phép thao tác.");

  const inferenceBeforeOffline = client.calls.filter((call) => call.method === "turn/start").length;
  await input("Tin nhắn giữ lại khi mất mạng");
  await page.offline(true);
  await page.evaluate("document.querySelector('#chat button[aria-label=\"Đóng trò chuyện\"]').click(); document.querySelector('#chat-button').click()");
  await waitText("#chat-status", "Mất kết nối");
  await page.offline(false);
  await page.waitFor("document.querySelector('#chat-status').textContent === 'Sẵn sàng'", { timeout: 20_000 });
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "Tin nhắn giữ lại khi mất mạng");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, inferenceBeforeOffline);

  // Normal UI project creation uses the same store as the observer and never sends an agent turn by itself.
  await click("#chat-new-project");
  await page.evaluate("(() => {const form=document.querySelector('.chat-new-project-form'); form.querySelector('input').value='Dự án tạo từ giao diện'; form.requestSubmit();})()");
  await waitText("#chat-project-name", "Dự án tạo từ giao diện");
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

  // The welcome screen can start a project with the very first message, without any terminal command or existing project.
  const emptyChat = new ChatService({ projectRoot: join(workspace, "empty", "projects"), client: new FixtureCodex({ automatic: true }) });
  const emptyServer = createPadStudioServer({ reader: new ProjectReader(emptyChat.projectRoot), chat: emptyChat });
  await new Promise((resolveEmpty) => emptyServer.listen(0, "127.0.0.1", resolveEmpty));
  try {
    await page.goto(`http://127.0.0.1:${emptyServer.address().port}/`);
    await page.waitFor("!document.querySelector('#welcome').hidden");
    await click("#welcome-chat"); await waitText("#chat-status", "Sẵn sàng");
    await send("Làm một video về những chiếc lá.");
    await waitText("#chat-history", "Đã nhận ý tưởng");
    const projects = await emptyChat.store.listProjects();
    assert.equal(projects.length, 1); assert.equal(projects[0].title, "Làm một video về những chiếc lá.");
    assert.equal((await emptyChat.read(projects[0].id)).items.filter((item) => item.role === "user").length, 1);
    assert.equal(page.errors.length, 0, page.errors.join("\n"));
  } finally {
    await page.goto("about:blank"); emptyServer.closeAllConnections(); await new Promise((resolveEmpty) => emptyServer.close(resolveEmpty)); await emptyChat.close();
  }
  console.log("Chat UI: passed (real HTTP/SSE, send/stream/reload, uploads, questions, approvals, steer/stop, project isolation, history, offline recovery, project creation, 320/390/768/1024/1440 px, light/dark)");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise((resolveServer) => server.close(resolveServer)); await chat.close();
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-chat-ui-")) throw new Error("Refusing to remove a fixture outside the temporary directory.");
  await rm(target, { recursive: true, force: true });
}
