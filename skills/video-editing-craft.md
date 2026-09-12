# Video editing craft

## Use when

Choosing how to assemble clips, layer added audio, or burn captions — not just whether the tool call succeeds, but whether the settings serve the video.

## Method

1. Default to a hard cut. Crossfade or fade-through-black is a pacing choice, not default polish; use it because the footage calls for it, not on every join.
2. When adding music or narration under a video that already has its own audio, keep the video's own audio as the reference and duck the added track — not the reverse — unless the intent is for the new track to replace the scene's sound entirely.
3. A duck level near 15% of full volume keeps music present without competing with speech; much louder defeats the point of ducking, much quieter may as well be silent.
4. Normalize loudness once, at the end, to a target that matches where the video is going: -16 LUFS reads as podcast/voice-forward, -14 LUFS matches YouTube and social platforms. Do not guess a number without knowing the destination.
5. Fit captions to orientation: portrait frames need shorter cues and hold each one briefly; landscape frames can carry more text per cue. A cue nobody could finish reading before it changes is a failure, not a style choice.
6. Never let a caption start before, or run past, the moment it describes.
7. A still image held for more than a couple of seconds usually reads as dead air; a light zoom or pan gives it life without calling attention to itself — reserve `static` for a still that is on screen only briefly, or one where any drift would distract from what it shows (a chart, a screenshot, a document).

## Standard

Judge by watching and listening at natural playback speed, not by checking numbers alone. Ducking that leaves music inaudible, or loud enough to fight the speech, both fail regardless of the configured level.

## Sequence 1.1

Treat narration, original speech and music as separate roles. Mute original speech over
replacement narration unless the user intentionally wants both. Use source volumeRanges
for exact intervals and fades for boundaries. Place narration with offsetSeconds; inspect
silence after it ends instead of leaving quiet original speech unintentionally exposed.
Use music ducking against the foreground mix and measure final loudness, then listen.
Use a consistent caption style and simple entrance/exit animation only when it helps reading.
Do not animate charts or screenshots by default. Transitions overlap adjacent segments;
check the shortened timeline before aligning music or deciding caption durations.
