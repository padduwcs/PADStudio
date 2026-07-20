// These are safety ceilings, not product presets. Normal projects should stay
// far below them, but long-form projects must not fail merely because the
// first vertical slice used small fixed limits.
export const pipelineSafetyLimits = {
  minimumSections: 1,
  maximumSections: 64,
  minimumBeatsPerSection: 1,
  maximumBeatsPerSection: 64,
  maximumTotalBeats: 512,
  minimumSectionDurationSeconds: 10,
  maximumSectionDurationSeconds: 16 * 60 * 60,
  minimumBeatDurationSeconds: 4,
  maximumBeatDurationSeconds: 15 * 60,
  maximumVisualHoldSeconds: 10 * 60,
  maximumVoiceChunks: 512,
  minimumCustomDurationMinutes: 0.5,
  maximumCustomDurationMinutes: 180,
  maximumSceneSourceCharacters: 96 * 1024,
  maximumJsonBodyBytes: 16 * 1024 * 1024,
} as const;

export function hasSafeTotalBeatCount(
  sections: ReadonlyArray<{beats: ReadonlyArray<unknown>}>,
) {
  return (
    sections.reduce((total, section) => total + section.beats.length, 0) <=
    pipelineSafetyLimits.maximumTotalBeats
  );
}
