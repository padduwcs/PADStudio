import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VideoFrameSchema,
  framesHaveSameAspectRatio,
  resolutionsForFrame,
} from './videoFormat.ts';

test('video frames protect H.264-compatible dimensions and named aspect ratios', () => {
  assert.equal(VideoFrameSchema.safeParse({
    aspectRatio: 'landscape', width: 1920, height: 1080, fps: 30,
  }).success, true);
  assert.equal(VideoFrameSchema.safeParse({
    aspectRatio: 'portrait', width: 1081, height: 1920, fps: 30,
  }).success, false);
});

test('resolution choices retain composition aspect ratio', () => {
  const frame = {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const};
  assert.equal(resolutionsForFrame(frame).every(value => framesHaveSameAspectRatio(frame, {...frame, ...value})), true);
});
