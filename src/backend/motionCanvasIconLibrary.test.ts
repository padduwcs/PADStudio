import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractReferencedMotionCanvasIconIds,
  generateMotionCanvasIconAtlasSource,
  isKnownMotionCanvasIconId,
  resolveMotionCanvasIcon,
  suggestMotionCanvasIconIds,
} from './motionCanvasIconLibrary.ts';

test('resolveMotionCanvasIcon trả về path data thật cho icon phosphor hợp lệ', () => {
  const icon = resolveMotionCanvasIcon('ph:tree');
  assert.ok(icon);
  assert.match(icon!.d, /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/u);
  assert.equal(icon!.viewBoxWidth, 256);
  assert.equal(icon!.viewBoxHeight, 256);
});

test('resolveMotionCanvasIcon trả về path data thật cho icon tabler hợp lệ, kể cả icon bọc trong <g>', () => {
  const single = resolveMotionCanvasIcon('tabler:heart');
  assert.ok(single);
  assert.match(single!.d, /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/u);
  assert.equal(single!.viewBoxWidth, 24);
  assert.equal(single!.viewBoxHeight, 24);

  const grouped = resolveMotionCanvasIcon('tabler:building-hospital');
  assert.ok(grouped);
  assert.match(grouped!.d, /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/u);
});

test('resolveMotionCanvasIcon từ chối prefix không được hỗ trợ', () => {
  assert.equal(resolveMotionCanvasIcon('fa:leaf'), null);
});

test('resolveMotionCanvasIcon từ chối icon không tồn tại', () => {
  assert.equal(resolveMotionCanvasIcon('tabler:this-icon-does-not-exist'), null);
});

test('resolveMotionCanvasIcon chỉ giữ Phosphor regular weight, từ chối các biến thể weight khác', () => {
  assert.equal(isKnownMotionCanvasIconId('ph:tree'), true);
  assert.equal(isKnownMotionCanvasIconId('ph:tree-fill'), false);
  assert.equal(isKnownMotionCanvasIconId('ph:tree-bold'), false);
  assert.equal(isKnownMotionCanvasIconId('ph:tree-duotone'), false);
});

test('resolveMotionCanvasIcon chỉ giữ Tabler outline, từ chối biến thể filled', () => {
  assert.equal(isKnownMotionCanvasIconId('tabler:heart'), true);
  assert.equal(isKnownMotionCanvasIconId('tabler:heart-filled'), false);
});

test('isKnownMotionCanvasIconId khớp với resolveMotionCanvasIcon', () => {
  assert.equal(isKnownMotionCanvasIconId('ph:white-balance-sunny'), false);
  assert.equal(isKnownMotionCanvasIconId('tabler:sun'), true);
  assert.equal(isKnownMotionCanvasIconId('tabler:not-a-real-icon-xyz'), false);
});

test('suggestMotionCanvasIconIds gợi ý icon gần đúng theo từ khoá', () => {
  const suggestions = suggestMotionCanvasIconIds('leaf', 5);
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every(id => /^(ph|tabler):/u.test(id)));
  assert.ok(suggestions.some(id => id.includes('leaf')));
});

test('suggestMotionCanvasIconIds trả về mảng rỗng với từ khoá rỗng', () => {
  assert.deepEqual(suggestMotionCanvasIconIds(''), []);
});

test('extractReferencedMotionCanvasIconIds đọc id từ <Icon id="..."> và bỏ qua element khác', () => {
  const source = `import {Icon} from '../iconAtlas';
import {makeScene2D, Rect} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    <Rect key="scene-background">
      <Icon key="leaf-icon" id="ph:leaf" width={40} height={40} />
      <Icon key="heart-icon" id={"tabler:heart"} width={40} height={40} />
      <Rect key="not-an-icon" id="unrelated-attribute" />
    </Rect>,
  );
});
`;
  assert.deepEqual(
    extractReferencedMotionCanvasIconIds(source).sort(),
    ['ph:leaf', 'tabler:heart'],
  );
});

test('extractReferencedMotionCanvasIconIds trả về mảng rỗng với dedup khi không có Icon nào', () => {
  assert.deepEqual(extractReferencedMotionCanvasIconIds('<Rect key="only-rect" />'), []);
  const repeated = '<Icon key="a" id="ph:leaf" width={1} height={1} /><Icon key="b" id="ph:leaf" width={1} height={1} />';
  assert.deepEqual(extractReferencedMotionCanvasIconIds(repeated), ['ph:leaf']);
});

test('generateMotionCanvasIconAtlasSource nhúng path data thật cho icon đã biết và bỏ qua icon không hợp lệ', () => {
  const icon = resolveMotionCanvasIcon('ph:leaf');
  assert.ok(icon);
  const source = generateMotionCanvasIconAtlasSource(['ph:leaf', 'ph:leaf', 'ph:does-not-exist-xyz']);
  assert.match(source, /import \{Path\} from '@motion-canvas\/2d';/);
  assert.ok(source.includes(JSON.stringify(icon!.d)));
  assert.match(source, /"ph:leaf":/);
  assert.doesNotMatch(source, /does-not-exist/);
  assert.match(source, /export function Icon\(props: IconProps\)/);
  assert.match(source, /scale=\{\[props\.width \/ icon\.viewBoxWidth, props\.height \/ icon\.viewBoxHeight\]\}/);
});

test('generateMotionCanvasIconAtlasSource với danh sách rỗng vẫn sinh file hợp lệ không có icon', () => {
  const source = generateMotionCanvasIconAtlasSource([]);
  assert.match(source, /const rawIcons: Record<string, \{d: string; viewBoxWidth: number; viewBoxHeight: number\}> = \{\s*\};/);
  assert.match(source, /export function Icon/);
});
