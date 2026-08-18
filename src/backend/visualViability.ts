import {inflateSync} from 'node:zlib';

export type Rgb = readonly [number, number, number];

export type VisualSampleVerdict =
  | 'viable'
  | 'transparent'
  | 'uniform'
  | 'insufficient-content';

export interface VisualSampleMetrics {
  frame: number;
  timeSeconds: number;
  sceneId: string;
  backgroundColor: string | null;
  totalPixels: number;
  opaquePixels: number;
  backgroundPixels: number;
  contentPixels: number;
  contentRatio: number;
  dominantColorRatio: number;
  verdict: VisualSampleVerdict;
}

export interface VisualSceneWindow {
  sceneId: string;
  durationSeconds: number;
}

export interface VisualViabilityValidation {
  backgroundColor: string | null;
  sampleCount: number;
  scenes: Array<{
    sceneId: string;
    sampleFrames: number[];
    viableSampleCount: number;
    samples: VisualSampleMetrics[];
  }>;
}

const ALPHA_TOLERANCE = 8;
const BACKGROUND_CHANNEL_TOLERANCE = 20;
const MINIMUM_CONTENT_PIXELS = 32;
const MINIMUM_CONTENT_RATIO = 0.0001;

export const visualViabilityThresholds = {
  alphaTolerance: ALPHA_TOLERANCE,
  backgroundChannelTolerance: BACKGROUND_CHANNEL_TOLERANCE,
  minimumContentPixels: MINIMUM_CONTENT_PIXELS,
  minimumContentRatio: MINIMUM_CONTENT_RATIO,
} as const;

export function parseHexColor(value: string | null | undefined): Rgb | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(
    String(value ?? '').trim(),
  );
  if (!match) return null;
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ];
}

function colorDistanceWithin(
  red: number,
  green: number,
  blue: number,
  expected: Rgb,
  tolerance: number,
) {
  return (
    Math.abs(red - expected[0]) <= tolerance &&
    Math.abs(green - expected[1]) <= tolerance &&
    Math.abs(blue - expected[2]) <= tolerance
  );
}

/**
 * Assess rendered RGBA pixels, rather than source structure. The deliberately
 * small coverage floor admits real text and small diagrams while rejecting a
 * canvas that only contains its configured background.
 */
export function analyzeRgbaFrame(options: {
  frame: number;
  timeSeconds: number;
  sceneId: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  backgroundColor?: string | null;
}): VisualSampleMetrics {
  const totalPixels = options.width * options.height;
  if (
    !Number.isSafeInteger(totalPixels) ||
    totalPixels <= 0 ||
    options.rgba.length !== totalPixels * 4
  ) {
    throw new Error('Frame RGBA không đúng kích thước canvas.');
  }
  const background = parseHexColor(options.backgroundColor);
  let opaquePixels = 0;
  let backgroundPixels = 0;
  const colorBins = new Map<number, number>();

  for (let offset = 0; offset < options.rgba.length; offset += 4) {
    const alpha = options.rgba[offset + 3]!;
    if (alpha <= ALPHA_TOLERANCE) continue;
    opaquePixels += 1;
    const red = options.rgba[offset]!;
    const green = options.rgba[offset + 1]!;
    const blue = options.rgba[offset + 2]!;
    if (
      background &&
      colorDistanceWithin(
        red,
        green,
        blue,
        background,
        BACKGROUND_CHANNEL_TOLERANCE,
      )
    ) {
      backgroundPixels += 1;
    }
    // 16-level bins absorb anti-aliasing and encoder-adjacent color jitter.
    const bin = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    colorBins.set(bin, (colorBins.get(bin) ?? 0) + 1);
  }

  const contentPixels = background
    ? Math.max(0, opaquePixels - backgroundPixels)
    : opaquePixels;
  const contentRatio = totalPixels > 0 ? contentPixels / totalPixels : 0;
  const dominantColorRatio = opaquePixels === 0
    ? 1
    : Math.max(0, ...colorBins.values()) / opaquePixels;
  const requiredContentPixels = Math.max(
    MINIMUM_CONTENT_PIXELS,
    Math.ceil(totalPixels * MINIMUM_CONTENT_RATIO),
  );
  const enoughContent =
    contentPixels >= requiredContentPixels &&
    contentRatio >= MINIMUM_CONTENT_RATIO;
  const verdict: VisualSampleVerdict = opaquePixels === 0
    ? 'transparent'
    // A perfectly (or virtually perfectly) solid frame is not viable even
    // when that color differs from the configured background (for example an
    // accidental black canvas). The high threshold still permits small text.
    : dominantColorRatio >= 0.99995
      ? 'uniform'
      : enoughContent
        ? 'viable'
        : 'insufficient-content';

  return {
    frame: options.frame,
    timeSeconds: options.timeSeconds,
    sceneId: options.sceneId,
    backgroundColor: background ? String(options.backgroundColor).toUpperCase() : null,
    totalPixels,
    opaquePixels,
    backgroundPixels,
    contentPixels,
    contentRatio,
    dominantColorRatio,
    verdict,
  };
}

