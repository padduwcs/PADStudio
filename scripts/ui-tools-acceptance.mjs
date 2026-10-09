// Browser acceptance for the Tools page, against a throwaway project store and a throwaway padstudio.local.json:
// the sheet opens from the top bar and from /?panel=tools, lists the real tools of this machine, saves an
// ElevenLabs key and declared services through the page, never shows the key again and never touches a project.
//
//   node scripts/ui-tools-acceptance.mjs [--shots <dir>]
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchBrowser } from "./lib/browser.mjs";

const shotsIndex = process.argv.indexOf("--shots");
const shots = shotsIndex > 0 ? resolve(process.argv[shotsIndex + 1]) : null;
const workspace = await mkdtemp(join(tmpdir(), "padstudio-ui-tools-"));
const rootDir = join(workspace, "projects");
const configPath = join(workspace, "padstudio.local.json");
await mkdir(rootDir);
await writeFile(configPath, JSON.stringify({ piper: { pythonCommand: "python" } }, null, 2));
// The tool registry reads the same file as the settings page, so a saved key changes the ElevenLabs status.
process.env.PADSTUDIO_LOCAL_CONFIG = configPath;

const { ProjectStore } = await import("../src/project/project-store.js");
const { ProjectReader } = await import("../src/web/project-reader.js");
const { createPadStudioServer } = await import("../src/web/server.js");
const { createSettingsService } = await import("../src/web/settings-service.js");

const KEY = "sk_ui_acceptance_key_4d2e";
const expect = (condition, message) => { if (!condition) throw new Error(message); };
await new ProjectStore(rootDir).createProject({ projectId: "tools-demo", title: "Thử trang công cụ" });
const projectFiles = async () => (await readdir(join(rootDir, "tools-demo"), { recursive: true })).sort().join("\n");
const before = await projectFiles();
const server = createPadStudioServer({ reader: new ProjectReader(rootDir), settings: createSettingsService({ configPath }) });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const { page, close } = await launchBrowser();

async function itemStatus(id) {
  return page.evaluate(`document.querySelector('#tools [data-tool="${id}"] .chip')?.textContent ?? ''`);
}

try {
  if (shots) await mkdir(shots, { recursive: true });
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]]) {
    await page.viewport(width, height, { mobile });
    await page.goto(`${origin}/?project=tools-demo`);
    await page.waitFor("!document.querySelector('#project').hidden", { label: "project opens" });
    await page.evaluate("document.querySelector('#tools-button').focus(); document.querySelector('#tools-button').click()");
    await page.waitFor("!document.querySelector('#tools').hidden && document.querySelector('#tools .tool-item')", { timeout: 60_000, label: "tools listed" });
    const state = await page.evaluate(`(() => ({
      url: location.search, inert: document.querySelector('#main').hasAttribute('inert'),
      groups: document.querySelectorAll('#tools .tools-group').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      sheetOverflow: document.querySelector('#tools .tools-body').scrollWidth - document.querySelector('#tools .tools-body').clientWidth,
      password: document.querySelector('#elevenlabs-key')?.type
    }))()`);
    expect(state.url.includes("panel=tools") && state.inert && state.groups >= 5 && state.overflow <= 1 && state.sheetOverflow <= 1 && state.password === "password",
      `${width}: tools sheet is not usable (${JSON.stringify(state)})`);
    await page.waitFor("document.getAnimations().every((animation) => animation.playState !== 'running')", { label: "sheet animation settles" });
    if (shots) await page.screenshot(`${shots}/tools-${width}.png`);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.waitFor("document.querySelector('#tools').hidden && !location.search.includes('panel=tools')", { label: "Escape closes and clears the link" });
    expect(await page.evaluate("document.activeElement?.id === 'tools-button'"), `${width}: focus did not return to the Tools button`);
  }

  // The link the Agent sends opens the sheet directly; save a key through the form.
  await page.goto(`${origin}/?panel=tools`);
  await page.waitFor("!document.querySelector('#tools').hidden && document.querySelector('#elevenlabs-key')", { timeout: 60_000, label: "deep link opens the tools" });
  expect((await itemStatus("elevenlabs")).includes("Cần khóa API"), "ElevenLabs should ask for a key first");
  await page.evaluate(`(() => { const input = document.querySelector('#elevenlabs-key'); input.value = ${JSON.stringify(KEY)};
    input.closest('form').requestSubmit(); })()`);
  await page.waitFor("document.querySelector('#tools [data-tool=elevenlabs] .form-message')?.textContent.includes('Đã lưu khóa')", { timeout: 60_000, label: "key saved" });
  await page.waitFor("document.querySelector('#tools [data-tool=elevenlabs] .chip')?.textContent.includes('Sẵn sàng')", { timeout: 60_000, label: "ElevenLabs becomes available" });
  expect(!(await page.evaluate("document.documentElement.outerHTML")).includes(KEY), "the page shows the saved key");
  expect((await page.evaluate("document.querySelector('#tools [data-tool=elevenlabs] .key-saved')?.textContent ?? ''")).includes("…4d2e"), "the saved key hint is missing");

  // Declare outside services.
  await page.evaluate(`(() => {
    for (const box of document.querySelectorAll('#tools input[name=service]')) box.checked = ['image-generation', 'music-generation'].includes(box.value);
    document.querySelector('#services-note').value = 'ChatGPT Plus, Suno';
    document.querySelector('#tools .services-form').requestSubmit();
  })()`);
  await page.waitFor("document.querySelector('#tools .tools-services .form-message')?.textContent.includes('Đã lưu')", { label: "services saved" });
  if (shots) {
    await page.media([{ name: "prefers-color-scheme", value: "light" }]);
    await page.evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#tools .tools-services').scrollIntoView({ block: 'start' })");
    await page.screenshot(`${shots}/tools-services-light-1440.png`);
  }

  const stored = JSON.parse(await readFile(configPath, "utf8"));
  expect(stored.elevenLabs?.apiKey === KEY, "the key did not reach padstudio.local.json");
  expect(JSON.stringify(stored.services) === JSON.stringify({ available: ["image-generation", "music-generation"], note: "ChatGPT Plus, Suno" }), "services were not saved");
  expect(stored.piper?.pythonCommand === "python", "a runtime path was changed");
  expect(await projectFiles() === before, "the Tools page changed a project");
  const writes = page.writes.filter((entry) => !/\/api\/settings(\/elevenlabs\/check)?$/.test(entry.split(" ")[1]));
  expect(writes.length === 0, `unexpected write requests: ${writes.join(", ")}`);
  expect(page.errors.length === 0 && page.consoleErrors.length === 0, `page errors: ${[...page.errors, ...page.consoleErrors].join(" | ")}`);
  console.log("Tools page: passed (top bar and deep link, 390/1440 px, key saved and masked, services saved, projects untouched)");
} finally {
  await close();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  const target = resolve(workspace);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("padstudio-ui-tools-")) {
    throw new Error("Refusing to remove a fixture outside its temporary directory.");
  }
  await rm(target, { recursive: true, force: true });
}
