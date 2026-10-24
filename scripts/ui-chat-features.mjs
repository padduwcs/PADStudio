import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChatService } from "../src/chat/chat-service.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";
import { FixtureCodex } from "./lib/chat-fixture.mjs";
import { launchBrowser } from "./lib/browser.mjs";

const cwd = await mkdtemp(join(tmpdir(), "padstudio-chat-features-ui-"));
const client = new FixtureCodex({ automatic: true }); const chat = new ChatService({ cwd, client });
const server = createPadStudioServer({ reader: new ProjectReader(join(cwd, ".padstudio", "projects")), chat });
await new Promise((done) => server.listen(0, "127.0.0.1", done)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(); const { page } = browser;
const shots = resolve(".cache/chat-features-ui"); await mkdir(shots, { recursive: true });
const downloads = join(shots, "downloads"); await mkdir(downloads, { recursive: true });
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text = (selector, value) => page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(value)})`);
const fill = (selector, value) => page.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const choose = (selector, value) => page.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const idle = () => page.waitFor("document.querySelector('#chat-status').textContent === 'Sẵn sàng'");
async function send(message) {
  await fill("#chat-input", message); await page.waitFor("!document.querySelector('#chat-send').disabled");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()");
  await page.waitFor("document.querySelector('#chat-input').value === ''"); await idle();
}
const selected = () => page.evaluate("document.querySelector('#chat-tabs [aria-selected=true]').dataset.conversationId");
async function pointerClick(selector) {
  const point = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
}
async function more(label) {
  await click("#chat-more");
  if (["Xuất Markdown", "Xuất JSON", "Thu gọn ngữ cảnh"].includes(label)) await page.evaluate("[...document.querySelectorAll('#chat-popover button')].find(button => button.textContent === 'Thêm thao tác…').click()");
  await page.evaluate(`([...document.querySelectorAll('#chat-popover button')].find(button => button.textContent === ${JSON.stringify(label)})).click()`);
}
async function reference() { await click("#chat-add"); await click("#chat-reference"); }
async function settings() { await click("#chat-more"); await click("#chat-settings"); }

try {
  await writeFile(join(cwd, "reference.md"), "# User reference\n"); client.files = [{ root: cwd, path: "reference.md" }];
  const external = (await client.request("thread/start", { cwd })).thread; external.name = "Hội thoại từ Codex CLI"; external.source = "cli";
  external.turns = [{ id: "native-turn", status: "completed", items: [{ id: "native-answer", type: "agentMessage", text: "Lịch sử có sẵn trên máy" }] }];
  await page.goto(origin + "/?chat=1"); await idle(); const first = await selected();
  assert.equal(await page.evaluate("document.querySelector('.chat-tab-bar').hidden"), true);
  assert.equal(await page.evaluate("!!document.querySelector('.chat-hint, .chat-empty-mark, #chat-context-info, #chat-reference, #chat-attach')"), false, "the initial chat only exposes familiar composer controls");
  await page.screenshot(join(shots, "empty-sidebar.png"));
  await pointerClick("#chat-add"); await pointerClick("#chat-reference"); await page.waitFor("document.activeElement.id === 'chat-file-search'");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.equal(await page.evaluate("document.querySelector('#chat-popover').hidden && document.activeElement.id === 'chat-add'"), true, "nested picker closes to its visible composer trigger");
  await pointerClick("#chat-model-button"); await choose("#chat-model", "fixture-model");
  assert.equal(await page.evaluate("document.querySelector('#chat-popover').hidden && document.activeElement.id === 'chat-input'"), true, "choosing a model returns focus to the prompt");
  await click("#chat-model-button"); await choose("#chat-option-effort", "high"); await click("#chat-model-button");
  await click("#chat-mode-button"); await choose("#chat-option-mode", "plan"); await choose("#chat-option-permissions", ":read-only");
  assert.equal(await page.evaluate("!!document.querySelector('#chat-option-permissions option[value=\":danger-full-access\"]')"), false);
  await page.screenshot(join(shots, "settings-light.png")); await click("#chat-mode-button");
  // Use browser File/DataTransfer, exercising the same FileReader/upload path as the picker.
  await page.evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1XkAAAAASUVORK5CYII='), c=>c.charCodeAt(0))], 'reference.png', {type:'image/png'}));
    transfer.items.add(new File(['A user note'], 'note.txt', {type:'text/plain'}));
    const picker = document.querySelector('#chat-file-picker'); picker.files = transfer.files; picker.dispatchEvent(new Event('change'));
  })()`);
  await page.waitFor("document.querySelectorAll('#chat-attachments .chat-attachment').length === 2 && !document.querySelector('#chat-add').disabled");
  await reference(); await fill("#chat-file-search", "reference"); await text(".chat-picker-results", "reference.md"); await click(".chat-picker-results button");
  await reference(); await page.evaluate("[...document.querySelectorAll('#chat-popover button')].find(button=>button.textContent==='fixture-skill').click()");
  await page.waitFor("document.querySelectorAll('#chat-attachments .chat-attachment').length === 4");
  // Menus follow their source and clear the whole composer when it grows, then when the panel resizes.
  await fill("#chat-input", "Bản nháp nhiều dòng\n".repeat(7)); await click("#chat-add");
  await page.waitFor("document.querySelector('#chat-popover').getBoundingClientRect().bottom <= document.querySelector('#chat-composer').getBoundingClientRect().top - 6");
  await page.viewport(390, 700, { mobile: true });
  await page.waitFor("(()=>{const menu=document.querySelector('#chat-popover').getBoundingClientRect(),input=document.querySelector('#chat-composer').getBoundingClientRect();return menu.left>=0&&menu.right<=innerWidth&&menu.bottom<=input.top-6&&menu.top>=0})()");
  await page.screenshot(join(shots, "menu-with-tall-draft-mobile.png"));
  await page.viewport(390, 420, { mobile: true });
  await page.waitFor("(()=>{const panel=document.querySelector('#chat').getBoundingClientRect(),dock=document.querySelector('.chat-dock').getBoundingClientRect(),menu=document.querySelector('#chat-popover').getBoundingClientRect(),input=document.querySelector('#chat-composer').getBoundingClientRect();return dock.bottom<=panel.bottom+1&&menu.bottom<=input.top-6&&menu.top>=panel.top})()");
  await page.screenshot(join(shots, "menu-with-tall-draft-short-viewport.png"));
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }); await page.viewport(1440, 900);
  await fill("#chat-input", "  Đọc file tôi chọn, xem ảnh này.\n ");
  await page.goto(origin + "/?chat=1"); await idle();
  assert.equal(await page.evaluate("document.querySelectorAll('#chat-attachments .chat-attachment').length"), 4);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "  Đọc file tôi chọn, xem ảnh này.\n ");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()"); await text("#chat-history", "Đã nhận ý tưởng"); await idle();
  const sent = client.calls.findLast((call) => call.method === "turn/start").params;
  assert.equal(sent.input[0].text, "  Đọc file tôi chọn, xem ảnh này.\n "); assert.equal(sent.input[1].type, "localImage");
  assert.equal(sent.input.at(-1).type, "skill"); assert.equal(sent.permissions, ":read-only"); assert.equal(sent.effort, "high"); assert.equal(sent.collaborationMode.mode, "plan");
  assert.equal(await page.evaluate("document.querySelectorAll('#chat-attachments .chat-attachment').length"), 0);
  await page.waitFor("document.querySelector('.chat-message-attachments img')?.naturalWidth === 1");

  await more("Đổi tên"); await fill("#chat-rename-input", "Lá xanh và ánh sáng"); await page.evaluate("document.querySelector('.chat-rename').requestSubmit()");
  await text("#chat-tabs", "Lá xanh và ánh sáng");
  const firstThread = (await chat.session(first)).threadId; assert.equal(client.threads.get(firstThread).name, "Lá xanh và ánh sáng");
  assert.equal(await page.evaluate("document.querySelector('#chat-title').textContent"), "Lá xanh và ánh sáng");
  // Edit creates a fresh branch before the original turn. It does not alter old turns or auto-send.
  const turnsBefore = client.calls.filter((call) => call.method === "turn/start").length;
  await click(".chat-message-user .chat-message-actions button:last-child"); await page.waitFor("document.querySelectorAll('#chat-tabs [role=tab]').length === 2");
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, turnsBefore);
  assert.notEqual(await selected(), first); assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), "  Đọc file tôi chọn, xem ảnh này.\n ");
  assert.equal(await page.evaluate("document.querySelectorAll('#chat-attachments .chat-attachment').length"), 4);
  await send("Bản nháp sau khi sửa"); const edited = await selected();
  assert.equal(client.threads.get(firstThread).turns.length, 1);
  await click(".chat-message-assistant .chat-message-actions button:last-child");
  await page.waitFor("document.querySelectorAll('#chat-tabs [role=tab]').length === 3"); await text("#chat-history", "Đã nhận ý tưởng"); await idle();
  assert.equal(client.calls.filter((call) => call.method === "turn/start").length, turnsBefore + 2);
  assert.notEqual(await selected(), edited);

  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "f", code: "KeyF", modifiers: 2 });
  await page.waitFor("!document.querySelector('.chat-find').hidden"); await fill(".chat-find input", "Bản nháp");
  await page.waitFor("document.querySelector('.chat-search-match')"); await click(".chat-find button:last-child");
  await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  const exportId = await selected(); await more("Xuất Markdown");
  const deadline = Date.now() + 10_000;
  while (!(await readdir(downloads)).includes(`codex-${exportId}.md`)) { if (Date.now() > deadline) throw new Error("Markdown export did not download"); await new Promise((done) => setTimeout(done, 100)); }
  assert.equal((await readFile(join(downloads, `codex-${exportId}.md`), "utf8")).includes("Bản nháp sau khi sửa"), true);

  await more("Lưu trữ hội thoại"); await text("#chat-status", "đã lưu trữ"); assert.equal(await page.evaluate("document.querySelector('#chat-send').disabled"), true);
  await more("Khôi phục hội thoại"); await idle();
  await click("#chat-history-button"); await fill("#chat-history-search", "Hội thoại từ Codex CLI"); await text("#chat-native-results", "Hội thoại từ Codex CLI"); await click("#chat-native-results button");
  await text("#chat-history", "Lịch sử có sẵn trên máy");
  const requestsBefore = client.calls.filter((call) => call.method === "turn/start").length;
  await send("/plan"); assert.equal(client.calls.filter((call) => call.method === "turn/start").length, requestsBefore);
  await click("#chat-mode-button"); assert.equal(await page.evaluate("document.querySelector('#chat-option-mode').value"), "plan"); await click("#chat-mode-button");
  await send("/compact");
  const compactDeadline = Date.now() + 5000;
  while (!client.calls.some((call) => call.method === "thread/compact/start")) { if (Date.now() > compactDeadline) throw new Error("Compact was not requested"); await new Promise((done) => setTimeout(done, 50)); }
  await send("/help"); await text("#chat-popover", "Phím tắt và lệnh nhanh"); await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });

  await fill("#chat-input", "[wait] Tạo đoạn mở đầu cho bộ phim về chiếc lá.");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()"); await text("#chat-status", "Agent đang làm việc");
  const active = await chat.session(await selected()); const base = { threadId: active.threadId, turnId: active.turnId };
  client.notify("turn/plan/updated", { ...base, plan: [{ step: "Đọc tư liệu", status: "completed" }, { step: "Dựng bản xem thử", status: "inProgress" }] });
  client.notify("item/started", { ...base, item: { id: "live-command", type: "commandExecution", command: "node --version", status: "inProgress" } });
  client.notify("item/commandExecution/outputDelta", { ...base, itemId: "live-command", delta: "v24.18.1\n" });
  client.notify("thread/tokenUsage/updated", { ...base, tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 4200 }, modelContextWindow: 128000 } });
  await text("#chat-history", "v24.18.1");
  assert.equal(await page.evaluate("!!document.querySelector('#chat-context-info')"), false, "usage stays out of the conversation surface");
  await settings(); await page.evaluate("[...document.querySelectorAll('#chat-popover button')].find(button=>button.textContent==='Mức sử dụng').click()"); await text("#chat-context-info", "3%");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  client.complete(active.threadId, "Mở đầu bằng một chiếc lá trong nắng sớm. **Ánh sáng trở thành năng lượng.**\n\n> Giữ nhịp chậm để người xem theo kịp.\n\n| Cảnh | Nội dung |\n| --- | --- |\n| 01 | Chiếc lá đón ánh nắng |\n| 02 | Nước và khí CO₂ đi vào lá |\n\n- [x] Đọc tư liệu\n  - Ghi lại các điểm chính\n- [ ] Dựng bản xem thử\n\nBạn muốn thay đổi điều gì ở đoạn mở đầu?"); await idle();
  assert.equal(await page.evaluate("[...document.querySelectorAll('.chat-message-tool summary')].some(element => element.textContent.startsWith('Đang chạy'))"), false, "finished turns do not leave stale running indicators");
  assert.equal(await page.evaluate("document.querySelectorAll('.chat-table th').length"), 2); assert.equal(await page.evaluate("!!document.querySelector('.chat-prose blockquote')"), true);
  await click("#chat-history-button"); await fill("#chat-history-search", "");
  await page.waitFor("document.querySelectorAll('#chat-native-results [data-thread-id]').length >= 4");
  assert.equal(await page.evaluate("(()=>{const ids=[...document.querySelectorAll('#chat-native-results [data-thread-id]')].map(x=>x.dataset.threadId).filter(Boolean);return ids.length===new Set(ids).size})()"), true, "linked Codex threads appear once in history");
  await click("#chat-history-button");
  const screenshotIds = ["chat-model-button", "chat-mode-button", "chat-more", "chat-add", "chat-history-button"];
  for (const theme of ["light", "dark"]) {
    await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    for (const width of [320, 390, 768, 1440]) {
      await page.viewport(width, 900); await page.screenshot(join(shots, `conversation-${theme}-${width}.png`));
      assert.equal(await page.evaluate("document.querySelector('#chat').scrollWidth <= document.querySelector('#chat').clientWidth + 1"), true, `no panel overflow ${theme} ${width}`);
      for (const id of screenshotIds) {
        await click("#" + id); await page.screenshot(join(shots, `${id}-${theme}-${width}.png`));
        const selector = id === "chat-history-button" ? ".chat-menu" : "#chat-popover";
        assert.equal(await page.evaluate(`(() => {const r=document.querySelector('${selector}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()`), true, `${id} fits ${width}`);
        if (["chat-model-button", "chat-mode-button", "chat-add"].includes(id)) assert.equal(await page.evaluate("document.querySelector('#chat-popover').getBoundingClientRect().bottom <= document.querySelector('#chat-composer').getBoundingClientRect().top - 6"), true, `${id} opens above the prompt at ${width}px`);
        await click("#" + id);
      }
      await settings(); await page.screenshot(join(shots, `chat-settings-${theme}-${width}.png`));
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    }
  }
  assert.deepEqual(await readdir(join(cwd, ".padstudio")), ["chat"]);
  assert.deepEqual(page.errors, []); assert.deepEqual(page.consoleErrors, []);
  assert.equal(page.failed.some((entry) => /\/api\/chat\//.test(entry)), false, page.failed.join("\n"));
  console.log("Chat features UI: passed (native options, image/file uploads, references/skills, reload, rename, edit/retry branches, export, archive, native CLI history, slash commands, streaming, Markdown and menus at 320/390/768/1440 px in both themes)");
} catch (error) {
  await page.screenshot(join(shots, "failure.png")).catch(() => {}); console.error("Browser errors:", page.errors); throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise((done) => server.close(done)); await chat.close();
  if (!resolve(cwd).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))) throw new Error("Unsafe cleanup target");
  await rm(cwd, { recursive: true, force: true });
}
