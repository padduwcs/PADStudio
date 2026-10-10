// ElevenLabs can return, with the audio, when each character of the text is spoken. Video that has to follow the
// words (a visual argument built cue by cue) needs those times, and getting them from the same request avoids a second
// call that lives outside the project. A provider answer is only trusted after it passes checks, because one that is
// subtly wrong (durations where end times belong, say) would mis-time every cue built on it without any visible error.

// The spoken text may end a little before or after the encoded audio (leading and trailing silence).
export const TIMING_SLACK_SECONDS = 2;

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Check one alignment object as the provider documents it: parallel arrays `characters`,
 * `character_start_times_seconds` and `character_end_times_seconds`.
 * @returns {{ ok: true, alignment: { characters: string[], startSeconds: number[], endSeconds: number[] } } | { ok: false, reason: string }}
 */
export function normalizeProviderAlignment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "The provider sent no alignment." };
  const characters = raw.characters;
  const startSeconds = raw.character_start_times_seconds;
  const endSeconds = raw.character_end_times_seconds;
  if (![characters, startSeconds, endSeconds].every(Array.isArray)) {
    return { ok: false, reason: "The alignment is missing one of characters, character_start_times_seconds or character_end_times_seconds." };
  }
  if (characters.length === 0 || characters.length !== startSeconds.length || characters.length !== endSeconds.length) {
    return { ok: false, reason: "The alignment arrays are empty or differ in length." };
  }
  if (characters.some((entry) => typeof entry !== "string")) return { ok: false, reason: "The alignment characters are not all text." };
  const times = [...startSeconds, ...endSeconds];
  if (times.some((value) => !Number.isFinite(value) || value < 0)) return { ok: false, reason: "The alignment times are not all finite, non-negative numbers." };
  for (let index = 1; index < characters.length; index += 1) {
    if (startSeconds[index] < startSeconds[index - 1] - 1e-6) return { ok: false, reason: `Character ${index} starts before the one before it.` };
  }
  const ends = interpretEndTimes(startSeconds, endSeconds);
  if (!ends.ok) return ends;
  return {
    ok: true,
    convention: ends.convention,
    alignment: { characters: [...characters], startSeconds: [...startSeconds], endSeconds: ends.endSeconds }
  };
}

// The documented field holds the time each character ends. The alignment ElevenLabs keeps in its history holds the
// duration of each character there instead (found by checking a real response: every next start equals the start
// plus the stored value). Both are accepted, each only when the numbers prove it; anything else is refused.
const CONTIGUOUS_TOLERANCE_SECONDS = 0.01;

function interpretEndTimes(startSeconds, endSeconds) {
  const firstBadEnd = endSeconds.findIndex((end, index) => end < startSeconds[index]);
  if (firstBadEnd === -1) return { ok: true, convention: "end_times", endSeconds: [...endSeconds] };
  const derived = endSeconds.map((duration, index) => startSeconds[index] + duration);
  const contiguous = derived.slice(0, -1).every((end, index) => Math.abs(startSeconds[index + 1] - end) <= CONTIGUOUS_TOLERANCE_SECONDS);
  if (contiguous) return { ok: true, convention: "durations", endSeconds: derived };
  return { ok: false, reason: `Character ${firstBadEnd} ends before it starts, and the end values are not durations either.` };
}

function wordsOf(alignment) {
  const words = [];
  let first = null;
  const close = (last) => {
    if (first === null) return;
    words.push({
      text: alignment.characters.slice(first, last + 1).join(""),
      startSeconds: round(alignment.startSeconds[first]),
      endSeconds: round(alignment.endSeconds[last]),
      firstCharacter: first,
      lastCharacter: last
    });
    first = null;
  };
  alignment.characters.forEach((character, index) => {
    if (/^\s*$/u.test(character)) close(index - 1);
    else if (first === null) first = index;
  });
  close(alignment.characters.length - 1);
  return words;
}

/**
 * Turn the provider's alignment into the timing document stored with a Result: character times as the provider gave
 * them, word times derived from them, and the checks that were made.
 * @returns {{ ok: true, document: object } | { ok: false, reason: string }}
 */
export function buildSpeechTiming({ text, alignment, normalizedAlignment = null, audioDurationSeconds }) {
  const checked = normalizeProviderAlignment(alignment);
  if (!checked.ok) return checked;
  const lastEndSeconds = Math.max(...checked.alignment.endSeconds);
  if (lastEndSeconds > audioDurationSeconds + TIMING_SLACK_SECONDS || lastEndSeconds < audioDurationSeconds - TIMING_SLACK_SECONDS) {
    return {
      ok: false,
      reason: `The alignment ends at ${round(lastEndSeconds)} s but the audio lasts ${round(audioDurationSeconds)} s, ` +
        `more than ${TIMING_SLACK_SECONDS} s apart; it is not trusted.`
    };
  }
  const spoken = checked.alignment.characters.join("");
  const normalized = normalizedAlignment === null ? null : normalizeProviderAlignment(normalizedAlignment);
  return {
    ok: true,
    document: {
      version: "1.0",
      source: "elevenlabs.with-timestamps",
      audioDurationSeconds: round(audioDurationSeconds),
      alignment: checked.alignment,
      normalizedAlignment: normalized?.ok ? normalized.alignment : null,
      words: wordsOf(checked.alignment),
      checks: {
        endTimesAre: checked.convention,
        lastEndSeconds: round(lastEndSeconds),
        durationDeltaSeconds: round(lastEndSeconds - audioDurationSeconds),
        textMatchesRequest: spoken.normalize("NFC") === String(text).normalize("NFC")
      }
    }
  };
}
