# Human release review

Use when the user wants a full watch-and-listen review stored against one exact render, for example
a release candidate or a platform submission. It is optional. The user's acceptance of the exact
Result in chat, recorded with `project:accept -- <project-id> <render-result-id> --from-agent-host`,
already closes the creative decision and needs no review first.

Machine QA is evidence for the person, not a substitute for watching and listening. It does not
gate acceptance or delivery.

1. Resolve the exact `video.sequence-render` Result and verify its primary SHA-256 before review.
2. Watch the entire render at normal speed on the stated device. Check opening, every transition and caption/overlay window, and the final frame.
3. If audio is present, listen to the entire render. Check intelligibility, music/narration balance, abrupt cuts, silence, distortion and emotional fit.
4. Record concrete findings with timestamps. Do not mark watched/listened from contact sheets, ASR, waveforms or partial playback.
5. Only the user can store the attestation: they run `project:accept -- <project-id> <render-result-id>`
   (without `--from-agent-host`) themselves in an interactive terminal, which asks them to type an
   exact phrase. An Agent never runs it, pipes input into it or types the phrase for them.
6. Acceptance and delivery stay bound to that exact Result and artifact revision.

If anything material changes, review the new Result in full. An older attestation never transfers to new bytes.
