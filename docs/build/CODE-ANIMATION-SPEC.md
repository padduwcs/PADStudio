# Code Animation — project-native extension

Status: authoring loop implemented with deterministic adapter tests, 2026-09-16.

## Purpose

PADStudio can keep editable, revisioned code animation inside a project and render it through
Manim Community, Remotion or HyperFrames. This is an optional branch in an adaptive workflow.
It does not turn PADStudio into a fixed animation pipeline and does not make a runtime or UI
responsible for creative choices.

The design selectively adopts useful lessons from OpenMontage: runtime-specific craft guidance,
frame-accurate composition, and the HyperFrames quality order of check-before-render. It does not
adopt raw caller-controlled paths, mutable workspaces, automatic `npx` downloads, static lint as a
sandbox, silent runtime fallback, or filename-based `final` semantics.

## Durable model

```text
animation.source-package Result (immutable code + manifest + checksums)
             │
             ├── animation.validation Result (static, exact package checksum)
             ├── animation.props Result (optional immutable JSON data)
             │
             └── animation.composition Artifact rN (intent + runtime + format + assets + props ref)
                              │
                    animation.preflight Result
                              │
              optional animation.preview Result (Remotion/HyperFrames)
                              │
                    animation.render Result
                              │
                optional source in video.sequence
```

For narration-led and stepwise work, an `animation.choreography` Artifact may be created before
source authoring. `animation.composition` 1.1 binds its exact Artifact revision; see
[VISUAL-CHOREOGRAPHY-SPEC.md](VISUAL-CHOREOGRAPHY-SPEC.md). Composition 1.0 remains supported.

New explainers should use choreography 1.3: an Agent-authored visual thesis, purposeful relationships
between beats, truthful semantic operations, composition intent, an explicit representative-sample
intent, visual proof for each beat and an exact inventory of planned text. It avoids disconnected
animated cards, transcript panels and the opposite failure of forcing the complete film into one
persistent dashboard. Choreography 1.0–1.2 remain compatible for existing projects.

Source/props edits create new Results. Composition edits create a new artifact revision with
`expectedRevision`. Preflight/render inputs name the exact artifact ID, revision and validation
Result. Full render also requires a passed preflight bound to the same source, props and composition.
Draft/history rendering is blocked unless `allowHistorical: true` is explicit.
The renderer records the exact source, validation, composition, props and preflight bindings.

## Capabilities and tools

| Capability | Tool | Responsibility |
| --- | --- | --- |
| `animation.source` | `code-animation-source` | Create/revise up to 64 UTF-8 source files; never execute them. |
| `animation.props` | `code-animation-props` | Create/revise bounded immutable JSON props/data without executing code. |
| `animation.validate` | `code-animation-validator` | Verify checksums, entry contract and blocked host/network constructs without execution. |
| `animation.preflight` | three runtime-specific `*-preflight` tools | Check the exact validated workspace and preserve diagnostics, including failures. |
| `animation.preview` | `remotion-preview` | Render selected still frames and/or a clip of at most 30 seconds after passed preflight. |
| `animation.preview` | `hyperframes-preview` | Capture selected exact frames and a contact sheet after passed preflight. |
| `animation.preview` | `hyperframes-motion-preview` | Inspect one selector and preserve a bounded onion-skin path/strip plus JSON keyframe diagnostics. |
| `animation.render` | `manim-ce` | Render a validated Manim `Scene`. |
| `animation.render` | `remotion-local` | Render a validated Remotion composition frame-accurately. |
| `animation.render` | `hyperframes-local` | Run strict HyperFrames check, then render authored `index.html`. |

All adapters use the shared Executor and project-owned output workspace. They never accept raw
input/output paths and never auto-install dependencies. Runtime selection is exact; an unavailable
runtime fails with setup guidance instead of falling back.

## Source package 1.0

The source Result contains `manifest.json` as `primary` and each source file as a registered Result
file. Manifest fields are `runtime`, `entryFile`, `entrySymbol`, pinned dependency declarations,
`sourceFiles`, `packageSha256`, `parentSourceResultId`, and `changeSummary`. Paths must be relative,
cannot traverse, and are case-insensitively unique. Limits are 1 MiB per file and 4 MiB per package.

`revise` requires `baseResultId` and patch-like `changes`; `content: null` deletes a file. Omitted
dependencies inherit from the base package. Earlier bytes and metadata remain intact.
`animation:read` returns the manifest by default and retrieves one file or `--all` by exact Result
ID when an Agent needs to continue editing; it does not expose backing filesystem paths.

## Composition artifact 1.0 and 1.1

