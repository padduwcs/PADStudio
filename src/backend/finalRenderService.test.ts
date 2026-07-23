import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createFinalRenderService,
  inspectRenderFrameTiming,
} from './finalRenderService.ts';
import {
  FinalRenderBundleSchema,
  FinalRenderJobReportSchema,
  FinalRenderJobStatusSchema,
} from '../shared/render.ts';

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
  const migrated = FinalRenderBundleSchema.parse({
    ...bundle,
    playbackRate: 1.25,
    sourceDurationSeconds: 256.5,
    watermark: {
      type: 'text',
      text: 'Legacy',
      opacity: 0.2,
      position: 'bottom-right',
      fontSize: 32,
      color: '#ffffff',
    },
  });
  assert.deepEqual(migrated.watermark, {
    type: 'text',
    text: 'Legacy',
    opacity: 0.2,
    xPercent: 92,
    yPercent: 92,
    fontSize: 32,
    color: '#ffffff',
  });
  const migratedImage = FinalRenderBundleSchema.parse({
    ...bundle,
    watermark: {
      type: 'image',
      assetId: 'd'.repeat(64),
      opacity: 0.4,
      xPercent: 50,
      yPercent: 50,
      widthPercent: 30,
    },
  });
  assert.deepEqual(migratedImage.watermark, {
    type: 'image',
    assetId: 'd'.repeat(64),
    opacity: 0.4,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 30,
    tintColor: '#FFFFFF',
    tintStrength: 0,
  });
  assert.equal('playbackRate' in migrated, false);
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

test('status render giữ diagnostic có scene, frame và stack', () => {
  const status = FinalRenderJobStatusSchema.parse({
    generationId: '20000000-0000-4000-8000-000000000002',
    state: 'failed',
    progress: 0.4,
    renderedFrames: 120,
    totalFrames: 300,
    startedAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:01:00.000Z',
    message: 'Không thể vẽ node.',
    errorCode: 'FINAL_RENDER_MOTION_CANVAS_FAILED',
    diagnostic: {
      stage: 'motion-canvas',
      frame: 119,
      sceneFrame: 29,
      sceneName: 'scene-02',
      timeSeconds: 119 / 30,
      logs: [
        {
          level: 'error',
          message: 'Không thể vẽ node.',
          remarks: null,
          stack: 'Error: Không thể vẽ node.\n at scene-02.tsx:10',
        },
      ],
    },
  });

  assert.equal(status.diagnostic?.sceneName, 'scene-02');
  assert.equal(status.diagnostic?.frame, 119);
});

test('job report chỉ chấp nhận trạng thái terminal', () => {
  const base = {
    version: 1,
    projectId: 'diagnostic-project',
    sourceLayoutContentRevision: 1,
    sourceLayoutGenerationId: '10000000-0000-4000-8000-000000000001',
    sourceLayoutSourceHash: 'a'.repeat(64),
    status: {
      generationId: '20000000-0000-4000-8000-000000000002',
      state: 'completed',
      progress: 1,
      renderedFrames: 31,
      totalFrames: 31,
      startedAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:10.000Z',
      message: 'Video cuối đã sẵn sàng.',
      errorCode: null,
      diagnostic: null,
    },
  };

  assert.equal(FinalRenderJobReportSchema.safeParse(base).success, true);
  assert.equal(
    FinalRenderJobReportSchema.safeParse({
      ...base,
      status: {...base.status, state: 'rendering'},
    }).success,
    false,
  );
});

test('khôi phục status terminal từ report sau khi service khởi động lại', async context => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-render-report-test-'),
  );
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const projectId = 'diagnostic-project';
  const generationId = '20000000-0000-4000-8000-000000000002';
  const jobsDirectory = path.join(
    projectsDirectory,
    projectId,
    'renders',
    'jobs',
  );
  await mkdir(jobsDirectory, {recursive: true});
  const report = FinalRenderJobReportSchema.parse({
    version: 1,
    projectId,
    sourceLayoutContentRevision: 1,
    sourceLayoutGenerationId: '10000000-0000-4000-8000-000000000001',
    sourceLayoutSourceHash: 'a'.repeat(64),
    status: {
      generationId,
      state: 'failed',
      progress: 0.4,
      renderedFrames: 120,
      totalFrames: 300,
      startedAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:01:00.000Z',
      message: 'Không thể vẽ node.',
      errorCode: 'FINAL_RENDER_MOTION_CANVAS_FAILED',
      diagnostic: null,
    },
  });
  await writeFile(
    path.join(jobsDirectory, `${generationId}.json`),
    JSON.stringify(report),
    'utf8',
  );

  const service = createFinalRenderService(projectsDirectory, {
    logger: {info() {}, error() {}},
  });
  context.after(() => service.close());

  assert.deepEqual(await service.getStatus(projectId, generationId), report.status);
  assert.deepEqual(await service.getStatus(projectId), report.status);
});
