# Visual choreography for explanatory motion

Use when narration, a process, an algorithm, a transformation or a product action must be
understood through motion. Skip it for a tiny decorative loop or source footage that already
communicates the idea. This is optional directorial support for the Agent, not a storyboard stage
or a layout generator.

## Direct the visual argument

1. Read the active brief, direction, exact narration/script and relevant evidence. Find the chain
   of questions the viewer must answer. Split at a change of meaning, operation or inference—not at
   arbitrary sentence boundaries.
2. Write the visual thesis: what the viewer will come to understand by watching. Then describe:
   how causality remains legible, how composition and intensity may vary, the motion language, the
   project's anti-patterns, and which opening plus representative operation should be sampled first.
3. Treat each important beat as a visual proposition. Record its question, the visible operation,
   the resulting state, the intended audience insight and the composition that best exposes it.
   A viewer should be able to infer the point from the operation without reading a transcript card.
4. Choose the relationship to earlier material deliberately:
   - `carry`: retain useful state or identity;
   - `transform`: visibly turn prior material into the next idea;
   - `reframe`: change scale or composition around the same evidence;
   - `contrast`: compare against an earlier state or case;
   - `analogy`: temporarily map the idea into a clearer model;
   - `cutaway`: leave the current view for relevant context;
   - `reset`: begin a genuinely different visual situation.

   Continuity is conceptual and causal, not a requirement to keep one object or layout forever.
   A purposeful cut can be more coherent than a forced persistent dashboard.
5. Mark action effect honestly. A semantic beat needs a semantic `state-change` action. Camera
   drift, decorative easing, title entrance, reveal, highlight, annotation or generic zoom is
   presentation/focus motion and does not prove the spoken claim.
6. Prefer visible causal verbs: select, traverse, accumulate, calculate, substitute, compare,
   connect, move or transform. Use `other` only when the description and resulting state make the
   project-specific action unambiguous. Give the result time to be perceived; do not manufacture
   constant movement.
7. Let the subject determine the frame. Preserve objects, colors, positions or values when they
   help the viewer follow causality; change or discard them when the explanatory question changes.
   Keep narration text subordinate unless kinetic typography is itself the chosen visual subject.
   For spoken explainers, default to `visual-first`: remove the narration and ask what the viewer
   can still infer from objects, spatial relationships and change. Do not reserve permanent space
   for a heading, section label, transcript or decorative studio chrome. Labels, values and formulas
   should point into the model; they must not become a second script competing with it.

## Author and review

8. Write `animation.choreography` version 1.3 with `project:choreography`. Keep frame-aligned beat
   and action timing, stable IDs for meanings that survive revisions, and concrete review criteria.
   Use `presentation.communicationMode: visual-first` for normal narrated explanation. Use
   `type-led` only when words, quotations or kinetic typography are intentionally the visual subject.
   For every beat, state its `visualProof` and inventory every planned `textElement` exactly, with
   role and purpose. If text has no indispensable pointing, naming, numeric, symbolic or subject role,
   remove it before source authoring. Do not invent chapters, hero quotas, state-ID chains, reset
   budgets or screen-area percentages.
9. For a long or visually uncertain piece, author enough source to preview the opening and one
   representative operational passage before polishing the whole timeline. The Agent chooses these
   passages from the creative risk, not from a fixed timestamp. Revise the visual language if that
   sample feels like slides, a static dashboard or disconnected novelty.
10. Create `animation.composition` version 1.1 and bind the exact choreography Artifact. Duration
    and FPS must match. Source may realize the argument creatively but must not silently drop,
    reverse or falsify semantic operations.
11. Use choreography frames for exact states and targeted range/motion previews for trajectories.
    One preview run is limited evidence; use additional targeted previews when the chosen sample or
    a difficult beat is not covered.
12. After rendering, load `code-animation-review`. Review the full timeline for semantic truth and
    the sequence of audience insights, then inspect adjacent scenes for coherence without sameness.
    Compare rendered text against the declared inventory, perform a no-prose pass for every semantic
    beat, record timestamped corrections and revise before presenting the review render.

## Contract 1.3 shape

In addition to the shared objects, beats, actions and review criteria:

- `direction`: `visualThesis`, `continuityIntent`, `variationIntent`, non-empty
  `motionLanguage`, non-empty `antiPatterns`, and `sampleIntent`;
- `presentation`: `narrationMode` (`voice-led`, `selective-captions`, `kinetic-type`, or
  `full-transcript`), `communicationMode` (`visual-first` or `type-led`), plus prose `stageIntent`
  and `textIntent`; `visual-first` rejects full-transcript presentation;
- every beat: `visualQuestion`, `audienceInsight`, `relationToPrevious` (`establish`, `carry`,
  `transform`, `reframe`, `contrast`, `analogy`, `cutaway`, or `reset`), `continuityCue`, and
  `compositionIntent`;
- every beat: `visualProof`, describing what the imagery itself proves, and exact `textElements`
  with `id`, visible `text`, `role` (`label`, `value`, `formula`, `caption`, `title`, or `quote`) and
  `purpose`; display text is bounded by role and visual-first captions/titles/quotes cannot simply
  duplicate the complete narration;
- every action: `effect` (`state-change`, `focus-change`, or `presentation`). The final semantic
  state-change action's `resultingState` must equal the beat's `stateAfter`.

The first beat uses `establish`; later beats state an actual relationship instead of establishing
the film again. The contract validates timing, references and semantic honesty. It deliberately
does not score aesthetics, force a global hero, require adjacent state IDs, cap cuts/resets, or
turn directorial prose into numeric layout quotas.

Versions 1.0–1.2 remain readable for existing projects. Use 1.3 for new explanatory work. See
`docs/build/VISUAL-CHOREOGRAPHY-SPEC.md` for lifecycle and compatibility.
