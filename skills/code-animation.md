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
   frame-aligned duration, output format, local asset mappings, style principles and
   concrete review criteria. Preserve stable artifact IDs across revisions.
4. Treat generated source as untrusted until reviewed. Run `animation.validate` first.
   This is static lint, not a sandbox. Before render, obtain a user ProjectDecision on the
   exact source Result with category `animation_code_execution` and outcome `approved`.
5. Render with the matching adapter. Draft/history requires explicit `allowHistorical: true`.
   PADStudio never installs dependencies, calls `npx`,
   or falls back to another runtime automatically. If unavailable, surface setup guidance.
6. The renderer materializes a temporary Run workspace, verifies source checksums, copies
   only declared project assets, filters environment variables, and checks output duration,
   resolution and frame rate. Host network isolation is not currently enforced; never claim it is.
7. Inspect the poster and full animation. Review semantic correctness, hierarchy, pacing,
   continuity, readability, easing, safe margins and visual artifacts separately from the
   renderer's technical checks. Revise source or composition according to what actually changed.
8. Use the resulting `animation.render` as a normal Result source in `video.sequence`.
   Keep reusable animation renders independent; do not flatten them into an unmanaged clip.

Learn principles from references without copying their fixed workflows or unsafe path/execution
assumptions. A successful process exit proves only technical completion, not creative quality.
