# Code animation review

Use this skill after an authored preview or render exists. It strengthens evidence and creative
judgment without imposing a fixed production pipeline.

1. Review in two passes: first technical/semantic correctness, then audience experience. A clean
   render is not evidence that the explanation is correct, engaging or distinctive.
2. Cover the complete timeline. Use automated QA samples at no more than five-second gaps for a
   three-minute video, plus exact beat and transition boundaries. Inspect contact sheets page by
   page and open targeted frames or short clips around anything suspicious. State plainly that
   sampled frames are not the same as watching continuous playback.
3. For spoken work, compare ASR with the intended script. Supply important names, English terms,
   symbols and abbreviations as `expectedSpeech.terms`; treat failed recognition as a cue to listen
   and revise pronunciation, wording or TTS—not as proof of the exact phonetic cause.
4. Check whether motion teaches the spoken claim: object identity, direction, scale, causality,
   timing and mathematical meaning must agree. A polished but semantically wrong animation fails.
5. Run a distinctness pass. Ask whether the frames could belong to any unrelated video after only
   replacing the text. Flag repeated card/title/diagram grammar, slideshow pacing and decorative
   motion. Reuse engines and utilities freely; give important videos a bespoke visual argument.
6. Evaluate variation deliberately: visual vocabulary, motion intensity and information density
   should change with the narrative. Variation must clarify progression, not create random novelty.
7. Record every material finding with a timestamp/frame, observable evidence, severity and a
   concrete proposed correction. After finding one defect, scan the rest of the render for the same
   class before revising source.
8. Batch source corrections into a coherent revision. Static validation and non-executing checks
   must pass before requesting approval. Never use human code approval as a compile/debug loop.
   If approved bytes later need changing, explain that the security boundary requires one new
   approval for the new immutable source; props-only changes do not invent a source approval.
9. Before release, a human must still watch and listen to the exact final render in full. Machine
   QA, ASR, contact sheets and targeted clips remain evidence, not an attestation.
