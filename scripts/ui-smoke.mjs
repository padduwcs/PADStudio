// Browser smoke for the observer UI. Drives a real Chromium-family browser over CDP (scripts/lib/browser.mjs) and
// prints one JSON report. It never writes to a project: any non-GET request fails the run.
//
//   node scripts/ui-smoke.mjs --url http://127.0.0.1:7603 [--project <id>] [--empty] [--live] [--shots <dir>]
//
//   --empty   expect no project to be selectable (welcome screen), or an empty project when --project is given
//   --live    the server exposes POST /_fixture/advance (see ui-live-acceptance.mjs); walk the live-progress story
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "./lib/browser.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const VIEWPORTS = [[390, 844, true], [768, 1000, false], [1440, 900, false]];
const TABS = ["video", "sources"];

function parseArguments(args) {
  const options = { url: "http://127.0.0.1:7603", projectId: null, empty: false, live: false, shots: null, browser: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--url") options.url = args[++index];
    else if (flag === "--project") options.projectId = args[++index];
    else if (flag === "--shots") options.shots = args[++index];
    else if (flag === "--browser") options.browser = args[++index];
    else if (flag === "--empty") options.empty = true;
    else if (flag === "--live") options.live = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  options.url = options.url.replace(/\/$/, "");
  return options;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function open(page, options, { width, height, mobile = false, theme = "light" }) {
  await page.media([{ name: "prefers-color-scheme", value: theme }]);
  await page.viewport(width, height, { mobile });
  const query = options.projectId ? `?project=${encodeURIComponent(options.projectId)}` : "";
  await page.goto(`${options.url}/${query}`);
  await page.waitFor("!document.querySelector('#welcome').hidden || !document.querySelector('#project').hidden", { label: "first render" });
}

async function overflow(page) {
  return page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
}

async function checkShell(page, label) {
  const brand = await page.evaluate(`(() => {
    const name = document.querySelector('.brand-tagline');
    const box = name.getBoundingClientRect();
    return { text: name.textContent, visible: box.width > 0 && box.height > 0, clipped: name.scrollWidth > name.clientWidth + 1 };
  })()`);
  expect(brand.text === "Precise Animated Demonstration Studio" && brand.visible && !brand.clipped,
    `${label}: the full studio name must stay visible and unclipped`);
  expect(await overflow(page) <= 1, `${label}: page scrolls sideways`);
}

async function checkTabs(page, options, label, shots) {
  for (const view of TABS) {
    await page.evaluate(`document.querySelector('#tab-${view}').click()`);
    await page.waitFor(`document.querySelector('#tab-${view}').getAttribute('aria-selected') === 'true' && !document.querySelector('#view-${view}').hidden`, { label: `${label} ${view} tab` });
    await page.waitFor(`document.querySelector('#view-${view}').querySelector('.theatre, .theatre-empty, .theatre-skeleton, .sources, .empty-note') && !document.querySelector('#view-${view} .theatre-skeleton')`,
      { timeout: 20_000, label: `${label} ${view} content` });
    expect(await overflow(page) <= 1, `${label}/${view}: page scrolls sideways`);
    if (shots) await page.screenshot(`${shots}/${label}-${view}.png`);
  }
  await page.evaluate("document.querySelector('#tab-video').click()");
}

async function checkLibrary(page, label) {
  await page.evaluate("document.querySelector('#library-button').focus(); document.querySelector('#library-button').click()");
  await page.waitFor("!document.querySelector('#library').hidden", { label: `${label} library opens` });
  const state = await page.evaluate(`(() => ({
    cards: document.querySelectorAll('.project-card').length,
    inert: document.querySelector('#main').hasAttribute('inert'),
    focusInside: document.querySelector('#library').contains(document.activeElement),
    overflow: document.documentElement.scrollWidth - window.innerWidth
  }))()`);
  expect(state.cards >= 1 && state.inert && state.focusInside && state.overflow <= 1, `${label}: library is not usable (${JSON.stringify(state)})`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.waitFor("document.querySelector('#library').hidden", { label: `${label} library closes on Escape` });
  expect(await page.evaluate("document.activeElement?.id === 'library-button'"), `${label}: focus did not return to the library button`);
}

async function checkTheme(page) {
  const before = await page.evaluate("document.documentElement.dataset.theme");
  await page.evaluate("document.querySelector('#theme-toggle').click()");
  const after = await page.evaluate("document.documentElement.dataset.theme");
  expect(before && after && before !== after, "theme toggle did not switch");
  await page.evaluate("document.querySelector('#theme-toggle').click()");
}

async function checkOffline(page) {
  await page.offline(true);
  await page.waitFor("!document.querySelector('#app-error').hidden", { timeout: 15_000, label: "offline notice" });
  await page.offline(false);
  await page.evaluate("document.querySelector('#retry-button').click()");
  await page.waitFor("document.querySelector('#app-error').hidden", { timeout: 15_000, label: "recovery after reconnect" });
}

async function liveStory(page, options) {
  const advance = () => fetch(`${options.url}/_fixture/advance`, { method: "POST" }).then((response) => expect(response.ok, "fixture did not advance"));
  const selected = "document.querySelector('select[data-control=revision]')?.selectedOptions[0]?.textContent ?? ''";

  await page.waitFor("document.querySelector('#project-meta .chip-working') && document.querySelector('.theatre-empty, .stage.is-unavailable.is-working')", { label: "progress before the first preview" });
  await page.waitFor("document.querySelector('#project-meta .chip-working')?.textContent.includes('Đang dựng video')", { label: "working label" });

  await advance();
  await page.waitFor("(() => { const v = document.querySelector('video[data-ui=video]'); return v && v.readyState >= 2 && !document.querySelector('#project-meta .chip-working'); })()", { timeout: 15_000, label: "first preview appears" });
  await page.evaluate("(async () => { const v = document.querySelector('video[data-ui=video]'); window.__firstPlayer = v; v.muted = true; v.currentTime = 0.75; await v.play(); })()");

  await advance();
  await page.waitFor("document.querySelector('select[data-control=revision]')?.options.length === 2 && document.querySelector('#project-meta .chip-working')", { timeout: 15_000, label: "second revision starts" });
  expect(await page.evaluate("(() => { const v = document.querySelector('video[data-ui=video]'); const ok = v === window.__firstPlayer && !v.paused && v.currentTime > 0.75; v.pause(); return ok; })()"),
    "an unfinished revision interrupted the playing preview");
  expect((await page.evaluate(selected)).startsWith("Bản 1"), "viewer left Bản 1 before Bản 2 had a video");

  await advance();
  await page.waitFor(`(${selected}).startsWith('Bản 2') && !document.querySelector('#project-meta .chip-working')`, { timeout: 15_000, label: "completed replacement is followed automatically" });
  expect(await page.evaluate("document.querySelector('video[data-ui=video]').getAttribute('src') !== window.__firstPlayer.getAttribute('src')"), "replacement kept the old video");
  await page.evaluate("(() => { const s = document.querySelector('select[data-control=revision]'); s.value = s.options[0].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.waitFor(`(${selected}).startsWith('Bản 1')`, { label: "manual selection of Bản 1" });

  await advance();
  await page.waitFor("document.querySelector('select[data-control=revision]')?.options.length === 3", { timeout: 15_000, label: "third revision listed" });
  expect((await page.evaluate(selected)).startsWith("Bản 1")
    && await page.evaluate("document.querySelector('video[data-ui=video]').getAttribute('src') === window.__firstPlayer.getAttribute('src')"),
    "a new preview replaced the version the user chose");
}

export async function runSmoke(options) {
  const { page, close } = await launchBrowser({ browserPath: options.browser });
  const report = { status: "failed", url: options.url, projectId: options.projectId, views: 0 };
  try {
    if (options.shots) await mkdir(options.shots, { recursive: true });
    if (options.live) {
      await open(page, options, { width: 1440, height: 900 });
      try { await liveStory(page, options); } catch (error) {
        const screen = await page.evaluate("document.querySelector('#project').innerText.slice(0, 400)").catch(() => "");
        throw new Error(`${error.message}
Screen: ${screen}`);
      }
      report.liveProgress = "passed";
    }
    for (const theme of ["light", "dark"]) {
      for (const [width, height, mobile] of VIEWPORTS) {
        const label = `${theme}-${width}`;
        await open(page, options, { width, height, mobile, theme });
        await checkShell(page, label);
        if (options.empty && !options.projectId) {
          expect(await page.evaluate("!document.querySelector('#welcome').hidden && document.querySelector('#project').hidden"), `${label}: expected the welcome screen`);
          if (options.shots) await page.screenshot(`${options.shots}/${label}-welcome.png`);
        } else {
          expect(await page.evaluate("document.querySelector('#project-title').textContent.trim().length > 0 && !document.querySelector('#project').hidden"), `${label}: project did not open`);
          await checkTabs(page, options, label, options.shots);
          if (options.empty) {
            await page.waitFor("document.querySelector('.theatre-empty')", { label: `${label} empty theatre` });
            expect(!await page.evaluate("document.querySelector('video')"), `${label}: an empty project must not show a player`);
          }
          if (options.projectId) await checkLibrary(page, label);
        }
        report.views += 1;
      }
    }
    await open(page, options, { width: 1280, height: 900 });
    await checkTheme(page);
    if (options.projectId) await checkOffline(page);

    expect(page.errors.length === 0, `page errors: ${page.errors.join(" | ")}`);
    expect(page.consoleErrors.length === 0, `console errors: ${page.consoleErrors.join(" | ")}`);
    expect(page.writes.length === 0, `the observer made write requests: ${page.writes.join(", ")}`);
    const failed = page.failed.filter((entry) => !entry.includes("/_fixture/"));
    expect(failed.length === 0, `failed requests: ${failed.join(", ")}`);
    report.status = "passed";
    report.writeRequests = 0;
    return report;
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmoke(parseArguments(process.argv.slice(2)))
    .then((report) => process.stdout.write(JSON.stringify(report, null, 2) + "\n"))
    .catch((error) => { process.stderr.write(`UI smoke failed: ${error.message}\n`); process.exitCode = 1; });
}
