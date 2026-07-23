import {z} from 'zod';
import {pipelineSafetyLimits} from './pipelineLimits.ts';
import {
  CodexReasoningEffortSchema,
  CodexTokenUsageSchema,
  CreationIdSchema,
  MotionCanvasBundleSchema,
} from './topic.ts';

export const MotionCanvasEditScopeSchema = z
  .object({
    sceneIds: z
      .array(CreationIdSchema)
      .min(1, 'Hãy chọn ít nhất một scene được phép sinh lại.')
      .max(pipelineSafetyLimits.maximumSections),
  })
  .strict()
  .refine(
    value => new Set(value.sceneIds).size === value.sceneIds.length,
    'Phạm vi scene không được lặp.',
  );

export type MotionCanvasEditScope = z.infer<
  typeof MotionCanvasEditScopeSchema
>;

export const CreateMotionCanvasCandidateSchema = z
  .object({
    generationId: CreationIdSchema,
    baseCandidateId: CreationIdSchema.optional(),
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
    guidance: z
      .string()
      .trim()
      .min(3, 'Hãy mô tả điều cần chỉnh rõ hơn một chút.'),
    scope: MotionCanvasEditScopeSchema,
  })
  .strict();

export type CreateMotionCanvasCandidate = z.infer<
  typeof CreateMotionCanvasCandidateSchema
>;

export const CreateMotionCanvasCheckpointSchema = z
  .object({label: z.string().trim().min(1).optional()})
  .strict();

export const MotionCanvasCoherenceReviewSchema = z
  .object({
    verdict: z.enum(['coherent', 'warning', 'needs_scope_expansion']),
    summary: z.string().trim().min(6).max(900),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(['warning', 'error']),
            category: z.enum([
              'narrative_continuity',
              'voice_visual_alignment',
              'visual_consistency',
              'timing',
              'scope',
            ]),
            message: z.string().trim().min(6).max(700),
            suggestedFix: z.string().trim().min(6).max(700),
            affectedSceneIds: z
              .array(CreationIdSchema)
              .max(pipelineSafetyLimits.maximumSections),
            requiresScopeExpansion: z.boolean(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type MotionCanvasCoherenceReview = z.infer<
  typeof MotionCanvasCoherenceReviewSchema
>;

export const MotionCanvasVersionOriginSchema = z.enum([
  'baseline',
  'manual_checkpoint',
  'ai_candidate',
  'restore',
  'approval',
]);

export const MotionCanvasVersionRecordSchema = z
  .object({
    versionId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    origin: MotionCanvasVersionOriginSchema,
    label: z.string().min(1).nullable(),
    parentVersionId: CreationIdSchema.nullable(),
    restoredFromVersionId: CreationIdSchema.nullable(),
    candidateId: CreationIdSchema.nullable(),
    projectRevision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifact: MotionCanvasBundleSchema,
  })
  .strict();

export type MotionCanvasVersionRecord = z.infer<
  typeof MotionCanvasVersionRecordSchema
>;

export const MotionCanvasCandidateStatusSchema = z.enum([
  'ready',
  'coherence_warning',
  'coherence_blocked',
  'scope_expansion_required',
]);
export const MotionCanvasCandidateDecisionSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
]);

export const MotionCanvasCandidateRecordSchema = z
  .object({
    candidateId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    status: MotionCanvasCandidateStatusSchema,
    decision: MotionCanvasCandidateDecisionSchema,
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
    guidance: z.string().trim().min(3),
    scope: MotionCanvasEditScopeSchema,
    bundle: MotionCanvasBundleSchema,
    coherence: MotionCanvasCoherenceReviewSchema,
    generation: z
      .object({
        provider: z.literal('codex'),
        model: z.string().min(1).max(160),
        requestedModel: z.string().min(1).max(160).nullable(),
        reasoningEffort: CodexReasoningEffortSchema.nullable(),
        promptVersion: z.string().min(1).max(40),
        generatedAt: z.string().datetime(),
        generationUsage: CodexTokenUsageSchema.nullable(),
        reviewerUsage: CodexTokenUsageSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type MotionCanvasCandidateRecord = z.infer<
  typeof MotionCanvasCandidateRecordSchema
>;

export const MotionCanvasHistoryResponseSchema = z
  .object({
    versions: z.array(MotionCanvasVersionRecordSchema),
    candidates: z.array(MotionCanvasCandidateRecordSchema),
    currentContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    currentContextHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type MotionCanvasHistoryResponse = z.infer<
  typeof MotionCanvasHistoryResponseSchema
>;
