import {z} from 'zod';
import {pipelineSafetyLimits} from './pipelineLimits.ts';
import {
  CodexReasoningEffortSchema,
  CodexTokenUsageSchema,
  CreationIdSchema,
  VoiceVisualBeatSchema,
  VoiceVisualPlanContentSchema,
  VoiceVisualPlanSchema,
} from './topic.ts';

export const VoiceVisualGlobalFieldSchema = z.enum([
  'voiceDirection',
  'visualDirection',
]);
export type VoiceVisualGlobalField = z.infer<
  typeof VoiceVisualGlobalFieldSchema
>;

export const VoiceVisualBeatFieldSchema = z.enum([
  'voiceover',
  'visualDescription',
  'animationDescription',
  'visualHoldSeconds',
]);
export type VoiceVisualBeatField = z.infer<
  typeof VoiceVisualBeatFieldSchema
>;

const VoiceVisualBeatScopeSchema = z
  .object({
    beatId: z.string().uuid(),
    fields: z.array(VoiceVisualBeatFieldSchema).min(1).max(4),
  })
  .strict()
  .refine(
    value => new Set(value.fields).size === value.fields.length,
    'Phạm vi beat không được lặp trường.',
  );

export const VoiceVisualEditScopeSchema = z
  .object({
    globalFields: z.array(VoiceVisualGlobalFieldSchema).max(2),
    beats: z
      .array(VoiceVisualBeatScopeSchema)
      .max(pipelineSafetyLimits.maximumTotalBeats),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.globalFields.length === 0 && value.beats.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Hãy chọn ít nhất một phần AI được phép chỉnh sửa.',
      });
    }
    if (new Set(value.globalFields).size !== value.globalFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['globalFields'],
        message: 'Phạm vi toàn cục không được lặp trường.',
      });
    }
    const beatIds = value.beats.map(beat => beat.beatId);
    if (new Set(beatIds).size !== beatIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['beats'],
        message: 'Mỗi beat chỉ được xuất hiện một lần trong phạm vi.',
      });
    }
  });

export type VoiceVisualEditScope = z.infer<
  typeof VoiceVisualEditScopeSchema
>;

export const CreateVoiceVisualCandidateSchema = z
  .object({
    generationId: CreationIdSchema,
    baseCandidateId: CreationIdSchema.optional(),
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
    guidance: z
      .string()
      .trim()
      .min(3, 'Hãy mô tả điều cần chỉnh rõ hơn một chút.')
      .max(4000, 'Góp ý cho AI vượt quá 4000 ký tự.'),
    scope: VoiceVisualEditScopeSchema,
  })
  .strict();

export type CreateVoiceVisualCandidate = z.infer<
  typeof CreateVoiceVisualCandidateSchema
>;

export const CreateVoiceVisualReviewSchema = z
  .object({
    reviewId: CreationIdSchema,
    candidateId: CreationIdSchema.optional(),
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
  })
  .strict();

export type CreateVoiceVisualReview = z.infer<
  typeof CreateVoiceVisualReviewSchema
>;

export const CreateVoiceVisualCheckpointSchema = z
  .object({label: z.string().trim().min(1).max(120).optional()})
  .strict();

export const VoiceVisualAiPatchSchema = z
  .object({
    editSummary: z.string().trim().min(3).max(700),
    voiceDirection:
      VoiceVisualPlanContentSchema.shape.voiceDirection.nullable(),
    visualDirection:
      VoiceVisualPlanContentSchema.shape.visualDirection.nullable(),
    beats: z
      .array(
        z
          .object({
            beatId: z.string().uuid(),
            voiceover: VoiceVisualBeatSchema.shape.voiceover.nullable(),
            visualDescription:
              VoiceVisualBeatSchema.shape.visualDescription.nullable(),
            animationDescription:
              VoiceVisualBeatSchema.shape.animationDescription.nullable(),
            visualHoldSeconds:
              VoiceVisualBeatSchema.shape.visualHoldSeconds.nullable(),
          })
          .strict()
          .refine(
            value =>
              value.voiceover !== null ||
              value.visualDescription !== null ||
              value.animationDescription !== null ||
              value.visualHoldSeconds !== null,
            'Mỗi patch beat phải có ít nhất một thay đổi.',
          ),
      )
      .max(pipelineSafetyLimits.maximumTotalBeats),
  })
  .strict();

