// Browser acceptance for the Tools page, against a throwaway project store, a throwaway padstudio.local.json and a
// fake ElevenLabs: the sheet opens from the top bar and from /?panel=tools (optionally &tab=voice), shows the real tools
// of this machine on its Tổng quan tab, saves an ElevenLabs key, picks a model and a voice (by search and by voice id) on
// the Giọng đọc tab and declares services on the Dịch vụ của bạn tab, never shows the key again and never touches a project.
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
const { ElevenLabsClient } = await import("../src/tools/elevenlabs-client.js");

// A small ElevenLabs account answering read-only routes only, so this run can never spend a credit or use the network.
const VOICES = [
  { voice_id: "v_minh_anh", name: "Minh Anh", category: "professional", description: "Giọng nữ rõ ràng, hợp video giải thích.", labels: { gender: "female", accent: "northern" }, preview_url: "https://storage.googleapis.com/eleven-public-prod/test/minh-anh.mp3" },
  { voice_id: "v_quang", name: "Quang", category: "premade", description: "Giọng nam trầm.", labels: { gender: "male" } },
  { voice_id: "v_ha_my", name: "Hà My", category: "cloned" },
  { voice_id: "v_costly", name: "Costly", category: "professional", sharing: { rate: 0.2 } }
];
const MODELS = [
  { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true, languages: [{ language_id: "en" }], model_rates: { character_cost_multiplier: 1 } },
  { model_id: "eleven_v3", name: "Eleven v3", can_do_text_to_speech: true, languages: [{ language_id: "vi" }, { language_id: "en" }], model_rates: { character_cost_multiplier: 1 }, maximum_text_length_per_request: 5000 }
];
const providerRequests = [];
async function fakeFetch(url, options) {
  const parsed = new URL(url);
  providerRequests.push(`${options.method ?? "GET"} ${parsed.pathname}`);
  const reply = (value, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => value });
  if (parsed.pathname === "/v2/voices") {
    const search = parsed.searchParams.get("search")?.toLowerCase();
    const rows = VOICES.filter((voice) => !search || voice.name.toLowerCase().includes(search));
    const start = Number(parsed.searchParams.get("next_page_token") ?? 0);
    const more = start + 2 < rows.length;
    return reply({ voices: rows.slice(start, start + 2), has_more: more, next_page_token: more ? String(start + 2) : null, total_count: rows.length });
  }
  if (parsed.pathname === "/v1/models") return reply(MODELS);
  const single = parsed.pathname.match(/^\/v1\/voices\/(.+)$/);
  const voice = single && VOICES.find((entry) => entry.voice_id === single[1]);
  if (single) return voice ? reply(voice) : reply({ detail: "not found" }, 404);
  return reply({ detail: "unexpected" }, 500);
}

const KEY = "sk_ui_acceptance_key_4d2e";
const expect = (condition, message) => { if (!condition) throw new Error(message); };
await new ProjectStore(rootDir).createProject({ projectId: "tools-demo", title: "Thử trang công cụ" });
const projectFiles = async () => (await readdir(join(rootDir, "tools-demo"), { recursive: true })).sort().join("\n");
const before = await projectFiles();
const settings = createSettingsService({
  configPath, createClient: (apiKey) => new ElevenLabsClient({ apiKey, fetchImpl: fakeFetch })
});
const server = createPadStudioServer({ reader: new ProjectReader(rootDir), settings });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const { page, close } = await launchBrowser();

const chipText = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
const openTab = async (id) => {
  await page.evaluate(`document.querySelector('#tools-tab-${id}').click()`);
  await page.waitFor(`document.querySelector('#tools-tab-${id}').getAttribute('aria-selected') === 'true' && !document.querySelector('#tools-panel-${id}').hidden`, { label: `${id} tab opens` });
};
const settled = () => page.waitFor("document.getAnimations().every((animation) => animation.playState !== 'running')", { label: "animations settle" });
const storedElevenLabs = async () => JSON.parse(await readFile(configPath, "utf8")).elevenLabs;
const card = (id) => `document.querySelector('#tools .voice-card[data-voice="${id}"]')`;
const LIST_CARDS = "document.querySelectorAll('#tools .voice-list:not(.voice-found) .voice-card')";

