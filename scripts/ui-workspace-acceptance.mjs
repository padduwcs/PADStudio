// Real browser/server/store and a deterministic Codex peer. No model or paid provider calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ProjectStore } from "../src/project/project-store.js";
import { archiveProject } from "../src/project/project-archive.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { ChatService } from "../src/chat/chat-service.js";
import { createPadStudioServer } from "../src/web/server.js";
import { launchBrowser } from "./lib/browser.mjs";
import { FixtureCodex } from "./lib/chat-fixture.mjs";

const workspace = await mkdtemp(join(tmpdir(), "padstudio-workspace-ui-"));
const shots = resolve(".cache/workspace-ui"); await mkdir(shots, { recursive: true });
const store = new ProjectStore(join(workspace, "projects"));
// A title equal to a UI translation key must still be left untouched.
await store.createProject({ projectId: "alpha", title: "Tư liệu" });
await store.createProject({ projectId: "beta", title: "A second film" });
const client = new FixtureCodex();
const chat = new ChatService({ cwd: join(workspace, "PADStudio"), client });
const server = createPadStudioServer({ reader: new ProjectReader(join(workspace, "projects")), chat });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(); const { page } = browser;
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (text) => page.evaluate(`(() => {const input=document.querySelector('#chat-input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const home = () => page.evaluate("!document.querySelector('#welcome').hidden && document.querySelector('#project').hidden && !new URL(location.href).searchParams.has('project')");
const turns = () => client.calls.filter((call) => call.method === "turn/start");
async function language(value) {
  await page.evaluate(`(() => {const select=document.querySelector('#language-select');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await page.waitFor(`document.documentElement.lang === '${value}' && document.querySelector('#language-select').value === '${value}'`);
}
async function send(text) {
  await input(text); await page.waitFor("!document.querySelector('#chat-send').disabled");
  await page.evaluate("document.querySelector('#chat-composer').requestSubmit()");
  await page.waitFor("document.querySelector('#chat-input').value === '' && !document.querySelector('#chat-stop').hidden");
}
async function choose(id) {
  await click("#library-button"); await page.waitFor(`document.querySelector('#library [data-project-id="${id}"]')`);
  await click(`#library [data-project-id="${id}"]`);
  await page.waitFor(`new URL(location.href).searchParams.get('project') === '${id}' && !document.querySelector('#project').hidden`);
}
async function geometry(label) {
  const result = await page.evaluate(`(() => {
    const r=element=>element.getBoundingClientRect(),header=r(document.querySelector('#topbar'));
    const controls=[...document.querySelectorAll('.brand,.topbar button,.topbar select')].map(r);
    const tagline=document.querySelector('.brand-tagline');
    return {overflow:document.documentElement.scrollWidth-innerWidth,
      contained:controls.every(x=>x.left>=0&&x.right<=innerWidth&&x.top>=header.top&&x.bottom<=header.bottom),
      overlap:controls.some((a,i)=>controls.some((b,j)=>j>i&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)),
      targets:controls.slice(1).every(x=>x.width>=40&&x.height>=40),tagline:tagline.scrollWidth<=tagline.clientWidth+1,
      labels:[...document.querySelectorAll('.topbar .button-label')].every(e=>r(e).width>0)};
  })()`);
  assert.ok(result.overflow<=1 && result.contained && !result.overlap && result.targets && result.tagline && result.labels, `${label}: ${JSON.stringify(result)}`);
}

try {
  await page.goto(origin); await page.waitFor("!document.querySelector('#welcome').hidden");
  assert.equal(await home(), true);
  assert.equal(client.calls.length, 0, "home never launches the agent");
  await page.evaluate("localStorage.setItem('padstudio-project','alpha')");
  await page.goto(origin); await page.waitFor("document.querySelector('#library-count').textContent === '2'");
  assert.equal(await home(), true, "legacy last-project preference does not bypass home");
  await click("#welcome-projects"); await page.waitFor("!document.querySelector('#library').hidden");
  await click("[data-library-close]"); assert.equal(await home(), true);
  await click("#welcome-chat"); await page.waitFor("document.querySelector('#chat-status').textContent === 'Sẵn sàng'");
  const firstId = (await chat.read()).conversationId;
  const firstPrompt = "Tạo một dự án mới cho video về lá cây.";
  await send(firstPrompt);
  const firstThread = turns().at(-1).params.threadId;
  await click("#chat-new-conversation");
  await page.waitFor("document.querySelectorAll('#chat .chat-message').length === 0");
  const secondPrompt = "Quản lý một dự án video khác trong cuộc trò chuyện này.";
  await send(secondPrompt);
  const secondId = (await chat.read()).conversationId;
  const secondThread = turns().at(-1).params.threadId;
  assert.equal((await chat.read()).conversations.filter((entry) => entry.active).length, 2);
  // Simulate projects written by independent agent work through the real ProjectStore.
  await store.createProject({ projectId: "created-a", title: "Lá cây" });
  await store.createProject({ projectId: "created-b", title: "Một video khác" });
  await page.waitFor("document.querySelector('#library-count').textContent === '4'");
  assert.equal(await home(), true, "new projects from concurrent chats do not select a viewer project");
  const draft = "Bản nháp tiếng Việt chưa gửi {0} <b>giữ nguyên</b>";
  await input(draft);
  await language("en");
  await page.waitFor("document.querySelectorAll('#chat-tabs [role=tab]').length === 2 && document.querySelector('#chat-input').value !== ''");
  assert.equal(await home(), true);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), draft);
  assert.equal(await page.evaluate("document.querySelector('#chat-input').placeholder"), "Message Codex…");
  assert.equal((await chat.read()).conversations.filter((entry) => entry.active).length, 2, "switching UI language leaves active turns running");
  assert.equal(turns().length, 2, "language switch does not replay prompts");
  client.complete(firstThread, "Đã tạo dự án đầu tiên."); client.complete(secondThread, "Đã tạo dự án thứ hai.");
  await page.waitFor("document.querySelector('#chat-history').textContent.includes('Đã tạo dự án thứ hai.')");
  assert.equal(await page.evaluate("document.querySelector('#chat-history').textContent.includes('Quản lý một dự án video khác')"), true, "the transcript stays in its original language");
  assert.deepEqual(turns().map((call) => call.params.input[0].text), [firstPrompt, secondPrompt]);
  assert.equal(turns().some((call) => JSON.stringify(call.params).includes('language')), false, "UI locale is never injected into Codex params");
  await send("Tư liệu");
  client.ask(secondThread, "item/tool/requestUserInput", { questions: [{ id: "choice", header: "Lựa chọn", question: "Chọn một câu trả lời", options: [{ label: "Tư liệu", description: "Nội dung của agent" }, { label: "Khác", description: "Giữ nguyên lời gốc" }] }] });
  await page.waitFor("document.querySelector('#chat-requests select')");
  assert.equal(await page.evaluate("document.querySelector('#chat-requests select option:nth-child(2)').textContent"), "Tư liệu");
  await page.evaluate("document.querySelector('#chat-requests select').value='Tư liệu'; document.querySelector('#chat-requests form').requestSubmit()");
  await page.waitFor("document.querySelector('#chat-requests').childElementCount === 0");
  assert.deepEqual(client.responses.at(-1).result.answers.choice.answers, ["Tư liệu"], "native answers are not translated");
  assert.equal(turns().at(-1).params.input[0].text, "Tư liệu", "a prompt matching a UI label is still sent verbatim");
  client.complete(secondThread, "Câu trả lời được giữ nguyên."); await input(draft);
  await choose("alpha");
  await page.waitFor("document.querySelector('#project-title').textContent === 'Tư liệu' && document.querySelector('#project-meta .chip')");
  assert.equal(await page.evaluate("document.querySelector('#tab-sources').textContent"), "Sources");
  assert.equal(await page.evaluate("document.querySelector('#project-meta .chip').textContent"), "No video yet");
  assert.equal((await chat.read()).conversationId, secondId);
  await store.createProject({ projectId: "created-c", title: "Newest project" });
  await page.waitFor("document.querySelector('#library-count').textContent === '5'");
  assert.equal(await page.evaluate("new URL(location.href).searchParams.get('project')"), "alpha");
  await language("vi");
  await page.waitFor("document.querySelector('#project-title').textContent === 'Tư liệu' && !document.querySelector('#project').hidden");
  assert.equal((await chat.read()).conversationId, secondId);
  await click(".brand"); assert.equal(await home(), true);
  assert.equal(await page.evaluate("document.querySelector('#chat').hidden"), false, "returning home keeps chat open");
  assert.equal(await page.evaluate("document.querySelector('#chat-input').value"), draft);
  await page.goto(origin+"/?project=missing");
  await page.waitFor("!new URL(location.href).searchParams.has('project')"); assert.equal(await home(), true);

  // Both languages, both themes, and the desktop/mobile boundary. Language controls remain usable on home.
  for (const locale of ["vi", "en"]) {
    await page.goto(origin); await page.waitFor("!document.querySelector('#welcome').hidden");
    if (await page.evaluate("document.documentElement.lang") !== locale) await language(locale);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await page.waitFor("document.getAnimations().every(animation=>animation.playState!=='running')");
      for (const width of [320,390,768,900,901,1024,1440,1920]) {
        await page.viewport(width, 900, { mobile: width < 600 });
        await geometry(`${locale}/${theme}/${width}`);
        if ([320,390,901,1440].includes(width)) await page.screenshot(join(shots, `home-${locale}-${theme}-${width}.png`));
      }
    }
    await click("#tools-button");
    await page.waitFor("document.querySelector('#tools .tools-summary')");
    if (locale === "en") {
      assert.equal(await page.evaluate("document.querySelector('#tools-tab-overview').textContent"), "Overview");
      assert.equal(await page.evaluate("/[\\u0300-\\u036f\\u0111\\u0110]/u.test([...document.querySelectorAll('.tool-summary,.tool-setup,.ready-label')].map(e=>e.textContent).join('').normalize('NFD'))"), false, "application tool descriptions are translated");
      await click("#tools-tab-services");
      assert.equal(await page.evaluate("document.querySelector('.service-name').textContent"), "AI image generation");
    }
    await click("[data-tools-close]");
    await page.viewport(1440,900); await click("#welcome-chat");
    await page.waitFor("document.querySelectorAll('#chat-tabs [role=tab]').length === 2");
    await click("#chat-more");
    await page.screenshot(join(shots, `chat-${locale}-desktop.png`));
    if (locale === "en") assert.ok(await page.evaluate("document.querySelector('#chat-popover').textContent.includes('Rename')"));
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.viewport(390,844,{mobile:true}); await page.screenshot(join(shots, `chat-${locale}-mobile.png`));
    await click("#chat button[aria-label='"+(locale === "en" ? "Close chat" : "Đóng trò chuyện")+"']");
  }
  await page.goto(origin+"/?project=alpha");
  await page.waitFor("!document.querySelector('#project').hidden");
  assert.equal(await page.evaluate("document.documentElement.lang"), "en", "language persists when opening a new URL");
  await archiveProject({ activeRoot: join(workspace, "projects"), archiveRoot: join(workspace, "archive"), projectId: "alpha", reason: "UI fixture", confirmedStopped: true });
  await page.waitFor("!new URL(location.href).searchParams.has('project')");
  assert.equal(await home(), true, "an unavailable project returns home instead of switching projects");
  assert.ok((await chat.read()).conversations.some((entry) => entry.id === firstId));
  assert.equal(turns().length, 3);
  assert.deepEqual(page.errors, []); assert.deepEqual(page.consoleErrors, []);
  console.log("Workspace UI: passed (explicit project selection, home with existing/new/archived projects, two independent active chats, original prompts/transcripts/titles/drafts, VI/EN persistence, responsive 320–1920 px, both themes, tools and chat)");
} catch (error) {
  await page.screenshot(join(shots, "failure.png")).catch(() => {});
  console.error("Browser errors:", page.errors, page.consoleErrors);
  throw error;
} finally {
  await browser.close(); await chat.close(); server.closeAllConnections(); await new Promise((done) => server.close(done));
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-workspace-ui-")) throw new Error("Unsafe fixture cleanup");
  await rm(target, { recursive: true, force: true });
}
