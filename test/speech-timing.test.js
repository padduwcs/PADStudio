import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSpeechTiming, normalizeProviderAlignment } from "../src/tools/speech-timing.js";

const real = JSON.parse(await readFile(new URL("./fixtures/elevenlabs-alignment-durations.json", import.meta.url), "utf8"));

function endsAsTimes(alignment) {
  return {
    ...alignment,
    character_end_times_seconds: alignment.character_end_times_seconds.map((duration, index) =>
      alignment.character_start_times_seconds[index] + duration)
  };
}

test("a real ElevenLabs response, whose end field holds durations, gives the same word times as an independent derivation", () => {
  const built = buildSpeechTiming({ text: real.text, alignment: real.alignment, audioDurationSeconds: real.audioDurationSeconds });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.document.checks.endTimesAre, "durations");
  assert.equal(built.document.checks.textMatchesRequest, true);
  assert.equal(built.document.words.length, real.expectedWords.length);
  built.document.words.forEach((word, index) => {
    const expected = real.expectedWords[index];
    assert.equal(word.text, expected.text);
    assert.ok(Math.abs(word.startSeconds - expected.startSeconds) < 0.0015, `${word.text} starts at ${word.startSeconds}, expected ${expected.startSeconds}`);
    assert.ok(Math.abs(word.endSeconds - expected.endSeconds) < 0.0015, `${word.text} ends at ${word.endSeconds}, expected ${expected.endSeconds}`);
  });
});

test("the same response with true end times as documented gives identical timing", () => {
  const fromDurations = buildSpeechTiming({ text: real.text, alignment: real.alignment, audioDurationSeconds: real.audioDurationSeconds });
  const fromEnds = buildSpeechTiming({ text: real.text, alignment: endsAsTimes(real.alignment), audioDurationSeconds: real.audioDurationSeconds });
  assert.equal(fromEnds.ok, true, fromEnds.reason);
  assert.equal(fromEnds.document.checks.endTimesAre, "end_times");
  assert.deepEqual(fromEnds.document.words, fromDurations.document.words);
  assert.equal(fromEnds.document.words[0].text, "Ba");
  assert.deepEqual(
    [fromEnds.document.words[0].firstCharacter, fromEnds.document.words[0].lastCharacter], [0, 1],
    "words point back into the character arrays"
  );
});

test("alignment that cannot be trusted is refused with a reason, never stored", () => {
  const good = { characters: ["X", "i", "n"], character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] };
  assert.equal(normalizeProviderAlignment(good).ok, true);
  const refused = (value, pattern) => {
    const result = normalizeProviderAlignment(value);
    assert.equal(result.ok, false);
    assert.match(result.reason, pattern);
  };
  refused(null, /no alignment/);
  refused({ characters: ["X"] }, /missing one of/);
  refused({ ...good, character_end_times_seconds: [0.1, 0.2] }, /empty or differ in length/);
  refused({ ...good, characters: ["X", 2, "n"] }, /not all text/);
  refused({ ...good, character_start_times_seconds: [0, Number.NaN, 0.2] }, /finite, non-negative/);
  refused({ ...good, character_start_times_seconds: [0, 0.2, 0.1], character_end_times_seconds: [0.1, 0.3, 0.2] }, /starts before the one before it/);
  // End values that are neither end times nor durations of back-to-back characters.
  refused({ ...good, character_end_times_seconds: [0.1, 0.05, 0.9] }, /not durations either/);
});

test("timing that disagrees with the audio length is not trusted", () => {
  const alignment = { characters: ["X", "i", "n"], character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] };
  assert.equal(buildSpeechTiming({ text: "Xin", alignment, audioDurationSeconds: 1.5 }).ok, true);
  const tooLong = buildSpeechTiming({ text: "Xin", alignment, audioDurationSeconds: 30 });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.reason, /ends at 0\.3 s but the audio lasts 30 s/);
  assert.equal(buildSpeechTiming({ text: "Xin", alignment: null, audioDurationSeconds: 1 }).ok, false);
});

test("words are split on whitespace and a changed text is reported rather than hidden", () => {
  const characters = [..."Xin chào"];
  const starts = characters.map((_, index) => index * 0.1);
  const alignment = { characters, character_start_times_seconds: starts, character_end_times_seconds: starts.map((value) => value + 0.1) };
  const built = buildSpeechTiming({ text: "Xin chào", alignment, audioDurationSeconds: 0.8 });
  assert.deepEqual(built.document.words.map((word) => word.text), ["Xin", "chào"]);
  assert.equal(built.document.checks.textMatchesRequest, true);
  const changed = buildSpeechTiming({ text: "Xin chào bạn", alignment, audioDurationSeconds: 0.8 });
  assert.equal(changed.ok, true);
  assert.equal(changed.document.checks.textMatchesRequest, false);
});
