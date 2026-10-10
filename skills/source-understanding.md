# Source understanding

## Use when

Creative or technical decisions depend on media, documents, previous results, or other supplied material.

## Method

1. Inspect the material with the least destructive available capability.
   When the user supplies a reference folder, look for material that could change the video's form or scope before committing to a duration, narration mode or production approach. Explain a consequential decision to omit such material; availability alone does not require its use.
2. Before combining multiple sources into one result (e.g. concatenation), confirm each source's technical shape individually — do not assume compatibility.
3. Separate measured facts from interpretation.
4. Capture notable structure, content, quality, limitations, opportunities, and risks.
5. Link every consequential observation to its resource, result, or run.
6. Classify intended use with `source.profile`; importing a file does not grant reuse rights or make it selected footage.
7. Record evidence-backed synthesis as `source.assessment`. Use `observation` for what was actually viewed, heard, read, or measured; use `inference` for interpretation.
8. Record the exact review action and coverage. A contact sheet is sampled visual evidence, not proof that the complete source was watched.
9. Keep raw ASR immutable. Put verified corrections in `source.transcript-edit`, with listened evidence for the affected segment.
10. Use `analysis:read` for bounded detail/search and `analysis:verify` before relying on evidence whose freshness is unknown or stale.
11. Run analysis with `npm run project:analyze` (request format in `PADSTUDIO-AGENT-REFERENCE.md`), never with `tool:run`: the analysis service supplies the source identity a stored Result needs.

## Standard

Do not plan from filenames or chat memory alone. A future run should be able to recover what was observed, the exact source version and evidence, what remains unreviewed, and why the finding matters.
