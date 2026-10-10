import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reviewSpeechText } from "../src/tools/speech-text-review.js";

const codes = (review) => review.advisories.map((advisory) => advisory.code);
const advisory = (review, code) => review.advisories.find((entry) => entry.code === code);

test("narration written the way it is spoken passes without advisories", async () => {
  // The script that was actually sent to ElevenLabs for the Binary Exponentiation video: every number and
  // formula in words, English product names left as they are.
  const review = reviewSpeechText(await readFile(new URL("./fixtures/approved-narration-vi.txt", import.meta.url), "utf8"));
  assert.equal(review.characters, 3269);
  assert.equal(review.clean, true);
  assert.deepEqual(review.advisories, []);
  assert.ok(review.notChecked.length >= 2, "a clean review must still say what it cannot check");
});

test("digits, symbols and standalone letters are found in a draft written in notation", () => {
  const review = reviewSpeechText(
    "Binary Exponentiation là một cách tính a^n nhanh hơn việc nhân a với chính nó n lần. Ví dụ, để tính 2^1000, cần gần một nghìn phép nhân."
  );
  assert.equal(review.clean, false);
  assert.deepEqual(codes(review), ["digits", "symbols", "single_letters"]);
  assert.deepEqual(advisory(review, "digits").examples.map((entry) => entry.text), ["2", "1000"]);
  assert.equal(advisory(review, "symbols").count, 2);
  // a is a Vietnamese word and is left alone; the two n are variables.
  assert.deepEqual(advisory(review, "single_letters").examples.map((entry) => entry.text), ["n", "n"]);
  assert.match(advisory(review, "digits").examples[0].context, /\[2\]\^1000/);
});

test("a stretch of text is reported once, by the check that claims it first", () => {
  const review = reviewSpeechText('Mở <break time="1s"/> tệp main.py rồi gọi render_video() và camelCase');
  assert.deepEqual(codes(review), ["code_like", "markup"]);
  assert.deepEqual(advisory(review, "code_like").examples.map((entry) => entry.text), ["main.py", "render_video", "camelCase"]);
  assert.equal(advisory(review, "markup").count, 1);
  assert.equal(codes(review).includes("digits"), false, "the 1 inside the tag belongs to the tag");
  assert.equal(codes(review).includes("symbols"), false, "the < > / of the tag belong to the tag");
});

test("abbreviations are noted, and warnings are listed before notes", () => {
  const review = reviewSpeechText("Duyệt BFS từ điểm B rồi quay lại. A, ra vậy.");
  assert.deepEqual(review.advisories.map((entry) => [entry.severity, entry.code]), [
    ["warning", "single_letters"], ["note", "acronyms"]
  ]);
  assert.deepEqual(advisory(review, "acronyms").examples.map((entry) => entry.text), ["BFS"]);
});

test("text in capitals and ordinary Vietnamese punctuation are not mistaken for problems", () => {
  assert.equal(reviewSpeechText("NGÃ BA ĐƯỜNG VÀO THÀNH PHỐ").clean, true);
  assert.equal(reviewSpeechText("Con “cá” ngon, ÂM NHẠC hay, ví dụ: chào(xin) bạn.").clean, true);
  assert.equal(reviewSpeechText("Ta chọn tám, bốn và một, đúng với ba nhóm vừa giữ.").clean, true);
});

test("text that went through the wrong encoding is flagged before it is read aloud", () => {
  const review = reviewSpeechText("Số mÆ°á»i ba và Ä‘á»‡ quy");
  assert.equal(advisory(review, "garbled_text").count, 4);
  assert.deepEqual(advisory(review, "garbled_text").examples.map((entry) => entry.text), ["Æ°", "á»", "Ä‘", "á»"]);
  assert.equal(reviewSpeechText("Số mười ba và đệ quy").clean, true);
});

test("a word repeated back to back is noted for a human to judge", () => {
  const review = reviewSpeechText("Ta tính một một không một, và và đây là lỗi gõ.");
  assert.equal(advisory(review, "repeated_words").count, 2);
  assert.equal(advisory(review, "repeated_words").severity, "note");
});

test("long lists keep the full count but only a few examples, and the review is repeatable", () => {
  const text = Array.from({ length: 12 }, (_, index) => `bước ${index + 1}`).join(", ");
  const first = reviewSpeechText(text);
  assert.equal(advisory(first, "digits").count, 12);
  assert.equal(advisory(first, "digits").examples.length, 5);
  assert.deepEqual(reviewSpeechText(text), first);
  assert.equal(reviewSpeechText("").clean, true);
  assert.equal(reviewSpeechText(undefined).characters, 0);
});
