# Video sequence planning and revision

Use when a project needs a concrete, editable video arrangement. A sequence is an optional
product artifact, not a workflow or a required pipeline. Keep tiny media tasks simple.

1. Read the active brief, direction and production context. Inspect actual source media.
2. Give each segment a stable ID, a purpose and frame-aligned duration. Keep unrelated
   segments separate so that local revisions can be compared and reused.
3. Write video.sequence version 1.0 via project:sequence. See
   docs/build/VIDEO-SEQUENCE-PRODUCTION.md for the complete contract.
4. Attach brief/direction references only where they are relevant: segment.references for
   local evidence; artifact.references for global evidence. Keep local references in their
   segment so a change there does not invalidate unrelated segments. The store validates
   both scopes; context derives media dependencies from the selected sources.
5. A visual may be null while planning. Narration text without an audio source is also
   valid planning data. The local renderer refuses these gaps; it never synthesizes speech,
   invents assets or silently drops requested content.
6. On revision, reread the latest artifact revision, submit expectedRevision and a concrete
   data.changeReason. Preserve stable IDs for the same segment. Completed work is historical;
   create new work items when the meaning of already reviewed work changes.
7. Review production dependency warnings. Rebase references deliberately or explain why an
   older revision is intentional. allowHistorical is an explicit render option, not a default.
8. Render with video.render-sequence / ffmpeg-sequence using the exact artifactId.
   Optional reuseResultId selects a prior render of the same sequence. Reuse requires matching
   specifications, evidence references, source bytes, renderer version and cached output hash.
9. Inspect the registered frames and watch/listen to the full preview, especially seams,
   captions and narration. Tone/metadata/volume alone cannot prove intelligible speech.
   Record a result review with real observations; leave unperformed checks explicit.
10. Ask for user feedback in chat. Record a decision for the exact render result only.
    A new artifact revision or render never inherits an older approval.

The first adapter uses local FFmpeg: ordered image/video segments, fit-with-padding,
source audio plus one optional narration track per segment, plain timed captions, cuts.
It pads shorter narration with silence and refuses to cut off longer narration. It does
not offer generated speech, transitions, music buses, arbitrary compositions or paid calls.
An existing composed clip can be used as a segment source. Keep source media and authored
intent independent of the renderer. Do not hand-edit stored result/run JSON.