export function sampleFramesForScene(
  startSeconds: number,
  durationSeconds: number,
  fps: number,
) {
  const startFrame = Math.max(0, Math.floor(startSeconds * fps));
  const endFrame = Math.max(startFrame, Math.ceil((startSeconds + durationSeconds) * fps) - 1);
  const span = endFrame - startFrame;
  // Interior points avoid scene boundaries, where a deliberate transition can
  // legitimately be empty for a frame.
  return [...new Set([0.25, 0.5, 0.75].map(ratio =>
    Math.min(endFrame, Math.max(startFrame, startFrame + Math.round(span * ratio))),
  ))];
}

export function createVisualViabilitySampler(options: {
  sections: VisualSceneWindow[];
  fps: number;
  backgroundColor?: string | null;
  analyze?: (input: {
    frame: number;
    timeSeconds: number;
    sceneId: string;
    backgroundColor: string | null;
    png: Buffer;
  }) => VisualSampleMetrics;
}) {
  const backgroundColor = parseHexColor(options.backgroundColor)
    ? String(options.backgroundColor).toUpperCase()
    : null;
  const scheduled = new Map<number, {sceneId: string; timeSeconds: number}>();
  let startSeconds = 0;
  const scenes = options.sections.map(section => {
    const sampleFrames = sampleFramesForScene(
      startSeconds,
      section.durationSeconds,
      options.fps,
    );
    const entry = {sceneId: section.sceneId, sampleFrames, samples: [] as VisualSampleMetrics[]};
    for (const frame of sampleFrames) {
      scheduled.set(frame, {
        sceneId: section.sceneId,
        timeSeconds: frame / options.fps,
      });
    }
    startSeconds += section.durationSeconds;
    return entry;
  });
  const sceneById = new Map(scenes.map(scene => [scene.sceneId, scene]));

  return {
    inspect(frame: number, png: Buffer) {
      const scheduledFrame = scheduled.get(frame);
      if (!scheduledFrame) return;
      const analyze = options.analyze ?? ((input: {
        frame: number;
        timeSeconds: number;
        sceneId: string;
        backgroundColor: string | null;
        png: Buffer;
      }) => {
        const decoded = decodePngRgba(input.png);
        return analyzeRgbaFrame({...input, ...decoded});
      });
      const sample = analyze({
        frame,
        timeSeconds: scheduledFrame.timeSeconds,
        sceneId: scheduledFrame.sceneId,
        backgroundColor,
        png,
      });
      sceneById.get(scheduledFrame.sceneId)?.samples.push(sample);
    },
    result(): VisualViabilityValidation {
      return {
        backgroundColor,
        sampleCount: scenes.reduce((total, scene) => total + scene.samples.length, 0),
        scenes: scenes.map(scene => ({
          sceneId: scene.sceneId,
          sampleFrames: scene.sampleFrames,
          viableSampleCount: scene.samples.filter(sample => sample.verdict === 'viable').length,
          samples: [...scene.samples],
        })),
      };
    },
  };
}

/** Minimal PNG decoder for the lossless 8-bit canvas PNGs emitted by Chrome. */
export function decodePngRgba(png: Buffer) {
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Frame không phải PNG hợp lệ.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + length;
    if (bodyEnd + 4 > png.length) throw new Error('PNG frame bị cắt ngắn.');
    const body = png.subarray(bodyStart, bodyEnd);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || ![2, 6].includes(body[9]!)) {
        throw new Error('PNG frame phải dùng màu RGB/RGBA 8-bit.');
      }
      colorType = body[9]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset = bodyEnd + 4;
  }
  if (!width || !height || !idat.length || colorType < 0) {
    throw new Error('PNG frame thiếu dữ liệu ảnh.');
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(idat));
  if (filtered.length !== (stride + 1) * height) {
    throw new Error('PNG frame có kích thước dữ liệu không khớp.');
  }
  const raw = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[inputOffset++]!;
    const rowOffset = row * stride;
    const previousOffset = rowOffset - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = filtered[inputOffset++]!;
      const left = column >= channels ? raw[rowOffset + column - channels]! : 0;
      const up = row > 0 ? raw[previousOffset + column]! : 0;
      const upperLeft = row > 0 && column >= channels
        ? raw[previousOffset + column - channels]!
        : 0;
      const paeth = () => {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        return leftDistance <= upDistance && leftDistance <= upperLeftDistance
          ? left
          : upDistance <= upperLeftDistance ? up : upperLeft;
      };
      raw[rowOffset + column] = filter === 0 ? value
        : filter === 1 ? (value + left) & 255
          : filter === 2 ? (value + up) & 255
            : filter === 3 ? (value + Math.floor((left + up) / 2)) & 255
              : filter === 4 ? (value + paeth()) & 255
                : (() => { throw new Error('PNG frame dùng filter không hỗ trợ.'); })();
    }
  }
  if (colorType === 6) return {width, height, rgba: raw};
  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0; source < raw.length; source += 3, target += 4) {
    rgba[target] = raw[source]!;
    rgba[target + 1] = raw[source + 1]!;
    rgba[target + 2] = raw[source + 2]!;
    rgba[target + 3] = 255;
  }
  return {width, height, rgba};
}
