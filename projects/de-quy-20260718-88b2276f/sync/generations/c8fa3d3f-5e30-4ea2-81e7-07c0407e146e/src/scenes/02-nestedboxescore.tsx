import {makeScene2D, Rect, Circle, Line, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, waitUntil, useDuration, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const stage = createRef<Layout>();
  const outer = createRef<Rect>();
  const middle = createRef<Rect>();
  const inner = createRef<Rect>();
  const outerLid = createRef<Rect>();
  const middleLid = createRef<Rect>();
  const innerLid = createRef<Rect>();
  const path = createRef<Line>();
  const stop = createRef<Line>();
  const prize = createRef<Circle>();

  view.add(
    <Layout ref={stage} width={1080} height={1920}>
      <Rect width={1080} height={1920} fill={'#0B1324'} />

      <Line
        ref={path}
        points={[[0, -720], [0, 720]]}
        stroke={'#8DB8FF'}
        lineWidth={12}
        lineDash={[24, 22]}
        endArrow
        arrowSize={28}
        opacity={0}
      />
      <Line
        ref={stop}
        points={[[-100, 190], [100, 190]]}
        stroke={'#F8FAFC'}
        lineWidth={18}
        lineCap={'round'}
        opacity={0}
      />

      <Rect
        ref={outer}
        width={760}
        height={620}
        radius={54}
        fill={'#3B82F6'}
        stroke={'#BFDBFE'}
        lineWidth={18}
      />
      <Rect
        ref={outerLid}
        width={820}
        height={90}
        y={-330}
        radius={28}
        fill={'#60A5FA'}
        stroke={'#DBEAFE'}
        lineWidth={14}
      />

      <Rect
        ref={middle}
        width={500}
        height={410}
        radius={42}
        fill={'#3B82F6'}
        stroke={'#BFDBFE'}
        lineWidth={15}
        opacity={0}
        scale={[0.76, 0.76]}
      />
      <Rect
        ref={middleLid}
        width={540}
        height={70}
        y={-220}
        radius={22}
        fill={'#60A5FA'}
        stroke={'#DBEAFE'}
        lineWidth={12}
        opacity={0}
        scale={[0.76, 0.76]}
      />

      <Rect
        ref={inner}
        width={280}
        height={230}
        radius={32}
        fill={'#3B82F6'}
        stroke={'#BFDBFE'}
        lineWidth={13}
        opacity={0}
        scale={[0.7, 0.7]}
      />
      <Rect
        ref={innerLid}
        width={310}
        height={55}
        y={-125}
        radius={18}
        fill={'#60A5FA'}
        stroke={'#DBEAFE'}
        lineWidth={10}
        opacity={0}
        scale={[0.7, 0.7]}
      />

      <Circle
        ref={prize}
        size={92}
        fill={'#FFF3A3'}
        stroke={'#FFFFFF'}
        lineWidth={12}
        opacity={0}
        scale={[0.2, 0.2]}
      />
    </Layout>,
  );

  yield* waitUntil('beat:69e8662b-5f20-4106-af3f-e689f1273695:start');
  {
    const beatDuration = useDuration('beat:69e8662b-5f20-4106-af3f-e689f1273695:end');
    yield* all(
      outer().fill('#3B82F62B', beatDuration * 0.58, easeInOutCubic),
      outerLid().fill('#60A5FA55', beatDuration * 0.58, easeInOutCubic),
      middle().opacity(1, beatDuration * 0.58, easeInOutCubic),
      middleLid().opacity(1, beatDuration * 0.58, easeInOutCubic),
      middle().scale([1, 1], beatDuration * 0.58, easeInOutCubic),
      middleLid().scale([1, 1], beatDuration * 0.58, easeInOutCubic),
    );
  }
  yield* waitUntil('beat:69e8662b-5f20-4106-af3f-e689f1273695:end');

  yield* waitUntil('beat:885465fa-07cc-4cae-b1de-a96de6525637:start');
  {
    const beatDuration = useDuration('beat:885465fa-07cc-4cae-b1de-a96de6525637:end');
    yield* all(
      stage().scale([1.08, 1.08], beatDuration * 0.62, easeInOutCubic),
      inner().opacity(1, beatDuration * 0.42, easeInOutCubic),
      innerLid().opacity(1, beatDuration * 0.42, easeInOutCubic),
      inner().scale([1, 1], beatDuration * 0.42, easeInOutCubic),
      innerLid().scale([1, 1], beatDuration * 0.42, easeInOutCubic),
      chain(
        all(
          outerLid().y(-390, beatDuration * 0.18, easeInOutCubic),
          outerLid().rotation(-10, beatDuration * 0.18, easeInOutCubic),
        ),
        all(
          middleLid().y(-265, beatDuration * 0.18, easeInOutCubic),
          middleLid().rotation(-10, beatDuration * 0.18, easeInOutCubic),
        ),
        all(
          innerLid().y(-160, beatDuration * 0.18, easeInOutCubic),
          innerLid().rotation(-10, beatDuration * 0.18, easeInOutCubic),
        ),
      ),
    );
  }
  yield* waitUntil('beat:885465fa-07cc-4cae-b1de-a96de6525637:end');

  yield* waitUntil('beat:71a2a021-aa85-45ff-8fcc-b1696a9ef17d:start');
  {
    const beatDuration = useDuration('beat:71a2a021-aa85-45ff-8fcc-b1696a9ef17d:end');
    yield* all(
      outerLid().y(-330, beatDuration * 0.1, easeInOutCubic),
      middleLid().y(-220, beatDuration * 0.1, easeInOutCubic),
      innerLid().y(-125, beatDuration * 0.1, easeInOutCubic),
      outerLid().rotation(0, beatDuration * 0.1, easeInOutCubic),
      middleLid().rotation(0, beatDuration * 0.1, easeInOutCubic),
      innerLid().rotation(0, beatDuration * 0.1, easeInOutCubic),
    );
    yield* all(
      stage().scale([1, 1], beatDuration * 0.22, easeInOutCubic),
      path().opacity(0.7, beatDuration * 0.22, easeInOutCubic),
      outer().position([0, -520], beatDuration * 0.22, easeInOutCubic),
      outerLid().position([0, -850], beatDuration * 0.22, easeInOutCubic),
      outer().scale([0.52, 0.52], beatDuration * 0.22, easeInOutCubic),
      outerLid().scale([0.52, 0.52], beatDuration * 0.22, easeInOutCubic),
      middle().position([0, 0], beatDuration * 0.22, easeInOutCubic),
      middleLid().position([0, -220], beatDuration * 0.22, easeInOutCubic),
      middle().scale([0.65, 0.65], beatDuration * 0.22, easeInOutCubic),
      middleLid().scale([0.65, 0.65], beatDuration * 0.22, easeInOutCubic),
      inner().position([0, 520], beatDuration * 0.22, easeInOutCubic),
      innerLid().position([0, 395], beatDuration * 0.22, easeInOutCubic),
    );
    yield* chain(
      all(
        outer().fill('#3B82F6', beatDuration * 0.16, easeInOutCubic),
        outerLid().y(-890, beatDuration * 0.16, easeInOutCubic),
        outerLid().rotation(-12, beatDuration * 0.16, easeInOutCubic),
      ),
      all(
        outer().fill('#FBBF24', beatDuration * 0.16, easeInOutCubic),
        middle().fill('#3B82F6', beatDuration * 0.16, easeInOutCubic),
        middleLid().y(-260, beatDuration * 0.16, easeInOutCubic),
        middleLid().rotation(-12, beatDuration * 0.16, easeInOutCubic),
      ),
      all(
        middle().fill('#FBBF24', beatDuration * 0.16, easeInOutCubic),
        inner().fill('#3B82F6', beatDuration * 0.16, easeInOutCubic),
        innerLid().y(355, beatDuration * 0.16, easeInOutCubic),
        innerLid().rotation(-12, beatDuration * 0.16, easeInOutCubic),
      ),
    );
  }
  yield* waitUntil('beat:71a2a021-aa85-45ff-8fcc-b1696a9ef17d:end');

  yield* waitUntil('beat:97247e1f-c78c-4a3e-897d-f7142a6e9313:start');
  {
    const beatDuration = useDuration('beat:97247e1f-c78c-4a3e-897d-f7142a6e9313:end');
    yield* all(
      outer().opacity(0.14, beatDuration * 0.38, easeInOutCubic),
      outerLid().opacity(0.14, beatDuration * 0.38, easeInOutCubic),
      middle().opacity(0.14, beatDuration * 0.38, easeInOutCubic),
      middleLid().opacity(0.14, beatDuration * 0.38, easeInOutCubic),
      path().opacity(0.12, beatDuration * 0.38, easeInOutCubic),
      inner().position([0, 0], beatDuration * 0.38, easeInOutCubic),
      innerLid().position([0, -165], beatDuration * 0.38, easeInOutCubic),
      inner().scale([1.5, 1.5], beatDuration * 0.38, easeInOutCubic),
      innerLid().scale([1.5, 1.5], beatDuration * 0.38, easeInOutCubic),
    );
    yield* all(
      inner().fill('#22C55E', beatDuration * 0.3, easeInOutCubic),
      innerLid().fill('#4ADE80', beatDuration * 0.3, easeInOutCubic),
      innerLid().y(-235, beatDuration * 0.3, easeInOutCubic),
      innerLid().rotation(-15, beatDuration * 0.3, easeInOutCubic),
      prize().opacity(1, beatDuration * 0.3, easeInOutCubic),
      prize().scale([1, 1], beatDuration * 0.3, easeInOutCubic),
      stop().opacity(1, beatDuration * 0.3, easeInOutCubic),
    );
  }
  yield* waitUntil('beat:97247e1f-c78c-4a3e-897d-f7142a6e9313:end');
});
