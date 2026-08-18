import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeRgbaFrame,
  createVisualViabilitySampler,
} from './visualViability.ts';
import {
  FinalRenderError,
  assertFinalRenderVisualViability,
} from './finalRenderService.ts';

const sceneOne = '10000000-0000-4000-8000-000000000001';
const sceneTwo = '20000000-0000-4000-8000-000000000002';

function rgba(width: number, height: number, color: [number, number, number, number]) {
  return new Uint8Array(Array.from({length: width * height}, () => color).flat());
}

test('visual viability từ chối frame trong suốt và toàn nền tối', () => {
  const transparent = analyzeRgbaFrame({
    frame: 0, timeSeconds: 0, sceneId: sceneOne, width: 32, height: 32,
    rgba: rgba(32, 32, [0, 0, 0, 0]), backgroundColor: '#10231D',
  });
  const black = analyzeRgbaFrame({
    frame: 1, timeSeconds: 1 / 30, sceneId: sceneOne, width: 32, height: 32,
    rgba: rgba(32, 32, [0, 0, 0, 255]), backgroundColor: '#10231D',
  });

  assert.equal(transparent.verdict, 'transparent');
  assert.equal(black.verdict, 'uniform');
  assert.equal(black.dominantColorRatio, 1);
});

test('visual viability chấp nhận content tương phản dù scene tối giản', () => {
  const pixels = rgba(64, 64, [16, 35, 29, 255]);
  for (let pixel = 0; pixel < 96; pixel += 1) {
    const offset = pixel * 4;
    pixels[offset] = 219;
    pixels[offset + 1] = 233;
    pixels[offset + 2] = 226;
  }
  const sample = analyzeRgbaFrame({
    frame: 10, timeSeconds: 10 / 30, sceneId: sceneOne, width: 64, height: 64,
    rgba: pixels, backgroundColor: '#10231D',
  });

  assert.equal(sample.verdict, 'viable');
  assert.ok(sample.contentPixels >= 96);
});

test('video có một scene rỗng bị reject dù media metadata giả định hợp lệ', () => {
  const sampler = createVisualViabilitySampler({
    sections: [
      {sceneId: sceneOne, durationSeconds: 1},
      {sceneId: sceneTwo, durationSeconds: 1},
    ],
    fps: 30,
    backgroundColor: '#10231D',
    analyze: ({frame, timeSeconds, sceneId, backgroundColor}) => ({
      ...analyzeRgbaFrame({
        frame,
        timeSeconds,
        sceneId,
        width: 64,
        height: 64,
        rgba: sceneId === sceneOne
          ? (() => {
              const pixels = rgba(64, 64, [16, 35, 29, 255]);
              for (let index = 0; index < 96; index += 1) pixels[index * 4] = 220;
              return pixels;
            })()
          : rgba(64, 64, [16, 35, 29, 255]),
        backgroundColor,
      }),
    }),
  });
  const scheduled = sampler.result().scenes.flatMap(scene => scene.sampleFrames);
  for (const frame of scheduled) sampler.inspect(frame, Buffer.alloc(0));
  const result = sampler.result();
  assert.equal(result.scenes[0]?.viableSampleCount, 3);
  assert.equal(result.scenes[1]?.viableSampleCount, 0);
  assert.equal(result.scenes[1]?.samples[0]?.verdict, 'uniform');
  assert.throws(
    () => assertFinalRenderVisualViability(result),
    (error: unknown) =>
      error instanceof FinalRenderError &&
      error.code === 'FINAL_RENDER_VISUAL_VALIDATION_FAILED' &&
      error.diagnostic?.visual?.scenes[1]?.samples[0]?.frame === result.scenes[1]?.sampleFrames[0],
  );
});
