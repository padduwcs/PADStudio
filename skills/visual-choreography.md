# Visual choreography for explanatory motion

Use when narration, a process, an algorithm, a transformation or a product action must be
shown step by step. Skip it for a tiny decorative loop or a clip whose source motion already
communicates the whole idea. This is an optional planning artifact, not a mandatory storyboard
stage.

1. Read the active brief, direction, exact narration/script and relevant evidence. Split the
   explanation at changes of meaning or state, not at arbitrary sentence lengths. A beat may be
   short, but it must give the viewer enough time to perceive the result.
2. Write one visual thesis before splitting beats: name the model that the viewer will watch evolve.
   Choose one to three persistent hero objects and reuse their identity, position and visual grammar.
   Transform or update the same matrix, heap, node, cursor, token or UI control instead of replacing
   it with a look-alike at every sentence.
3. Group the explanation into a few causal chapters, not one mini-slide per narration sentence. A
   chapter must retain at least one global hero. At a chapter boundary, bridge visibly from the
   prior state; use a reset only when continuity would be misleading, state why, and keep the reset
   budget explicit and small.
4. Write `animation.choreography` version 1.1 with `project:choreography`. Give every beat a stable
   `stateBeforeId`/`stateAfterId`, the immediately preceding beat as its continuity source, carried
   hero objects, one genuinely new piece of information and an honest continuity mode. State IDs
   must form an unbroken chain unless the beat declares a justified reset.
5. Mark action effect honestly. A semantic beat needs a semantic `state-change` action. Camera drift,
   decorative easing, a title entrance, reveal, highlight, annotation or generic zoom is presentation
   or focus motion; it does not count as advancing the explanatory model.
6. Prefer verbs that describe visible causality: select, traverse, accumulate, calculate,
   substitute, compare, connect or transform. Use `other` only when the description and resulting
   state make the project-specific action unambiguous.
7. Keep actions and beat boundaries frame-aligned. Actions may overlap when they are intentionally
   simultaneous, but list them by start time. `holdAfterSeconds` begins after the last action and
   must fit inside the beat.
8. Plan a dominant visual stage before authoring. Use `voice-led` or `selective-captions`; never put
   the full narration in a competing card. Set explicit stage-coverage and maximum-text-area targets.
   Labels, values and short conclusions may support the model, but they must not become a second slide.
9. Review the plan before source authoring. Read only `newInformation` in order: it must form a logical
   explanation. Then follow state IDs and carried heroes: every beat must visibly inherit its context.
   Do not manufacture constant motion; a meaningful change followed by a readable hold is stronger.
10. For code animation, create `animation.composition` version 1.1 and bind the exact choreography
   Artifact. Its duration and FPS must match. Source code may implement the plan creatively, but it
   must not silently drop or reorder semantic actions.
11. Preview with `useChoreographyFrames: true` when using Remotion or HyperFrames. PADStudio derives
   bounded exact frames from beat starts, semantic action results and intentional holds. Add a short
   range or selector-scoped motion preview when stills cannot establish trajectory or continuity.
12. After rendering, load `code-animation-review`. Compare each semantic beat against the exact
    rendered interval and record timestamped corrections. Sampled frames are evidence, not a
    substitute for continuous playback and human listening.

For version 1.1, add these exact fields to the existing 1.0 shape:

- top-level `continuity`: `mode` (`continuous-model` or `chaptered-model`), `visualThesis`,
  persistent `heroObjectIds`, and integer `maxResets`;
- top-level `presentation`: `narrationMode` (`voice-led` or `selective-captions`),
  `stageDescription`, `targetStageCoveragePercent` (40–95), and `maxTextAreaPercent` (0–35);
- top-level `chapters`: ordered objects with `id`, `label`, `goal`, and persistent
  `heroObjectIds`; use every declared chapter exactly once and in order;
- every beat: `chapterId`, `continuityMode` (`establish`, `continue`, `transform`, `bridge`, or
  `reset`), `stateBeforeId`, `stateAfterId`, `carriedObjectIds`, `newInformation`, and
  `resetReason` (null except for reset);
- every action: `effect` (`state-change`, `focus-change`, or `presentation`). The final semantic
  state-change action's `resultingState` must exactly equal the beat's `stateAfter`.

The first beat uses `establish`, has no continuity source and may carry no object. Every later beat
references the immediately preceding beat. Non-reset beats inherit its output state ID and carry a
global hero. A new chapter uses `bridge` with a hero shared by both chapters, or a justified `reset`.
Semantic beats must change state IDs. Keep `newInformation` unique across beats.

For the schema and lifecycle, see `docs/build/VISUAL-CHOREOGRAPHY-SPEC.md`. Preserve stable object
and beat IDs across revisions when their meaning remains the same.
