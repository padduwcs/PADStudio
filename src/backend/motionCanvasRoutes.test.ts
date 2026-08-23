import assert from 'node:assert/strict';
import test from 'node:test';
import {motionCanvasGuidanceOnStaleBundleIsUnsafe} from './motionCanvasRoutes.ts';

test('regenerateFromScratch với guidance trên bundle lỗi thời vẫn được chấp nhận', () => {
  assert.equal(
    motionCanvasGuidanceOnStaleBundleIsUnsafe({
      hasGuidance: true,
      bundleExists: true,
      currentBundleUsable: false,
      regenerateFromScratch: true,
    }),
    false,
    'Codex tự khắc phục scene phải sinh lại từ đầu được dù kế hoạch voice-visual đã đổi',
  );
});

test('guidance chỉnh sửa tại chỗ trên bundle lỗi thời vẫn bị từ chối', () => {
  assert.equal(
    motionCanvasGuidanceOnStaleBundleIsUnsafe({
      hasGuidance: true,
      bundleExists: true,
      currentBundleUsable: false,
      regenerateFromScratch: false,
    }),
    true,
    'không được vá scene dựng từ kế hoạch voice-visual đã lỗi thời',
  );
});

test('guidance trên bundle vẫn còn dùng được không bị chặn', () => {
  assert.equal(
    motionCanvasGuidanceOnStaleBundleIsUnsafe({
      hasGuidance: true,
      bundleExists: true,
      currentBundleUsable: true,
      regenerateFromScratch: false,
    }),
    false,
  );
});

test('không có guidance thì không bao giờ bị chặn bởi kiểm tra này', () => {
  assert.equal(
    motionCanvasGuidanceOnStaleBundleIsUnsafe({
      hasGuidance: false,
      bundleExists: true,
      currentBundleUsable: false,
      regenerateFromScratch: false,
    }),
    false,
  );
});

test('chưa từng có bundle thì không bị chặn bởi kiểm tra này', () => {
  assert.equal(
    motionCanvasGuidanceOnStaleBundleIsUnsafe({
      hasGuidance: true,
      bundleExists: false,
      currentBundleUsable: false,
      regenerateFromScratch: false,
    }),
    false,
  );
});
