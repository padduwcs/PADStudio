import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const BLUE = '#36A3FF';
  const YELLOW = '#F7C948';
  const GREEN = '#43D17A';
  const DARK = '#101C2C';
  const MUTED = '#49627D';
  const RED = '#FF667A';

  const stage1 = createRef<Layout>();
  const stage2 = createRef<Layout>();
  const stage3 = createRef<Layout>();
  const stage4 = createRef<Layout>();
  const finalBox = createRef<Rect>();
  const prize = createRef<Circle>();
  const hand = createRef<Layout>();
  const route = createRef<Line>();
  const dot = createRef<Circle>();
  const b1 = createRef<Rect>();
  const b2 = createRef<Rect>();
  const b3 = createRef<Rect>();
  const b4 = createRef<Rect>();
  const b5 = createRef<Rect>();
  const tunnel = createRef<Layout>();
  const sameBox = createRef<Rect>();
  const blocked = createRef<Txt>();

  view.add(
    <Rect width={1080} height={1920} fill={'#07111E'}>
      <Layout ref={stage1} width={1080} height={1920} opacity={0}>
        <Rect width={650} height={900} radius={52} stroke={MUTED} lineWidth={12}/>
        <Rect width={500} height={680} radius={44} stroke={YELLOW} lineWidth={14}/>
        <Rect ref={finalBox} y={80} width={340} height={360} radius={36} fill={BLUE} stroke={'#B9E2FF'} lineWidth={12}>
          <Rect y={-210} width={340} height={65} radius={18} fill={BLUE} rotation={-10}/>
          <Circle ref={prize} y={30} size={105} fill={YELLOW} stroke={'#FFF0A8'} lineWidth={12} scale={0}/>
        </Rect>
        <Layout ref={hand} x={500} y={80}>
          <Line points={[[0, 0], [-150, 0]]} stroke={'#F5D2B8'} lineWidth={58} lineCap={'round'}/>
          <Circle x={-185} size={92} fill={'#F5D2B8'}/>
          <Line points={[[-215, -28], [-265, -82]]} stroke={'#F5D2B8'} lineWidth={30} lineCap={'round'}/>
        </Layout>
      </Layout>

      <Layout ref={stage2} width={1080} height={1920} opacity={0}>
        <Line
          ref={route}
          points={[[250, -600], [210, -310], [170, -30], [130, 245], [95, 520]]}
          stroke={'#8ACBFF'}
          lineWidth={10}
          end={0}
        />
        <Rect ref={b1} x={0} y={-600} width={470} height={230} radius={34} fill={BLUE}/>
        <Rect ref={b2} x={0} y={-310} width={400} height={205} radius={32} fill={DARK} stroke={MUTED} lineWidth={10}/>
        <Rect ref={b3} x={0} y={-30} width={330} height={180} radius={30} fill={DARK} stroke={MUTED} lineWidth={10}/>
        <Rect ref={b4} x={0} y={245} width={260} height={155} radius={28} fill={DARK} stroke={MUTED} lineWidth={10}/>
        <Rect ref={b5} x={0} y={520} width={190} height={135} radius={26} fill={DARK} stroke={MUTED} lineWidth={10}>
          <Circle size={52} fill={YELLOW}/>
        </Rect>
        <Circle ref={dot} x={250} y={-600} size={40} fill={'#FFFFFF'} shadowColor={BLUE} shadowBlur={28}/>
      </Layout>

      <Layout ref={stage3} width={1080} height={1920} opacity={0}>
        <Rect width={820} height={1320} radius={65} fill={'#030810'} stroke={MUTED} lineWidth={10}/>
        <Layout ref={tunnel}>
          <Rect width={700} height={1120} radius={58} stroke={BLUE} lineWidth={15}/>
          <Rect width={560} height={890} radius={50} stroke={'#2781C5'} lineWidth={14}/>
          <Rect width={430} height={680} radius={44} stroke={'#20699F'} lineWidth={13}/>
          <Rect width={310} height={485} radius={38} stroke={'#194C76'} lineWidth={12}/>
          <Rect width={205} height={315} radius={30} stroke={'#123552'} lineWidth={11}/>
          <Rect width={115} height={170} radius={22} fill={'#07111E'} stroke={'#0D263B'} lineWidth={10}/>
        </Layout>
      </Layout>

      <Layout ref={stage4} width={1080} height={1920} opacity={0}>
        <Rect y={-560} width={260} height={200} radius={34} fill={GREEN} stroke={'#A7F2C4'} lineWidth={12}>
          <Circle size={65} fill={YELLOW}/>
        </Rect>
        <Line points={[[0, -430], [0, 285]]} stroke={MUTED} lineWidth={10} lineDash={[22, 28]}/>
        <Circle y={-300} size={24} fill={MUTED}/>
        <Circle y={-80} size={24} fill={MUTED}/>
        <Circle y={140} size={24} fill={MUTED}/>
        <Rect ref={sameBox} y={430} width={430} height={300} radius={42} fill={BLUE} stroke={'#B9E2FF'} lineWidth={12}/>
        <Txt ref={blocked} y={-80} text={'×'} fill={RED} fontSize={210} fontWeight={800} opacity={0}/>
      </Layout>
    </Rect>,
  );

  yield* stage1().opacity(1, 1, easeInOutCubic);
  yield* hand().position([315, 80], 2, easeInOutCubic);
  yield* waitFor(1);
  yield* all(
    finalBox().fill(GREEN, 1, easeInOutCubic),
    prize().scale([1, 1], 1, easeInOutCubic),
  );
  yield* waitFor(2);
  yield* hand().position([500, 80], 1.5, easeInOutCubic);
  yield* waitFor(3.5);

  yield* all(stage1().opacity(0, 1), stage2().opacity(1, 1));
  yield* chain(
    all(dot().position([210, -310], 2, easeInOutCubic), route().end(0.25, 2), b1().fill(YELLOW, 2), b2().fill(BLUE, 2)),
    all(dot().position([170, -30], 2, easeInOutCubic), route().end(0.5, 2), b2().fill(YELLOW, 2), b3().fill(BLUE, 2)),
    all(dot().position([130, 245], 2, easeInOutCubic), route().end(0.75, 2), b3().fill(YELLOW, 2), b4().fill(BLUE, 2)),
    all(dot().position([95, 520], 2, easeInOutCubic), route().end(1, 2), b4().fill(YELLOW, 2), b5().fill(GREEN, 2)),
  );
  yield* waitFor(4);

  yield* all(stage2().opacity(0, 1), stage3().opacity(1, 1));
  for (let i = 0; i < 5; i++) {
    tunnel().scale([1, 1]);
    tunnel().opacity(1);
    yield* all(
      tunnel().scale([2.15, 2.15], 2, easeInOutCubic),
      tunnel().opacity(0.12, 2, easeInOutCubic),
    );
  }
  yield* waitFor(1);

  yield* all(stage3().opacity(0, 1), stage4().opacity(1, 1));
  for (let i = 0; i < 5; i++) {
    yield* all(
      sameBox().scale([1.08, 1.08], 0.75, easeInOutCubic),
      sameBox().fill(YELLOW, 0.75),
    );
    yield* all(
      sameBox().scale([1, 1], 0.75, easeInOutCubic),
      sameBox().fill(BLUE, 0.75),
    );
  }
  yield* blocked().opacity(1, 1, easeInOutCubic);
  yield* waitFor(3.5);
});
