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
- Use `animation.preview / hyperframes-preview` for exact key frames, transition boundaries and
  suspicious timestamps before a long render. Treat checks as technical evidence, not proof of visual quality. Review representative frames,
  opening/ending holds and dense keyframe regions. For video-heavy compositions prefer stable,
  conservative concurrency over maximum worker count.
- Do not assume a feature described by a different HyperFrames version exists. Pin dependencies
  and let live availability/preflight settle the installed contract.
