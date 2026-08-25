import assert from 'node:assert/strict';
import test from 'node:test';
import {computeNewlyStalledMotionCanvasScenes, motionCanvasGuidanceOnStaleBundleIsUnsafe} from './motionCanvasRoutes.ts';

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

test('computeNewlyStalledMotionCanvasScenes không đánh dấu gì ở vòng đầu tiên (chưa có lịch sử để so sánh)', () => {
  const issueCodesByScene = new Map<string, Set<string>>();
  const newlyStalled = computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'block-overlap'}, {sceneId: 'scene-a', code: 'text-clipped'}],
    issueCodesByScene,
    new Set(),
  );
  assert.deepEqual([...newlyStalled], []);
  assert.deepEqual([...issueCodesByScene.get('scene-a')!], ['block-overlap', 'text-clipped']);
});

test('computeNewlyStalledMotionCanvasScenes đánh dấu stalled khi số lượng issue-code không giảm giữa hai vòng', () => {
  const issueCodesByScene = new Map<string, Set<string>>();
  computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'block-overlap'}, {sceneId: 'scene-a', code: 'text-clipped'}],
    issueCodesByScene,
    new Set(),
  );
  const newlyStalled = computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'plan-misaligned'}, {sceneId: 'scene-a', code: 'palette-drift'}],
    issueCodesByScene,
    new Set(),
  );
  assert.deepEqual([...newlyStalled], ['scene-a']);
});

test('computeNewlyStalledMotionCanvasScenes không đánh dấu stalled khi issue-code thực sự giảm giữa hai vòng', () => {
  const issueCodesByScene = new Map<string, Set<string>>();
  computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'block-overlap'}, {sceneId: 'scene-a', code: 'text-clipped'}],
    issueCodesByScene,
    new Set(),
  );
  const newlyStalled = computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'block-overlap'}],
    issueCodesByScene,
    new Set(),
  );
  assert.deepEqual([...newlyStalled], []);
});

test('computeNewlyStalledMotionCanvasScenes bỏ qua scene đã stalled từ trước, không đánh dấu lại', () => {
  const issueCodesByScene = new Map<string, Set<string>>([['scene-a', new Set(['block-overlap'])]]);
  const newlyStalled = computeNewlyStalledMotionCanvasScenes(
    [{sceneId: 'scene-a', code: 'block-overlap'}, {sceneId: 'scene-b', code: 'text-clipped'}],
    issueCodesByScene,
    new Set(['scene-a']),
  );
  assert.deepEqual([...newlyStalled], []);
  assert.equal(issueCodesByScene.has('scene-b'), true);
});

test('computeNewlyStalledMotionCanvasScenes xử lý độc lập nhiều scene trong cùng một vòng', () => {
  const issueCodesByScene = new Map<string, Set<string>>();
  computeNewlyStalledMotionCanvasScenes(
    [
      {sceneId: 'converging', code: 'block-overlap'},
      {sceneId: 'converging', code: 'text-clipped'},
      {sceneId: 'stuck', code: 'plan-misaligned'},
    ],
    issueCodesByScene,
    new Set(),
  );
  const newlyStalled = computeNewlyStalledMotionCanvasScenes(
    [
      {sceneId: 'converging', code: 'block-overlap'},
      {sceneId: 'stuck', code: 'plan-misaligned'},
    ],
    issueCodesByScene,
    new Set(),
  );
  assert.deepEqual([...newlyStalled], ['stuck']);
});
