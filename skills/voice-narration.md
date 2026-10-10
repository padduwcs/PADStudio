# Voice and narration

Use whenever a video has spoken narration: writing the script, then making the voice with `tts.synthesize`
(Piper local or ElevenLabs cloud). A narration is heard once, at the speaker's pace. The listener cannot reread,
skim ahead or look something up, and a cloud voice cannot be corrected after it is made without paying again.
So the work is done in the script, before any request.

## Write the script for a listener

1. Start from the one thing the viewer should understand when it ends (the brief's `desiredOutcome`), and who
   they are and what they already know. Everything in the script either serves that or goes.
2. Give the reason before the method. The first draft of an explanation usually says what to do and leaves out
   why, and the viewer is told a technique they cannot yet believe. Lead with the question they would ask, then
   the step that answers it ("why split in half?", "why compute only one half and reuse it?"), and only then name
   the technique. A short script that explains why beats a complete one that only describes how.
3. One idea per sentence, and let each sentence answer what the one before made the listener wonder. Bring in a
   term at the moment it is needed and say what it means in the same breath. Cut a detail if the viewer would not
   miss it: a second example, an edge case, a caveat that does not change what they walk away with. Length follows
   the idea; do not aim at a duration.
4. Check the content before you spend anything. Recompute every number and claim yourself, keep one worked example
   consistent from the first sentence to the last, and keep the check in the project (a checks file beside the
   script) so the next Agent does not have to redo it.
5. Say it in your head as the speaker. A sentence that needs two breaths is too long. Written-formal words, stacked
   clauses and the same connective every sentence ("Sau đó… Sau đó…") sound stiff aloud. Prefer the word a person
   would use talking to a friend who is learning this. If you would skip a line when reading it out, delete it.
6. Show the user the exact text that will be sent and settle it before any request. Whatever you change after the
   voice exists is a new paid request.

## Write what the voice can read

7. Write everything the way it should sound. Numbers and formulas in words ("ba mũ mười ba", "một triệu"), symbols
   as the word ("mũ", "nhân"), a variable as the sound you want ("nờ"), a digit string one digit at a time,
   an abbreviation as its sounds. ElevenLabs itself recommends writing numbers, dates, symbols and acronyms fully
   in words, because a digit has several valid readings and the model chooses. Ordinary English words and product
   names are read well and can stay as they are.
8. Run `tool:plan` and read `inputReview`. It lists what a voice may misread (digits, symbols, standalone letters,
   file names, markup, garbled encoding, abbreviations, repeated words) with examples. It advises and never blocks;
   fix what it finds and plan again. It cannot check spelling, so proofread the exact text yourself, diacritics
   included: a typo reaches the voice as a different word. `notChecked` says what the review could not see.
9. For a word that is still misread, respell it in words that sound the way you want ("nờ", "lô ga rít") and
   test it in the sample. Do not reach for phoneme or IPA markup with Eleven v3: ElevenLabs documents IPA for
   Eleven v4 and phoneme tags only for `eleven_flash_v2`, and v3 does not support SSML break tags, so shape pauses
   with punctuation.

## Ask for as little as possible

10. Make the whole narration in **one request**. Separate requests differ slightly in intonation and the joins can
    be heard. Split only when the text is longer than the model allows (`maximumTextLengthPerRequest` in
    `tts:inspect`), then at paragraph breaks, with the same voice, model, settings and seed. Do not give each
    scene its own request for convenience: changing the text later regenerates it all, which is exactly why steps
    1-9 come first. A change to the visuals alone never needs a new voice.
11. A sample is real credit; make one only if it teaches something. It does when the user has not heard this voice
    and model, when the voice has its own rate (a short request of that voice and model measures its real cost per
    character, so the estimate for the full script is measured, not guessed), or when the script has a passage you
    cannot be sure of. Then make the sample the **riskiest passage of the real script** (a few sentences with the
    hardest numbers and names), not the opening line, so one request answers pronunciation, voice and cost together.
    Skip it when the user already knows the voice and the review is clean. Tell the user where to open it: the
    audio Result file in the project's outputs. The Tư liệu tab only lists narration the current sequence uses.

## Paid requests, one at a time

12. Choose the engine and voice with the user. Read `project:resume` → `environment.voice` and `budget.credits`.
    Piper is free and local; ElevenLabs sounds better but spends the user's credits. If the user has not said
    which, ask once; never choose the paid engine silently. Without a saved ElevenLabs key, send the user to the
    Tools page, Giọng đọc tab (`http://127.0.0.1:7603/?panel=tools&tab=voice`, start the observer with
    `npm run observer:ensure` if needed). Never ask for, accept or repeat an API key in chat; if one is pasted,
    do not use it. Propose `defaultVoice` and
    `defaultModelId` from `environment.voice`; with none saved, `npm run tts:inspect -- vi` lists real choices.
    Never invent a voice id. Every request names `modelId` and `voiceId`, even when they equal the defaults.
13. `tool:plan` returns `estimatedUsage` and `creditBudget`. Tell the user the credits and what remains, say
    whether the figure is `uncertain` (a voice with its own rate: only a minimum until an earlier request of that
    voice and model exists) or `calibrated` (measured from the project's earlier requests, so close to the real
    cost), and wait for an explicit yes **for that exact text**. A general "cứ làm đi" does not cover text
    written later.
14. Then `tool:authorize` with `approvedBy: "user"`, `maxCredits` equal to the estimate and a `reason` that says
    what they approved, then `tool:run` with the `authorizationId`. One authorization covers one request.
15. If the video must follow the words, set `withTimestamps: true` in that same request. The Result then carries
    the time each word is spoken (file `timing`), so the cue map is built from the take that will be used and no
    call outside PADStudio is needed. If `data.timing.available` is false, read `data.timing.reason` and tell the
    user; do not fetch timing by another route quietly.
16. A project cap is set with `npm run project:credits -- <project-id> set <credits>` (ask before suggesting one).
    On `credit_budget_exceeded` stop and report the numbers; the user decides to raise the cap or shorten the
    script. Never split text to slip under a cap.
17. Never re-run a failed or interrupted request on your own. `usage_unknown` means credits may already be spent;
    `finalization_pending` is fixed with `project:run:recover`, which does not call the provider again.
    `credential_rejected` goes back to the Tools page.

## Use the audio

18. Use each Result as narration `{ "kind": "result", "id": "...", "file": "primary" }` and plan segment durations
    from the real `data.durationSeconds`.
19. Check the voice against the script with an ASR transcript of the audio Result (`project:analyze`), and read it
    the way a listener would be affected: ASR writes numbers as digits, so compare after turning them back into
    words. What differs is a short list of places to listen to again, with their timestamps (a changed tone mark,
    a dropped word, a name spelled out). It catches dropped or garbled words, not taste. Say that nobody has
    listened until the user has, and record only what you actually checked.
