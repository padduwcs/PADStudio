import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const BLUE = '#3B82F6';
  const YELLOW = '#F6C453';
  const GREEN = '#39C978';
  const BG = '#101827';
  const INK = '#EAF2FF';
  const steps: [number, number][] = [
    [-280, -540],
    [-110, -250],
    [70, 20],
    [230, 270],
  ];
  const sizes: [number, number][] = [
    [400, 300],
    [310, 235],
    [235, 178],
    [165, 125],
  ];

  const groups = sizes.map(() => createRef<Layout>());
  const bodies = sizes.map(() => createRef<Rect>());
  const lids = sizes.map(() => createRef<Rect>());
  const waitingZone = createRef<Rect>();
  const activeZone = createRef<Rect>();
  const path = createRef<Line>();
  const downArrow = createRef<Txt>();
  const upArrow = createRef<Txt>();
  const result = createRef<Circle>();

  view.fill(BG);
  view.add(
    <>
      <Rect
        ref={waitingZone}
        position={[-245, -350]}
        width={510}
        height={700}
        radius={48}
        stroke={YELLOW}
        lineWidth={8}
        opacity={0}
      />
      <Rect
        ref={activeZone}
        position={[120, -120]}
        width={440}
        height={430}
        radius={48}
        stroke={BLUE}
        lineWidth={8}
        opacity={0}
      />
      <Line
        ref={path}
        points={steps}
        stroke={INK}
        lineWidth={12}
        radius={24}
        opacity={0}
      />
      <Txt
        ref={downArrow}
        text={'↓'}
        position={[355, -270]}
        fill={BLUE}
        fontSize={118}
        fontWeight={700}
        opacity={0}
      />
      <Txt
        ref={upArrow}
        text={'↑'}
        position={[355, 120]}
        fill={GREEN}
        fontSize={118}
        fontWeight={700}
        opacity={0}
      />
    </>,
  );

  sizes.forEach(([w, h], i) => {
    const visible = i < 2 ? 1 : 0;
    const initialScale: [number, number] = i === 1 ? [0.72, 0.72] : [1, 1];
    view.add(
      <Layout
        ref={groups[i]}
        position={i < 2 ? [0, -180] : [70, -160]}
        scale={initialScale}
        opacity={visible}
      >
        <Rect
          ref={bodies[i]}
          y={18}
          width={w}
          height={h - 34}
          radius={24}
          fill={BLUE}
          stroke={'#CFE2FF'}
          lineWidth={7}
        />
        <Rect
          ref={lids[i]}
          y={-h / 2 + 15}
          width={w + 28}
          height={34}
          radius={16}
          fill={BLUE}
          stroke={'#CFE2FF'}
          lineWidth={7}
          rotation={-22}
        />
      </Layout>,
    );
  });

  view.add(
    <Circle
      ref={result}
      position={steps[3]}
      size={58}
      fill={'#F5FFF9'}
      stroke={GREEN}
      lineWidth={14}
      scale={[0, 0]}
      opacity={0}
    />,
  );

  // Beat 1 — hộp hiện tại chờ, hộp nhỏ hơn được đưa vào xử lý.
  yield* all(
    waitingZone().opacity(0.24, 4),
    groups[0]().position(steps[0], 4, easeInOutCubic),
    bodies[0]().fill(YELLOW, 4),
    lids[0]().fill(YELLOW, 4),
  );
  yield* all(
    activeZone().opacity(0.3, 4),
    groups[1]().position([70, -160], 4, easeInOutCubic),
    groups[1]().scale([1.08, 1.08], 4, easeInOutCubic),
  );
  yield* groups[1]().scale([1, 1], 2, easeInOutCubic);
  yield* waitFor(5);

  // Beat 2 — tiếp tục đi xuống, để lại các hộp vàng đang chờ.
  yield* all(
    path().opacity(0.22, 6),
    downArrow().opacity(1, 2),
    downArrow().position([355, -40], 6, easeInOutCubic),
    activeZone().opacity(0, 3),
    waitingZone().opacity(0.08, 3),
    groups[1]().position(steps[1], 6, easeInOutCubic),
    bodies[1]().fill(YELLOW, 6),
    lids[1]().fill(YELLOW, 6),
    groups[2]().opacity(1, 2),
    groups[2]().position(steps[2], 6, easeInOutCubic),
    groups[2]().scale([1, 1], 6, easeInOutCubic),
  );
  yield* all(
    downArrow().position([355, 300], 6, easeInOutCubic),
    groups[2]().position(steps[2], 6),
    bodies[2]().fill(YELLOW, 6),
    lids[2]().fill(YELLOW, 6),
    groups[3]().opacity(1, 2),
    groups[3]().position(steps[3], 6, easeInOutCubic),
    groups[3]().scale([1, 1], 6, easeInOutCubic),
  );
  yield* waitFor(3);

  // Beat 3 — chạm đáy, có kết quả và đổi chiều.
  yield* all(
    bodies[3]().fill(GREEN, 4),
    lids[3]().fill(GREEN, 4),
    lids[3]().rotation(0, 4, easeInOutCubic),
    result().opacity(1, 2),
    result().scale([1, 1], 4, easeInOutCubic),
  );
  yield* all(
    downArrow().opacity(0, 3),
    upArrow().opacity(1, 3),
    upArrow().position([355, -20], 3, easeInOutCubic),
  );
  yield* result().scale([1.35, 1.35], 1.5, easeInOutCubic);
  yield* result().scale([1, 1], 1.5, easeInOutCubic);
  yield* waitFor(5);

  // Beat 4 — kết quả quay lên, từng hộp đóng lại và hoàn tất.
  yield* all(
    result().position(steps[2], 4, easeInOutCubic),
    bodies[2]().fill(GREEN, 4),
    lids[2]().fill(GREEN, 4),
    lids[2]().rotation(0, 4, easeInOutCubic),
    upArrow().position([355, -250], 4, easeInOutCubic),
  );
  yield* all(
    result().position(steps[1], 4, easeInOutCubic),
    bodies[1]().fill(GREEN, 4),
    lids[1]().fill(GREEN, 4),
    lids[1]().rotation(0, 4, easeInOutCubic),
    upArrow().position([355, -500], 4, easeInOutCubic),
  );
  yield* all(
    result().position(steps[0], 4, easeInOutCubic),
    bodies[0]().fill(GREEN, 4),
    lids[0]().fill(GREEN, 4),
    lids[0]().rotation(0, 4, easeInOutCubic),
    waitingZone().opacity(0, 4),
    upArrow().opacity(0, 3),
  );
  yield* all(
    result().scale([1.6, 1.6], 2, easeInOutCubic),
    path().opacity(0.08, 2),
  );
  yield* waitFor(1);
});
