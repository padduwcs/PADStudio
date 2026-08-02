import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EDITOR_WORKSPACE_DEFAULTS,
  fitEditorWorkspaceToBounds,
  normalizeEditorWorkspacePreferences,
  setEditorCanvasZoom,
  setEditorPanelSize,
} from './editorWorkspaceState.ts';

test('workspace editor khôi phục preference lỗi về giá trị an toàn', () => {
  assert.deepEqual(
    normalizeEditorWorkspacePreferences({
      left: Number.NaN,
      right: -20,
      timeline: 9_000,
      canvasZoom: 20,
    }),
    {
      left: EDITOR_WORKSPACE_DEFAULTS.left,
      right: 180,
      timeline: 480,
      canvasZoom: 3,
    },
  );
});

test('panel editor co về 0 và không lấn vùng canvas tối thiểu', () => {
  const collapsed = setEditorPanelSize(
    EDITOR_WORKSPACE_DEFAULTS,
    'left',
    40,
    {width: 1_240, height: 800},
  );
  assert.equal(collapsed.left, 0);

  const expanded = setEditorPanelSize(
    EDITOR_WORKSPACE_DEFAULTS,
    'left',
    900,
    {width: 1_120, height: 800},
  );
  assert.equal(expanded.left, 370);

  const timeline = setEditorPanelSize(
    EDITOR_WORKSPACE_DEFAULTS,
    'timeline',
    900,
    {width: 1_240, height: 720},
  );
  assert.equal(timeline.timeline, 372);
});

test('zoom canvas được giới hạn nhưng không làm thay đổi panel', () => {
  assert.deepEqual(
    setEditorCanvasZoom(EDITOR_WORKSPACE_DEFAULTS, 0.1),
    {...EDITOR_WORKSPACE_DEFAULTS, canvasZoom: 0.5},
  );
  assert.deepEqual(
    setEditorCanvasZoom(EDITOR_WORKSPACE_DEFAULTS, 4),
    {...EDITOR_WORKSPACE_DEFAULTS, canvasZoom: 3},
  );
});

test('workspace tự cân lại hai sidebar khi cửa sổ bị thu hẹp', () => {
  const fitted = fitEditorWorkspaceToBounds(
    {
      left: 460,
      right: 460,
      timeline: 480,
      canvasZoom: 1.8,
    },
    {width: 1_040, height: 760},
  );
  assert.equal(Math.round(fitted.left + fitted.right), 572);
  assert.equal(fitted.timeline, 412);
  assert.equal(fitted.canvasZoom, 1.8);
});
