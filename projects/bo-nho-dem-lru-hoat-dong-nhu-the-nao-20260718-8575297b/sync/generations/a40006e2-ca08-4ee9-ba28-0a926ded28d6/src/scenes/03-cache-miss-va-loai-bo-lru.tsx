import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, createRef, easeInOutCubic, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const scan = createRef<Rect>();
  const route = createRef<Line>();
  const request = createRef<Circle>();
  const cardA = createRef<Rect>();
  const cardB = createRef<Rect>();
  const cardC = createRef<Rect>();
  const cardD = createRef<Rect>();

  const card = (label: string, color: string) => (
    <Rect width={220} height={220} radius={34} fill={color} shadowColor={'#07111f88'} shadowBlur={24}>
      <Txt text={label} fill={'#ffffff'} fontSize={92} fontWeight={800}/>
    </Rect>
  );

  view.add(
    <Rect width={1080} height={1920} fill={'#081321'}>
      <Line
        points={[[380, -115], [-380, -115]]}
        stroke={'#5f7890'}
        lineWidth={8}
        endArrow
        arrowSize={22}
      />

      <Rect y={140} width={930} height={300} radius={42} fill={'#102438'} stroke={'#28435b'} lineWidth={8}/>
      <Rect x={-300} y={140} width={250} height={250} radius={32} stroke={'#45627a'} lineWidth={6}/>
      <Rect x={0} y={140} width={250} height={250} radius={32} stroke={'#45627a'} lineWidth={6}/>
      <Rect x={300} y={140} width={250} height={250} radius={32} stroke={'#45627a'} lineWidth={6}/>

      <Rect
        ref={scan}
        x={-300}
        y={140}
        width={270}
        height={270}
        radius={38}
        stroke={'#ffb84d'}
        lineWidth={12}
        opacity={0}
      />

      <Rect ref={cardA} x={-300} y={140}>{card('A', '#3979d8')}</Rect>
      <Rect ref={cardB} x={0} y={140}>{card('B', '#7857d6')}</Rect>

      <Circle ref={request} x={-300} y={-390} width={150} height={150} fill={'#ffb84d'}>
        <Txt text={'D'} fill={'#081321'} fontSize={70} fontWeight={900}/>
      </Circle>

      <Line
        ref={route}
        points={[[0, 310], [0, 480]]}
        stroke={'#ffb84d'}
        lineWidth={12}
        lineDash={[22, 18]}
        endArrow
        arrowSize={28}
        end={0}
        opacity={0}
      />

      <Rect y={690} width={850} height={320} radius={48} fill={'#0d1d2d'} stroke={'#39536a'} lineWidth={8}>
        <Circle x={-300} width={72} height={72} fill={'#39536a'}/>
        <Circle width={72} height={72} fill={'#39536a'}/>
        <Circle x={300} width={72} height={72} fill={'#39536a'}/>
      </Rect>

      <Rect ref={cardD} x={-120} y={690}>{card('D', '#ef7b45')}</Rect>
      <Rect ref={cardC} x={150} y={690} opacity={0}>{card('C', '#22a98a')}</Rect>
    </Rect>,
  );

  {
    yield* waitUntil('beat:53e1621e-275a-4cc2-b601-9b898784f6c2:start');
    const beatDuration = useDuration('beat:53e1621e-275a-4cc2-b601-9b898784f6c2:end');
    const beatEndTime = useThread().time() + beatDuration;

    yield* chain(
      scan().opacity(1, beatDuration * 0.08),
      scan().x(0, beatDuration * 0.13, easeInOutCubic),
      scan().x(300, beatDuration * 0.13, easeInOutCubic),
      all(
        scan().opacity(0, beatDuration * 0.08),
        route().opacity(1, beatDuration * 0.08),
        route().end(1, beatDuration * 0.16, easeInOutCubic),
      ),
      cardD().position([-300, -145], beatDuration * 0.28, easeInOutCubic),
      all(
        route().opacity(0, beatDuration * 0.08),
        request().opacity(0.35, beatDuration * 0.08),
      ),
    );

    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }

  {
    yield* waitUntil('beat:cf8dbe4f-0eb6-457b-8ddb-093cfb3d4128:start');
    const beatDuration = useDuration('beat:cf8dbe4f-0eb6-457b-8ddb-093cfb3d4128:end');
    const beatEndTime = useThread().time() + beatDuration;

    yield* all(
      cardA().x(0, beatDuration * 0.58, easeInOutCubic),
      cardB().x(300, beatDuration * 0.58, easeInOutCubic),
      cardD().position([-300, 140], beatDuration * 0.58, easeInOutCubic),
      request().opacity(0, beatDuration * 0.22),
    );

    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }

  {
    yield* waitUntil('beat:dc20ec93-b278-4463-a074-d406b0e4faab:start');
    const beatDuration = useDuration('beat:dc20ec93-b278-4463-a074-d406b0e4faab:end');
    const beatEndTime = useThread().time() + beatDuration;

    yield* chain(
      all(
        cardC().opacity(1, beatDuration * 0.12),
        cardC().position([-300, -145], beatDuration * 0.2, easeInOutCubic),
      ),
      all(
        cardB().position([470, 430], beatDuration * 0.25, easeInOutCubic),
        cardB().opacity(0, beatDuration * 0.25),
      ),
      all(
        cardD().x(0, beatDuration * 0.4, easeInOutCubic),
        cardA().x(300, beatDuration * 0.4, easeInOutCubic),
        cardC().position([-300, 140], beatDuration * 0.4, easeInOutCubic),
      ),
    );

    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }
});
