# Visual Choreography — semantic motion contract

Status: implemented as an optional project-native planning layer, 2026-09-18.

## Purpose

`animation.choreography` turns an explanation into observable, frame-aligned state changes before
runtime source is authored. It is intended for narration-led explainers, algorithms, diagrams,
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

## Contract 1.1 — continuity-first explanation

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

These checks do not judge aesthetics or measure rendered pixels. They prevent a plan from satisfying
“motion per beat” while still describing disconnected animated slides. Render review remains
responsible for confirming that hero identity, stage coverage and text-area targets are visible.

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
causality, state transition and readable hold. For 1.1, also review consecutive boundaries: the
hero must remain locatable, output state must become the next visible input state, ordinary beats
must not clear and rebuild the stage, and chapter changes must bridge. Audit the complete frame for
unused regions, repeated dashboard/card grammar and narration text competing with the model.
Missing, reordered or visually ambiguous semantic actions require revision even when the render is
technically clean. Continuous viewing and human listening remain mandatory before release; sampled
frames are evidence only.

## Boundaries

- No automatic inference that all videos need choreography.
- No fixed action-density threshold; the content determines beat length.
- No renderer-specific scene type in the choreography contract.
- No automatic creative verdict from motion amount or freeze detection.
- No change to delivery acceptance or final-state semantics.
