import assert from "node:assert/strict";
import test from "node:test";
import { createWikimediaStockSearch } from "../src/tools/wikimedia-stock-search.js";

test("Wikimedia search preserves source and rights metadata without importing media", async () => {
  let requested;
  const tool = createWikimediaStockSearch({ now: () => "2026-09-14T00:00:00.000Z", fetchImpl: async (url) => {
    requested = url; return { ok: true, json: async () => ({ query: { pages: [{ pageid: 42, title: "File:Example.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/example.jpg", thumburl: "https://upload.wikimedia.org/thumb.jpg", mime: "image/jpeg", width: 1200, height: 800, extmetadata: { Artist: { value: "<b>Alice</b>" }, LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" } } }] }] } }) };
  } });
  const prepared = await tool.prepare({ inputs: { query: "coffee farm", mediaType: "image", limit: 5 } });
  const execution = await tool.execute(prepared.runtime);
  const result = tool.createResult({ prepared, execution });
  assert.match(requested.search, /filetype%3Abitmap/);
  assert.equal(result.files.length, 0);
  assert.equal(result.data.candidates[0].creator, "Alice");
  assert.equal(result.data.candidates[0].license, "CC BY-SA 4.0");
  assert.equal(result.data.candidates[0].sourcePage, "https://commons.wikimedia.org/?curid=42");
});

test("Wikimedia search rejects loose inputs and insecure asset URLs", async () => {
  const tool = createWikimediaStockSearch({ fetchImpl: async () => ({ ok: true, json: async () => ({ query: { pages: [{ pageid: 1, title: "File:bad", imageinfo: [{ url: "http://example.test/bad.jpg" }] }] } }) }) });
  await assert.rejects(tool.prepare({ inputs: { query: "x", extra: true } }), (error) => error.code === "invalid_input");
  const prepared = await tool.prepare({ inputs: { query: "safe" } });
  assert.equal((await tool.execute(prepared.runtime)).candidates.length, 0);
});
