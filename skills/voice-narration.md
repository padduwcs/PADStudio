# Voice and narration

Use whenever a video needs a spoken narration made with `tts.synthesize` (Piper local or ElevenLabs cloud).
The goal is the right voice on the first full pass: no wasted credits, no surprises for the user.

## Choose the engine and the voice
1. Read `project:resume` → `environment.voice` and `budget.credits`. Piper is free and local; ElevenLabs sounds better but spends the user's credits.
   If the user has not said which, ask once. Never pick the paid engine silently.
2. ElevenLabs without a saved key: send the user to the Tools page (`http://127.0.0.1:7603/?panel=tools`, start the observer with
   `npm run observer:ensure` if needed). Never ask for, accept or repeat an API key in chat; if one is pasted, do not use it.
3. ElevenLabs voice and model: propose `defaultVoice` and `defaultModelId` from `environment.voice` ("Dùng giọng Minh Anh, model Eleven v3?").
   None saved: tell the user the Tools page lets them search their voices, listen to previews, paste the id of a voice they used before
   and choose the model. Or run `npm run tts:inspect -- vi` and offer a short list with `previewUrl` links. Never invent a voice id from memory.
   Only voices without a custom rate and models that advertise Vietnamese pass planning.
4. Every request names `modelId` and `voiceId` explicitly, even when they equal the saved defaults. A different voice for one passage is fine when the user asks.

## Script first, then a sample, then the rest
5. Settle the narration text before synthesizing. Write numbers, abbreviations and foreign terms the way they are spoken, and read
   the script back to the user when pronunciation matters. Every later edit of the text is a new paid request.
6. Make one short sample (one or two sentences) and ask the user to listen to it in the observer (Tư liệu tab). Change voice, model or
   settings now, while it costs a sentence, not a whole script. Piper is free but follows the same order.
7. Synthesize in passages that match the video's segments (about one scene each, within the model's character limit), each as its own Result.
   Changing one passage later then regenerates only that passage.

## Paid requests, one at a time
8. `tool:plan` returns `estimatedUsage` (credits) and `creditBudget` (the project's cap, use so far and what is left). Tell the user the number
   of credits and what remains, and wait for an explicit yes **for that exact text**. A general "cứ làm đi" does not cover text written later.
9. Only then `tool:authorize` with `approvedBy: "user"`, `maxCredits` equal to the estimate and a `reason` that says what they approved,
   then `tool:run` with the `authorizationId`. One authorization covers one request. Do not authorize several requests ahead.
10. A project cap is set with `npm run project:credits -- <project-id> set <credits>` (ask before suggesting one). On `credit_budget_exceeded`
    stop and report the numbers; the user decides to raise the cap or shorten the script. Never split text to slip under a cap.
11. Never re-run a failed or interrupted request on your own. `usage_unknown` means credits may already be spent; `finalization_pending` is fixed
    with `project:run:recover`, which does not call the provider again. `credential_rejected` goes back to the Tools page.

## Use the audio
12. Use each Result as narration `{ "kind": "result", "id": "...", "file": "primary" }` and plan segment durations from the real
    `data.durationSeconds`. Unchanged passages keep their audio when only visuals or timing change; do not synthesize again for that.
13. Machine checks (ASR of the audio against the script) catch dropped or garbled words but not taste. Say that nobody has listened until
    the user has, and record only what you actually checked.
