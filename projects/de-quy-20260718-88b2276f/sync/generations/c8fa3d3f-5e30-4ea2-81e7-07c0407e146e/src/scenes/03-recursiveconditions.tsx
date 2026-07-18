import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const group = createRef<Layout>();
  const box1 = createRef<Rect>();
  const box2 = createRef<Rect>();
  const box3 = createRef<Rect>();
  const box4 = createRef<Rect>();
  const ring1 = createRef<Rect>();
  const ring2 = createRef<Rect>();
  const gem = createRef<Rect>();
  const hand = createRef<Layout>();
  const pointer = createRef<Line>();
  const dot = createRef<Circle>();
  const path = createRef<Line>();
  const halo = createRef<Circle>();
  const pulse = createSignal(1);

  view.add(
    <Rect width={1080} height={1920} fill={'#07111f'}>
      <Rect width={920} height={1680} radius={54} fill={'#0c1b2d'} stroke={'#18344d'} lineWidth={4}>
        <Layout y={-700}>
          <Circle x={-220} size={104} fill={'#102a40'} stroke={'#35c978'} lineWidth={5}>
            <Rect size={38} radius={8} fill={'#35c978'} />
          </Circle>
          <Txt x={-220} y={86} text={'1'} fill={'#8ba6bd'} fontSize={34} fontWeight={700} />
          <Circle x={220} size={104} fill={'#102a40'} stroke={'#258cff'} lineWidth={5}>
            <Rect x={-21} size={42} radius={7} stroke={'#258cff'} lineWidth={5} />
            <Rect x={21} size={25} radius={5} stroke={'#258cff'} lineWidth={5} />
          </Circle>
          <Txt x={220} y={86} text={'2'} fill={'#8ba6bd'} fontSize={34} fontWeight={700} />
        </Layout>

        <Line ref={path} points={[[0, -420], [0, 540]]} stroke={'#537088'} lineWidth={8} lineDash={[18, 18]} endArrow arrowSize={20} opacity={0} />

        <Layout ref={group} scale={() => [pulse(), pulse()]}>
          <Rect ref={box1} size={650} radius={62} fill={'#102a40'} stroke={'#258cff'} lineWidth={8} opacity={0.24} />
          <Rect ref={box2} size={490} radius={52} fill={'#102a40'} stroke={'#258cff'} lineWidth={8} opacity={0.32} />
          <Rect ref={box3} size={330} radius={42} fill={'#102a40'} stroke={'#258cff'} lineWidth={8} opacity={0.42} />
          <Rect ref={box4} size={175} radius={30} fill={'#258cff'} stroke={'#75bdff'} lineWidth={8} />
          <Rect ref={ring1} size={112} radius={22} stroke={'#258cff'} lineWidth={7} opacity={0} />
          <Rect ref={ring2} size={62} radius={15} stroke={'#258cff'} lineWidth={6} opacity={0} />
        </Layout>

        <Rect ref={gem} size={54} radius={10} rotation={45} fill={'#ffd45c'} stroke={'#fff1a8'} lineWidth={6} opacity={0} />
        <Circle ref={dot} size={34} fill={'#ffffff'} shadowColor={'#59b4ff'} shadowBlur={24} opacity={0} />
        <Circle ref={halo} size={310} stroke={'#258cff'} lineWidth={8} opacity={0} />

        <Line ref={pointer} points={[[310, 300], [88, 88]]} stroke={'#f3c78f'} lineWidth={20} lineCap={'round'} endArrow arrowSize={28} end={0} />
        <Layout ref={hand} x={350} y={350} opacity={0}>
          <Circle size={94} fill={'#f3c78f'} />
          <Line points={[[-18, -34], [-82, -105]]} stroke={'#f3c78f'} lineWidth={30} lineCap={'round'} />
          <Line points={[[12, -38], [-34, -126]]} stroke={'#f3c78f'} lineWidth={27} lineCap={'round'} />
        </Layout>
      </Rect>
    </Rect>,
  );

  {
    yield* waitUntil('beat:3efac0dd-1595-4851-a023-bb17f75df87e:start');
    const beatDuration = useDuration('beat:3efac0dd-1595-4851-a023-bb17f75df87e:end');
    yield* chain(
      all(
        hand().opacity(1, beatDuration * 0.14),
        hand().position([300, 275], beatDuration * 0.22, easeInOutCubic),
        pointer().end(1, beatDuration * 0.22, easeInOutCubic),
      ),
      all(
        hand().position([250, 220], beatDuration * 0.16, easeInOutCubic),
        gem().opacity(1, beatDuration * 0.16),
        gem().scale([1.18, 1.18], beatDuration * 0.16, easeInOutCubic),
      ),
      all(
        box4().fill('#35c978', beatDuration * 0.2),
        box4().stroke('#91f1b8', beatDuration * 0.2),
        hand().position([310, 280], beatDuration * 0.2, easeInOutCubic),
        pointer().end(0.76, beatDuration * 0.2, easeInOutCubic),
        gem().scale([1, 1], beatDuration * 0.2, easeInOutCubic),
      ),
    );
    yield* waitUntil('beat:3efac0dd-1595-4851-a023-bb17f75df87e:end');
  }

  {
    yield* waitUntil('beat:339b17b8-fa6e-4ee9-a857-9c83451bdd59:start');
    const beatDuration = useDuration('beat:339b17b8-fa6e-4ee9-a857-9c83451bdd59:end');
    yield* chain(
      all(
        hand().opacity(0, beatDuration * 0.12),
        pointer().opacity(0, beatDuration * 0.12),
        gem().opacity(0, beatDuration * 0.12),
        path().opacity(0.55, beatDuration * 0.16),
        box1().position([0, -430], beatDuration * 0.18, easeInOutCubic),
        box2().position([0, -130], beatDuration * 0.18, easeInOutCubic),
        box3().position([0, 145], beatDuration * 0.18, easeInOutCubic),
        box4().position([0, 390], beatDuration * 0.18, easeInOutCubic),
        box1().size(285, beatDuration * 0.18),
        box2().size(235, beatDuration * 0.18),
        box3().size(185, beatDuration * 0.18),
        box4().size(135, beatDuration * 0.18),
        box1().opacity(1, beatDuration * 0.18),
        box2().opacity(1, beatDuration * 0.18),
        box3().opacity(1, beatDuration * 0.18),
        box1().fill('#258cff', beatDuration * 0.18),
        box2().fill('#e3ad35', beatDuration * 0.18),
        box3().fill('#e3ad35', beatDuration * 0.18),
        box4().fill('#e3ad35', beatDuration * 0.18),
        dot().position([0, -430], beatDuration * 0.18),
        dot().opacity(1, beatDuration * 0.18),
      ),
      all(
        dot().position([0, -130], beatDuration * 0.14, easeInOutCubic),
        box1().fill('#35c978', beatDuration * 0.14),
        box2().fill('#258cff', beatDuration * 0.14),
      ),
      all(
        dot().position([0, 145], beatDuration * 0.14, easeInOutCubic),
        box2().fill('#35c978', beatDuration * 0.14),
        box3().fill('#258cff', beatDuration * 0.14),
      ),
      all(
        dot().position([0, 390], beatDuration * 0.14, easeInOutCubic),
        box3().fill('#35c978', beatDuration * 0.14),
        box4().fill('#35c978', beatDuration * 0.14),
        gem().position([0, 390], beatDuration * 0.14),
        gem().opacity(1, beatDuration * 0.14),
      ),
    );
    yield* waitUntil('beat:339b17b8-fa6e-4ee9-a857-9c83451bdd59:end');
  }

  {
    yield* waitUntil('beat:17c93655-adc7-4605-93d5-87112492fc01:start');
    const beatDuration = useDuration('beat:17c93655-adc7-4605-93d5-87112492fc01:end');
    yield* chain(
      all(
        path().opacity(0, beatDuration * 0.14),
        dot().opacity(0, beatDuration * 0.14),
        gem().opacity(0, beatDuration * 0.14),
        box1().position([0, 0], beatDuration * 0.18, easeInOutCubic),
        box2().position([0, 0], beatDuration * 0.18, easeInOutCubic),
        box3().position([0, 0], beatDuration * 0.18, easeInOutCubic),
        box4().position([0, 0], beatDuration * 0.18, easeInOutCubic),
        box1().size(650, beatDuration * 0.18),
        box2().size(490, beatDuration * 0.18),
        box3().size(330, beatDuration * 0.18),
        box4().size(190, beatDuration * 0.18),
        box1().fill('#102a40', beatDuration * 0.18),
        box2().fill('#102a40', beatDuration * 0.18),
        box3().fill('#102a40', beatDuration * 0.18),
        box4().fill('#102a40', beatDuration * 0.18),
        ring1().opacity(1, beatDuration * 0.18),
        ring2().opacity(0.9, beatDuration * 0.18),
      ),
      all(
        pulse(1.62, beatDuration * 0.28, easeInOutCubic),
        box1().opacity(0.06, beatDuration * 0.28),
      ),
      all(
        pulse(1, beatDuration * 0.03),
        box1().opacity(1, beatDuration * 0.03),
      ),
      all(
        pulse(1.62, beatDuration * 0.28, easeInOutCubic),
        box1().opacity(0.06, beatDuration * 0.28),
        ring2().stroke('#07111f', beatDuration * 0.28),
      ),
    );
    yield* waitUntil('beat:17c93655-adc7-4605-93d5-87112492fc01:end');
  }

  {
    yield* waitUntil('beat:4e64fb60-a552-4062-8062-73e584f5399f:start');
    const beatDuration = useDuration('beat:4e64fb60-a552-4062-8062-73e584f5399f:end');
    yield* chain(
      all(
        pulse(1, beatDuration * 0.12, easeInOutCubic),
        ring1().opacity(0, beatDuration * 0.12),
        ring2().opacity(0, beatDuration * 0.12),
        box1().position([0, -250], beatDuration * 0.18, easeInOutCubic),
        box2().position([0, -250], beatDuration * 0.18, easeInOutCubic),
        box3().position([0, -250], beatDuration * 0.18, easeInOutCubic),
        box4().position([0, 500], beatDuration * 0.18, easeInOutCubic),
        box1().size(260, beatDuration * 0.18),
        box2().size(260, beatDuration * 0.18),
        box3().size(260, beatDuration * 0.18),
        box4().size(150, beatDuration * 0.18),
        box1().fill('#258cff', beatDuration * 0.18),
        box2().fill('#258cff', beatDuration * 0.18),
        box3().fill('#258cff', beatDuration * 0.18),
        box4().fill('#35c978', beatDuration * 0.18),
        box1().opacity(1, beatDuration * 0.18),
        box2().opacity(0, beatDuration * 0.18),
        box3().opacity(0, beatDuration * 0.18),
        box4().opacity(1, beatDuration * 0.18),
        path().points([[0, -100], [0, 410]], beatDuration * 0.18),
        path().opacity(0.7, beatDuration * 0.18),
        halo().position([0, -250], beatDuration * 0.18),
        halo().opacity(0.7, beatDuration * 0.18),
      ),
      all(
        box1().opacity(0, beatDuration * 0.14),
        box2().opacity(1, beatDuration * 0.14),
        halo().scale([1.18, 1.18], beatDuration * 0.14, easeInOutCubic),
      ),
      all(
        box2().opacity(0, beatDuration * 0.14),
        box3().opacity(1, beatDuration * 0.14),
        halo().scale([1, 1], beatDuration * 0.14, easeInOutCubic),
      ),
      all(
        box3().scale([1.08, 1.08], beatDuration * 0.12, easeInOutCubic),
        halo().scale([1.18, 1.18], beatDuration * 0.12, easeInOutCubic),
      ),
      all(
        box3().scale([1, 1], beatDuration * 0.12, easeInOutCubic),
        halo().scale([1, 1], beatDuration * 0.12, easeInOutCubic),
        halo().opacity(0, beatDuration * 0.12),
      ),
    );
    yield* waitUntil('beat:4e64fb60-a552-4062-8062-73e584f5399f:end');
  }
});
