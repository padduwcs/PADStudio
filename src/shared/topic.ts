import {z} from 'zod';

export const audienceValues = ['beginner', 'familiar'] as const;
export const durationValues = ['concise', 'standard', 'deep'] as const;
export const projectStepValues = ['topic', 'outline', 'voiceVisual'] as const;
export const projectStatusValues = ['draft'] as const;
export const outlineStatusValues = ['draft', 'approved'] as const;
export const voiceVisualStatusValues = ['draft', 'approved'] as const;
export const currentProjectVersion = 4 as const;

export const ProjectStepSchema = z.enum(projectStepValues);
export type ProjectStep = z.infer<typeof ProjectStepSchema>;
export const ProjectStatusSchema = z.enum(projectStatusValues);
export const CreationIdSchema = z.string().uuid();

export const TopicInputSchema = z
  .object({
    topic: z
      .string()
      .trim()
      .min(6, 'Hãy mô tả chủ đề rõ hơn một chút.')
      .max(180, 'Chủ đề nên ngắn hơn 180 ký tự.'),
    learningGoal: z
      .string()
      .trim()
      .max(320, 'Mục tiêu học nên ngắn hơn 320 ký tự.')
      .optional(),
    videoDirection: z
      .string()
      .trim()
      .max(1200, 'Mô tả video nên ngắn hơn 1200 ký tự.')
      .optional(),
    audience: z.enum(audienceValues),
    duration: z.enum(durationValues),
  })
  .strict();

export type TopicInput = z.infer<typeof TopicInputSchema>;

export const AiVideoBriefSchema = z
  .object({
    summary: z
      .string()
      .trim()
      .min(12, 'Bản tóm tắt yêu cầu còn quá ngắn.')
      .max(700, 'Bản tóm tắt yêu cầu nên ngắn hơn 700 ký tự.'),
    assumptions: z
      .array(
        z
          .string()
          .trim()
          .min(3, 'Giả định cần rõ nghĩa hơn.')
          .max(220, 'Mỗi giả định nên ngắn hơn 220 ký tự.'),
      )
      .max(6, 'Chỉ nên giữ tối đa 6 giả định.'),
  })
  .strict();

export const TeachingOutlineSectionSchema = z
  .object({
    id: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(3, 'Tên ý còn quá ngắn.')
      .max(120, 'Tên ý nên ngắn hơn 120 ký tự.'),
    goal: z
      .string()
      .trim()
      .min(6, 'Mục tiêu của ý cần rõ hơn.')
      .max(280, 'Mục tiêu của ý nên ngắn hơn 280 ký tự.'),
    content: z
      .string()
      .trim()
      .min(12, 'Nội dung của ý cần rõ hơn.')
      .max(900, 'Nội dung của ý nên ngắn hơn 900 ký tự.'),
    estimatedSeconds: z
      .number()
      .int()
      .min(10, 'Mỗi ý cần ít nhất 10 giây.')
      .max(240, 'Mỗi ý không nên dài quá 240 giây.'),
  })
  .strict();

export type TeachingOutlineSection = z.infer<
  typeof TeachingOutlineSectionSchema
>;

export const TeachingOutlineContentSchema = z
  .object({
    brief: AiVideoBriefSchema,
    centralMessage: z
      .string()
      .trim()
      .min(10, 'Thông điệp trung tâm cần rõ hơn.')
      .max(400, 'Thông điệp trung tâm nên ngắn hơn 400 ký tự.'),
    sections: z
      .array(TeachingOutlineSectionSchema)
      .min(2, 'Mạch giảng cần ít nhất 2 ý.')
      .max(10, 'Mạch giảng không nên có quá 10 ý.'),
  })
  .strict();

export type TeachingOutlineContent = z.infer<
  typeof TeachingOutlineContentSchema
>;

export const CodexTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export type CodexTokenUsage = z.infer<typeof CodexTokenUsageSchema>;

export const TeachingOutlineSchema = TeachingOutlineContentSchema.extend({
  status: z.enum(outlineStatusValues),
  contentRevision: z.number().int().positive(),
  sourceInput: TopicInputSchema,
  generation: z
    .object({
      generationId: CreationIdSchema,
      provider: z.literal('codex'),
      model: z.string().min(1).max(160),
      promptVersion: z.string().min(1).max(40),
      generatedAt: z.string().datetime(),
      usage: CodexTokenUsageSchema.nullable(),
    })
    .strict(),
}).strict();

export type TeachingOutline = z.infer<typeof TeachingOutlineSchema>;

export const VoiceVisualBeatSchema = z
  .object({
    id: z.string().uuid(),
    voiceover: z
      .string()
      .trim()
      .min(12, 'Lời thuyết minh của beat cần rõ hơn.')
      .max(1000, 'Lời thuyết minh của beat nên ngắn hơn 1000 ký tự.'),
    visualDescription: z
      .string()
      .trim()
      .min(12, 'Mô tả visual của beat cần rõ hơn.')
      .max(700, 'Mô tả visual của beat nên ngắn hơn 700 ký tự.'),
    animationDescription: z
      .string()
      .trim()
      .min(8, 'Mô tả chuyển động của beat cần rõ hơn.')
      .max(500, 'Mô tả chuyển động của beat nên ngắn hơn 500 ký tự.'),
    durationSeconds: z
      .number()
      .int()
      .min(4, 'Mỗi beat cần ít nhất 4 giây.')
      .max(45, 'Mỗi beat không nên dài quá 45 giây.'),
  })
  .strict();

export type VoiceVisualBeat = z.infer<typeof VoiceVisualBeatSchema>;

