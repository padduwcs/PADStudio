import {z} from 'zod';

export const audienceValues = ['beginner', 'familiar'] as const;
export const durationValues = ['concise', 'standard', 'deep'] as const;
export const projectStepValues = ['topic', 'outline'] as const;

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

export const TopicProjectSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  status: z.literal('draft'),
  currentStep: z.enum(projectStepValues),
  topicInput: TopicInputSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TopicProject = z.infer<typeof TopicProjectSchema>;

export const UpdateTopicProjectSchema = z
  .object({
    topicInput: TopicInputSchema.optional(),
    currentStep: z.enum(projectStepValues).optional(),
  })
  .strict()
  .refine(
    (value) => value.topicInput !== undefined || value.currentStep !== undefined,
    'Cần có ít nhất một thay đổi.',
  );

export type UpdateTopicProject = z.infer<typeof UpdateTopicProjectSchema>;

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
