# Visual Choreography — semantic motion contract

Status: contract 1.3 implemented as an optional project-native directorial layer, 2026-09-20.

## Purpose

`animation.choreography` turns an explanation into a visual argument with observable, frame-aligned
state changes before runtime source is authored. It is intended for narration-led explainers, algorithms, diagrams,
mathematical transformations and product actions where a single still or generic pan/zoom cannot
prove the spoken claim.

This does not add a fixed storyboard stage. The Agent chooses it when semantic motion matters.
`video.sequence` remains the macro edit; choreography describes the micro-actions inside one code
animation Result.

## Durable relationship

```text
brief / direction / script evidence
              │
    animation.choreography Artifact rN
              │ exact Artifact reference
    animation.composition 1.1 Artifact rN
              │
 source → validation → preflight → choreography-aware preview → render
```

Choreography can exist before source code. A composition 1.1 must reference its exact choreography
Artifact and match its duration and FPS. Composition 1.0 remains valid for existing projects and
small work that does not need a choreography plan.

## Contract 1.0 compatibility

Top-level fields are `version`, `changeReason`, `purpose`, `durationSeconds`, `fps`, `objects`,
`beats` and `reviewCriteria`.

An object has a stable `id`, human label, role (`subject`, `context`, `evidence`, `annotation`),
continuity (`persistent`, `beat-local`) and observable initial state.

A beat records:

- `kind`: semantic, support or transition;
- frame-aligned start/end;
- audience `message` and optional exact `narrationText`;
- visual purpose, primary object and focus objects;
- state before and after;
- ordered timed actions;
- deliberate hold after the final action;
- optional continuity from an earlier beat;
- beat-specific review criteria.

An action records timing, verb, meaning, subject/target objects, visible description and resulting
state. A semantic beat must contain at least one non-hold semantic action. This prevents decorative
camera motion or a title entrance from masquerading as explanation.

Beats cannot overlap and actions must stay inside their beat. Actions may overlap each other for
intentional simultaneity but remain ordered by start time. All references to objects and earlier
beats are validated. Revisions preserve history and require `expectedRevision`.

Contract 1.0 remains readable for existing projects. It proves local beat semantics but does not
prove that the complete film preserves a visual model across beat boundaries.

## Contract 1.1 compatibility — continuity-first explanation

Version 1.1 adds a machine-checked continuity layer for narration-led and procedural explainers:

- `continuity` declares a visual thesis, persistent hero objects, continuous or chaptered model,
  and a small explicit reset budget;
- `presentation` declares voice-led or selective-caption narration, a dominant-stage coverage
  target and a maximum text-area target; full-transcript presentation panels are rejected;
- `chapters` form an ordered, contiguous causal arc and retain at least one global hero;
- every beat identifies its chapter, continuity mode, stable input/output state IDs, carried objects
  and the genuinely new information it contributes;
- each non-first beat references the immediately preceding beat. Unless it is an explicit reset,
  its input state ID must equal the preceding output state ID and it must carry a global hero;
- a chapter boundary must visibly bridge from the previous model or consume the reset budget;
- semantic beats must advance to a new state ID and contain a semantic action whose `effect` is
  `state-change`. Reveal, entrance, highlight, annotation and hold cannot be state changes;
- the final semantic state-change action must produce the beat's declared `stateAfter`.

These checks do not judge aesthetics or measure rendered pixels. Pilot use showed that their global
hero, exact state-chain and numeric presentation requirements could also overconstrain direction and
encourage one fixed dashboard. Contract 1.1 therefore remains readable for existing projects but is
not recommended for new explanatory work.

## Contract 1.2 — agent-directed visual argument

Version 1.2 keeps machine-checkable semantic truth while returning scene direction to the Agent:

- `direction` records the visual thesis, conceptual continuity intent, variation intent, motion
  language, anti-patterns and the opening/representative passage the Agent intends to sample first;
- `presentation` records narration mode plus prose stage/text intent without screen-area quotas;
- every beat records the visual question, intended audience insight, composition intent and a
  relationship to earlier material: establish, carry, transform, reframe, contrast, analogy,
  cutaway or reset;
- actions remain frame-aligned. A semantic beat still needs a genuine semantic `state-change`, and
  the final such action must produce the declared visible state.

The contract validates references, timing and semantic honesty. It deliberately does not require a
global hero, causal chapters, adjacent state IDs, carried-object ratios, reset budgets or numeric
layout targets. Continuity may live in evidence, color roles, values, spatial orientation, a visual
mapping or the logic of the argument. A purposeful cut or analogy is valid when it advances the
viewer; keeping one layout is not evidence of coherence.

