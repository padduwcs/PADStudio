// An advisory look at text that is about to be spoken by a text-to-speech engine. A spoken request can be neither
// edited nor taken back (a cloud one also costs credits), so what a voice is likely to misread is worth seeing
// before it is sent. It never blocks anything: the Agent decides, and it cannot find spelling mistakes or tell how a
// particular voice will read a word. Those limits are returned with every review so a clean result is not mistaken
// for a verified one.

const CONTEXT_CHARACTERS = 20;
const MAX_EXAMPLES = 5;
const NOT_CHECKED = Object.freeze([
  "Spelling, diacritics and wording: proofread the text yourself; this review cannot tell a misspelled Vietnamese word from a correct one.",
  "How a particular voice and model read a word: only listening settles it, so keep the first sample to the passage with the most risk.",
  "Single letters a, e, o and y are Vietnamese words, so they are not flagged even when they stand for a variable."
]);

const LETTER_OR_DIGIT = String.raw`\p{L}\p{N}_`;

// The checks run in this order and a stretch of text is reported by the first check that claims it, so one
// problem (a <break/> tag, say) is not listed three times under three names.
const CHECKS = Object.freeze([
  {
    code: "garbled_text", severity: "warning",
    // UTF-8 read as Windows-1252 or Latin-1: "đ" arrives as "Ä‘", "ư" as "Æ°", "ạ" as "áº". Ã and Â are valid
    // capitals in Vietnamese, so they only count when followed by a symbol, which a real word never has.
    pattern: /�|[ÃÂ][\u0080-\u009F¡-¿]|[ÄÅÆ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]|á[º»]|â€/gu,
    message: "This looks like text that went through the wrong character encoding. Fix the source before sending: the voice will read the garbage."
  },
  {
    code: "code_like", severity: "warning",
    // \b only knows ASCII letters, so word edges are written as lookarounds that also see Vietnamese letters.
    pattern: new RegExp([
      String.raw`https?:\/\/\S+`,
      String.raw`www\.\S+`,
      String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`,
      String.raw`(?<![${LETTER_OR_DIGIT}])[A-Za-z]+_[A-Za-z0-9_]+(?![${LETTER_OR_DIGIT}])`,
      String.raw`(?<![${LETTER_OR_DIGIT}])[a-z]+[A-Z][A-Za-z]*(?![${LETTER_OR_DIGIT}])`,
      String.raw`(?<![${LETTER_OR_DIGIT}])[\w-]+\.(?:js|mjs|py|json|md|mp3|mp4|png|jpg|html|css|txt)(?![${LETTER_OR_DIGIT}])`,
      String.raw`(?<![${LETTER_OR_DIGIT}])[A-Za-z_][A-Za-z0-9_]*\(`
    ].join("|"), "gu"),
    message: "Code, file names, links and addresses are read letter by letter or garbled. Describe them in words instead."
  },
  {
    code: "markup", severity: "warning",
    pattern: /<\/?[A-Za-z][^>]*>|__|`{1,3}|^[ \t]*(?:#{1,6}[ \t]|[-*][ \t])/gmu,
    message: "Markup is read aloud or ignored. Eleven v3 does not support SSML break tags either; use punctuation for pauses."
  },
  {
    code: "digits", severity: "warning",
    pattern: /\d+(?:[.,:/-]\d+)*/gu,
    message: "Numbers written as digits are read the way the model's text normalization guesses, which depends on language and context. " +
      "Write each number as the words that should be spoken (for example \"mười ba\", \"một triệu\"); ElevenLabs recommends writing numbers, dates, " +
      "symbols and acronyms fully in words."
  },
  {
    code: "symbols", severity: "warning",
    pattern: /[\^=+*\/\\|<>~#@&%$±×÷√∑∏∞≈≠≤≥→←↔²³°]/gu,
    message: "Symbols are skipped or spelled out unpredictably. Say them in words (for example \"mũ\" for ^, \"nhân\" for ×, \"phần trăm\" for %)."
  },
  {
    code: "single_letters", severity: "warning",
    pattern: new RegExp(`(?<![${LETTER_OR_DIGIT}])[A-Za-z](?![${LETTER_OR_DIGIT}])`, "gu"),
    skip: (match) => /^[aeoy]$/.test(match),
    message: "A letter standing alone (a variable such as n or B) may be read as its Latin name, as a Vietnamese sound, or skipped. " +
      "Write the sound you want, such as \"nờ\", or name the thing (\"số mũ\")."
  },
  {
    code: "acronyms", severity: "note",
    pattern: new RegExp(`(?<![${LETTER_OR_DIGIT}])[A-Z]{2,}(?![${LETTER_OR_DIGIT}])`, "gu"),
    // A heading written in capitals is not a row of abbreviations: skip a run whose neighbouring words are capitals too.
    skip: (_match, { text, start, end }) => {
      const neighbours = [/(\p{L}+)[^\p{L}]*$/u.exec(text.slice(0, start))?.[1], /^[^\p{L}]*(\p{L}+)/u.exec(text.slice(end))?.[1]];
      return neighbours.some((word) => word && word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase());
    },
    message: "An abbreviation may be spelled out letter by letter or read as a word. Write how it should sound " +
      "(for example \"bi ép ét\" for BFS) unless the English reading is what you want."
  },
  {
    code: "repeated_words", severity: "note",
    pattern: /(?<![\p{L}\p{N}])(\p{L}{2,})[ \t]+\1(?![\p{L}\p{N}])/giu,
    message: "The same word twice in a row is often a typo, though Vietnamese does use deliberate repetition. Check each one."
  }
]);

function example(text, index, matched) {
  const before = text.slice(Math.max(0, index - CONTEXT_CHARACTERS), index);
  const after = text.slice(index + matched.length, index + matched.length + CONTEXT_CHARACTERS);
  return { text: matched, context: `${before}[${matched}]${after}`.replace(/\s+/g, " ").trim() };
}

/** The review a TTS tool shows when planning a request, or null when the request has no text to review yet. */
export function reviewSpeechInputs(inputs) {
  return typeof inputs?.text === "string" && inputs.text.trim() ? { kind: "speech_text", ...reviewSpeechText(inputs.text) } : null;
}

/** What a Result keeps of the review: whether the text was clean when it was sent, not the whole list. */
export function summarizeSpeechReview(review) {
  return {
    clean: review.clean,
    warnings: review.advisories.filter((entry) => entry.severity === "warning").reduce((sum, entry) => sum + entry.count, 0),
    notes: review.advisories.filter((entry) => entry.severity === "note").reduce((sum, entry) => sum + entry.count, 0)
  };
}

/**
 * Review `text` and return the advisories that apply, warnings before notes. The same text always gives the same review.
 * @param {string} text
 */
export function reviewSpeechText(text) {
  const value = String(text ?? "");
  const claimed = [];
  const overlapsClaimed = (start, end) => claimed.some((range) => start < range.end && end > range.start);
  const advisories = [];
  for (const check of CHECKS) {
    const examples = [];
    let count = 0;
    for (const match of value.matchAll(check.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (check.skip?.(match[0], { text: value, start, end })) continue;
      if (overlapsClaimed(start, end)) continue;
      claimed.push({ start, end });
      count += 1;
      if (examples.length < MAX_EXAMPLES) examples.push(example(value, start, match[0]));
    }
    if (count > 0) advisories.push({ code: check.code, severity: check.severity, count, message: check.message, examples });
  }
  advisories.sort((left, right) => (left.severity === right.severity ? 0 : left.severity === "warning" ? -1 : 1));
  return {
    version: "1.0",
    characters: [...value].length,
    clean: advisories.length === 0,
    advisories,
    notChecked: [...NOT_CHECKED]
  };
}
