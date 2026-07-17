import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, tween, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const stage = createRef<Layout>();
  const rail = createRef<Rect>();
  const target = createRef<Rect>();
  const magnifier = createRef<Circle>();
  const handle = createRef<Line>();
  const title = createRef<Txt>();
  const big = createRef<Txt>();
  const small = createRef<Txt>();
  const count = createSignal(0);
  const sweep = createSignal(0);
  const pulse = createSignal(0);

  view.fill('#081018');
  view.add(
    <Layout ref={stage} width={1080} height={1920} direction="column" justifyContent="center" alignItems="center">
      <Txt ref={title} text={'Một triệu khả năng'} y={-660} fontSize={64} fontWeight={800} fill={'#EAF2FF'} opacity={0} />
      <Txt ref={big} text={'0'} y={-560} fontSize={210} fontWeight={900} fill={'#7CF7D4'} opacity={0} />
      <Txt ref={small} text={'lần kiểm tra'} y={-420} fontSize={52} fontWeight={700} fill={'#A9B7C9'} opacity={0} />

      <Rect
        ref={rail}
        width={920}
        height={1180}
        radius={28}
        fill={'#0E1724'}
        stroke={'#203044'}
        lineWidth={4}
        opacity={0}
      />

      <Rect
        ref={target}
        x={290}
        y={380}
        width={136}
        height={64}
        radius={14}
        fill={'#FFCC66'}
        opacity={0}
      />

      <Circle
        ref={magnifier}
        x={-340}
        y={-470}
        width={150}
        height={150}
        lineWidth={10}
        stroke={'#F4F7FA'}
        fill={'#0E1724'}
        opacity={0}
      />
      <Line
        ref={handle}
        points={[[-280, -410], [-198, -328]]}
        lineWidth={14}
        stroke={'#F4F7FA'}
        endArrow
        opacity={0}
      />

      <Layout y={0} direction="column" gap={22} opacity={0.95}>
        {Array.from({length: 12}).map((_, i) => (
          <Rect
            key={`row-${i}`}
            x={0}
            y={-470 + i * 86}
            width={760}
            height={62}
            radius={16}
            fill={i === 10 ? '#233147' : '#152233'}
            stroke={i === 10 ? '#7CF7D4' : '#223449'}
            lineWidth={3}
            opacity={i === 10 ? pulse : 1}
          >
            <Txt
              text={String(i === 10 ? 'mục tiêu' : '')}
              x={-312}
              fontSize={28}
              fontWeight={700}
              fill={'#0B121C'}
              opacity={i === 10 ? 1 : 0}
            />
          </Rect>
        ))}
      </Layout>
    </Layout>,
  );

  yield* all(
    title().opacity(1, 0.45),
    big().opacity(1, 0.45),
    small().opacity(1, 0.45),
    rail().opacity(1, 0.45),
    magnifier().opacity(1, 0.45),
    handle().opacity(1, 0.45),
  );

  yield* chain(
    tween(1.2, value => {
      sweep(easeInOutCubic(value));
      count(Math.round(1000000 * value));
      pulse(0.5 + 0.5 * Math.sin(value * Math.PI * 6));
    }),
    waitFor(0.4),
    all(
      title().opacity(0, 0.35),
      small().opacity(0, 0.35),
      big().text('20', 0.35),
      big().fill('#FFCC66', 0.35),
      big().scale([1.08, 1.08], 0.35),
    ),
    waitFor(0.25),
  );

  yield* all(
    target().opacity(1, 0.3),
    magnifier().x(250, 0.8),
    magnifier().y(378, 0.8),
    handle().points([[-280, -410], [-120, -70]], 0.8),
    rail().scale([1, 0.98], 0.8),
  );
});
