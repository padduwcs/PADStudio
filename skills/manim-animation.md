# Manim authoring craft

Load this skill only when Manim is the chosen runtime for mathematical, geometric or explanatory motion.

- Before coding a complex lesson, sketch only the useful beats: hook, claim, visual construction,
  transformation and landing. This is optional working material, not a mandatory project stage.
- Use semantic mathematical objects and transformations so continuity is visible. Prefer
  transforming an existing object over replacing it with an unrelated copy when identity matters.
- Reserve frame regions deliberately for equations, diagrams and labels. Test bounding boxes,
  camera framing and the longest notation; avoid adding text until objects merely stop overlapping.
- Make narration/pacing room explicit with `wait` and run times. Manim timing is measured by the
  output, so the target duration guides authoring but does not justify retiming a mismatched render.
- Use project-managed fonts and assets. Keep LaTeX dependencies explicit and surface missing TeX,
  font or renderer support as diagnostics rather than changing the visual silently.
- `animation.preflight` currently verifies the Manim runtime and reports TeX tool availability,
  not exact Scene execution. The
  first preview/render is therefore the exact-code runtime proof; preserve this limitation when
  reporting readiness.
- Review mathematical correctness separately from visual craft: symbol identity, step order,
  coordinate meaning, label legibility, camera motion and whether each transformation teaches.
