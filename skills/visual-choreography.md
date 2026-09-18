# Visual choreography for explanatory motion

Use when narration, a process, an algorithm, a transformation or a product action must be
shown step by step. Skip it for a tiny decorative loop or a clip whose source motion already
communicates the whole idea. This is an optional planning artifact, not a mandatory storyboard
stage.

1. Read the active brief, direction, exact narration/script and relevant evidence. Split the
   explanation at changes of meaning or state, not at arbitrary sentence lengths. A beat may be
   short, but it must give the viewer enough time to perceive the result.
2. Define persistent visual objects before beats. Preserve identity across beats when continuity
   teaches causality: transform or update the same matrix, node, cursor, token or UI control instead
   of replacing it with a look-alike.
3. Write `animation.choreography` version 1.0 with `project:choreography`. For every beat record:
   the audience message, optional exact narration, visual purpose, primary/focus objects, observable
   state before and after, timed actions, deliberate hold time and concrete review criteria.
4. Mark action meaning honestly. A semantic beat needs a non-hold semantic action. Camera drift,
   decorative easing, a title entrance or a generic zoom is support motion; it does not count as
   explaining a claim.
5. Prefer verbs that describe visible causality: select, traverse, accumulate, calculate,
   substitute, compare, connect or transform. Use `other` only when the description and resulting
   state make the project-specific action unambiguous.
6. Keep actions and beat boundaries frame-aligned. Actions may overlap when they are intentionally
   simultaneous, but list them by start time. `holdAfterSeconds` begins after the last action and
   must fit inside the beat.
7. Review the plan before source authoring. Check claim coverage, object continuity, action order,
   cognitive load and whether the state change can be seen without relying on narration. Do not
   manufacture constant motion: a meaningful change followed by a readable hold is often stronger.
8. For code animation, create `animation.composition` version 1.1 and bind the exact choreography
   Artifact. Its duration and FPS must match. Source code may implement the plan creatively, but it
   must not silently drop or reorder semantic actions.
9. Preview with `useChoreographyFrames: true` when using Remotion or HyperFrames. PADStudio derives
   bounded exact frames from beat starts, semantic action results and intentional holds. Add a short
   range or selector-scoped motion preview when stills cannot establish trajectory or continuity.
10. After rendering, load `code-animation-review`. Compare each semantic beat against the exact
    rendered interval and record timestamped corrections. Sampled frames are evidence, not a
    substitute for continuous playback and human listening.

For the schema and lifecycle, see `docs/build/VISUAL-CHOREOGRAPHY-SPEC.md`. Preserve stable object
and beat IDs across revisions when their meaning remains the same.
