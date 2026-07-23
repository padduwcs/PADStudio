import {z} from 'zod';

const CreationIdSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

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
  opacity: z.number().finite().min(0).max(1),
  xPercent: z.number().finite(),
  yPercent: z.number().finite(),
});

export const RenderWatermarkSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('none')}).strict(),
  WatermarkBaseSchema.extend({
    type: z.literal('text'),
    text: z.string().trim().min(1),
    fontSize: z.number().finite().positive(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict(),
  WatermarkBaseSchema.extend({
    type: z.literal('image'),
    assetId: Sha256Schema,
    widthPercent: z.number().finite().nonnegative(),
    tintColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#FFFFFF'),
    tintStrength: z.number().finite().min(0).max(1).default(0),
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

export const finalRenderDiagnosticStageValues = [
  'preparing',
  'motion-canvas',
  'encoder',
  'browser',
  'finalizing',
] as const;

export const FinalRenderDiagnosticLogSchema = z
  .object({
    level: z.enum(['error', 'warn', 'info', 'debug']),
    message: z.string().trim().min(1).max(1_000),
    remarks: z.string().trim().min(1).max(2_000).nullable().default(null),
    stack: z.string().trim().min(1).max(4_000).nullable().default(null),
  })
  .strict();

export const FinalRenderDiagnosticSchema = z
  .object({
    stage: z.enum(finalRenderDiagnosticStageValues),
    frame: z.number().int().nonnegative().nullable(),
    sceneFrame: z.number().int().nonnegative().nullable(),
    sceneName: z.string().trim().min(1).max(200).nullable(),
    timeSeconds: z.number().nonnegative().finite().nullable(),
    logs: z.array(FinalRenderDiagnosticLogSchema).max(8),
  })
  .strict();

export type FinalRenderDiagnostic = z.infer<
  typeof FinalRenderDiagnosticSchema
>;

function normalizeLegacyFinalRenderBundle(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const bundle: Record<string, unknown> = {...value};
  delete bundle.playbackRate;
  delete bundle.sourceDurationSeconds;
  const watermark = bundle.watermark;
  if (
    watermark &&
    typeof watermark === 'object' &&
    !Array.isArray(watermark) &&
    'type' in watermark &&
    watermark.type !== 'none'
  ) {
    const legacy = {...watermark} as Record<string, unknown>;
    const coordinates =
      legacy.position === 'top-left'
        ? {xPercent: 8, yPercent: 8}
        : legacy.position === 'top-right'
          ? {xPercent: 92, yPercent: 8}
          : legacy.position === 'bottom-left'
            ? {xPercent: 8, yPercent: 92}
            : legacy.position === 'center'
              ? {xPercent: 50, yPercent: 50}
              : {xPercent: 92, yPercent: 92};
    delete legacy.position;
    bundle.watermark = {
      ...legacy,
      ...(legacy.type === 'image'
        ? {
            tintColor:
              typeof legacy.tintColor === 'string'
                ? legacy.tintColor
                : '#FFFFFF',
            tintStrength:
              typeof legacy.tintStrength === 'number'
                ? legacy.tintStrength
                : 0,
          }
        : {}),
      xPercent:
        typeof legacy.xPercent === 'number'
          ? legacy.xPercent
          : coordinates.xPercent,
      yPercent:
        typeof legacy.yPercent === 'number'
          ? legacy.yPercent
          : coordinates.yPercent,
    };
  }
  return bundle;
}

const FinalRenderBundleValueSchema = z
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
  });

export const FinalRenderBundleSchema = z.preprocess(
  normalizeLegacyFinalRenderBundle,
  FinalRenderBundleValueSchema,
);

export type FinalRenderBundle = z.infer<typeof FinalRenderBundleSchema>;

export const GenerateFinalRenderSchema = z
  .object({
    generationId: CreationIdSchema,
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
    diagnostic: FinalRenderDiagnosticSchema.nullable().optional(),
  })
  .strict();

export type FinalRenderJobStatus = z.infer<
  typeof FinalRenderJobStatusSchema
>;

export const FinalRenderJobReportSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
    sourceLayoutContentRevision: z.number().int().positive(),
    sourceLayoutGenerationId: CreationIdSchema,
    sourceLayoutSourceHash: Sha256Schema,
    status: FinalRenderJobStatusSchema,
    bundle: FinalRenderBundleSchema.nullable().optional(),
  })
  .strict()
  .superRefine((report, context) => {
    if (!['completed', 'failed'].includes(report.status.state)) {
      context.addIssue({
        code: 'custom',
        message: 'Chỉ job render đã kết thúc mới được lưu thành report.',
        path: ['status', 'state'],
      });
    }
    if (report.bundle) {
      if (
        report.status.state !== 'completed' ||
        report.bundle.generation.generationId !==
          report.status.generationId ||
        report.bundle.sourceLayoutContentRevision !==
          report.sourceLayoutContentRevision ||
        report.bundle.sourceLayoutGenerationId !==
          report.sourceLayoutGenerationId ||
        report.bundle.sourceLayoutSourceHash !==
          report.sourceLayoutSourceHash
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Bundle trong render report không khớp job hoặc Layout nguồn.',
          path: ['bundle'],
        });
      }
    }
  });

export type FinalRenderJobReport = z.infer<
  typeof FinalRenderJobReportSchema
>;
