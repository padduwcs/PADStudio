export interface NarrationCalibration {
  whitespaceTokensPerMinute: number;
  charactersPerSecond: number;
}

export interface NarrationMetrics {
  whitespaceTokenCount: number;
  characterCount: number;
  estimatedSeconds: number;
}

export const DEFAULT_NARRATION_CALIBRATION: NarrationCalibration = {
  whitespaceTokensPerMinute: 195,
  charactersPerSecond: 14.5,
};

export const TARGET_NARRATION_TOKENS_PER_MINUTE = 180;

export const narrationDurationTargets = {
  concise: {
    minimumSeconds: 60,
    targetSeconds: 90,
    maximumSeconds: 120,
  },
  standard: {
    minimumSeconds: 180,
    targetSeconds: 240,
    maximumSeconds: 300,
  },
  deep: {
    minimumSeconds: 360,
    targetSeconds: 420,
    maximumSeconds: 480,
  },
} as const;

export function normalizeNarrationText(text: string) {
  return text.trim().replace(/\r\n?/g, '\n');
}

export function countNarrationWhitespaceTokens(text: string) {
  const normalized = normalizeNarrationText(text);
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function countNarrationCharacters(text: string) {
  return Array.from(normalizeNarrationText(text)).length;
}

function validPositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function estimateNarrationSeconds(
  text: string,
  calibration: NarrationCalibration = DEFAULT_NARRATION_CALIBRATION,
) {
  const whitespaceTokenCount = countNarrationWhitespaceTokens(text);
  const characterCount = countNarrationCharacters(text);
  if (whitespaceTokenCount === 0 || characterCount === 0) return 0;

  const tokensPerMinute = validPositive(
    calibration.whitespaceTokensPerMinute,
    DEFAULT_NARRATION_CALIBRATION.whitespaceTokensPerMinute,
  );
  const charactersPerSecond = validPositive(
    calibration.charactersPerSecond,
    DEFAULT_NARRATION_CALIBRATION.charactersPerSecond,
  );
  const tokenEstimate = (whitespaceTokenCount * 60) / tokensPerMinute;
  const characterEstimate = characterCount / charactersPerSecond;

  // Vietnamese whitespace units are closer to spoken syllables than lexical
  // words. Blending both rates is more stable across short and long phrases.
  return tokenEstimate * 0.65 + characterEstimate * 0.35;
}

export function narrationMetrics(
  text: string,
  calibration: NarrationCalibration = DEFAULT_NARRATION_CALIBRATION,
): NarrationMetrics {
  return {
    whitespaceTokenCount: countNarrationWhitespaceTokens(text),
    characterCount: countNarrationCharacters(text),
    estimatedSeconds: estimateNarrationSeconds(text, calibration),
  };
}

export function plannedBeatDurationSeconds(
  text: string,
  visualHoldSeconds = 0,
  calibration: NarrationCalibration = DEFAULT_NARRATION_CALIBRATION,
) {
  const hold = Math.max(0, Math.min(30, Math.round(visualHoldSeconds)));
  return Math.max(
    4,
    Math.min(90, Math.ceil(estimateNarrationSeconds(text, calibration)) + hold),
  );
}

export function targetNarrationTokenCount(durationSeconds: number) {
  return Math.max(
    1,
    Math.round(
      (Math.max(1, durationSeconds) *
        TARGET_NARRATION_TOKENS_PER_MINUTE) /
        60,
    ),
  );
}

export function calibrationFromActualNarration(
  text: string,
  durationSeconds: number,
): NarrationCalibration | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const whitespaceTokenCount = countNarrationWhitespaceTokens(text);
  const characterCount = countNarrationCharacters(text);
  if (whitespaceTokenCount === 0 || characterCount === 0) return null;

  return {
    whitespaceTokensPerMinute:
      (whitespaceTokenCount * 60) / durationSeconds,
    charactersPerSecond: characterCount / durationSeconds,
  };
}
