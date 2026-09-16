# Human release review

Machine QA is a prerequisite, not a substitute for watching and listening.

1. Resolve the exact `video.sequence-render` Result and verify its primary SHA-256 before review.
2. Watch the entire render at normal speed on the stated device. Check opening, every transition and caption/overlay window, and the final frame.
3. If audio is present, listen to the entire render. Check intelligibility, music/narration balance, abrupt cuts, silence, distortion and emotional fit.
4. Record concrete findings with timestamps. Do not mark watched/listened from contact sheets, ASR, waveforms or partial playback.
5. Store the attestation and acceptance together with the interactive `project:accept` command;
   acceptance and delivery must remain bound to that exact Result and artifact revision.

If anything material changes, review the new Result in full. An older attestation never transfers to new bytes.
