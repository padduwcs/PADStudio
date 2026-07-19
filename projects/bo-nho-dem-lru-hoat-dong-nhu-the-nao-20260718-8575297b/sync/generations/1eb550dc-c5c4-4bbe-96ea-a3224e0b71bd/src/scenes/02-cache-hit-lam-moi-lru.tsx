import {Circle, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const cardA = createRef<Rect>();
  const cardB = createRef<Rect>();
  const cardC = createRef<Rect>();
  const responseB = createRef<Rect>();
  const requestLine = createRef<Line>();
  const requestDot = createRef<Circle>();

  view.fill('#0B1020');
  view.add(
    <>
      <Circle x={0} y={250} size={150} fill={'#26324A'} />
      <Circle x={0} y={225} size={48} fill={'#D7E2F4'} />
      <Rect x={0} y={292} width={82} height={54} radius={28} fill={'#D7E2F4'} />

      <Line
        ref={requestLine}
        points={[[0, 390], [0, 790]]}
        stroke={'#62D9FF'}
        lineWidth={10}
        endArrow
        arrowSize={22}
        end={0}
        opacity={0}
      />
      <Circle ref={requestDot} x={0} y={410} size={26} fill={'#62D9FF'} opacity={0} />

      <Rect
        x={0}
        y={930}
        width={940}
        height={330}
        radius={48}
        fill={'#151F35'}
        stroke={'#334362'}
        lineWidth={6}
      />
      <Line
        points={[[330, 740], [-330, 740]]}
        stroke={'#7B8AA8'}
        lineWidth={6}
        endArrow
        arrowSize={18}
        opacity={0.7}
      />
      <Circle x={-280} y={740} size={22} fill={'#62D9FF'} />
      <Circle x={0} y={740} size={18} fill={'#7B8AA8'} />
      <Circle x={280} y={740} size={14} fill={'#46536D'} />

      <Rect ref={cardA} x={-280} y={930} width={230} height={210} radius={34} fill={'#334362'} stroke={'#60708F'} lineWidth={5}>
        <Txt text={'A'} fill={'#FFFFFF'} fontSize={88} fontWeight={700} />
      </Rect>
      <Rect ref={cardB} x={0} y={930} width={230} height={210} radius={34} fill={'#334362'} stroke={'#60708F'} lineWidth={5}>
        <Txt text={'B'} fill={'#FFFFFF'} fontSize={88} fontWeight={700} />
      </Rect>
      <Rect ref={cardC} x={280} y={930} width={230} height={210} radius={34} fill={'#334362'} stroke={'#60708F'} lineWidth={5}>
        <Txt text={'C'} fill={'#FFFFFF'} fontSize={88} fontWeight={700} />
      </Rect>

      <Line
        points={[[0, 1110], [0, 1370]]}
        stroke={'#64708A'}
        lineWidth={7}
        lineDash={[18, 18]}
        opacity={0.16}
      />
      <Line points={[[-34, 1210], [34, 1278]]} stroke={'#E36A72'} lineWidth={10} opacity={0.35} />
      <Line points={[[34, 1210], [-34, 1278]]} stroke={'#E36A72'} lineWidth={10} opacity={0.35} />
      <Rect x={0} y={1510} width={720} height={310} radius={42} fill={'#151A27'} stroke={'#3A4355'} lineWidth={5} opacity={0.42} />
      <Rect x={0} y={1470} width={610} height={80} radius={18} fill={'#293246'} opacity={0.42} />
      <Rect x={0} y={1570} width={610} height={80} radius={18} fill={'#293246'} opacity={0.32} />

      <Rect ref={responseB} x={0} y={930} width={150} height={136} radius={28} fill={'#29C892'} stroke={'#A8FFE1'} lineWidth={6} opacity={0} scale={0.75}>
        <Txt text={'B'} fill={'#071A16'} fontSize={66} fontWeight={800} />
      </Rect>
    </>,
  );

  yield* waitUntil('beat:a359a3b8-fe1f-4543-89ac-f0e314b6c26c:start');
  const hitDuration = useDuration('beat:a359a3b8-fe1f-4543-89ac-f0e314b6c26c:end');
  const hitEndTime = useThread().time() + hitDuration;

  yield* all(
    requestLine().opacity(1, hitDuration * 0.08),
    requestLine().end(1, hitDuration * 0.18, easeInOutCubic),
    requestDot().opacity(1, hitDuration * 0.08),
    requestDot().position([0, 790], hitDuration * 0.18, easeInOutCubic),
  );
  yield* all(
    cardB().fill('#29C892', hitDuration * 0.16),
    cardB().stroke('#A8FFE1', hitDuration * 0.16),
    cardB().scale(1.08, hitDuration * 0.16, easeInOutCubic),
    requestDot().opacity(0, hitDuration * 0.12),
  );
  yield* all(
    cardB().scale(1, hitDuration * 0.24, easeInOutCubic),
    responseB().opacity(1, hitDuration * 0.08),
    responseB().scale(1, hitDuration * 0.18, easeInOutCubic),
    responseB().position([0, 410], hitDuration * 0.24, easeInOutCubic),
    requestLine().opacity(0, hitDuration * 0.2),
  );
  yield* responseB().opacity(0, hitDuration * 0.06);
  yield* waitFor(Math.max(0, hitEndTime - useThread().time()));

  yield* waitUntil('beat:ee38263f-8f86-438b-8edc-2aa400521d43:start');
  const refreshDuration = useDuration('beat:ee38263f-8f86-438b-8edc-2aa400521d43:end');
  const refreshEndTime = useThread().time() + refreshDuration;

  yield* all(
    cardB().y(790, refreshDuration * 0.18, easeInOutCubic),
    cardB().scale(1.1, refreshDuration * 0.18, easeInOutCubic),
  );
  yield* all(
    cardB().x(-280, refreshDuration * 0.38, easeInOutCubic),
    cardA().x(0, refreshDuration * 0.38, easeInOutCubic),
  );
  yield* all(
    cardB().y(930, refreshDuration * 0.18, easeInOutCubic),
    cardB().scale(1, refreshDuration * 0.18, easeInOutCubic),
    cardA().fill('#334362', refreshDuration * 0.18),
    cardA().stroke('#60708F', refreshDuration * 0.18),
  );
  yield* waitFor(Math.max(0, refreshEndTime - useThread().time()));
});
