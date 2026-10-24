import test from "node:test";
import assert from "node:assert/strict";
import { EN_MESSAGES } from "../ui/messages-en.js";
import { getLanguage, setLanguage, t } from "../ui/i18n.js";

test("UI language validates preferences, preserves unknown text and interpolates values verbatim", () => {
  setLanguage("vi");
  assert.equal(t("Dự án"), "Dự án");
  assert.equal(setLanguage("en"), true);
  assert.equal(getLanguage(), "en");
  assert.equal(t("Dự án"), "Projects");
  assert.equal(t("Kết nối được: 2 giọng, 3 model, đã dùng 10/100 ký tự."), "Connected: 2 voices, 3 models, 10/100 characters used.");
  assert.equal(t("Công cụ cho media.inspect."), "Tool for media.inspect.");
  assert.equal(t("Bản {0} · {1}", 2, "<img onerror=alert(1)> $& {0}"), "Version 2 · <img onerror=alert(1)> $& {0}");
  for (const value of ["constructor", "__proto__", "toString", "My video {0}", "A user-written sentence."]) assert.equal(t(value), value);
  assert.equal(setLanguage("fr"), false);
  assert.equal(getLanguage(), "en");
  setLanguage("vi");
});

test("English messages retain every interpolation placeholder and contain usable copy", () => {
  const placeholders = (text) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
  for (const [source, english] of Object.entries(EN_MESSAGES)) {
    assert.equal(typeof english, "string", source);
    assert.ok(english.trim().length, source);
    assert.deepEqual(placeholders(english), placeholders(source), source);
  }
});