export type VoiceVisualAiPatch = z.infer<typeof VoiceVisualAiPatchSchema>;

export const VoiceVisualCoherenceReviewSchema = z
  .object({
    verdict: z.enum(['coherent', 'warning', 'needs_scope_expansion']),
    summary: z.string().trim().min(6).max(900),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(['warning', 'error']),
            category: z.enum([
              'narration_transition',
              'voice_visual_alignment',
              'visual_consistency',
              'terminology',
              'repetition',
              'timing',
              'scope',
            ]),
            message: z.string().trim().min(6).max(700),
            suggestedFix: z.string().trim().min(6).max(700),
            affectedBeatIds: z
              .array(z.string().uuid())
              .max(pipelineSafetyLimits.maximumTotalBeats),
            requiresScopeExpansion: z.boolean(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export type VoiceVisualCoherenceReview = z.infer<
  typeof VoiceVisualCoherenceReviewSchema
>;

export const VoiceVisualReviewRecordSchema = z
  .object({
    reviewId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    target: z.enum(['current', 'candidate']),
    targetCandidateId: CreationIdSchema.nullable(),
    targetContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    rootContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedProjectRevision: z.number().int().positive(),
    coherence: VoiceVisualCoherenceReviewSchema,
    generation: z
      .object({
        provider: z.literal('codex'),
        model: z.string().min(1).max(160),
        requestedModel: z.string().min(1).max(160).nullable(),
        reasoningEffort: CodexReasoningEffortSchema.nullable(),
        promptVersion: z.string().min(1).max(40),
        generatedAt: z.string().datetime(),
        usage: CodexTokenUsageSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type VoiceVisualReviewRecord = z.infer<
  typeof VoiceVisualReviewRecordSchema
>;

export const VoiceVisualVersionOriginSchema = z.enum([
  'baseline',
  'manual_checkpoint',
  'ai_candidate',
  'restore',
  'approval',
]);

export const VoiceVisualVersionRecordSchema = z
  .object({
    versionId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    origin: VoiceVisualVersionOriginSchema,
    label: z.string().min(1).max(120).nullable(),
    parentVersionId: CreationIdSchema.nullable(),
    restoredFromVersionId: CreationIdSchema.nullable(),
    candidateId: CreationIdSchema.nullable(),
    projectRevision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifact: VoiceVisualPlanSchema,
  })
  .strict();

export type VoiceVisualVersionRecord = z.infer<
  typeof VoiceVisualVersionRecordSchema
>;

export const VoiceVisualCandidateStatusSchema = z.enum([
  'ready',
  'coherence_warning',
  'coherence_blocked',
  'scope_expansion_required',
]);
export const VoiceVisualCandidateDecisionSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
]);

export const VoiceVisualCandidateRecordSchema = z
  .object({
    candidateId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    status: VoiceVisualCandidateStatusSchema,
    decision: VoiceVisualCandidateDecisionSchema,
    decidedAt: z.string().datetime().nullable(),
    appliedVersionId: CreationIdSchema.nullable(),
    baseVersionId: CreationIdSchema,
    parentCandidateId: CreationIdSchema.nullable(),
    rootBaseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    rootBaseContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseProjectRevision: z.number().int().positive(),
    candidateContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    guidance: z.string().trim().min(3).max(4000),
    scope: VoiceVisualEditScopeSchema,
    patch: VoiceVisualAiPatchSchema,
    content: VoiceVisualPlanContentSchema,
    coherence: VoiceVisualCoherenceReviewSchema,
    generation: z
      .object({
        provider: z.literal('codex'),
        model: z.string().min(1).max(160),
        requestedModel: z.string().min(1).max(160).nullable(),
        reasoningEffort: CodexReasoningEffortSchema.nullable(),
        promptVersion: z.string().min(1).max(40),
        generatedAt: z.string().datetime(),
        editorUsage: CodexTokenUsageSchema.nullable(),
        reviewerUsage: CodexTokenUsageSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type VoiceVisualCandidateRecord = z.infer<
  typeof VoiceVisualCandidateRecordSchema
>;

export const VoiceVisualHistoryResponseSchema = z
  .object({
    versions: z.array(VoiceVisualVersionRecordSchema),
    candidates: z.array(VoiceVisualCandidateRecordSchema),
    currentContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    currentContextHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type VoiceVisualHistoryResponse = z.infer<
  typeof VoiceVisualHistoryResponseSchema
>;
