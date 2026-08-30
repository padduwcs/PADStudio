import assert from 'node:assert/strict';
import test from 'node:test';
import {MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER} from './motionCanvasGenerator.ts';
import {
  assertMotionCanvasScenesArePublishable,
  computeNewlyStalledMotionCanvasScenes,
  motionCanvasCheckpointRecoveryGuidance,
  motionCanvasGuidanceOnStaleBundleIsUnsafe,
  selectMotionCanvasVisualEvidenceForRetry,
} from './motionCanvasRoutes.ts';
import type {MotionCanvasVisualEvidence} from './motionCanvasVisualQuality.ts';

function routeTestScene(overrides: {name?: string; source?: string} = {}) {
  return {
    name: overrides.name ?? 'Direct TSX scene',
    source: overrides.source ?? [
      "import {makeScene2D} from '@motion-canvas/2d';",
      "import {waitFor} from '@motion-canvas/core';",
      'export default makeScene2D(function* (view) { yield* waitFor(1); });',
    ].join('\n'),
  };
}

test('initial fallback is rejected before workspace preparation', () => {
  let workspacePreparationCalls = 0;
  const generated = [routeTestScene({
    source: `// ${MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER}`,
  })];

  assert.throws(() => {
    assertMotionCanvasScenesArePublishable(generated, 'workspace preparation');
    workspacePreparationCalls += 1;
  }, /deterministic fallback output.*workspace preparation/u);
  assert.equal(workspacePreparationCalls, 0);
});

test('fallback returned by recover is rejected before approval or publish', () => {
  let approvalOrPublishCalls = 0;
  const recover = () => ({
    scenes: [routeTestScene({name: 'Topic scene · safe fallback'})],
  });
  const recovered = recover();

  assert.throws(() => {
    assertMotionCanvasScenesArePublishable(recovered.scenes, 'approval/publish');
    approvalOrPublishCalls += 1;
  }, /deterministic fallback output.*approval\/publish.*safe fallback/u);
  assert.equal(approvalOrPublishCalls, 0);
});

test('checkpoint fallback regeneration receives direct-TSX guidance', () => {
  const guidance = motionCanvasCheckpointRecoveryGuidance('Keep the existing beat ids.');

  assert.match(guidance, /complete TSX source object \{name, source\}/u);
  assert.match(guidance, /full literal TSX file contents/u);
  assert.doesNotMatch(guidance, /Scene Graph v3/u);
});

test('valid direct-TSX scene still proceeds through each route boundary', () => {
  let workspacePreparationCalls = 0;
  let visualQualityApprovalCalls = 0;
  let bundleCreationCalls = 0;
  let publishCalls = 0;
  const directScene = [routeTestScene()];

  assert.doesNotThrow(() => {
    assertMotionCanvasScenesArePublishable(directScene, 'workspace preparation');
    workspacePreparationCalls += 1;
    assertMotionCanvasScenesArePublishable(directScene, 'visual-quality approval');
    visualQualityApprovalCalls += 1;
    assertMotionCanvasScenesArePublishable(directScene, 'bundle creation');
    bundleCreationCalls += 1;
    assertMotionCanvasScenesArePublishable(directScene, 'approval/publish');
    publishCalls += 1;
  });
  assert.equal(workspacePreparationCalls, 1);
  assert.equal(visualQualityApprovalCalls, 1);
  assert.equal(bundleCreationCalls, 1);
  assert.equal(publishCalls, 1);
});

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

test('quality retry selects visual evidence only for failed scenes', () => {
  const evidence = (sceneId: string): MotionCanvasVisualEvidence => ({
    sceneId,
    beatId: '10000000-0000-4000-8000-000000000011',
    phase: 'middle',
    frame: 12,
    timeSeconds: 1,
    png: Buffer.from(sceneId),
    issues: [],
    nodes: [],
  });
  const selected = selectMotionCanvasVisualEvidenceForRetry(
    [evidence('passed-scene'), evidence('failed-scene')],
    new Set(['failed-scene']),
  );
  assert.deepEqual(selected.map(item => item.sceneId), ['failed-scene']);
});