`animation.composition` stores intent/change reason, exact runtime/source/entry, even output
dimensions, integer FPS, frame-aligned target duration, timing mode, opaque MP4 background, explicit assets mapped only under `assets/`, style
principles, and review criteria. It fixes `executionPolicy.codeTrust` to `agent-managed-execution` and
`executionPolicy.networkAccess` to `not-required`.

Version 1.1 additionally requires `choreographyArtifactId`. The Store verifies that it identifies
an exact `animation.choreography` Artifact included in references and that duration/FPS match.

`propsResultId` is optional and must reference an `animation.props` Result included in artifact
references. Props are normalized JSON, limited to 1 MiB and depth 32, stored both as metadata and a
checksummed `props.json`. Revisions create new Results and retain the parent Result ID. At execution,
PADStudio stages the exact file as `data/props.json`; Remotion also receives it through its CLI
`--props` argument. The renderer never accepts caller-controlled props paths.

Timing is explicit without making the Agent chase runtime rounding. `exact` keeps the target duration
as a strict output contract (with only container-level tolerance). Manim defaults to `measured`: its
verified output may differ from the target within a small bounded tolerance of two frames to 1% of
the target, capped at two seconds. The Result records target, actual duration, drift and tolerance;
the exact measured Result duration is what downstream sequence composition consumes. Remotion is
always `exact` because PADStudio supplies its frame range. PADStudio never silently trims, pads or
retimes code-animation output to make a mismatch pass.

The Store verifies source type/runtime/entry, every source checksum, every declared asset, and all
artifact references before accepting an active revision. Asset targets cannot overwrite source files
during materialization.

## Trust and execution boundary

Generated code is not safe merely because it passed a regex or AST check. Validation therefore says
`static_source_only` and `not_a_sandbox`. It is nevertheless the automatic execution gate: after the
exact immutable source passes validation, the Agent may run preflight, preview and render without a
separate user code-approval decision. This matches the useful OpenMontage authoring behavior: runtime
checks and renders stay inside the agent loop, while human approval is reserved for creative/publish
milestones rather than repeated source-level confirmations.

Remotion validation rejects `staticFile()`, raw `assets/...` media URLs and unresolved relative imports
because those constructs cannot consume PADStudio's staged assets reliably. Changing source bytes
creates a new immutable Result and invalidates the old validation/preflight binding, so the Agent must
validate and preflight the new revision before it executes. Historical `animation_code_execution`
decisions remain readable for old projects but are ignored and cannot be newly recorded. The retired
`project:approve-code` command is not part of the runtime contract.

Each preflight, preview or render copies verified source, props and declared assets into a temporary Run workspace and passes an
allowlisted environment. It does not expose provider secrets. The current host process does not
enforce OS/container network isolation; render evidence states `networkIsolation:
not_enforced_by_host`. This limitation is explicit and must not be represented as a sandbox.

## Preflight, preview, diagnostics and render verification

Preflight is a durable Result rather than a transient console check. A non-zero runtime check still
creates `animation.preflight` with `data.status: failed`, capped stdout/stderr, parsed JSON when
available, command shape and runtime fingerprint. Run/repository paths are redacted from preserved
diagnostics. Such a Result is evidence but cannot authorize
preview/render. Remotion lists/compiles the exact composition with exact props; HyperFrames runs
strict JSON check. Manim uses non-interactive runtime/version and TeX-tool discovery, so its Result
explicitly limits scope to the environment; exact Scene execution, fonts and Scene-specific
dependencies first resolve during render.

Remotion preview requires the exact passed preflight and can emit up to twelve PNG stills plus an
optional frame-aligned clip no longer than 30 seconds. The clip is probed for resolution, FPS and
duration. HyperFrames preflight uses adaptive timeline samples, transition-boundary sampling, and
preserves normalized lint/runtime/layout/motion/contrast findings plus snapshots and finding crops.
Its frame preview can capture up to twelve requested exact frames and preserves the generated contact
sheet. Its optional selector-scoped motion preview records keyframe diagnostics and a bounded onion-skin
path/strip for a chosen frame interval. Preflight also exposes whether findings were truncated or
transition samples were dropped; incomplete coverage remains visible rather than being treated as
full coverage. A matching `*.motion.json` may be included in the immutable source package when the authored
motion has useful testable promises; it remains optional. Preview is an authoring aid, not technical
or creative acceptance. PADStudio does not pretend that all runtimes expose the same preview contract.

When a composition binds choreography, Remotion and HyperFrames preview may use
`useChoreographyFrames: true`. PADStudio selects bounded exact frames from beat starts, semantic
action results and deliberate holds, and records `frameSelection: choreography` in the preview.

