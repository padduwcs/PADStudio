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
   When the composition binds `animation.choreography`, review every semantic beat against its
   message, state-before/state-after and ordered actions. Missing or reordered actions are failures,
   even when the sampled frames look attractive.
5. Run a distinctness pass. Ask whether the frames could belong to any unrelated video after only
   replacing the text. Flag repeated card/title/diagram grammar, slideshow pacing and decorative
   motion. Reuse engines and utilities freely; give important videos a bespoke visual argument.
6. Run a relational pass on consecutive samples and targeted motion clips. For choreography 1.2,
   check the declared `relationToPrevious`: carried state must remain recognizable, transformations
   must show cause, reframing must preserve orientation, contrasts and analogies must have a readable
   mapping, and cutaways/resets must earn their place in the argument. For legacy 1.1, check its hero
   and state-ID promises as declared. Do not penalize a purposeful cut merely because an object or
   layout changes; do flag unexplained loss of evidence or repeated re-entry.
7. Run a composition-usage pass. The primary explanatory subject should receive the frame it needs.
   Flag persistent empty regions, repeated dashboard chrome, narration
   paragraphs that duplicate the voice, and layouts where the real operation occupies a small card.
   Short labels and selective captions are acceptable when they point into the model.
   For choreography 1.3, compare every visible word against the beat's exact `textElements` inventory.
   Flag undeclared copy, unnecessary headings, transcript duplication and persistent labels that no
   longer help the current question. Then perform a no-prose pass: mentally hide titles, captions and
   paragraphs while retaining essential values, symbols and labels. The declared `visualProof` must
   still be legible unless the project explicitly chose `type-led` communication.
8. Evaluate variation deliberately: visual vocabulary, motion intensity and information density
   should change with the narrative. Variation must clarify progression, not create random novelty.
   Check for front-loading: the opening must not receive all bespoke motion while the middle and end
   collapse into repetitive cards. Each major beat should earn its treatment from the content.
   When HyperFrames motion is hard to infer from stills, use a targeted motion preview for the
   relevant selector and interval rather than increasing global sampling blindly.
9. Record every material finding with a timestamp/frame, observable evidence, severity and a
   concrete proposed correction. After finding one defect, scan the rest of the render for the same
   class before revising source.
10. Batch source corrections into a coherent revision. Create a new immutable source Result, then
   validate and preflight the exact revision before preview/render. Handle compile and runtime errors
   inside the Agent authoring loop; do not turn them into user confirmation steps.
11. Before release, a human must still watch and listen to the exact final render in full. Machine
   QA, ASR, contact sheets and targeted clips remain evidence, not an attestation.
