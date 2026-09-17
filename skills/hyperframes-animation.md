# HyperFrames authoring craft

Load this skill only for an explicitly selected HyperFrames composition.

- Author one deterministic, paused timeline driven by the renderer. Avoid wall clocks, network
  requests, unseeded randomness and infinite repeats.
- Give timed elements stable unique IDs and the classes/data attributes required by the installed
  HyperFrames contract. Duplicate IDs can produce blank or incorrect frames.
- Make root width, height and background explicit. Browser preview can hide root sizing or
  transparent-background defects that appear in rendered output.
- Keep video/audio hierarchy compatible with the runtime and verify intrinsic aspect ratio,
  object-fit and letterboxing using the exact project asset.
- Run strict `animation.preflight`; inspect its normalized lint/runtime/layout/motion/contrast
  findings and preserved snapshots/crops, then open the raw JSON report only when more detail is
  needed. The adapter must not silently downgrade warnings, swap runtimes or mutate authored HTML.
- For important motion promises, optionally keep a matching `*.motion.json` beside the composition.
  Use assertions supported by the pinned runtime (for example appearance order, staying in frame,
  or continued movement); do not invent assertions merely to make the check pass.
- Design for the camera: compose each beat for the actual output frame, readable scale and visual
  hierarchy. Sub-compositions and relative timing are useful for long work when they clarify
  structure, but they are not mandatory architecture.
- For long explanations, sketch a lightweight beat intent before authoring: what changes, why the
  viewer should care, and which visual relationship proves the spoken claim. Keep that intent in
  the existing project/workflow artifacts and let the source structure follow it; do not create a
  mandatory storyboard gate or a fixed number of scenes.
- Prefer a source-specific visual vocabulary over a sequence of interchangeable cards. Reuse a
  visual object across beats when its continuity teaches causality, and use hold time deliberately
  so the viewer can read the state before it transforms.
- Use `animation.preview / hyperframes-preview` for exact key frames, transition boundaries and
  suspicious timestamps before a long render. Treat checks as technical evidence, not proof of visual quality. Review representative frames,
  opening/ending holds and dense keyframe regions. For video-heavy compositions prefer stable,
  conservative concurrency over maximum worker count.
- Use `animation.preview / hyperframes-motion-preview` selectively for an important or suspicious
  selector. Its onion-skin path/strip is evidence about trajectory, overlap and continuity between
  sampled stills; it is not a requirement for every element and not a substitute for playback.
- A passed preflight with incomplete diagnostic coverage is not silently equivalent to full
  coverage. Inspect `coverageComplete`, dropped transition samples and truncation, then target the
  affected beats with exact frames or motion previews.
- Do not assume a feature described by a different HyperFrames version exists. Pin dependencies
  and let live availability/preflight settle the installed contract.
