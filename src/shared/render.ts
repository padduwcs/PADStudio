import {z} from 'zod';

const CreationIdSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const watermarkPositionValues = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center',
] as const;
export type WatermarkPosition = (typeof watermarkPositionValues)[number];

export function finalRenderTimingToleranceSeconds(
  fps: number,
  durationSeconds: number,
) {
  const frameTolerance =
    Number.isFinite(fps) && fps > 0 ? 4 / fps : 0;
  const proportionalTolerance =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds * 0.002
      : 0;
  return Math.min(
    0.5,
    Math.max(0.25, frameTolerance, proportionalTolerance),
  );
}

const WatermarkBaseSchema = z.object({
  opacity: z.number().min(0.05).max(1),
  position: z.enum(watermarkPositionValues),
});

export const RenderWatermarkSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('none')}).strict(),
  WatermarkBaseSchema.extend({
    type: z.literal('text'),
    text: z.string().trim().min(1).max(120),
    fontSize: z.number().int().min(16).max(200),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict(),
  WatermarkBaseSchema.extend({
    type: z.literal('image'),
    assetId: Sha256Schema,
    widthPercent: z.number().min(5).max(80),
  }).strict(),
]);

export type RenderWatermark = z.infer<typeof RenderWatermarkSchema>;

export const finalRenderStatusValues = ['completed'] as const;
export const finalRenderJobStateValues = [
  'queued',
  'preparing',
  'rendering',
  'finalizing',
  'completed',
  'failed',
] as const;

export const FinalRenderBundleSchema = z
  .object({
    status: z.enum(finalRenderStatusValues),
    contentRevision: z.number().int().positive(),
    sourceLayoutContentRevision: z.number().int().positive(),
    sourceLayoutGenerationId: CreationIdSchema,
    sourceLayoutSourceHash: Sha256Schema,
    workspacePath: z
      .string()
      .regex(
        /^renders\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    videoFile: z.literal('video.mp4'),
    width: z.number().int().min(480).max(3840),
    height: z.number().int().min(480).max(3840),
    fps: z.number().int().min(1).max(120),
    playbackRate: z.number().min(0.25).max(4).default(1),
    sourceDurationSeconds: z.number().positive().optional(),
    watermark: RenderWatermarkSchema.default({type: 'none'}),
    durationSeconds: z.number().positive(),
    fileSizeBytes: z.number().int().positive(),
    encoding: z
      .object({
        container: z.literal('mp4'),
        videoCodec: z.literal('h264'),
        audioCodec: z.literal('aac'),
        pixelFormat: z.literal('yuv420p'),
        crf: z.number().int().min(0).max(51),
        preset: z.enum([
          'ultrafast',
          'superfast',
          'veryfast',
          'faster',
          'fast',
          'medium',
          'slow',
        ]),
      })
      .strict(),
    validation: z
      .object({
        validatedAt: z.string().datetime(),
        sourceHash: Sha256Schema,
        videoHash: Sha256Schema,
        renderedFrameCount: z.number().int().positive(),
        probedDurationSeconds: z.number().positive(),
      })
      .strict(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('local'),
        tool: z.literal('motion-canvas-ffmpeg'),
        generatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.workspacePath !==
      `renders/generations/${bundle.generation.generationId}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Render workspace phải trỏ đúng render generation.',
        path: ['workspacePath'],
      });
    }
    if (
      Math.abs(
        bundle.durationSeconds - bundle.validation.probedDurationSeconds,
      ) > finalRenderTimingToleranceSeconds(
        bundle.fps,
        bundle.durationSeconds,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Thời lượng video cuối không khớp nguồn Layout.',
        path: ['validation', 'probedDurationSeconds'],
      });
    }
    if (
      bundle.sourceDurationSeconds !== undefined &&
      Math.abs(
        bundle.durationSeconds -
          bundle.sourceDurationSeconds / bundle.playbackRate,
      ) > finalRenderTimingToleranceSeconds(
        bundle.fps,
        bundle.durationSeconds,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Thời lượng video không khớp tốc độ phát đã chọn.',
        path: ['playbackRate'],
      });
    }
  });

export type FinalRenderBundle = z.infer<typeof FinalRenderBundleSchema>;

export const GenerateFinalRenderSchema = z
  .object({
    generationId: CreationIdSchema,
    playbackRate: z.number().min(0.25).max(4).default(1),
    watermark: RenderWatermarkSchema.default({type: 'none'}),
  })
  .strict();

export type GenerateFinalRender = z.infer<typeof GenerateFinalRenderSchema>;

export interface WatermarkAssetSummary {
  assetId: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  sizeBytes: number;
}

export const FinalRenderJobStatusSchema = z
  .object({
    generationId: CreationIdSchema,
    state: z.enum(finalRenderJobStateValues),
    progress: z.number().min(0).max(1),
    renderedFrames: z.number().int().nonnegative(),
    totalFrames: z.number().int().positive(),
    startedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
    message: z.string().trim().min(1).max(500),
    errorCode: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export type FinalRenderJobStatus = z.infer<
  typeof FinalRenderJobStatusSchema
>;
