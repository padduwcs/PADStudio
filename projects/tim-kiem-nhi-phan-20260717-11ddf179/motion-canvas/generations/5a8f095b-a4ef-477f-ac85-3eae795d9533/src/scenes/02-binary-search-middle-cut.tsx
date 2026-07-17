import {makeScene2D, Rect, Circle, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, createSignal, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  const subtitle = createRef<Txt>();
  const track = createRef<Rect>();
  const leftGone = createRef<Rect>();
  const rightKeep = createRef<Rect>();
  const midMarker = createRef<Circle>();
  const pointer = createRef<Circle>();
  const secret = createRef<Rect>();
  const secretLabel = createRef<Txt>();
  const stepLabel = createRef<Txt>();
  const hint = createRef<Txt>();

  const pointerX = createSignal(0);
  const secretX = createSignal(0);
  const rangeText = createSignal('1..100');
  const stepText = createSignal('');

  view.add(
    <Layout width={1080} height={1920} direction="column" alignItems="center" justifyContent="start" gap={40}>
      <Txt ref={title} text="ĐOÁN SỐ" y={120} fontSize={74} fontWeight={800} fill="#FFFFFF" opacity={0} />
      <Txt ref={subtitle} text="mỗi lần hỏi chỉ giữ lại một nửa" y={200} fontSize={34} fill="#B8C2FF" opacity={0} />

      <Layout y={360} width={960} height={220} justifyContent="center" alignItems="center">
        <Rect ref={track} width={920} height={34} radius={18} fill="#24304D" opacity={0.9} />
        <Rect ref={leftGone} x={-230} width={460} height={34} radius={18} fill="#3C4662" opacity={0} />
        <Rect ref={rightKeep} x={230} width={460} height={34} radius={18} fill="#63E6BE" opacity={0} />
        <Circle ref={midMarker} x={0} size={56} fill="#FFD166" opacity={0} />
        <Circle ref={pointer} x={() => pointerX()} y={-68} size={74} fill="#FFFFFF" opacity={0.95} />
        <Txt text={() => rangeText()} y={92} fontSize={32} fill="#EAF0FF" />
        <Txt ref={stepLabel} text={() => stepText()} y={134} fontSize={26} fill="#8FB3FF" opacity={0} />
      </Layout>

      <Layout y={770} width={980} height={620}>
        <Rect ref={secret} x={() => secretX()} y={0} width={120} height={96} radius={18} fill="#FF6B6B" opacity={0} />
        <Txt ref={secretLabel} text="73" x={() => secretX()} y={0} fontSize={42} fontWeight={800} fill="#FFFFFF" opacity={0} />
        <Txt ref={hint} text="" y={170} fontSize={38} fill="#FFFFFF" opacity={0} />
      </Layout>
    </Layout>
  );

  yield* all(
    title().opacity(1, 0.35),
    subtitle().opacity(1, 0.35),
  );
  yield* waitFor(0.15);

  yield* sequence(
    0.15,
    all(
      midMarker().opacity(1, 0.25),
      pointer().opacity(1, 0.25),
    ),
    chain(
      pointerX(0, 0.01),
      pointerX(0, 0.45, easeInOutCubic),
    ),
  );
  rangeText('1..100');
  stepText('chọn giữa: 50');
  yield* stepLabel().opacity(1, 0.2);
  yield* waitFor(1.0);

  yield* all(
    leftGone().opacity(1, 0.3),
    rightKeep().opacity(1, 0.3),
    leftGone().scale([1, 1], 0.01),
    pointerX(0, 0.01),
  );
  yield* chain(
    pointerX(0, 0.05),
    pointerX(230, 0.55, easeInOutCubic),
  );
  stepText('lớn hơn 50 → bỏ nửa trái');
  rangeText('51..100');
  yield* waitFor(1.5);

  yield* all(
    leftGone().opacity(0, 0.25),
    rightKeep().opacity(0.95, 0.25),
    pointerX(230, 0.01),
  );
  stepText('lại chọn giữa: 75');
  rangeText('51..100');
  yield* chain(
    pointerX(230, 0.05),
    pointerX(460, 0.55, easeInOutCubic),
  );
  yield* waitFor(1.25);

  yield* all(
    secret().opacity(1, 0.25),
    secretLabel().opacity(1, 0.25),
    secretX(220, 0.01),
  );
  hint().text('73 nằm bên trái 75');
  yield* hint().opacity(1, 0.25);
  stepText('nhỏ hơn 75 → bỏ nửa phải');
  yield* all(
    rightKeep().x(-230, 0.45, easeInOutCubic),
    rightKeep().scale([0.52, 1], 0.45),
    pointerX(460, 0.45, easeInOutCubic),
  );
  yield* waitFor(1.3);

  yield* all(
    title().opacity(1, 0.2),
    subtitle().opacity(1, 0.2),
    stepLabel().opacity(0.2, 0.2),
    hint().opacity(1, 0.2),
  );
  stepText('cứ chia đôi → log₂(n)');
  rangeText('1..25');
  yield* waitFor(1.35);
});
