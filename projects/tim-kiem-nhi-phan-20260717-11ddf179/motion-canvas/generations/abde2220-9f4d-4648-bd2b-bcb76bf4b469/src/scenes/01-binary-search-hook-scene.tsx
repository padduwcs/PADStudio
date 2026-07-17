import {all, createRef, createSignal, easeInOutCubic, waitFor} from '@motion-canvas/core';
import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.fill('#0b1020');

  const stage = createRef<Layout>();
  const bar = createRef<Rect>();
  const leftMask = createRef<Rect>();
  const rightMask = createRef<Rect>();
  const focus = createRef<Rect>();
  const target = createRef<Rect>();
  const probe = createRef<Circle>();
  const title = createRef<Txt>();
  const sub = createRef<Txt>();
  const leftLabel = createRef<Txt>();
  const rightLabel = createRef<Txt>();
  const steps = createRef<Txt>();
  const logHint = createRef<Txt>();
  const halfLine = createRef<Line>();

  const scanAlpha = createSignal(1);
  const focusWidth = createSignal(1000);
  const focusAlpha = createSignal(0);
  const halfAlpha = createSignal(0);
  const stepsCount = createSignal(1);
  const maskLeftW = createSignal(0);
  const maskRightW = createSignal(0);
  const probeX = createSignal(-140);
  const probeY = createSignal(0);
  const titleY = createSignal(-420);

  view.add(
    <Layout ref={stage} width={1080} height={1920}>
      <Txt
        ref={title}
        x={0}
        y={titleY}
        text="1,000,000 khả năng"
        fontSize={70}
        fontWeight={800}
        fill="#f8fbff"
      />
      <Txt
        ref={sub}
        x={0}
        y={-330}
        text="Tìm kiếm nhị phân không nhanh hơn — nó bỏ được một nửa mỗi lần"
        fontSize={34}
        fill="#8fa3c8"
      />

      <Layout y={80}>
        <Rect
          ref={bar}
          width={900}
          height={220}
          radius={34}
          fill="#16213d"
          stroke="#32406b"
          lineWidth={4}
        />
        <Rect
          ref={leftMask}
          x={() => -450 + maskLeftW() / 2}
          width={maskLeftW}
          height={220}
          radius={34}
          fill="#08111f"
          opacity={0.92}
        />
        <Rect
          ref={rightMask}
          x={() => 450 - maskRightW() / 2}
          width={maskRightW}
          height={220}
          radius={34}
          fill="#08111f"
          opacity={0.92}
        />
        <Rect
          ref={focus}
          width={focusWidth}
          height={220}
          radius={34}
          fill="#2a3f77"
          opacity={focusAlpha}
        />
        <Rect
          ref={target}
          x={250}
          width={78}
          height={78}
          radius={18}
          fill="#ffcc66"
          scale={[1, 1]}
        />
        <Circle
          ref={probe}
          x={probeX}
          y={probeY}
          width={92}
          height={92}
          fill="#5eead4"
          opacity={scanAlpha}
        />
        <Line
          ref={halfLine}
          points={[[-450, 0], [0, 0], [450, 0]]}
          lineWidth={8}
          stroke="#6b7aa8"
          opacity={halfAlpha}
          endArrow
        />
        <Txt ref={leftLabel} x={-300} y={-155} text="Bỏ phần này" fontSize={30} fill="#7f8db3" opacity={halfAlpha} />
        <Txt ref={rightLabel} x={300} y={-155} text="Giữ phần còn lại" fontSize={30} fill="#7f8db3" opacity={halfAlpha} />
      </Layout>

      <Layout y={520} gap={28} direction="column" alignItems="center">
        <Txt ref={steps} text="1" fontSize={82} fontWeight={800} fill="#f8fbff" />
        <Txt ref={logHint} text="~ log₂(n)" fontSize={44} fill="#ffd36a" opacity={0} />
      </Layout>
    </Layout>
  );

  yield* all(
    title().y(-510, 0.6, easeInOutCubic),
    sub().opacity(1, 0.6),
    focus().opacity(1, 0.4),
    focus().scale([0.98, 1], 0.4),
  );

  yield* all(
    probe().x(250, 1.6, easeInOutCubic),
    stepsCount(8, 1.6),
    scanAlpha(0.9, 0.6),
  );

  yield* all(
    probe().scale([1.12, 1.12], 0.18),
    target().scale([1.15, 1.15], 0.18),
  );

  yield* all(
    maskLeftW(460, 1.1, easeInOutCubic),
    maskRightW(0, 1.1, easeInOutCubic),
    focusWidth(430, 1.1, easeInOutCubic),
    focusAlpha(0.55, 1.1),
    halfAlpha(1, 0.6),
    logHint().opacity(1, 0.5),
    stepsCount(20, 1.4),
  );

  yield* all(
    probe().x(65, 0.9, easeInOutCubic),
    probe().y(0, 0.9),
  );

  yield* all(
    maskLeftW(675, 1.0, easeInOutCubic),
    focusWidth(215, 1.0, easeInOutCubic),
    stepsCount(21, 0.9),
  );

  yield* all(
    target().fill('#ff8a65', 0.3),
    target().scale([1.25, 1.25], 0.3),
    logHint().y(40, 0.3),
  );

  yield* waitFor(0.5);
});
