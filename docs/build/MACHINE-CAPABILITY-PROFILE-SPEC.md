# Machine & Capability Profile

Status: implemented, 2026-09-17.

## Purpose

Before planning production, the Agent needs a compact and current account of what the owner machine
can actually run. PADStudio reports facts and planning constraints; it does not choose the creative
workflow, auto-install software, inspect secret values, benchmark the host, or silently substitute a
runtime.

The design adopts the useful part of OpenMontage's onboarding preflight: composition-runtime status,
capability grouping, setup offers and runtime warnings. It does not copy a fixed pipeline, treat a
declared resource requirement as a measured benchmark, or claim that an FFmpeg encoder listed by the
build is usable hardware before an exact runtime verifies it.

## Contract

`system:profile` and the `environment` section of `project:resume` combine:

- OS/platform/architecture and Node-owned CPU/RAM facts;
- free project-volume storage;
- GPU name, reported memory and driver when a read-only platform probe succeeds;
- FFmpeg hardware-encoder candidates, explicitly distinguished from verified acceleration;
- live Tool Registry availability, grouped as a compact capability menu;
- explicit Manim, Remotion, HyperFrames and FFmpeg composition-runtime status;
- bounded setup offers read from tool contracts;
- tool resource profiles and visible capacity risks;
- planning hints and honest warnings.

The profile never reads API-key values. It checks no remote endpoint and contains
`networkProbePerformed: false`. Setup entries may name a configuration key but never expose its value.
GPU inventory is best effort: NVIDIA uses `nvidia-smi`; Windows falls back to read-only CIM, macOS to
`system_profiler`, and Linux to `lspci`. Failure is reported as unknown rather than absence.

## Planning semantics

Resource profiles are advisory catalog estimates unless a tool explicitly declares otherwise. They
are not admission control and do not replace the tool's live availability check or output
verification. A listed FFmpeg NVENC/QSV/AMF/VideoToolbox encoder is a candidate compiled into FFmpeg,
not proof that the corresponding device and driver can complete a render.

Fresh projects receive `environment.mode: onboarding`; existing projects receive `refresh`. The Agent
should translate this compact evidence into a short statement of what works, relevant constraints and
at most a few useful setup options. It must not dump the full tool registry or force setup before a
workflow that already works.

## Compatibility and failure behavior

Machine/environment data is a projection, not durable project truth. It is regenerated and may change
between resumes. Existing project records and tool contracts remain valid. Unknown hardware does not
block CPU/local or provider tools by itself; an exact selected tool may still fail closed if its own
runtime is unavailable.
