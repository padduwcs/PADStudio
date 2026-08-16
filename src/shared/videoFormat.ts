import {z} from 'zod';

export const videoAspectRatioValues = [
  'portrait',
  'landscape',
  'square',
  'custom',
] as const;

export const renderQualityValues = ['fast', 'standard', 'high'] as const;

export const VideoFrameSchema = z
  .object({
    aspectRatio: z.enum(videoAspectRatioValues),
    width: z.number().int().min(480).max(3840),
    height: z.number().int().min(480).max(3840),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.width % 2 || value.height % 2) {
      context.addIssue({
        code: 'custom',
        message: 'Chiều rộng và chiều cao phải là số chẵn để xuất H.264 ổn định.',
      });
    }
    const ratio = value.width / value.height;
    const expected =
      value.aspectRatio === 'portrait'
        ? 9 / 16
        : value.aspectRatio === 'landscape'
          ? 16 / 9
          : value.aspectRatio === 'square'
            ? 1
            : null;
    if (expected !== null && Math.abs(ratio - expected) > 0.002) {
      context.addIssue({
        code: 'custom',
        message: 'Kích thước không khớp tỷ lệ khung hình đã chọn.',
      });
    }
  });

export type VideoFrame = z.infer<typeof VideoFrameSchema>;

export const defaultVideoFrame: VideoFrame = {
  aspectRatio: 'portrait',
  width: 1080,
  height: 1920,
  fps: 30,
};

export const RenderProfileSchema = z
  .object({
    frame: VideoFrameSchema,
    quality: z.enum(renderQualityValues).default('standard'),
  })
  .strict();

export type RenderProfile = z.infer<typeof RenderProfileSchema>;

export const defaultRenderProfile: RenderProfile = {
  frame: defaultVideoFrame,
  quality: 'standard',
};

/** Resolutions that preserve the project's chosen aspect ratio. */
export function resolutionsForFrame(frame: VideoFrame) {
  const ratio = frame.width / frame.height;
  const longerEdge = [720, 1080, 2160];
  return longerEdge.map((edge) => {
    const portrait = ratio < 1;
    const width = portrait ? Math.round((edge * ratio) / 2) * 2 : edge;
    const height = portrait ? edge : Math.round((edge / ratio) / 2) * 2;
    return {width, height};
  });
}

export function framesHaveSameAspectRatio(left: VideoFrame, right: VideoFrame) {
  return Math.abs(left.width / left.height - right.width / right.height) < 0.002;
}
