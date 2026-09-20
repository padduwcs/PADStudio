# Remotion authoring craft

Load this skill only when the chosen runtime is Remotion. Keep creative choices in the Agent;
these are mechanics and review heuristics, not a stock-scene recipe.

- Design from frames and beats. Derive timing from `useCurrentFrame()` and composition FPS;
  do not use wall clocks, CSS transitions, or nondeterministic animation state.
- Keep the composition component parameterized. Put changeable copy, values and configuration in
  an immutable `animation.props` Result and bind it through `animation.composition.propsResultId`.
- Use project-managed assets only. Import their declared staged `assets/...` targets as modules and
  pass the imported URL to Remotion components. Do not use `staticFile()`, raw `assets/...` URLs,
  paths outside the Run workspace or fetch media at render time.
- Measure text and DOM geometry before committing a layout. Test the longest real copy, safe
  margins, font loading, line wrapping and vertical rhythm at exact output dimensions.
- Use `Sequence`, spring/interpolation and transitions because they express the intended motion,
  not merely because a preset exists. Clamp extrapolation where overshoot would expose invalid UI.
- Prefer one primary visual subject per beat. Reuse utilities and design tokens, but avoid making
  every video look like the same card/chart/title template.
- Keep a multi-beat composition modular enough to revise locally: a thin registered root, passage
  or scene modules, low-level visual primitives, and timing/data/theme separated where they actually
  vary. Do not build one universal scene component with a large optional-prop switchboard; that moves
  creative decisions into fallback behavior and tends to produce template slides.
- For a hero explainer, derive a small visual vocabulary from the subject itself. Vary motion
  intensity and information density across hook, construction, insight and landing; check that the
  result would remain recognizable if all words disappeared.
- After approval, run exact preflight. Use `remotion-preview` for opening, closing and each major
  beat, plus a short transition clip. Revise source/props when evidence exposes a problem; never
  treat preview success as final creative approval.
- Use a pinned Chrome for Testing or Chrome Headless Shell. Do not silently fall back to the user's
  branded browser when its remote-debugging policy rejects automation.
- Check audio/video frame boundaries, OffthreadVideo behavior and actual duration in the full
  render. A successful bundle or composition listing only proves runtime readiness.
