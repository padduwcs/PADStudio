import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const left = createRef<Rect>();
  const right = createRef<Rect>();
  const possible = createRef<Rect>();
  const rejected = createRef<Rect>();
  const pointer = createRef<Line>();
  const divider = createRef<Rect>();
  const guess = createRef<Txt>();
  const card = createRef<Rect>();
  const secret = createRef<Txt>();
  const arrow = createRef<Txt>();
  const eliminated = createRef<Txt>();
  const low = createRef<Txt>();
  const high = createRef<Txt>();
  const rangeWidth = createSignal(440);
  const rangeX = createSignal(220);

  view.fill('#07111F');
  view.add(
    <>
      <Txt text={'ĐOÁN SỐ BÍ MẬT'} y={-790} fill={'#A9B8CD'} fontSize={42} fontWeight={700} letterSpacing={5}/>
      <Rect ref={card} y={-680} width={300} height={190} radius={34} fill={'#15243A'} stroke={'#35E6A5'} lineWidth={5} opacity={0}>
        <Txt ref={secret} text={'?'} fill={'#35E6A5'} fontSize={104} fontWeight={800}/>
      </Rect>

      <Rect y={300} width={920} height={250} radius={38} fill={'#0D1B2D'}>
        <Rect ref={left} x={-220} width={440} height={72} radius={18} fill={'#2A9DFF'}/>
        <Rect ref={right} x={rangeX} width={rangeWidth} height={72} radius={18} fill={'#35E6A5'}/>
        <Rect ref={possible} x={-220} width={440} height={72} radius={18} fill={'#35E6A5'} opacity={0}/>
        <Rect ref={rejected} x={220} width={440} height={72} radius={18} fill={'#FF5A72'} opacity={0}/>
        <Rect ref={divider} width={5} height={0} fill={'#F7FBFF'}/>
        <Txt ref={low} text={'1'} x={-430} y={82} fill={'#A9B8CD'} fontSize={36}/>
        <Txt ref={high} text={'100'} x={430} y={82} fill={'#A9B8CD'} fontSize={36}/>
        <Circle x={0} width={18} height={18} fill={'#F7FBFF'}/>
      </Rect>

      <Line ref={pointer} y={80} points={[[-34, 0], [0, 42], [34, 0]]} closed fill={'#FFD166'} stroke={'#FFD166'} opacity={0}/>
      <Txt ref={guess} text={'50'} y={30} fill={'#FFD166'} fontSize={92} fontWeight={800} opacity={0}/>
      <Txt ref={arrow} text={'>'} x={0} y={515} fill={'#35E6A5'} fontSize={110} fontWeight={900} opacity={0}/>
      <Txt ref={eliminated} text={'KHÔNG THỂ'} x={-235} y={515} fill={'#FF5A72'} fontSize={38} fontWeight={800} opacity={0}/>
    </>
  );

  yield* all(card().opacity(1, 0.8), card().y(-560, 0.8, easeInOutCubic));
  yield* pointer().y(190, 0.8, easeInOutCubic);
  yield* all(pointer().opacity(1, 0.7), guess().opacity(1, 0.7), divider().height(150, 0.7));
  yield* waitFor(3.7);

  yield* all(arrow().opacity(1, 0.6), arrow().x(120, 0.6, easeInOutCubic));
  yield* all(
    left().opacity(0.12, 1.6),
    left().width(0, 1.6, easeInOutCubic),
    left().x(-440, 1.6, easeInOutCubic),
    eliminated().opacity(1, 0.8)
  );
  yield* waitFor(4.8);

  yield* all(eliminated().opacity(0, 0.4), arrow().opacity(0, 0.4));
  yield* all(
    rangeWidth(880, 2, easeInOutCubic),
    rangeX(0, 2, easeInOutCubic),
    low().text('51', 2),
    low().x(-430, 2, easeInOutCubic),
    high().x(430, 2, easeInOutCubic),
    pointer().x(0, 2, easeInOutCubic)
  );
  guess().text('75');
  yield* chain(pointer().y(165, 0.35), pointer().y(190, 0.35));
  yield* all(guess().scale([1.22, 1.22], 0.3), divider().height(170, 0.3));
  yield* guess().scale([1, 1], 0.3);
  yield* waitFor(3.3);

  yield* all(
    right().opacity(0, 1.4),
    rejected().opacity(0.14, 0.5),
    rejected().width(0, 1.4, easeInOutCubic),
    rejected().x(440, 1.4, easeInOutCubic),
    possible().opacity(1, 0.5)
  );

  guess().text('62');
  yield* all(possible().width(220, 1), possible().x(-110, 1), pointer().x(-220, 1), divider().x(-220, 1));
  guess().text('68');
  yield* all(possible().width(110, 1), possible().x(-55, 1), pointer().x(-110, 1), divider().x(-110, 1));
  guess().text('71');
  yield* all(possible().width(55, 1), possible().x(-28, 1), pointer().x(-55, 1), divider().x(-55, 1));

  guess().text('73');
  secret().text('73');
  yield* all(
    pointer().x(-37, 1, easeInOutCubic),
    divider().x(-37, 1, easeInOutCubic),
    possible().width(24, 1, easeInOutCubic),
    possible().x(-37, 1, easeInOutCubic),
    card().fill('#123C35', 1),
    card().scale([1.12, 1.12], 1)
  );
  yield* waitFor(1.6);
});
