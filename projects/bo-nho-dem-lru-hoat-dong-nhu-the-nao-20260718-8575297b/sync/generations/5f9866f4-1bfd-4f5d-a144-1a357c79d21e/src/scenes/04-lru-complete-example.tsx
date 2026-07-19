import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, waitFor, waitUntil, useDuration, useThread} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const request = createRef<Rect>();
  const requestText = createSignal<string>('A');
  const cardA = createRef<Rect>();
  const cardB = createRef<Rect>();
  const cardC = createRef<Rect>();
  const cardD = createRef<Rect>();
  const history = createRef<Rect>();
  const entryA = createRef<Circle>();
  const recentB = createRef<Circle>();
  const reject = createRef<Txt>();

  const card = (label: string, fill: string) => (
    <Rect width={220} height={260} radius={32} fill={fill} stroke={'#E8F0FF'} lineWidth={6} shadowColor={'#00000066'} shadowBlur={22}>
      <Txt text={label} fill={'#FFFFFF'} fontSize={96} fontWeight={800}/>
    </Rect>
  );

  view.add(
    <Rect width={1080} height={1920} fill={'#0B1020'}>
      <Line points={[[330, -260], [-330, -260]]} stroke={'#6682A8'} lineWidth={8} endArrow arrowSize={22}/>

      <Rect y={-60} width={980} height={350} radius={48} fill={'#141D33'} stroke={'#334563'} lineWidth={6}>
        <Rect x={-300} width={250} height={290} radius={36} fill={'#0E1628'} stroke={'#40516E'} lineWidth={5}/>
        <Rect x={0} width={250} height={290} radius={36} fill={'#0E1628'} stroke={'#40516E'} lineWidth={5}/>
        <Rect x={300} width={250} height={290} radius={36} fill={'#0E1628'} stroke={'#40516E'} lineWidth={5}/>

        <Rect ref={cardA} x={-300} scale={0}>{card('A', '#4F7CFF')}</Rect>
        <Rect ref={cardB} x={-300} scale={0}>{card('B', '#8B5CF6')}</Rect>
        <Rect ref={cardC} x={-300} scale={0}>{card('C', '#12A89D')}</Rect>
        <Rect ref={cardD} x={-300} y={-390} scale={0}>{card('D', '#F59E42')}</Rect>
      </Rect>

      <Rect ref={request} y={-650} width={180} height={180} radius={90} fill={'#EF5D68'} stroke={'#FFFFFF'} lineWidth={7} opacity={0} scale={0.7}>
        <Txt text={requestText} fill={'#FFFFFF'} fontSize={82} fontWeight={800}/>
      </Rect>

      <Rect ref={history} y={540} width={940} height={520} radius={44} fill={'#111A2D'} stroke={'#31415D'} lineWidth={5} opacity={0}>
        <Txt x={-405} y={-125} text={'＋'} fill={'#90A4C4'} fontSize={58}/>
        <Line y={-125} points={[[-300, 0], [330, 0]]} stroke={'#526580'} lineWidth={8}/>
        <Circle ref={entryA} x={-300} y={-125} size={66} fill={'#4F7CFF'} stroke={'#F8C45C'} lineWidth={0}>
          <Txt text={'A'} fill={'#FFFFFF'} fontSize={34} fontWeight={700}/>
        </Circle>
        <Circle x={-90} y={-125} size={66} fill={'#8B5CF6'}><Txt text={'B'} fill={'#FFFFFF'} fontSize={34}/></Circle>
        <Circle x={120} y={-125} size={66} fill={'#12A89D'}><Txt text={'C'} fill={'#FFFFFF'} fontSize={34}/></Circle>
        <Circle x={330} y={-125} size={66} fill={'#F59E42'}><Txt text={'D'} fill={'#FFFFFF'} fontSize={34}/></Circle>

        <Txt x={-405} y={125} text={'↻'} fill={'#90A4C4'} fontSize={58}/>
        <Line y={125} points={[[-300, 0], [330, 0]]} stroke={'#526580'} lineWidth={8}/>
        <Circle ref={recentB} x={-300} y={125} size={66} fill={'#8B5CF6'} stroke={'#FF6673'} lineWidth={0}>
          <Txt text={'B'} fill={'#FFFFFF'} fontSize={34}/>
        </Circle>
        <Circle x={-90} y={125} size={66} fill={'#12A89D'}><Txt text={'C'} fill={'#FFFFFF'} fontSize={34}/></Circle>
        <Circle x={120} y={125} size={66} fill={'#4F7CFF'}><Txt text={'A'} fill={'#FFFFFF'} fontSize={34}/></Circle>
        <Circle x={330} y={125} size={66} fill={'#F59E42'}><Txt text={'D'} fill={'#FFFFFF'} fontSize={34}/></Circle>
        <Txt ref={reject} x={-300} y={125} text={'×'} fill={'#FFFFFF'} fontSize={88} fontWeight={900} opacity={0} scale={0.5}/>
      </Rect>
    </Rect>,
  );

  {
    yield* waitUntil('beat:aedc1721-9b94-4421-bc81-028f1070d039:start');
    const beatDuration = useDuration('beat:aedc1721-9b94-4421-bc81-028f1070d039:end');
    const beatEndTime = useThread().time() + beatDuration;

    requestText('A');
    yield* chain(
      all(request().opacity(1, beatDuration * 0.06), request().scale(1, beatDuration * 0.06)),
      cardA().scale(1, beatDuration * 0.12, easeInOutCubic),
      request().opacity(0, beatDuration * 0.04),
    );
    requestText('B');
    yield* chain(
      request().opacity(1, beatDuration * 0.05),
      all(cardA().x(0, beatDuration * 0.12, easeInOutCubic), cardB().scale(1, beatDuration * 0.12, easeInOutCubic)),
      request().opacity(0, beatDuration * 0.04),
    );
    requestText('C');
    yield* chain(
      request().opacity(1, beatDuration * 0.05),
      all(cardA().x(300, beatDuration * 0.12, easeInOutCubic), cardB().x(0, beatDuration * 0.12, easeInOutCubic), cardC().scale(1, beatDuration * 0.12, easeInOutCubic)),
      request().opacity(0, beatDuration * 0.04),
    );
    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }

  {
    yield* waitUntil('beat:edb469a2-adf5-4719-87ef-7a2d8a8aa5ed:start');
    const beatDuration = useDuration('beat:edb469a2-adf5-4719-87ef-7a2d8a8aa5ed:end');
    const beatEndTime = useThread().time() + beatDuration;

    requestText('A');
    request().fill('#38C98B');
    yield* chain(
      all(request().opacity(1, beatDuration * 0.08), request().scale(1.08, beatDuration * 0.08)),
      all(cardA().y(-150, beatDuration * 0.16, easeInOutCubic), cardA().scale(1.08, beatDuration * 0.16), cardA().stroke('#8FFFD0', beatDuration * 0.16)),
      all(cardA().x(-300, beatDuration * 0.28, easeInOutCubic), cardA().y(0, beatDuration * 0.28, easeInOutCubic), cardC().x(0, beatDuration * 0.28, easeInOutCubic), cardB().x(300, beatDuration * 0.28, easeInOutCubic)),
      all(cardA().scale(1, beatDuration * 0.08), cardA().stroke('#E8F0FF', beatDuration * 0.08), request().opacity(0, beatDuration * 0.08)),
    );
    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }

  {
    yield* waitUntil('beat:e8f8a3ce-f4bc-4a7d-b702-3023d43ddbc8:start');
    const beatDuration = useDuration('beat:e8f8a3ce-f4bc-4a7d-b702-3023d43ddbc8:end');
    const beatEndTime = useThread().time() + beatDuration;

    requestText('D');
    request().fill('#EF5D68');
    yield* chain(
      all(request().opacity(1, beatDuration * 0.08), request().scale(1, beatDuration * 0.08)),
      all(cardB().opacity(0, beatDuration * 0.18), cardB().y(260, beatDuration * 0.18, easeInOutCubic), cardB().scale(0.72, beatDuration * 0.18)),
      all(cardA().x(0, beatDuration * 0.18, easeInOutCubic), cardC().x(300, beatDuration * 0.18, easeInOutCubic)),
      all(cardD().y(0, beatDuration * 0.22, easeInOutCubic), cardD().scale(1, beatDuration * 0.22, easeInOutCubic), request().opacity(0, beatDuration * 0.12)),
    );
    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }

  {
    yield* waitUntil('beat:3a77de07-3002-4e4e-9e20-fd91224ef6ee:start');
    const beatDuration = useDuration('beat:3a77de07-3002-4e4e-9e20-fd91224ef6ee:end');
    const beatEndTime = useThread().time() + beatDuration;

    yield* chain(
      history().opacity(1, beatDuration * 0.18),
      all(entryA().lineWidth(10, beatDuration * 0.14), entryA().scale(1.2, beatDuration * 0.14)),
      entryA().scale(1, beatDuration * 0.1),
      all(recentB().lineWidth(12, beatDuration * 0.16), recentB().scale(1.22, beatDuration * 0.16), reject().opacity(1, beatDuration * 0.16), reject().scale(1, beatDuration * 0.16)),
      recentB().scale(1, beatDuration * 0.1),
    );
    yield* waitFor(Math.max(0, beatEndTime - useThread().time()));
  }
});
