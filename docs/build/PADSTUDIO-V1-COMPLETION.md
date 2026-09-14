# PADStudio V1 — completion report

Updated: **2026-09-14**. Status: **implementation complete; ready for owner user acceptance**.

## Product boundary

PADStudio V1 uses an external Agent host for chat and control. The local web application is a read-only observer. An integrated chat client, login layer, web mutations and provider-specific workflow are not part of V1.

## Completed in this pass

- Tool contracts now expose best use, limitations, setup, required skills, usage, alternatives and a six-factor selection profile. `tool:recommend` is advisory; execution still names an exact tool and never silently falls back.
- Project budgets support observe/cap mode, reserve in-progress estimates, reconcile completed spend and require exact authorization above the configured single-action threshold.
- Wikimedia Commons stock search returns image/video/audio candidates with creator, license and source-page provenance. Selection and acquisition remain explicit.
- Media created by an external Agent/provider can be registered from a managed Resource/Result with exact bytes, provider, model, prompt, seed/request ID, rights basis and external cost metadata.
- Production skills cover tool selection, visual taste, music direction, stock sourcing and full human release review.
- Exact-output QA samples segment/caption/overlay/transition windows, performs full decode, and detects black/frozen windows in addition to existing audio, ASR and cut checks.
- Human viewing/listening attestation is stored against the exact render SHA-256 and sequence revision and is shown in the observer.
- Holdout manifests stream-hash media and human gold files, enforce rights and path boundaries, and produce a canonical checksum. Release evidence assembly re-verifies exact render bytes before using a human attestation.
- The asset browser acceptance now deliberately activates lazy Result loading and runs generated-media registration through Registry/Executor.
- Final hardening rejects corrupt budget metadata and malformed recommendation/holdout/provider inputs, binds release holdout measurements to their exact corpus, selects only complete human attestations in the release CLI, and closes freeze windows that continue to the end of a render.
- Runtime context is split from development documentation: `project:resume` emits a compact continuation capsule, Agent instructions route operation/development separately, and completed projects can be archived/restored without deleting history.

## Verification

- Repository tests: **264/264 passed**.
- Source-analysis harness: **20/20 passed** through production/operations acceptance.
- Asset acceptance: **passed** with audio/image previews, attribution, preserved player state and 390/768/1440 px viewports.
- Production acceptance: **passed_with_documented_limits**.
- Operations acceptance: **passed_with_documented_limits**, including interrupted finalization recovery, exact delivery, deep integrity and browser regression.
- Release evaluator acceptance: **passed_with_documented_limits**; missing or falsified evidence remains blocked.
- JavaScript syntax check, JSON parse check and `git diff --check`: passed.

Machine verification does not claim that a person watched or listened, that an unavailable provider account works, or that a real independent holdout corpus meets broad-release thresholds. Those are the owner's user-acceptance and release-evidence inputs, not unfinished implementation.

Machine-readable summary: [padstudio-v1-completion.json](../../reports/padstudio-v1-completion.json).