## Contract 1.3 — visual-first communication

Version 1.3 keeps the directorial freedom of 1.2 and makes dependence on on-screen prose
inspectable before source is written:

- `presentation.communicationMode` declares `visual-first` or `type-led`. Ordinary narrated
  explanation should use visual-first; type-led remains valid when typography, a quotation or the
  written form is intentionally the subject;
- every beat declares `visualProof`: the understanding produced by visible objects, relationships
  and change rather than by reading a transcript;
- every planned text element is inventoried exactly with its role and purpose. Roles distinguish
  labels, values, formulas, captions, titles and quotations without imposing one visual style;
- visual-first rejects full-transcript presentation, an annotation as the primary subject of a
  semantic beat, and captions/titles/quotes that exactly duplicate that beat's narration;
- visual-first display strings have generous role-specific safety bounds that prevent paragraph-sized
  headings and labels; type-led retains a larger general data bound. These are structural guards,
  not an aesthetic word-count score.

PADStudio exposes communication metrics in observer context: text element and textless-beat counts,
role distribution, longest string, narration duplication and semantic beats with visual proof. The
metrics are evidence for Agent and human review; they do not automatically decide whether a video is
good or prescribe how much motion, text or empty space every project must contain.

Timed narration may be represented by an optional 1.3 `narrationCueMap`. Each cue identifies its
active beat and either a timed action or a reason to hold the completed image. Validation checks
chronology, references and gross action-duration mismatches. The observer exposes cue counts. This
is an authored synchronization plan, not audiovisual recognition; the Agent still inspects the
render against the actual voice. Existing 1.3 artifacts without a map remain valid.

After rendering, `animation.verify-sync / local-sync-verifier` turns the plan into evidence for review. For each cue it
measures the per-frame mean absolute luma difference of the exact render (FFmpeg `signalstats` YDIF at 160 px width) and
reports whether the first frame above a noise-relative threshold (`max(0.03, 4 × median motion)`) falls within the
tolerance (default 0.35 s, never below two frames) of the cue's planned action start: `aligned`, `late`,
`no_visible_change` or `ambiguous_ongoing_motion` when motion was already running as the window opened. A cue that
declares a `holdReason` is checked for stillness (`held` / `moving_during_hold`). With a `source.transcript` Result made
from the same render bytes it also reports whether words arrive on cue (`on_cue`, `late_voice`, `early_voice`,
`absent`). Pixel change cannot say what moved or whether it explains the narration, and subtle changes can stay below
the threshold, so the report is a guide to where to look, never a verdict.

Versions 1.0–1.2 remain readable. New narrated explanatory work should use 1.3. Existing 1.2 plans
do not become invalid merely because their text inventory was not recorded under the older contract.

## Preview evidence

PADStudio derives review points from every beat start, semantic action result and intentional hold.
It deduplicates exact frames and selects at most twelve evenly across the complete plan for bounded
runtime previews. Remotion and HyperFrames accept `useChoreographyFrames: true`; callers cannot mix
that with explicit frames. Explicit range clips and HyperFrames selector motion previews remain
available when stills cannot prove path, easing or continuity.

The full choreography is exposed in the animation observer. Preview, preflight and render Results
include both the composition and exact choreography in `inputArtifacts`.

## Review standard

Review each semantic beat for claim agreement, object identity, action order, direction, scale,
causality, state transition and readable hold. For 1.1, retain its legacy boundary checks. For 1.2/1.3,
review whether each declared relationship is legible and whether the audience insights form one
causal argument: carried state should remain recognizable, transformations should show cause,
reframing should preserve orientation, and contrasts/analogies should expose their mapping. Audit
the complete frame for unused regions, repeated dashboard/card grammar and narration text competing
with the visual subject.
For 1.3, compare the rendered words with `textElements` and perform a no-prose pass against each
`visualProof`. Values, symbols and labels may remain when they are part of the model; the test is
whether prose is doing explanatory work the planned imagery was supposed to do.
Missing, reordered or visually ambiguous semantic actions require revision even when the render is
technically clean. Continuous viewing and human listening remain mandatory before release; sampled
frames are evidence only.

## Boundaries

- No automatic inference that all videos need choreography.
- No fixed action-density threshold; the content determines beat length.
- No renderer-specific scene type in the choreography contract.
- No automatic creative verdict from motion amount or freeze detection.
- No change to delivery acceptance or final-state semantics.
