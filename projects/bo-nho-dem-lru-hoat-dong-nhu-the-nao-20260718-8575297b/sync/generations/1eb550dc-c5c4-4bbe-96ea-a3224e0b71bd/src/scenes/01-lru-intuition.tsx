import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, waitFor, waitUntil, useDuration, useThread, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const source = createRef<Rect>();
  const cache = createRef<Rect>();
  const user = createRef<Circle>();
  const requestPath = createRef<Line>();
  const request = createRef<Circle>();
  const recencyAxis = createRef<Line>();
  const access = createRef<Circle>();
  const cardA = createRef<Rect>();
  const cardB = createRef<Rect>();
  const cardC = createRef<Rect>();
  const cardD = createRef<Rect>();

  view.add(
    <Layout width={1080} height={1920} layout={false}>
      <Rect width={1080} height={1920} fill={'#0B1020'} />

      <Rect
        ref={source}
        x={0}
        y={-430}
        width={650}
        height={300}
        radius={42}
        fill={'#151F38'}
        stroke={'#3B4D72'}
        lineWidth={6}
        opacity={0}
      >
        <Rect x={-220} y={-70} width={130} height={72} radius={16} fill={'#293858'} />
        <Rect x={-70} y={-70} width={130} height={72} radius={16} fill={'#293858'} />
        <Rect x={80} y={-70} width={130} height={72} radius={16} fill={'#293858'} />
        <Rect x={230} y={-70} width={130} height={72} radius={16} fill={'#293858'} />
        <Rect x={-220} y={35} width={130} height={72} radius={16} fill={'#22304D'} />
        <Rect x={-70} y={35} width={130} height={72} radius={16} fill={'#22304D'} />
        <Rect x={80} y={35} width={130} height={72} radius={16} fill={'#22304D'} />
        <Rect x={230} y={35} width={130} height={72} radius={16} fill={'#22304D'} />
      </Rect>

      <Line
        ref={requestPath}
        points={[[0, 650], [0, 330]]}
        stroke={'#52698F'}
        lineWidth={8}
        lineDash={[18, 18]}
        end={0}
        opacity={0}
      />

      <Circle ref={user} x={0} y={700} size={160} fill={'#182640'} stroke={'#69E1FF'} lineWidth={7} opacity={0}>
        <Circle y={-28} size={48} fill={'#69E1FF'} />
        <Rect y={40} width={82} height={50} radius={25} fill={'#69E1FF'} />
      </Circle>

      <Rect
        ref={cache}
        x={0}
        y={170}
        width={840}
        height={250}
        radius={48}
        fill={'#111A2F'}
        stroke={'#69E1FF'}
        lineWidth={7}
        opacity={0}
      >
        <Rect x={-260} width={210} height={170} radius={28} stroke={'#344B6D'} lineWidth={5} />
        <Rect x={0} width={210} height={170} radius={28} stroke={'#344B6D'} lineWidth={5} />
        <Rect x={260} width={210} height={170} radius={28} stroke={'#344B6D'} lineWidth={5} />
      </Rect>

      <Line
        ref={recencyAxis}
        points={[[360, 115], [-360, 115]]}
        stroke={'#69E1FF'}
        lineWidth={8}
        endArrow
        arrowSize={22}
        opacity={0}
      />

      <Circle ref={request} x={0} y={630} size={34} fill={'#FFCA67'} opacity={0} />
      <Circle ref={access} x={260} y={-300} size={62} fill={'#FFFFFF'} stroke={'#69E1FF'} lineWidth={10} opacity={0} />

      <Rect ref={cardA} x={-180} y={-430} width={180} height={140} radius={28} fill={'#69E1FF'} opacity={0}>
        <Txt text={'A'} fontSize={68} fontWeight={700} fill={'#08101D'} />
      </Rect>
      <Rect ref={cardB} x={-60} y={-430} width={180} height={140} radius={28} fill={'#4FA8D1'} opacity={0}>
        <Txt text={'B'} fontSize={68} fontWeight={700} fill={'#08101D'} />
      </Rect>
      <Rect ref={cardC} x={60} y={-430} width={180} height={140} radius={28} fill={'#39749C'} opacity={0}>
        <Txt text={'C'} fontSize={68} fontWeight={700} fill={'#08101D'} />
      </Rect>
      <Rect ref={cardD} x={180} y={-430} width={180} height={140} radius={28} fill={'#FF916F'} opacity={0}>
        <Txt text={'D'} fontSize={68} fontWeight={700} fill={'#17101A'} />
      </Rect>
    </Layout>,
  );

  yield* waitUntil('beat:0df88b33-53a9-40b4-8db4-277d9aab9e6d:start');
  const beatOneDuration = useDuration('beat:0df88b33-53a9-40b4-8db4-277d9aab9e6d:end');
  const beatOneEndTime = useThread().time() + beatOneDuration;

  yield* all(
    source().opacity(1, beatOneDuration * 0.12),
    cache().opacity(1, beatOneDuration * 0.12),
    user().opacity(1, beatOneDuration * 0.12),
    requestPath().opacity(1, beatOneDuration * 0.12),
  );
  yield* all(
    requestPath().end(1, beatOneDuration * 0.12, easeInOutCubic),
    request().opacity(1, beatOneDuration * 0.04),
    request().position([0, 330], beatOneDuration * 0.12, easeInOutCubic),
  );
  yield* all(
    request().fill('#69E1FF', beatOneDuration * 0.04),
    request().position([0, 630], beatOneDuration * 0.1, easeInOutCubic),
  );
  yield* sequence(
    beatOneDuration * 0.035,
    cardA().opacity(1, beatOneDuration * 0.07),
    cardB().opacity(1, beatOneDuration * 0.07),
    cardC().opacity(1, beatOneDuration * 0.07),
    cardD().opacity(1, beatOneDuration * 0.07),
  );
  yield* all(
    cardA().position([-260, 170], beatOneDuration * 0.2, easeInOutCubic),
    cardB().position([0, 170], beatOneDuration * 0.2, easeInOutCubic),
    cardC().position([260, 170], beatOneDuration * 0.2, easeInOutCubic),
    cardD().position([470, 170], beatOneDuration * 0.2, easeInOutCubic),
    request().opacity(0, beatOneDuration * 0.08),
  );
  yield* waitFor(Math.max(0, beatOneEndTime - useThread().time()));

  yield* waitUntil('beat:ea7bec83-64c4-4a24-bd97-e72f80af401b:start');
  const beatTwoDuration = useDuration('beat:ea7bec83-64c4-4a24-bd97-e72f80af401b:end');
  const beatTwoEndTime = useThread().time() + beatTwoDuration;

  yield* all(
    source().opacity(0, beatTwoDuration * 0.12),
    user().opacity(0, beatTwoDuration * 0.12),
    requestPath().opacity(0, beatTwoDuration * 0.12),
    cardD().opacity(0, beatTwoDuration * 0.12),
    cache().y(-100, beatTwoDuration * 0.16, easeInOutCubic),
    cardA().position([-260, -100], beatTwoDuration * 0.16, easeInOutCubic),
    cardB().position([0, -100], beatTwoDuration * 0.16, easeInOutCubic),
    cardC().position([260, -100], beatTwoDuration * 0.16, easeInOutCubic),
    recencyAxis().opacity(1, beatTwoDuration * 0.16),
  );
  yield* chain(
    access().opacity(1, beatTwoDuration * 0.06),
    access().position([260, -100], beatTwoDuration * 0.12, easeInOutCubic),
    all(
      access().scale([1.45, 1.45], beatTwoDuration * 0.05),
      cardC().scale([1.08, 1.08], beatTwoDuration * 0.05),
    ),
    all(
      access().scale([1, 1], beatTwoDuration * 0.05),
      cardC().scale([1, 1], beatTwoDuration * 0.05),
    ),
  );
  yield* cardC().y(-250, beatTwoDuration * 0.1, easeInOutCubic);
  yield* all(
    cardA().x(0, beatTwoDuration * 0.14, easeInOutCubic),
    cardB().x(260, beatTwoDuration * 0.14, easeInOutCubic),
    cardA().fill('#4FA8D1', beatTwoDuration * 0.14),
    cardB().fill('#39749C', beatTwoDuration * 0.14),
    access().opacity(0, beatTwoDuration * 0.08),
  );
  yield* all(
    cardC().position([-260, -100], beatTwoDuration * 0.14, easeInOutCubic),
    cardC().fill('#69E1FF', beatTwoDuration * 0.14),
  );
  yield* waitFor(Math.max(0, beatTwoEndTime - useThread().time()));
});