The runtime must exit successfully and create the declared MP4. PADStudio probes resolution, frame
rate and duration against the composition timing contract, then creates a poster and JSON render report. Result files
carry SHA-256 and remain inside `outputs/<run-id>/`. Technical verification does not assert mathematical
correctness, visual taste, accessibility or human review.

Final-output QA plans semantic samples and adaptive cadence samples across the complete timeline,
up to 120 frames. A three-minute render is covered at gaps of at most five seconds rather than only
its start/middle/end. For spoken output, `quality:inspect` may receive `expectedSpeech` with exact
script text, important terms and conservative similarity thresholds. ASR/script alignment and term
recognition become fail-closed checks and participate in the QA reuse key. These checks expose likely
wording or pronunciation defects; they do not identify phonetic cause and do not replace listening.

The `code-animation-review` skill adds evidence-driven creative review: representative authoring
samples, complete-timeline coverage, timestamped findings with proposed corrections, semantic
agreement between narration and motion, purposeful scene relationships, and checks for
slideshow/template repetition and project-specific visual identity. These are review
heuristics, not fixed stages or automatic creative decisions.

An `animation.render` primary file has media type `video`, so the existing `video.sequence` source
contract consumes it without conversion or duplication. Final delivery remains governed by exact
sequence render acceptance, output QA and `video.export-delivery`.

## Runtime setup

- Manim: explicitly install/pin Manim Community and FFmpeg; optionally set `PADSTUDIO_MANIM_PATH`.
- Remotion: explicitly install/pin a compatible CLI/runtime. PADStudio discovers the isolated
  `.runtime-tools/code-animation-node` installation. Current Chrome security policy can reject
  remote debugging in branded Chrome 136+, so PADStudio only auto-discovers Chrome for Testing or
  Chrome Headless Shell under `.runtime-tools`; use `PADSTUDIO_REMOTION_PATH` and
  `PADSTUDIO_CHROME_PATH` for explicit overrides. It never downloads a browser.
- HyperFrames: explicitly install/pin the CLI. The prepared local runtime is pinned to 0.8.42;
  renders use strict warnings and disable best-effort media fallback. Availability runs structured
  `doctor` diagnostics and reports optional failures as degraded evidence rather than hiding them.
  PADStudio discovers the same isolated Node runtime
  and existing browser; use `PADSTUDIO_HYPERFRAMES_PATH` or `PADSTUDIO_CHROME_PATH` to override them.
- FFmpeg/ffprobe can use `PADSTUDIO_FFMPEG_PATH` and `PADSTUDIO_FFPROBE_PATH`.

Dependency declarations are provenance, not an instruction to install packages. Availability is
reported by `tool:list`. The optional runtimes remain local and ignored by Git. Windows acceptance on
2026-09-14 used Manim CE 0.21.0, Remotion 4.0.524, HyperFrames 0.8.38, React 18.2.0, Chrome and
FFmpeg 8.1.2; each runtime produced a probed 320x180, 24 fps, one-second MP4.
HyperFrames was upgraded locally to 0.8.42 on 2026-09-17 for process-cleanup, long-capture media and
SDR/HDR reliability fixes; PADStudio still does not auto-update it during project operation.

The expanded authoring-loop acceptance passed on Windows on 2026-09-16 with pinned Chrome Headless
Shell 153.0.8010.47: managed source and props, static validation, exact preflight, three stills, a
frame-range preview clip and a full probed Remotion render all completed through Registry/Executor.
Windows output commit and rollback retry transient `EPERM`/`EBUSY` locks for a bounded period while
preserving atomic rename semantics; they never copy partially written output as a fallback. Re-run
the real fixture with `npm run animation:acceptance`. Full animation render timeout is one hour so a
multi-minute composition is not constrained by the short-preview budget; cancellation remains explicit.

## Observer and acceptance

Full context exposes compositions, source/props packages, exact validation,
preflights, previews and render files. Summary/resume expose active compositions compactly. The
read-only observer shows runtime status, diagnostics limitations, a still/clip gallery and playable
registered render Results. It performs no mutation.

Automated tests cover immutable source/props revision provenance, traversal rejection, blocked host/network APIs,
exact validation/preflight binding, autonomous managed execution without a code-approval decision, preview/render evidence,
unavailable-runtime honesty, observer projection, and direct `video.sequence` consumption. Runtime-specific
skills route only the selected Remotion, HyperFrames or Manim craft guidance. Real runtime smoke tests must be run only
in a prepared, pinned environment and must never trigger installs during an ordinary render.
