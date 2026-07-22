import {z} from 'zod';
import {pipelineSafetyLimits} from './pipelineLimits.ts';
import {
  CodexReasoningEffortSchema,
  CodexTokenUsageSchema,
  CreationIdSchema,
  TeachingOutlineContentSchema,
  TeachingOutlineSchema,
  TeachingOutlineSectionSchema,
} from './topic.ts';

export const OutlineGlobalFieldSchema = z.enum([
  'brief.summary',
  'brief.assumptions',
  'centralMessage',
]);

export type OutlineGlobalField = z.infer<typeof OutlineGlobalFieldSchema>;

export const OutlineSectionFieldSchema = z.enum([
  'title',
  'goal',
  'content',
  'estimatedSeconds',
]);

export type OutlineSectionField = z.infer<typeof OutlineSectionFieldSchema>;

const OutlineSectionScopeSchema = z
  .object({
    sectionId: z.string().uuid(),
    fields: z.array(OutlineSectionFieldSchema).min(1).max(4),
  })
  .strict()
  .refine(
    value => new Set(value.fields).size === value.fields.length,
    'Phạm vi section không được lặp trường.',
  );

export const OutlineEditScopeSchema = z
  .object({
    globalFields: z.array(OutlineGlobalFieldSchema).max(3),
    sections: z
      .array(OutlineSectionScopeSchema)
      .max(pipelineSafetyLimits.maximumSections),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.globalFields.length === 0 && value.sections.length === 0) {
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
    const sectionIds = value.sections.map(section => section.sectionId);
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'Mỗi section chỉ được xuất hiện một lần trong phạm vi.',
      });
    }
  });

export type OutlineEditScope = z.infer<typeof OutlineEditScopeSchema>;

export const CreateOutlineCandidateSchema = z
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
    scope: OutlineEditScopeSchema,
  })
  .strict();

export type CreateOutlineCandidate = z.infer<
  typeof CreateOutlineCandidateSchema
>;

export const CreateOutlineCheckpointSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type CreateOutlineCheckpoint = z.infer<
  typeof CreateOutlineCheckpointSchema
>;

export const OutlineAiPatchSchema = z
  .object({
    editSummary: z.string().trim().min(3).max(700),
    brief: z
      .object({
        summary: TeachingOutlineSchema.shape.brief.shape.summary.nullable(),
        assumptions:
          TeachingOutlineSchema.shape.brief.shape.assumptions.nullable(),
      })
      .strict(),
    centralMessage: TeachingOutlineSchema.shape.centralMessage.nullable(),
    sections: z
      .array(
        z
          .object({
            sectionId: z.string().uuid(),
            title: TeachingOutlineSectionSchema.shape.title.nullable(),
            goal: TeachingOutlineSectionSchema.shape.goal.nullable(),
            content: TeachingOutlineSectionSchema.shape.content.nullable(),
            estimatedSeconds:
              TeachingOutlineSectionSchema.shape.estimatedSeconds.nullable(),
          })
          .strict()
          .refine(
            value =>
              value.title !== null ||
              value.goal !== null ||
              value.content !== null ||
              value.estimatedSeconds !== null,
            'Mỗi patch section phải có ít nhất một thay đổi.',
          ),
      )
      .max(pipelineSafetyLimits.maximumSections),
  })
  .strict();

export type OutlineAiPatch = z.infer<typeof OutlineAiPatchSchema>;

export const OutlineCoherenceIssueSchema = z
  .object({
    severity: z.enum(['warning', 'error']),
    category: z.enum([
      'logic',
      'transition',
      'consistency',
      'repetition',
      'terminology',
      'pacing',
      'scope',
    ]),
    message: z.string().trim().min(6).max(700),
    suggestedFix: z.string().trim().min(6).max(700),
    affectedSectionIds: z
      .array(z.string().uuid())
      .max(pipelineSafetyLimits.maximumSections),
    requiresScopeExpansion: z.boolean(),
  })
  .strict();

export const OutlineCoherenceReviewSchema = z
  .object({
    verdict: z.enum([
      'coherent',
      'warning',
      'needs_scope_expansion',
    ]),
    summary: z.string().trim().min(6).max(900),
    issues: z.array(OutlineCoherenceIssueSchema).max(12),
  })
  .strict();

export type OutlineCoherenceReview = z.infer<
  typeof OutlineCoherenceReviewSchema
>;

export const OutlineVersionOriginSchema = z.enum([
  'baseline',
  'manual_checkpoint',
  'ai_candidate',
  'restore',
  'approval',
]);

export const OutlineVersionRecordSchema = z
  .object({
    versionId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    origin: OutlineVersionOriginSchema,
    label: z.string().min(1).max(120).nullable(),
    parentVersionId: CreationIdSchema.nullable(),
    restoredFromVersionId: CreationIdSchema.nullable(),
    candidateId: CreationIdSchema.nullable(),
    projectRevision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifact: TeachingOutlineSchema,
  })
  .strict();

export type OutlineVersionRecord = z.infer<
  typeof OutlineVersionRecordSchema
>;

export const OutlineCandidateStatusSchema = z.enum([
  'ready',
  'coherence_warning',
  'coherence_blocked',
  'scope_expansion_required',
]);

export const OutlineCandidateDecisionSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
]);

export const OutlineCandidateRecordSchema = z
  .object({
    candidateId: CreationIdSchema,
    projectId: z.string().min(1).max(101),
    createdAt: z.string().datetime(),
    status: OutlineCandidateStatusSchema,
    decision: OutlineCandidateDecisionSchema,
    decidedAt: z.string().datetime().nullable(),
    appliedVersionId: CreationIdSchema.nullable(),
    baseVersionId: CreationIdSchema,
    parentCandidateId: CreationIdSchema.nullable(),
    rootBaseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    rootBaseContextHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    baseContextHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    baseProjectRevision: z.number().int().positive().optional(),
    candidateContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    guidance: z.string().trim().min(3).max(4000),
    scope: OutlineEditScopeSchema,
    patch: OutlineAiPatchSchema,
    content: TeachingOutlineContentSchema,
    coherence: OutlineCoherenceReviewSchema,
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

export type OutlineCandidateRecord = z.infer<
  typeof OutlineCandidateRecordSchema
>;

export const OutlineHistoryResponseSchema = z
  .object({
    versions: z.array(OutlineVersionRecordSchema),
    candidates: z.array(OutlineCandidateRecordSchema),
    currentContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    currentContextHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type OutlineHistoryResponse = z.infer<
  typeof OutlineHistoryResponseSchema
>;
