import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioTempoFilter,
  inspectRenderFrameTiming,
} from './finalRenderService.ts';
import {FinalRenderBundleSchema} from '../shared/render.ts';

test('ước tính frame giữ quy ước endpoint của Motion Canvas', () => {
  const timing = inspectRenderFrameTiming(31, 1, 30);

  assert.equal(timing.estimatedFrameCount, 31);
  assert.equal(timing.encodedDurationSeconds, 31 / 30);
  assert.equal(timing.matches, true);
});

test('chấp nhận sai số kết thúc scene nhỏ hơn một phần frame', () => {
  const timing = inspectRenderFrameTiming(2_611, 87.04, 30);

  assert.equal(timing.estimatedFrameCount, 2_613);
  assert.ok(Math.abs(timing.differenceSeconds) < 1 / 30);
  assert.equal(timing.matches, true);
});

test('chấp nhận thiếu vài frame và tự giới hạn dung sai cho video dài', () => {
  const timing = inspectRenderFrameTiming(6_153, 205.2, 30);

  assert.equal(timing.estimatedFrameCount, 6_157);
  assert.ok(Math.abs(timing.differenceSeconds + 0.1) < 0.000_001);
  assert.equal(timing.toleranceSeconds, 0.4104);
  assert.equal(timing.matches, true);
  assert.equal(inspectRenderFrameTiming(6_135, 205.2, 30).matches, false);
});

test('schema final render dùng cùng dung sai cho kết quả ffprobe', () => {
  const bundle = {
    status: 'completed',
    contentRevision: 1,
    sourceLayoutContentRevision: 1,
    sourceLayoutGenerationId: '10000000-0000-4000-8000-000000000001',
    sourceLayoutSourceHash: 'a'.repeat(64),
    workspacePath:
      'renders/generations/20000000-0000-4000-8000-000000000002',
    videoFile: 'video.mp4',
    width: 1080,
    height: 1920,
    fps: 30,
    playbackRate: 1,
    sourceDurationSeconds: 205.2,
    watermark: {type: 'none'},
    durationSeconds: 205.2,
    fileSizeBytes: 1,
    encoding: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      crf: 18,
      preset: 'medium',
    },
    validation: {
      validatedAt: '2026-07-20T00:00:00.000Z',
      sourceHash: 'b'.repeat(64),
      videoHash: 'c'.repeat(64),
      renderedFrameCount: 6_153,
      probedDurationSeconds: 205.1,
    },
    generation: {
      generationId: '20000000-0000-4000-8000-000000000002',
      provider: 'local',
      tool: 'motion-canvas-ffmpeg',
      generatedAt: '2026-07-20T00:00:00.000Z',
    },
  };

  assert.equal(FinalRenderBundleSchema.safeParse(bundle).success, true);
  assert.equal(
    FinalRenderBundleSchema.safeParse({
      ...bundle,
      validation: {...bundle.validation, probedDurationSeconds: 204.6},
    }).success,
    false,
  );
});

test('từ chối scene thực sự kết thúc sớm và frame count rỗng', () => {
  assert.equal(inspectRenderFrameTiming(2_580, 87.04, 30).matches, false);
  assert.equal(inspectRenderFrameTiming(0, 87.04, 30).matches, false);
});

test('audio tempo được chia chuỗi an toàn cho toàn dải tốc độ render', () => {
  assert.equal(audioTempoFilter(1), 'atempo=1.000000');
  assert.equal(
    audioTempoFilter(0.25),
    'atempo=0.500000,atempo=0.500000',
  );
  assert.equal(
    audioTempoFilter(4),
    'atempo=2.000000,atempo=2.000000',
  );
});
