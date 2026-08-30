import {z} from 'zod';

export const motionCanvasGenerationStageValues = [
  'queued',
  'generating-scenes',
  'compiling',
  'quality-render',
  'quality-retry',
  'committing',
] as const;

export const MotionCanvasGenerationProgressSchema = z.object({
  version: z.literal(1),
  projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
  generationId: z.string().uuid(),
  state: z.enum(['running', 'completed', 'failed', 'interrupted']),
  stage: z.enum(motionCanvasGenerationStageValues),
  message: z.string().trim().min(1).max(500),
  completedScenes: z.number().int().nonnegative(),
  /** Successful scene outputs; failed scene work is tracked separately. */
  failedScenes: z.number().int().nonnegative().default(0),
  totalScenes: z.number().int().nonnegative(),
  completedSamples: z.number().int().nonnegative(),
  totalSamples: z.number().int().nonnegative(),
  cachedSamples: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  error: z.string().trim().min(1).max(1_000).nullable(),
}).strict();

export type MotionCanvasGenerationProgress = z.infer<
  typeof MotionCanvasGenerationProgressSchema
>;
