import {z} from 'zod';

export const audienceValues = ['beginner', 'familiar'] as const;
export const durationValues = ['concise', 'standard', 'deep'] as const;
export const projectStepValues = ['topic', 'outline'] as const;
export const projectStatusValues = ['draft'] as const;
export const currentProjectVersion = 2 as const;

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
    audience: z.enum(audienceValues),
    duration: z.enum(durationValues),
  })
  .strict();

export type TopicInput = z.infer<typeof TopicInputSchema>;

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

export const TopicProjectSchema = z
  .object({
    id: z.string(),
    version: z.literal(currentProjectVersion),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: ProjectStepSchema,
    topicInput: TopicInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type TopicProject = z.infer<typeof TopicProjectSchema>;

export function parseTopicProject(value: unknown): TopicProject {
  const currentProject = TopicProjectSchema.safeParse(value);
  if (currentProject.success) return currentProject.data;

  const legacyProject = topicProjectV1Schema.safeParse(value);
  if (legacyProject.success) {
    return {
      ...legacyProject.data,
      version: currentProjectVersion,
      revision: 1,
      creationId: null,
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

export const UpdateTopicProjectSchema = z
  .object({
    topicInput: TopicInputSchema.optional(),
    currentStep: ProjectStepSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.topicInput !== undefined || value.currentStep !== undefined,
    'Cần có ít nhất một thay đổi.',
  );

export type UpdateTopicProject = z.infer<typeof UpdateTopicProjectSchema>;

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
