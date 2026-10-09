# Output profiles and style playbooks

This slice turns reusable production knowledge into validated, versioned data without making it a mandatory pipeline.

## Contracts

- `production-catalogs/output-profiles.v1.json` contains four generic local-delivery targets: portrait 9:16 (`local-portrait-h264-v1`, 1080×1920 at 30 fps, and `local-portrait-720p24-h264-v1`, 720×1280 at 24 fps), landscape 16:9 and square 1:1. A profile owns measurable media and visual constraints; it does not imply a publishing provider. (The catalog originally shipped three profiles; the 720p/24 portrait profile was added later.)
- `production-catalogs/style-playbooks.v1.json` contains five optional playbooks: educational/code, talking head, short-form, product/demo, and minimal editorial.
- The playbook catalog must declare `selectionMode: "optional-explicit"`. Resolving a profile without `playbookId` returns no playbook. PADStudio never infers one from aspect ratio, media type, provider, or project state.
- A playbook is guidance for the Agent and review, not a renderer preset or a fixed sequence of stages. `profileHints` only identify compatible starting points; they do not select a profile.

This preserves the useful OpenMontage lesson—make learned craft inspectable and reusable—while retaining PADStudio's adaptive, Agent-led workflow. Knowledge becomes a composable policy with testable boundaries, not an implicit production path.

## API

`ProductionPolicyCatalog` validates both catalogs at construction and provides:

- `listOutputProfiles()` and `readOutputProfile(id)`;
- `listStylePlaybooks()` and `readStylePlaybook(id)`;
- `resolve({ profileId, playbookId? })`, with strict fields and explicit optional playbook selection;
- `versions()` for provenance.

Returned values are defensive copies. The compatibility export `OUTPUT_PROFILES` is deeply frozen.

`local-delivery` now discovers profiles through this catalog. Existing code importing `LOCAL_DELIVERY_PROFILES` remains valid, and the original `local-portrait-h264-v1` identifier and media constraints are unchanged. When this slice was introduced, delivery required an explicit `profileId`. Since the 2026-09-22 UX decision `profileId` is optional and advisory: it is recorded in the manifest but profile compliance is not enforced after acceptance (`profileComplianceEnforced: false`), and no default profile is chosen. The profile-matching helpers in `src/production/delivery-readiness.js` and `acceptance-readiness.js` (`matchingDeliveryProfiles`, `deliveryProfilesForAcceptance`) are retained and unit-tested, but neither `project:accept` nor delivery calls them any more. The tool packages exact accepted bytes and does not render, publish, or silently change provider.

## Versioning and change rules

Changing an existing profile or playbook in a way that changes output/review meaning requires a new entry version and, when compatibility would be ambiguous, a new ID. Catalog version records which set was resolved. A future project-level selection should persist the resolved IDs and versions in normal project provenance; this catalog does not create that selection on its own.

## Verification

Targeted tests cover catalog counts and versions, malformed dimensions, unknown profile references, optional-explicit enforcement, strict resolution input, defensive copies, the frozen compatibility map, and local-delivery discovery. Media acceptance remains the responsibility of the existing local-delivery tests and release gates.
