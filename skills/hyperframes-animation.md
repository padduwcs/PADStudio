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
- Run strict `animation.preflight`; inspect its preserved JSON diagnostics. The adapter must not
  silently downgrade warnings, swap runtimes or mutate authored `index.html`.
- Treat checks as technical evidence, not proof of visual quality. Review representative frames,
  opening/ending holds and dense keyframe regions. For video-heavy compositions prefer stable,
  conservative concurrency over maximum worker count.
- Do not assume a feature described by a different HyperFrames version exists. Pin dependencies
  and let live availability/preflight settle the installed contract.
