# Code Animation — project-native extension

Status: implemented contract and deterministic adapter tests, 2026-09-14.

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
             │
             └── animation.composition Artifact rN (intent + runtime + format + assets)
                              │
                user ProjectDecision on exact source Result
                              │
                    animation.render Result
                              │
                optional source in video.sequence
```

Source edits create a new Result. Composition edits create a new artifact revision with
`expectedRevision`. Render inputs name the exact artifact ID, revision and validation Result.
Draft/history rendering is blocked unless `allowHistorical: true` is explicit.
The renderer records all three plus the exact user execution decision.

## Capabilities and tools

| Capability | Tool | Responsibility |
| --- | --- | --- |
| `animation.source` | `code-animation-source` | Create/revise up to 64 UTF-8 source files; never execute them. |
| `animation.validate` | `code-animation-validator` | Verify checksums, entry contract and blocked host/network constructs without execution. |
| `animation.render` | `manim-ce` | Render an approved Manim `Scene`. |
| `animation.render` | `remotion-local` | Render an approved Remotion composition frame-accurately. |
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

## Composition artifact 1.0

`animation.composition` stores intent/change reason, exact runtime/source/entry, even output
dimensions, integer FPS, frame-aligned target duration, timing mode, opaque MP4 background, explicit assets mapped only under `assets/`, style
principles, and review criteria. It fixes `executionPolicy.codeTrust` to `exact-user-approval` and
`executionPolicy.networkAccess` to `not-required`.

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
`static_source_only` and `not_a_sandbox`. Rendering requires the latest confirmed user
ProjectDecision targeting the exact source Result. Positive execution approval cannot be imported
through `project:decide`, JSON, stdin or a non-interactive process. The human must run:

```powershell
npm run project:approve-code -- <project-id> <source-result-id>
```

The command displays the exact Result, runtime, passing validation, complete package checksum and
source-file checksums, then requires a target-bound phrase from an interactive TTY. The Agent must
end its turn at this gate and must not type or pipe the answer. This is a deliberate per-gate pause,
adapted from OpenMontage's useful approval discipline without adopting its fixed production pipeline.
The receipt records channel, action, target and timestamp. It prevents ordinary Agent-authored
payloads from impersonating a user; it is not a cryptographic identity boundary against a process
with unrestricted access to the repository and host.

Each render copies verified source and declared assets into a temporary Run workspace and passes an
allowlisted environment. It does not expose provider secrets. The current host process does not
enforce OS/container network isolation; render evidence states `networkIsolation:
not_enforced_by_host`. This limitation is explicit and must not be represented as a sandbox.

## Render verification and reuse

The runtime must exit successfully and create the declared MP4. PADStudio probes resolution, frame
rate and duration against the composition timing contract, then creates a poster and JSON render report. Result files
carry SHA-256 and remain inside `outputs/<run-id>/`. Technical verification does not assert mathematical
correctness, visual taste, accessibility or human review.

An `animation.render` primary file has media type `video`, so the existing `video.sequence` source
contract consumes it without conversion or duplication. Final delivery remains governed by exact
sequence render acceptance, output QA and `video.export-delivery`.

## Runtime setup

- Manim: explicitly install/pin Manim Community and FFmpeg; optionally set `PADSTUDIO_MANIM_PATH`.
- Remotion: explicitly install/pin a compatible CLI/runtime. PADStudio discovers the isolated
  `.runtime-tools/code-animation-node` installation and a known local Chrome/Edge path; use
  `PADSTUDIO_REMOTION_PATH` or `PADSTUDIO_CHROME_PATH` to override them.
- HyperFrames: explicitly install/pin the CLI. PADStudio discovers the same isolated Node runtime
  and existing browser; use `PADSTUDIO_HYPERFRAMES_PATH` or `PADSTUDIO_CHROME_PATH` to override them.
- FFmpeg/ffprobe can use `PADSTUDIO_FFMPEG_PATH` and `PADSTUDIO_FFPROBE_PATH`.

Dependency declarations are provenance, not an instruction to install packages. Availability is
reported by `tool:list`. The optional runtimes remain local and ignored by Git. Windows acceptance on
2026-09-14 used Manim CE 0.21.0, Remotion 4.0.524, HyperFrames 0.8.38, React 18.2.0, Chrome and
FFmpeg 8.1.2; each runtime produced a probed 320x180, 24 fps, one-second MP4.

## Observer and acceptance

Full context exposes compositions, source packages, exact validation, execution approval and render
files. Summary/resume expose active compositions compactly. The read-only observer has an animation
section with revision/runtime/status and playable registered render Results. It performs no mutation.

Automated tests cover immutable revision provenance, traversal rejection, blocked host/network APIs,
exact validation binding, interactive-confirmation enforcement, render evidence, unavailable-runtime honesty,
observer projection, and direct `video.sequence` consumption. Real runtime smoke tests must be run only
in a prepared, pinned environment and must never trigger installs during an ordinary render.