export const VoiceVisualSectionSchema = z
  .object({
    outlineSectionId: z.string().uuid(),
    beats: z
      .array(VoiceVisualBeatSchema)
      .min(1, 'Mỗi ý trong mạch giảng cần ít nhất một beat.')
      .max(8, 'Mỗi ý không nên có quá 8 beat.'),
  })
  .strict();

export const VoiceVisualPlanContentSchema = z
  .object({
    voiceDirection: z
      .string()
      .trim()
      .min(6, 'Định hướng giọng kể cần rõ hơn.')
      .max(320, 'Định hướng giọng kể nên ngắn hơn 320 ký tự.'),
    visualDirection: z
      .string()
      .trim()
      .min(6, 'Định hướng hình ảnh cần rõ hơn.')
      .max(420, 'Định hướng hình ảnh nên ngắn hơn 420 ký tự.'),
    sections: z
      .array(VoiceVisualSectionSchema)
      .min(2, 'Kế hoạch cần bao phủ ít nhất 2 ý.')
      .max(10, 'Kế hoạch không nên có quá 10 ý.'),
  })
  .strict();

export type VoiceVisualPlanContent = z.infer<
  typeof VoiceVisualPlanContentSchema
>;

export const VoiceVisualPlanSchema = VoiceVisualPlanContentSchema.extend({
  status: z.enum(voiceVisualStatusValues),
  contentRevision: z.number().int().positive(),
  sourceOutlineContentRevision: z.number().int().positive(),
  generation: z
    .object({
      generationId: CreationIdSchema,
      provider: z.literal('codex'),
      model: z.string().min(1).max(160),
      promptVersion: z.string().min(1).max(40),
      generatedAt: z.string().datetime(),
      usage: CodexTokenUsageSchema.nullable(),
    })
    .strict(),
}).strict();

export type VoiceVisualPlan = z.infer<typeof VoiceVisualPlanSchema>;

const topicProjectV1Schema = z
  .object({
    id: z.string(),
    version: z.literal(1),
    status: ProjectStatusSchema,
    currentStep: ProjectStepSchema,
    topicInput: TopicInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV2Schema = z
  .object({
    id: z.string(),
    version: z.literal(2),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: ProjectStepSchema,
    topicInput: TopicInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV3Schema = z
  .object({
    id: z.string(),
    version: z.literal(3),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: z.enum(['topic', 'outline']),
    topicInput: TopicInputSchema,
    outline: TeachingOutlineSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const TopicProjectSchema = z
  .object({
    id: z.string(),
    version: z.literal(currentProjectVersion),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: ProjectStepSchema,
    topicInput: TopicInputSchema,
    outline: TeachingOutlineSchema.nullable(),
    voiceVisualPlan: VoiceVisualPlanSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type TopicProject = z.infer<typeof TopicProjectSchema>;

export function parseTopicProject(value: unknown): TopicProject {
  const currentProject = TopicProjectSchema.safeParse(value);
  if (currentProject.success) return currentProject.data;

  const versionThreeProject = topicProjectV3Schema.safeParse(value);
  if (versionThreeProject.success) {
    return {
      ...versionThreeProject.data,
      version: currentProjectVersion,
      voiceVisualPlan: null,
    };
  }

  const versionTwoProject = topicProjectV2Schema.safeParse(value);
  if (versionTwoProject.success) {
    return {
      ...versionTwoProject.data,
      version: currentProjectVersion,
      outline: null,
      voiceVisualPlan: null,
    };
  }

  const legacyProject = topicProjectV1Schema.safeParse(value);
  if (legacyProject.success) {
    return {
      ...legacyProject.data,
      version: currentProjectVersion,
      revision: 1,
      creationId: null,
      outline: null,
      voiceVisualPlan: null,
    };
  }

  throw currentProject.error;
}

export const CreateTopicProjectSchema = z
  .object({
    creationId: CreationIdSchema,
    topicInput: TopicInputSchema,
    currentStep: ProjectStepSchema,
  })
  .strict();

export type CreateTopicProject = z.infer<typeof CreateTopicProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    topicInput: TopicInputSchema.optional(),
    currentStep: ProjectStepSchema.optional(),
    outline: TeachingOutlineSchema.optional(),
    voiceVisualPlan: VoiceVisualPlanSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.topicInput !== undefined ||
      value.currentStep !== undefined ||
      value.outline !== undefined ||
      value.voiceVisualPlan !== undefined,
    'Cần có ít nhất một thay đổi.',
  );

export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const GenerateTeachingOutlineSchema = z
  .object({
    generationId: CreationIdSchema,
    guidance: z
      .string()
      .trim()
      .max(600, 'Góp ý cho AI nên ngắn hơn 600 ký tự.')
      .optional(),
  })
  .strict();

export type GenerateTeachingOutline = z.infer<
  typeof GenerateTeachingOutlineSchema
>;

export const GenerateVoiceVisualPlanSchema = z
  .object({
    generationId: CreationIdSchema,
    guidance: z
      .string()
      .trim()
      .max(600, 'Góp ý cho AI nên ngắn hơn 600 ký tự.')
      .optional(),
  })
  .strict();

export type GenerateVoiceVisualPlan = z.infer<
  typeof GenerateVoiceVisualPlanSchema
>;

export type ProjectListIssueCode =
  | 'INVALID_PROJECT_DATA'
  | 'UNSUPPORTED_PROJECT_VERSION'
  | 'PROJECT_READ_ERROR';

export interface ProjectListIssue {
  projectId: string;
  code: ProjectListIssueCode;
  message: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    currentProject?: TopicProject;
  };
}
