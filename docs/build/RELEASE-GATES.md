# PADStudio broad-release evidence gates

Updated: **2026-09-13**. Current status: **not measured; broad release remains blocked**.

This contract turns previously narrative release limitations into an executable checklist. It does not add a fixed production pipeline, change `releaseDefault`, or make a release decision. Project workflows remain adaptive and Agent-led.

## Boundaries

- `D:\Test\vid` is the known owner development corpus: 25 portrait H.264/AAC programming videos already used during development evaluation. It is useful for regression and may support matching media-slot evidence, but it is never an independent holdout.
- Fixture evidence tests the gate evaluator. It never proves product or media quality.
- No media is copied into the repository by this mechanism. Evidence documents contain durable references to separately controlled reports, Results, corpus manifests, and human attestations.
- Every broad-release gate is blocking. Missing, duplicate, malformed, or failed evidence remains visible and fail-closed.
- The evaluator checks measured thresholds and media/corpus characteristics itself. A caller-supplied `outcome: passed` never overrides contradictory values.
- Even a complete evidence set only requests an explicit owner release decision. The evaluator always reports `releaseReady: false` and never changes `releaseDefault: null`.

## Executable checklist

The machine-readable manifest is [`eval/release-gates/manifest.json`](../../eval/release-gates/manifest.json). It covers:

1. A rights-cleared independent gold holdout, locked before evaluation.
2. Gold-transcript ASR error/timing measurements and scene precision/recall.
3. End-to-end media slots for landscape, VFR, 4K, audio-only, image-only, multi-track, two-hour duration, non-zero stream offset, and corrupt-input failure.
4. The 100-file/10-hour query and memory benchmark.
5. Human viewing and human listening bound to an exact Result and artifact revision.
6. A representative exact Result checked against its approved delivery promise for technical, visual, audio, and promise-preservation quality.

The delivery-promise idea is adapted from OpenMontage: PADStudio binds the review to durable project evidence instead of imposing OpenMontage's fixed stages or renderer choices.

## Run

Without evidence, the command intentionally exits `2` and reports every missing gate as `not_measured`:

```powershell
node src/cli/release-gates.js
```

Evaluate a candidate evidence document without modifying it or any project:

```powershell
node src/cli/release-gates.js --evidence path/to/release-evidence.json
```

Run the evaluator acceptance fixture:

```powershell
node scripts/release-gates-acceptance.mjs
```

The checked fixture at `eval/release-gates/test-fixture-evidence.json` is marked `scope: test_fixture`. A complete fixture returns `fixture_passed`, while retaining `releaseReady: false`.

## Evidence document

Evidence uses version `1.0`, scope `release_candidate`, declared corpora, and exactly one measurement per gate. A measurement needs:

- `outcome`: `passed` or `failed`; absence is represented by no measurement, never by a caller-supplied fake pass;
- `measuredAt`, a reproducible `method`, and one or more durable `evidenceRefs`;
- unique `corpusId` values for media/corpus gates, with confirmed rights;
- for the independent holdout: a pre-evaluation lock, manifest SHA-256, proof it was not development data, and the section 13.1 characteristics (90 audio minutes, 36 clips, clean/hard Vietnamese and no-speech coverage, 300 timing boundaries, 12 scene clips, 100 hard cuts, speaker/source split, and human-verified gold);
- actual metric fields for quality and scale gates. The evaluator enforces non-negative error/timing values, bounded ratios, ASR names/numbers accuracy of at least 90%, scene precision/recall of at least 90%, query p95 at most 500 ms, summary p95 at most one second, and peak memory at most 16 GiB;
- media-slot characteristics plus `endToEndCompleted: 1` (or `failureWasExplicit: 1` for corrupt input), so an asserted outcome alone cannot satisfy a slot;
- a human reviewer plus exact Result/artifact revision and an explicit full-result `attestation.action` of `viewed` or `listened` for the corresponding gate;
- exact Result, output profile, approved promise revision, and all four review checks for delivery-promise evidence.

Missing, malformed, or contradictory evidence produces `invalid`; an absent gate produces `not_measured`; a valid explicit failure produces `measured_failed`. All three keep the overall status `blocked`.

`status: evidence_complete` means the document is structurally complete, every measured requirement passes the evaluator's contract, and no submitted outcome failed. It is not a release certificate. The owner must review the underlying evidence and make a separate explicit decision.

## How to fill the gaps efficiently

Use a small, rights-cleared corpus manifest where one source may cover multiple compatible slots. Do not manufacture one file merely to tick every box when it would hide real-world diversity. Lock the independent holdout manifest before tuning thresholds, retain checksums, and record the exact command/profile/environment used for every measurement.

Human viewing and listening must inspect representative exact Results, not source files or technical metrics alone. A user acceptance without an explicit listening/viewing attestation does not retroactively satisfy these gates.
