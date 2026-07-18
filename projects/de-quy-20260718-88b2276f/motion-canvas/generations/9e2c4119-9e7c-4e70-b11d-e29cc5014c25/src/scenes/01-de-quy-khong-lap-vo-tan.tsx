import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const BLUE = '#42A5F5';
  const YELLOW = '#F6C453';
  const GREEN = '#55D68B';
  const INK = '#EAF2FF';
  const BG = '#101827';

  const b1 = createRef<Rect>();
  const b2 = createRef<Rect>();
  const b3 = createRef<Rect>();
  const l1 = createRef<Rect>();
  const l2 = createRef<Rect>();
  const l3 = createRef<Rect>();
  const gem = createRef<Circle>();
  const hand = createRef<Circle>();
  const path1 = createRef<Line>();
  const path2 = createRef<Line>();
  const arrow1 = createRef<Line>();
  const arrow2 = createRef<Line>();
  const divider = createRef<Line>();
  const check = createRef<Txt>();
  const infinity = createRef<Txt>();
  const r1 = createRef<Rect>();
  const r2 = createRef<Rect>();
  const r3 = createRef<Rect>();
  const r4 = createRef<Rect>();
  const r5 = createRef<Rect>();
  const pulseX = createSignal(-300);

  view.add(
    <Layout width={1080} height={1920} layout={false}>
      <Rect width={1080} height={1920} fill={BG}/>
      <Txt y={-710} text={'HỘP TRONG HỘP'} fill={INK} fontSize={52} fontWeight={700}/>

      <Line ref={divider} points={[[0, -430], [0, 520]]} stroke={'#43506A'} lineWidth={4} opacity={0}/>

      <Rect ref={b1} width={620} height={450} radius={34} fill={'#162B43'} stroke={BLUE} lineWidth={12} x={-320} y={80} opacity={0}/>
      <Rect ref={b2} width={420} height={300} radius={28} fill={'#172C45'} stroke={BLUE} lineWidth={11} x={320} y={80} opacity={0}/>
      <Rect ref={b3} width={240} height={160} radius={22} fill={'#18304A'} stroke={BLUE} lineWidth={10} x={-260} y={80} opacity={0}/>

      <Rect ref={l1} width={620} height={24} radius={12} fill={BLUE} y={-145} opacity={0}/>
      <Rect ref={l2} width={420} height={22} radius={11} fill={BLUE} y={-70} opacity={0}/>
      <Rect ref={l3} width={240} height={20} radius={10} fill={BLUE} y={0} opacity={0}/>

      <Circle ref={gem} width={78} height={78} fill={GREEN} stroke={'#D8FFE8'} lineWidth={9} y={90} scale={[0, 0]} opacity={0}/>

      <Line ref={path1} points={[[-400, 30], [-330, -80], [-220, -150]]} stroke={'#9DB2CF'} lineWidth={9} lineDash={[18, 14]} end={0} opacity={0}/>
      <Line ref={path2} points={[[140, 30], [210, -70], [320, -140]]} stroke={'#9DB2CF'} lineWidth={9} lineDash={[18, 14]} end={0} opacity={0}/>
      <Circle ref={hand} width={46} height={46} fill={INK} stroke={BLUE} lineWidth={8} opacity={0}/>

      <Line ref={arrow1} points={[[-175, 100], [-105, 100]]} stroke={INK} lineWidth={10} endArrow arrowSize={22} opacity={0}/>
      <Line ref={arrow2} points={[[105, 100], [185, 100]]} stroke={INK} lineWidth={10} endArrow arrowSize={22} opacity={0}/>
      <Circle x={pulseX} y={100} width={58} height={58} fill={BLUE} stroke={'#D9F0FF'} lineWidth={8} opacity={() => 0}/>

      <Rect ref={r1} width={390} height={390} radius={30} x={300} y={80} fill={'#121B2B'} stroke={YELLOW} lineWidth={9} opacity={0}/>
      <Rect ref={r2} width={300} height={300} radius={25} x={300} y={80} fill={'#111A29'} stroke={YELLOW} lineWidth={8} opacity={0}/>
      <Rect ref={r3} width={215} height={215} radius={21} x={300} y={80} fill={'#101827'} stroke={YELLOW} lineWidth={7} opacity={0}/>
      <Rect ref={r4} width={140} height={140} radius={17} x={300} y={80} fill={'#0D1421'} stroke={YELLOW} lineWidth={6} opacity={0}/>
      <Rect ref={r5} width={76} height={76} radius={13} x={300} y={80} fill={'#090E18'} stroke={YELLOW} lineWidth={5} opacity={0}/>
      <Txt ref={check} x={-250} y={410} text={'✓'} fill={GREEN} fontSize={110} opacity={0}/>
      <Txt ref={infinity} x={330} y={410} text={'∞'} fill={YELLOW} fontSize={126} opacity={0}/>
    </Layout>,
  );

  // Beat 1 — lồng hộp, rồi mở dần tới món đồ.
  yield* chain(
    all(b1().x(0, 1.5, easeInOutCubic), b1().opacity(1, 1.5), l1().opacity(1, 1.5)),
    all(b2().x(0, 1.5, easeInOutCubic), b2().opacity(1, 1.5), l2().opacity(1, 1.5)),
    all(b3().x(0, 1.5, easeInOutCubic), b3().opacity(1, 1.5), l3().opacity(1, 1.5)),
    all(l1().y(-245, 1), l1().rotation(-12, 1)),
    all(l2().y(-160, 1), l2().rotation(-12, 1)),
    all(l3().y(-80, 1), l3().rotation(-12, 1)),
    all(gem().opacity(1, 1.5), gem().scale([1, 1], 1.5, easeInOutCubic)),
    waitFor(1),
  );

  // Beat 2 — hai kích thước, cùng một động tác mở.
  yield* all(
    b1().position([-270, 80], 2, easeInOutCubic), b1().scale([0.68, 0.68], 2),
    b2().position([270, 80], 2, easeInOutCubic), b2().scale([1, 1], 2),
    b3().opacity(0, 2), gem().opacity(0, 2),
    l1().position([-270, -75], 2), l1().scale([0.68, 0.68], 2), l1().rotation(0, 2),
    l2().position([270, -70], 2), l2().scale([1, 1], 2), l2().rotation(0, 2),
    l3().opacity(0, 2),
  );
  yield* chain(
    all(path1().opacity(0.7, 2), path1().end(1, 2), hand().opacity(1, 2), hand().position([-220, -150], 2), l1().y(-145, 2), l1().rotation(-18, 2)),
    all(path1().opacity(0, 1), hand().opacity(0, 1)),
    all(path2().opacity(0.7, 2), path2().end(1, 2), hand().opacity(1, 2), hand().position([320, -140], 2), l2().y(-140, 2), l2().rotation(-18, 2)),
    all(path2().opacity(0, 1), hand().opacity(0, 1)),
    waitFor(2),
  );

  // Beat 3 — bản chất giữ nguyên, kích thước giảm dần.
  yield* all(
    b1().position([-300, 100], 2), b1().scale([0.45, 0.45], 2), b1().stroke(YELLOW, 2),
    b2().position([0, 100], 2), b2().scale([0.62, 0.62], 2), b2().stroke(YELLOW, 2),
    b3().position([280, 100], 2), b3().scale([1, 1], 2), b3().opacity(1, 2), b3().stroke(YELLOW, 2),
    l1().opacity(0, 2), l2().opacity(0, 2),
    arrow1().opacity(1, 2), arrow2().opacity(1, 2),
  );
  const pulse = createRef<Circle>();
  view.add(<Circle ref={pulse} x={pulseX} y={100} width={58} height={58} fill={BLUE} stroke={'#D9F0FF'} lineWidth={8} opacity={0}/>);
  yield* chain(
    all(pulse().opacity(1, 2), pulse().scale([1.25, 1.25], 2), b1().stroke(BLUE, 2)),
    all(pulseX(0, 2, easeInOutCubic), pulse().scale([1, 1], 2), b1().stroke(YELLOW, 2), b2().stroke(BLUE, 2)),
    all(pulseX(280, 2, easeInOutCubic), pulse().scale([1.25, 1.25], 2), b2().stroke(YELLOW, 2), b3().stroke(BLUE, 2)),
  );

  // Beat 4 — bên trái chạm đáy; bên phải không có điểm dừng.
  yield* all(
    pulse().opacity(0, 2), arrow1().opacity(0, 2), arrow2().opacity(0, 2), divider().opacity(1, 2),
    b1().position([-250, 80], 2), b1().scale([0.5, 0.5], 2), b1().stroke(YELLOW, 2),
    b2().position([-250, 80], 2), b2().scale([0.6, 0.6], 2), b2().stroke(YELLOW, 2),
    b3().position([-250, 80], 2), b3().scale([0.75, 0.75], 2), b3().stroke(YELLOW, 2),
    gem().position([-250, 80], 2), gem().scale([0, 0], 2), check().opacity(0.25, 2), infinity().opacity(0.25, 2),
  );
  yield* all(
    chain(
      b1().stroke(BLUE, 1),
      all(b1().stroke(YELLOW, 1), b2().stroke(BLUE, 1)),
      all(b2().stroke(YELLOW, 1), b3().stroke(BLUE, 1)),
      all(gem().opacity(1, 2), gem().scale([1, 1], 2), b3().stroke(GREEN, 2)),
      all(b1().fill('#173D34', 2), b1().stroke(GREEN, 2), b2().fill('#173D34', 2), b2().stroke(GREEN, 2), b3().fill('#173D34', 2), check().opacity(1, 2)),
      waitFor(1),
    ),
    chain(
      r1().opacity(1, 1), r2().opacity(1, 1), r3().opacity(1, 1), r4().opacity(1, 1), r5().opacity(1, 1),
      all(
        r1().position([410, 80], 3), r1().scale([0.45, 0.45], 3), r1().opacity(0.35, 3),
        r2().position([410, 80], 3), r2().scale([0.38, 0.38], 3), r2().opacity(0.3, 3),
        r3().position([410, 80], 3), r3().scale([0.3, 0.3], 3), r3().opacity(0.25, 3),
        r4().position([410, 80], 3), r4().scale([0.22, 0.22], 3), r4().opacity(0.2, 3),
        r5().position([410, 80], 3), r5().scale([0.12, 0.12], 3), r5().opacity(0.1, 3),
        infinity().opacity(1, 3),
      ),
    ),
  );
});
