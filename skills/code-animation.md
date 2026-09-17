# Project-native code animation

Use this skill for mathematical exposition, animated infographics, SVG/icon motion,
kinetic typography and other visuals whose editable source belongs in the project.
Code animation is an optional production branch, not a required pipeline stage.

1. Choose the runtime for the idea: Manim for mathematical and geometric exposition;
   Remotion for React-driven, frame-accurate motion systems and typography; HyperFrames
   for authored HTML/CSS/SVG/GSAP compositions. Do not silently swap runtimes. Load exactly one
   runtime craft skill (`manim-animation`, `remotion-animation`, or `hyperframes-animation`).
2. Create source with `animation.source / code-animation-source`. Reopen an existing package with
   `animation:read` by Result ID; request one file or `--all` only when its content is needed. Revise from an exact
   `baseResultId`; never mutate an earlier package. Declare dependencies and pin versions.
3. Put changeable JSON data in an immutable `animation.props` Result when useful, then create or
   revise `animation.composition` with exact source/props Results, entry symbol,
   frame-aligned target duration, output format, local asset mappings, style principles and
   concrete review criteria. Preserve stable artifact IDs across revisions. Manim defaults to
   `timing.mode: measured`: the target guides planning while the verified render Result owns the
   exact duration within a small bounded tolerance. Use `exact` only when authored timing truly
   controls the output. Remotion always uses `exact` because PADStudio renders a fixed frame range.
4. Treat generated source as untrusted input. Finish source, props, asset mappings and the
   composition first, then run `animation.validate`. Resolve every static finding—including Remotion
   asset imports—before execution. Static validation is not a sandbox, but it is the automatic gate:
   there is no user code-approval prompt. Use only project-owned source/assets, pinned runtimes,
   the managed temporary workspace and the filtered environment.
5. Run matching `animation.preflight` and inspect its diagnostic Result. A failed
   preflight remains evidence and cannot authorize preview/render. Remotion can then create selected
   stills and a short frame-range clip with `animation.preview / remotion-preview`; HyperFrames can
   capture exact requested frames and a contact sheet with `animation.preview / hyperframes-preview`.
   Use preview as an authoring loop, not as acceptance. Manim preflight currently checks runtime
   health only; HyperFrames preflight preserves normalized findings, snapshots and its raw strict report.
6. Render with the matching adapter and exact passed preflight Result. Draft/history requires explicit `allowHistorical: true`.
   PADStudio never installs dependencies, calls `npx`,
   or falls back to another runtime automatically. If unavailable, surface setup guidance.
   When source bytes change, create a new immutable source Result, validate and preflight it again.
   Ignore historical checkpoints that mention `approve-code`; they are advisory state from the retired contract.
7. The renderer materializes a temporary Run workspace, verifies source checksums, copies
   only declared project assets, filters environment variables, and checks output duration,
   resolution and frame rate. Host network isolation is not currently enforced; never claim it is.
8. Load `code-animation-review` and inspect the full animation, not only its poster. Cover every logical beat and transition, plus
   the opening and ending. Review semantic correctness, hierarchy, pacing, continuity, readability,
   easing and safe margins. Treat black/freeze measurements as evidence: decide whether a hold gives
   the explanation room to land or is merely dead time; notice repeated empty transitions and whether
   visual changes track the narration. Do not turn every static explanatory hold into an automatic failure.
9. Use the resulting `animation.render` as a normal Result source in `video.sequence`.
   Keep reusable animation renders independent; do not flatten them into an unmanaged clip.

Learn principles from references without copying their fixed workflows or unsafe path/execution
assumptions. A successful process exit proves only technical completion, not creative quality.
If a PADStudio contract or adapter bug blocks the project, preserve the exact Run/Result and report it.
Do not edit PADStudio `src/`, `test/` or build documentation while acting as the video-production Agent.