try {
  if (shots) await mkdir(shots, { recursive: true });
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]]) {
    await page.viewport(width, height, { mobile });
    await page.goto(`${origin}/?project=tools-demo`);
    await page.waitFor("!document.querySelector('#project').hidden", { label: "project opens" });
    await page.evaluate("document.querySelector('#tools-button').focus(); document.querySelector('#tools-button').click()");
    await page.waitFor("!document.querySelector('#tools').hidden && document.querySelector('#tools .tool-pill, #tools .tool-card')", { timeout: 60_000, label: "tools listed" });
    const state = await page.evaluate(`(() => ({
      url: location.search, inert: document.querySelector('#main').hasAttribute('inert'),
      tabs: document.querySelectorAll('#tools .tools-tabs .tab').length,
      active: document.querySelector('#tools .tab.is-active')?.dataset.tab,
      attention: document.querySelectorAll('#tools-panel-overview .tool-card').length,
      ready: document.querySelectorAll('#tools-panel-overview .tool-pill').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      sheetOverflow: document.querySelector('#tools .tools-body').scrollWidth - document.querySelector('#tools .tools-body').clientWidth,
      password: document.querySelector('#elevenlabs-key')?.type
    }))()`);
    expect(state.url.includes("panel=tools") && !state.url.includes("tab=") && state.inert && state.tabs === 3 && state.active === "overview" && state.ready >= 8
      && state.attention >= 1 && state.overflow <= 1 && state.sheetOverflow <= 1 && state.password === "password",
      `${width}: tools sheet is not usable (${JSON.stringify(state)})`);
    await settled();
    if (shots) await page.screenshot(`${shots}/tools-${width}.png`);
    for (const id of ["voice", "services"]) {
      await openTab(id);
      expect(await page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 1, `${width}/${id}: the page scrolls sideways`);
      expect(await page.evaluate("document.querySelector('#tools-body').scrollWidth - document.querySelector('#tools-body').clientWidth") <= 1, `${width}/${id}: the sheet scrolls sideways`);
      expect(await page.evaluate("new URL(location.href).searchParams.get('tab')") === id, `${width}: the tab is not kept in the link`);
      await settled();
      if (shots) await page.screenshot(`${shots}/tools-${width}-${id}.png`);
    }
    await openTab("overview");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.waitFor("document.querySelector('#tools').hidden && !location.search.includes('panel=tools')", { label: "Escape closes and clears the link" });
    expect(await page.evaluate("document.activeElement?.id === 'tools-button'"), `${width}: focus did not return to the Tools button`);
  }

  // The link the Agent sends opens the sheet directly, on the tab it names; the overview card leads to the key.
  await page.goto(`${origin}/?panel=tools`);
  await page.waitFor("!document.querySelector('#tools').hidden && document.querySelector('#tools-panel-overview .tool-card')", { timeout: 60_000, label: "deep link opens the tools" });
  expect((await chipText("#tools-panel-overview [data-tool=elevenlabs] .chip")).includes("Cần khóa API"), "ElevenLabs should ask for a key first");
  await page.evaluate("document.querySelector('#tools-panel-overview [data-tool=elevenlabs] [data-control=goto-voice]').click()");
  await page.waitFor("document.querySelector('#tools-tab-voice').getAttribute('aria-selected') === 'true' && document.activeElement?.id === 'elevenlabs-key'", { label: "the card leads to the key field" });
  await page.goto(`${origin}/?panel=tools&tab=voice`);
  await page.waitFor("!document.querySelector('#tools').hidden && document.querySelector('#tools-tab-voice').getAttribute('aria-selected') === 'true' && document.querySelector('#elevenlabs-key')", { timeout: 60_000, label: "the tab named in the link opens" });
  expect(!await page.evaluate("document.querySelector('#tools #elevenlabs-model')"), "the model and voice steps must wait for a key");
  await page.evaluate(`(() => { const input = document.querySelector('#elevenlabs-key'); input.value = ${JSON.stringify(KEY)};
    input.closest('form').requestSubmit(); })()`);
  expect(providerRequests.length === 0, "nothing should be requested from ElevenLabs before a key is saved");
  await page.waitFor("document.querySelector('#tools-panel-voice .key-block .form-message')?.textContent.includes('Đã lưu khóa')", { timeout: 60_000, label: "key saved" });
  await page.waitFor("document.querySelector('#tools-panel-voice [data-tool=elevenlabs] .chip')?.textContent.includes('Sẵn sàng')", { timeout: 60_000, label: "ElevenLabs becomes available" });
  expect(!(await page.evaluate("document.documentElement.outerHTML")).includes(KEY), "the page shows the saved key");
  expect((await chipText("#tools-panel-voice .key-state")).includes("…4d2e"), "the saved key hint is missing");

  // Pick a model, then a voice by search, then a voice used before by its id.
  await page.waitFor(`${LIST_CARDS}.length === 2 && document.querySelector('#elevenlabs-model').options.length >= 3`, { timeout: 30_000, label: "voices and models load" });
  const listing = await page.evaluate(`(() => ({
    options: [...document.querySelector('#elevenlabs-model').options].map((option) => [option.value, option.disabled]),
    play: [...document.querySelectorAll('#tools .voice-card')].map((voiceCard) => [voiceCard.dataset.voice, voiceCard.querySelector('.voice-play').disabled]),
    more: !document.querySelector('[data-control=voice-more]').hidden
  }))()`);
  expect(JSON.stringify(listing.options) === JSON.stringify([["", false], ["eleven_v3", false], ["eleven_multilingual_v2", true]]), `model list is wrong: ${JSON.stringify(listing.options)}`);
  expect(JSON.stringify(listing.play) === JSON.stringify([["v_minh_anh", false], ["v_quang", true]]) && listing.more, `voice list is wrong: ${JSON.stringify(listing)}`);
  // Choosing something rebuilds the sheet; the reader must stay where they were.
  await page.evaluate("(() => { const body = document.querySelector('#tools-body'); body.scrollTop = 40; window.__before = body.scrollTop; window.__scrollable = body.scrollHeight > body.clientHeight + 40; })()");
  await page.evaluate("(() => { const select = document.querySelector('#elevenlabs-model'); select.focus(); select.value = 'eleven_v3'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.waitFor("document.querySelector('#tools .voice-flash')?.textContent.includes('model mặc định')", { label: "model saved" });
  const kept = await page.evaluate("({ before: window.__before, scrollable: window.__scrollable, after: document.querySelector('#tools-body').scrollTop, focus: document.activeElement?.id })");
  expect(!kept.scrollable || (kept.before > 0 && Math.abs(kept.after - kept.before) <= 2), `the sheet lost its scroll position after saving: ${JSON.stringify(kept)}`);
  expect(kept.focus === "elevenlabs-model", `focus was lost after saving: ${JSON.stringify(kept)}`);
  expect((await storedElevenLabs()).modelId === "eleven_v3", "the model was not saved");

  await page.evaluate("document.querySelector('[data-control=voice-more]').click()");
  await page.waitFor(`${LIST_CARDS}.length === 4`, { label: "more voices" });
  expect(await page.evaluate(`!${card("v_costly")}.querySelector('[data-control=use-voice]').disabled && ${card("v_costly")}.textContent.includes('mức tối thiểu')`),
    "a voice with a custom rate must stay choosable and say its estimate is only a minimum");
  await page.evaluate("(() => { const input = document.querySelector('[data-control=voice-search]'); input.value = 'quang'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await page.waitFor(`(() => { const cards = ${LIST_CARDS}; return cards.length === 1 && cards[0].dataset.voice === 'v_quang'; })()`, { label: "search narrows the list" });
  if (shots) {
    await page.media([{ name: "prefers-color-scheme", value: "light" }]);
    await page.evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#elevenlabs-model').scrollIntoView({ block: 'start' })");
    await settled();
    await page.screenshot(`${shots}/tools-voices-light.png`);
  }
  await page.evaluate(`${card("v_quang")}.querySelector('[data-control=use-voice]').click()`);
  await page.waitFor("document.querySelector('#tools .voice-summary-name')?.textContent.includes('Quang') && document.querySelector('#tools .voice-card.is-current')", { label: "voice chosen from search" });
  let chosen = await storedElevenLabs();
  expect(chosen.voiceId === "v_quang" && chosen.voiceName === "Quang" && chosen.modelId === "eleven_v3" && chosen.apiKey === KEY,
    `the default voice was not saved: ${JSON.stringify({ ...chosen, apiKey: "…" })}`);

  await page.evaluate("(() => { document.querySelector('[data-control=voice-id]').value = 'v_gone'; document.querySelector('.voice-lookup').requestSubmit(); })()");
  await page.waitFor("document.querySelector('.voice-lookup .form-message')?.textContent.includes('My Voices')", { label: "an unknown voice id is explained" });
  await page.evaluate("(() => { document.querySelector('[data-control=voice-id]').value = ' v_minh_anh '; document.querySelector('.voice-lookup').requestSubmit(); })()");
  await page.waitFor("document.querySelector('.voice-found .voice-card[data-voice=v_minh_anh]')", { label: "voice found by id" });
  await page.evaluate("document.querySelector('.voice-found .voice-card [data-control=use-voice]').click()");
  await page.waitFor("document.querySelector('#tools .voice-summary-name')?.textContent.includes('Minh Anh')", { label: "voice chosen by id" });
  chosen = await storedElevenLabs();
  expect(chosen.voiceId === "v_minh_anh" && chosen.voiceName === "Minh Anh", "the voice found by id was not saved");
  expect(providerRequests.every((request) => request.startsWith("GET ")), "the pickers must only read from ElevenLabs");
  if (shots) {
    await page.viewport(390, 900, { mobile: true });
    await page.evaluate("document.querySelector('#elevenlabs-model').scrollIntoView({ block: 'start' })");
    await settled();
    await page.screenshot(`${shots}/tools-voices-mobile.png`);
    expect(await page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 1, "the voice picker scrolls sideways on a phone");
    await page.viewport(1440, 900);
  }

  // Declare outside services.
  await openTab("services");
  await page.evaluate(`(() => {
    for (const box of document.querySelectorAll('#tools input[name=service]')) box.checked = ['image-generation', 'music-generation'].includes(box.value);
    document.querySelector('#services-note').value = 'ChatGPT Plus, Suno';
    document.querySelector('#tools-panel-services .services-form').requestSubmit();
  })()`);
  await page.waitFor("document.querySelector('#tools-panel-services .form-message')?.textContent.includes('Đã lưu')", { label: "services saved" });

  const stored = JSON.parse(await readFile(configPath, "utf8"));
  expect(stored.elevenLabs?.apiKey === KEY, "the key did not reach padstudio.local.json");
  expect(JSON.stringify(stored.services) === JSON.stringify({ available: ["image-generation", "music-generation"], note: "ChatGPT Plus, Suno" }), "services were not saved");
  expect(stored.piper?.pythonCommand === "python", "a runtime path was changed");
  expect(await projectFiles() === before, "the Tools page changed a project");
  const writes = page.writes.filter((entry) => !/\/api\/settings(\/elevenlabs\/(check|models|voices|voice))?$/.test(entry.split(" ")[1]));
  expect(writes.length === 0, `unexpected write requests: ${writes.join(", ")}`);
  expect(page.errors.length === 0 && page.consoleErrors.length === 0, `page errors: ${[...page.errors, ...page.consoleErrors].join(" | ")}`);
  // The one expected failure is the lookup of a voice id that is not in the account.
  const unexpected = page.failed.filter((entry) => !/^404 .*\/api\/settings\/elevenlabs\/voice$/.test(entry));
  expect(unexpected.length === 0, `failed requests: ${unexpected.join(", ")}`);
  console.log("Tools page: passed (top bar and deep link, 390/1440 px, key saved and masked, model and voice picked by search and by id, services saved, projects untouched)");
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
