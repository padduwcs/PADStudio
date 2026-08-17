import {z} from 'zod';
import {toVietnameseSpeechText} from './vietnameseSpeech.ts';

export const pronunciationRuleScopeValues = ['once', 'project', 'library'] as const;
export const pronunciationRuleOriginValues = ['user', 'ai', 'builtin'] as const;

export const PronunciationRuleSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().trim().min(1).max(300),
    spoken: z.string().trim().min(1).max(600),
    scope: z.enum(pronunciationRuleScopeValues),
    origin: z.enum(pronunciationRuleOriginValues),
    caseSensitive: z.boolean().default(false),
  })
  .strict();

export type PronunciationRule = z.infer<typeof PronunciationRuleSchema>;

export const PronunciationPatchSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    source: z.string().min(1),
    spoken: z.string().min(1),
    reason: z.string().trim().min(3).max(240),
    suggestedRule: PronunciationRuleSchema.omit({id: true}).nullable().default(null),
  })
  .strict()
  .refine(value => value.end > value.start, 'Patch phát âm phải có độ dài dương.');

export type PronunciationPatch = z.infer<typeof PronunciationPatchSchema>;

export const PronunciationReviewSchema = z
  .object({
    sourceText: z.string().trim().min(1),
    normalizedText: z.string().trim().min(1),
    rules: z.array(PronunciationRuleSchema).max(2_000),
    aiPatches: z.array(PronunciationPatchSchema).max(500),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    rulesHash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedAt: z.string().datetime().nullable().default(null),
  })
  .strict();

export type PronunciationReview = z.infer<typeof PronunciationReviewSchema>;

function escapeExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortedRules(rules: readonly PronunciationRule[]) {
  const scopePriority: Record<PronunciationRule['scope'], number> = {
    once: 3,
    project: 2,
    library: 1,
  };
  return [...rules].sort((left, right) =>
    right.source.length - left.source.length ||
    scopePriority[right.scope] - scopePriority[left.scope] ||
    left.id.localeCompare(right.id),
  );
}

/**
 * Applies user-controlled pronunciation memory before built-in notation rules.
 * English prose remains untouched unless a rule explicitly covers it.
 */
export function normalizePronunciation(
  sourceText: string,
  rules: readonly PronunciationRule[],
) {
  let value = sourceText.trim();
  for (const rule of sortedRules(rules)) {
    const flags = rule.caseSensitive ? 'g' : 'gi';
    value = value.replace(new RegExp(escapeExpression(rule.source), flags), rule.spoken);
  }
  return toVietnameseSpeechText(value);
}

/** Rejects free-form model rewrites: an AI patch must point to the exact source span. */
export function validatePronunciationPatches(
  sourceText: string,
  patches: readonly PronunciationPatch[],
) {
  let previousEnd = 0;
  for (const patch of [...patches].sort((left, right) => left.start - right.start)) {
    if (patch.start < previousEnd || sourceText.slice(patch.start, patch.end) !== patch.source) {
      return false;
    }
    previousEnd = patch.end;
  }
  return true;
}

export function applyPronunciationPatches(
  sourceText: string,
  patches: readonly PronunciationPatch[],
) {
  if (!validatePronunciationPatches(sourceText, patches)) {
    throw new Error('AI trả patch phát âm không khớp lời thoại gốc.');
  }
  const ordered = [...patches].sort((left, right) => right.start - left.start);
  return ordered.reduce(
    (result, patch) =>
      `${result.slice(0, patch.start)}${patch.spoken}${result.slice(patch.end)}`,
    sourceText,
  );
}

/**
 * Creates the exact text sent to TTS. AI patches are constrained to source
 * spans, then the same deterministic dictionary pass is applied as usual.
 */
export function reviewedPronunciationText(
  sourceText: string,
  rules: readonly PronunciationRule[],
  aiPatches: readonly PronunciationPatch[] = [],
) {
  return normalizePronunciation(
    aiPatches.length > 0
      ? applyPronunciationPatches(sourceText, aiPatches)
      : sourceText,
    rules,
  );
}
