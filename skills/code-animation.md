# Project-native code animation

Use this skill for mathematical exposition, animated infographics, SVG/icon motion,
kinetic typography and other visuals whose editable source belongs in the project.
Code animation is an optional production branch, not a required pipeline stage.

1. Choose the runtime for the idea: Manim for mathematical and geometric exposition;
   Remotion for React-driven, frame-accurate motion systems and typography; HyperFrames
   for authored HTML/CSS/SVG/GSAP compositions. Do not silently swap runtimes.
2. Create source with `animation.source / code-animation-source`. Reopen an existing package with
   `animation:read` by Result ID; request one file or `--all` only when its content is needed. Revise from an exact
   `baseResultId`; never mutate an earlier package. Declare dependencies and pin versions.
3. Create or revise `animation.composition` with an exact source Result, entry symbol,
   frame-aligned target duration, output format, local asset mappings, style principles and
   concrete review criteria. Preserve stable artifact IDs across revisions. Manim defaults to
   `timing.mode: measured`: the target guides planning while the verified render Result owns the
   exact duration within a small bounded tolerance. Use `exact` only when authored timing truly
   controls the output. Remotion always uses `exact` because PADStudio renders a fixed frame range.
4. Treat generated source as untrusted until reviewed. Run `animation.validate` first.
   This is static lint, not a sandbox. Before render, stop and ask the user to run
   `npm run project:approve-code -- <project-id> <source-result-id>` themselves in an
   interactive terminal. Never type the confirmation for them, pipe input, prepare an approval
   JSON, or continue in the same Agent turn. Only that command can create the confirmed user
   ProjectDecision for the exact source Result.
5. Render with the matching adapter. Draft/history requires explicit `allowHistorical: true`.
   PADStudio never installs dependencies, calls `npx`,
   or falls back to another runtime automatically. If unavailable, surface setup guidance.
   After the user reports completing an approval command, run `project:resume` and trust its durable
   execution approval. Do not ask for the same exact source again because an older checkpoint still says pending.
6. The renderer materializes a temporary Run workspace, verifies source checksums, copies
   only declared project assets, filters environment variables, and checks output duration,
   resolution and frame rate. Host network isolation is not currently enforced; never claim it is.
7. Inspect the full animation, not only its poster. Cover every logical beat and transition, plus
   the opening and ending. Review semantic correctness, hierarchy, pacing, continuity, readability,
   easing and safe margins. Treat black/freeze measurements as evidence: decide whether a hold gives
   the explanation room to land or is merely dead time; notice repeated empty transitions and whether
   visual changes track the narration. Do not turn every static explanatory hold into an automatic failure.
8. Use the resulting `animation.render` as a normal Result source in `video.sequence`.
   Keep reusable animation renders independent; do not flatten them into an unmanaged clip.

Learn principles from references without copying their fixed workflows or unsafe path/execution
assumptions. A successful process exit proves only technical completion, not creative quality.
If a PADStudio contract or adapter bug blocks the project, preserve the exact Run/Result and report it.
Do not edit PADStudio `src/`, `test/` or build documentation while acting as the video-production Agent.
