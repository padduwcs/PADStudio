import {useThread as padSyncUseThread, waitFor as padSyncWaitFor} from '@motion-canvas/core';
import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, waitUntil, useDuration, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  let padSyncBeatEnd1 = 0;
  let padSyncBeatEnd2 = 0;
  let padSyncBeatEnd3 = 0;
  let padSyncBeatEnd4 = 0;
  const outer = createRef<Rect>();
  const middle = createRef<Rect>();
  const inner = createRef<Rect>();
  const outerLid = createRef<Line>();
  const middleLid = createRef<Line>();
  const innerLid = createRef<Line>();
  const hand = createRef<Layout>();
  const item = createRef<Circle>();
  const link1 = createRef<Line>();
  const link2 = createRef<Line>();
  const pulse = createRef<Circle>();
  const firstStage = createRef<Layout>();
  const goodStage = createRef<Layout>();
  const badStage = createRef<Layout>();
  const goodItem = createRef<Circle>();
  const good1 = createRef<Rect>();
  const good2 = createRef<Rect>();
  const good3 = createRef<Rect>();
  const bad1 = createRef<Rect>();
  const bad2 = createRef<Rect>();
  const bad3 = createRef<Rect>();
  const bad4 = createRef<Rect>();
  const tunnel = createRef<Circle>();

  const bg = '#0B1020';
  const blue = '#339AF0';
  const yellow = '#FFD166';
  const green = '#35C77A';
  const pale = '#DCE7F5';

  view.fill(bg);
  view.add(
    <>
      <Layout ref={firstStage} position={[0, 20]}>
        <Rect ref={outer} width={620} height={470} radius={38} fill={'#162238'} stroke={blue} lineWidth={18} position={[-270, -430]} scale={[0.55, 0.55]}>
          <Line ref={outerLid} points={[[-310, -235], [310, -235]]} stroke={blue} lineWidth={26} lineCap={'round'} />
        </Rect>
        <Rect ref={middle} width={420} height={320} radius={30} fill={'#18263D'} stroke={yellow} lineWidth={16} position={[260, -20]} scale={[0.62, 0.62]}>
          <Line ref={middleLid} points={[[-210, -160], [210, -160]]} stroke={yellow} lineWidth={23} lineCap={'round'} />
        </Rect>
        <Rect ref={inner} width={250} height={190} radius={24} fill={'#1B2B43'} stroke={yellow} lineWidth={14} position={[-210, 430]} scale={[0.7, 0.7]}>
          <Line ref={innerLid} points={[[-125, -95], [125, -95]]} stroke={yellow} lineWidth={20} lineCap={'round'} />
        </Rect>
        <Circle ref={item} size={76} fill={green} position={[0, 60]} opacity={0} shadowColor={green} shadowBlur={28} />
        <Line ref={link1} points={[[-180, 0], [180, 0]]} stroke={pale} lineWidth={10} endArrow arrowSize={22} end={0} opacity={0} />
        <Line ref={link2} points={[[-180, 0], [180, 0]]} stroke={pale} lineWidth={10} endArrow arrowSize={22} end={0} opacity={0} />
        <Circle ref={pulse} size={42} fill={'#FFFFFF'} position={[-300, 0]} opacity={0} shadowColor={blue} shadowBlur={24} />
      </Layout>

      <Layout ref={hand} position={[350, -650]} opacity={0}>
        <Circle size={112} fill={'#F1B98A'} />
        <Rect width={70} height={250} radius={35} fill={'#F1B98A'} position={[-25, -130]} rotation={-18} />
      </Layout>

      <Layout ref={goodStage} position={[-235, 80]} opacity={0}>
        <Rect ref={good1} width={390} height={390} radius={34} stroke={yellow} lineWidth={16} fill={'#17243A'} />
        <Rect ref={good2} width={260} height={260} radius={28} stroke={yellow} lineWidth={14} fill={'#192940'} />
        <Rect ref={good3} width={145} height={145} radius={22} stroke={blue} lineWidth={13} fill={'#1B2E46'} />
        <Circle ref={goodItem} size={62} fill={green} opacity={0} shadowColor={green} shadowBlur={30} />
      </Layout>

      <Layout ref={badStage} position={[280, 80]} opacity={0}>
        <Circle ref={tunnel} size={500} fill={'#05070D'} stroke={'#27344B'} lineWidth={18} />
        <Rect ref={bad1} width={360} height={360} radius={32} stroke={blue} lineWidth={14} fill={'#10192A'} />
        <Rect ref={bad2} width={250} height={250} radius={27} stroke={blue} lineWidth={12} fill={'#0D1524'} />
        <Rect ref={bad3} width={155} height={155} radius={22} stroke={blue} lineWidth={10} fill={'#0A111E'} />
        <Rect ref={bad4} width={82} height={82} radius={17} stroke={blue} lineWidth={8} fill={'#070C15'} />
        <Txt text={'∞'} fill={'#73819A'} fontSize={82} fontWeight={700} opacity={0.7} />
      </Layout>
    </>,
  );

  yield* waitUntil('beat:cdb43b5b-fb9f-426b-811d-1ea5138988ea:start');
  const beatDuration1 = useDuration('beat:cdb43b5b-fb9f-426b-811d-1ea5138988ea:end');
  padSyncBeatEnd1 = padSyncUseThread().time() + beatDuration1;
  yield* chain(
    all(
      outer().position([0, 40], beatDuration1 * 0.24, easeInOutCubic),
      outer().scale([1, 1], beatDuration1 * 0.24, easeInOutCubic),
      middle().position([0, 55], beatDuration1 * 0.24, easeInOutCubic),
      middle().scale([1, 1], beatDuration1 * 0.24, easeInOutCubic),
    ),
    all(
      middle().scale([0.82, 0.82], beatDuration1 * 0.22, easeInOutCubic),
      inner().position([0, 65], beatDuration1 * 0.22, easeInOutCubic),
      inner().scale([0.82, 0.82], beatDuration1 * 0.22, easeInOutCubic),
    ),
    all(
      hand().opacity(1, beatDuration1 * 0.08),
      hand().position([260, -210], beatDuration1 * 0.08, easeInOutCubic),
    ),
    all(
      outerLid().rotation(-28, beatDuration1 * 0.18, easeInOutCubic),
      hand().position([330, -330], beatDuration1 * 0.18, easeInOutCubic),
      middle().stroke(blue, beatDuration1 * 0.18),
    ),
    all(
      middleLid().rotation(-28, beatDuration1 * 0.14, easeInOutCubic),
      innerLid().rotation(-28, beatDuration1 * 0.14, easeInOutCubic),
      item().opacity(1, beatDuration1 * 0.14),
      hand().opacity(0, beatDuration1 * 0.14),
    ),
    item().scale([1.18, 1.18], beatDuration1 * 0.14, easeInOutCubic),
  );
  yield* padSyncWaitFor(Math.max(0, padSyncBeatEnd1 - padSyncUseThread().time()));

  yield* waitUntil('beat:ccb859f2-4ba6-4d84-9d89-54e56b0d86e8:start');
  const beatDuration2 = useDuration('beat:ccb859f2-4ba6-4d84-9d89-54e56b0d86e8:end');
  padSyncBeatEnd2 = padSyncUseThread().time() + beatDuration2;
  yield* chain(
    all(
      item().opacity(0, beatDuration2 * 0.18),
      inner().opacity(0, beatDuration2 * 0.18),
      outer().position([-245, 40], beatDuration2 * 0.18, easeInOutCubic),
      outer().scale([0.72, 0.72], beatDuration2 * 0.18, easeInOutCubic),
      middle().position([250, 40], beatDuration2 * 0.18, easeInOutCubic),
      middle().scale([0.78, 0.78], beatDuration2 * 0.18, easeInOutCubic),
      outerLid().rotation(0, beatDuration2 * 0.18),
      middleLid().rotation(0, beatDuration2 * 0.18),
    ),
    all(
      hand().position([-260, -260], beatDuration2 * 0.12),
      hand().opacity(1, beatDuration2 * 0.12),
    ),
    all(
      outerLid().rotation(-34, beatDuration2 * 0.24, easeInOutCubic),
      hand().position([-170, -390], beatDuration2 * 0.24, easeInOutCubic),
    ),
    all(
      hand().position([235, -260], beatDuration2 * 0.14, easeInOutCubic),
      outer().opacity(0.42, beatDuration2 * 0.14),
    ),
    all(
      middleLid().rotation(-34, beatDuration2 * 0.24, easeInOutCubic),
      hand().position([325, -390], beatDuration2 * 0.24, easeInOutCubic),
    ),
    all(
      hand().opacity(0, beatDuration2 * 0.08),
      outer().opacity(1, beatDuration2 * 0.08),
    ),
  );
  yield* padSyncWaitFor(Math.max(0, padSyncBeatEnd2 - padSyncUseThread().time()));

  yield* waitUntil('beat:f1b8379d-5625-4150-aadb-533054d9c0c0:start');
  const beatDuration3 = useDuration('beat:f1b8379d-5625-4150-aadb-533054d9c0c0:end');
  padSyncBeatEnd3 = padSyncUseThread().time() + beatDuration3;
  yield* chain(
    all(
      outer().position([-320, 40], beatDuration3 * 0.22, easeInOutCubic),
      outer().scale([0.56, 0.56], beatDuration3 * 0.22, easeInOutCubic),
      middle().position([0, 40], beatDuration3 * 0.22, easeInOutCubic),
      middle().scale([0.58, 0.58], beatDuration3 * 0.22, easeInOutCubic),
      inner().position([280, 40], beatDuration3 * 0.22, easeInOutCubic),
      inner().scale([0.64, 0.64], beatDuration3 * 0.22, easeInOutCubic),
      inner().opacity(1, beatDuration3 * 0.22),
      outerLid().rotation(0, beatDuration3 * 0.22),
      middleLid().rotation(0, beatDuration3 * 0.22),
      innerLid().rotation(0, beatDuration3 * 0.22),
    ),
    all(
      link1().position([-160, 40], beatDuration3 * 0.12),
      link2().position([150, 40], beatDuration3 * 0.12),
      link1().opacity(0.8, beatDuration3 * 0.12),
      link2().opacity(0.8, beatDuration3 * 0.12),
      link1().end(1, beatDuration3 * 0.12),
      link2().end(1, beatDuration3 * 0.12),
    ),
    all(
      pulse().opacity(1, beatDuration3 * 0.08),
      pulse().position([-320, 40], beatDuration3 * 0.08),
      outer().stroke(blue, beatDuration3 * 0.08),
    ),
    all(
      pulse().position([0, 40], beatDuration3 * 0.22, easeInOutCubic),
      outer().stroke(yellow, beatDuration3 * 0.22),
      middle().stroke(blue, beatDuration3 * 0.22),
    ),
    all(
      pulse().position([280, 40], beatDuration3 * 0.22, easeInOutCubic),
      middle().stroke(yellow, beatDuration3 * 0.22),
      inner().stroke(blue, beatDuration3 * 0.22),
    ),
    all(
      pulse().scale([1.65, 1.65], beatDuration3 * 0.14, easeInOutCubic),
      pulse().opacity(0, beatDuration3 * 0.14),
    ),
  );
  yield* padSyncWaitFor(Math.max(0, padSyncBeatEnd3 - padSyncUseThread().time()));

  yield* waitUntil('beat:41834f5c-1841-4a8d-a49b-c45fbb1b9e46:start');
  const beatDuration4 = useDuration('beat:41834f5c-1841-4a8d-a49b-c45fbb1b9e46:end');
  padSyncBeatEnd4 = padSyncUseThread().time() + beatDuration4;
  yield* chain(
    all(
      firstStage().opacity(0, beatDuration4 * 0.16),
      goodStage().opacity(1, beatDuration4 * 0.16),
      badStage().opacity(1, beatDuration4 * 0.16),
    ),
    all(
      good1().stroke(blue, beatDuration4 * 0.16),
      good2().stroke(yellow, beatDuration4 * 0.16),
      good3().stroke(yellow, beatDuration4 * 0.16),
      bad1().scale([1.06, 1.06], beatDuration4 * 0.16, easeInOutCubic),
      bad2().scale([0.92, 0.92], beatDuration4 * 0.16, easeInOutCubic),
      bad3().scale([0.82, 0.82], beatDuration4 * 0.16, easeInOutCubic),
      bad4().scale([0.68, 0.68], beatDuration4 * 0.16, easeInOutCubic),
    ),
    all(
      good1().stroke(yellow, beatDuration4 * 0.16),
      good2().stroke(blue, beatDuration4 * 0.16),
      bad1().scale([0.92, 0.92], beatDuration4 * 0.16, easeInOutCubic),
      bad2().scale([0.78, 0.78], beatDuration4 * 0.16, easeInOutCubic),
      bad3().scale([0.66, 0.66], beatDuration4 * 0.16, easeInOutCubic),
      bad4().scale([0.48, 0.48], beatDuration4 * 0.16, easeInOutCubic),
    ),
    all(
      good2().stroke(yellow, beatDuration4 * 0.16),
      good3().stroke(blue, beatDuration4 * 0.16),
      bad1().scale([0.78, 0.78], beatDuration4 * 0.16, easeInOutCubic),
      bad2().scale([0.64, 0.64], beatDuration4 * 0.16, easeInOutCubic),
      bad3().scale([0.48, 0.48], beatDuration4 * 0.16, easeInOutCubic),
      bad4().scale([0.25, 0.25], beatDuration4 * 0.16, easeInOutCubic),
      tunnel().fill('#020308', beatDuration4 * 0.16),
    ),
    all(
      good3().stroke(green, beatDuration4 * 0.18),
      good1().stroke(green, beatDuration4 * 0.18),
      good2().stroke(green, beatDuration4 * 0.18),
      goodItem().opacity(1, beatDuration4 * 0.18),
      goodItem().scale([1.35, 1.35], beatDuration4 * 0.18, easeInOutCubic),
      bad1().scale([0.62, 0.62], beatDuration4 * 0.18, easeInOutCubic),
      bad2().scale([0.45, 0.45], beatDuration4 * 0.18, easeInOutCubic),
      bad3().scale([0.28, 0.28], beatDuration4 * 0.18, easeInOutCubic),
      bad4().opacity(0, beatDuration4 * 0.18),
    ),
    all(
      goodItem().scale([1, 1], beatDuration4 * 0.18, easeInOutCubic),
      bad1().scale([0.46, 0.46], beatDuration4 * 0.18, easeInOutCubic),
      bad2().scale([0.3, 0.3], beatDuration4 * 0.18, easeInOutCubic),
      bad3().opacity(0, beatDuration4 * 0.18),
      tunnel().scale([1.12, 1.12], beatDuration4 * 0.18, easeInOutCubic),
    ),
  );
  yield* padSyncWaitFor(Math.max(0, padSyncBeatEnd4 - padSyncUseThread().time()));
});
