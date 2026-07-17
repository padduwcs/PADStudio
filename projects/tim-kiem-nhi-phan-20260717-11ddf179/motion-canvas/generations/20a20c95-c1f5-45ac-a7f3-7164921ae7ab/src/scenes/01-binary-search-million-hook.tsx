import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, tween, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const bg = '#07111f';
  const ink = '#f5f8ff';
  const muted = '#263449';
  const cyan = '#31e6d2';
  const coral = '#ff647c';

  const linear = createRef<Rect>();
  const list = createRef<Rect>();
  const scanner = createRef<Circle>();
  const checks = createSignal(0);

  const binary = createRef<Rect>();
  const active = createRef<Rect>();
  const probe = createRef<Line>();
  const rangeWidth = createSignal(820);
  const rangeX = createSignal(0);
  const probeX = createSignal(0);

  const compare = createRef<Rect>();
  const linearPointer = createRef<Circle>();
  const binaryPointer = createRef<Circle>();
  const target = createRef<Circle>();
  const sequentialCells = Array.from({length: 16}, () => createRef<Rect>());
  const halfCells = Array.from({length: 8}, () => createRef<Rect>());

  view.add(
    <Rect width={1080} height={1920} fill={bg}>
      <Rect ref={linear} width={940} height={1760} radius={42} fill={'#0d1a2c'} clip>
        <Txt y={-720} text={'1.000.000 KHẢ NĂNG'} fill={ink} fontSize={62} fontWeight={800}/>
        <Rect ref={list} width={720} height={3200} y={1000}>
          {Array.from({length: 36}, (_, i) => (
            <Rect
              key={'long-'+String(i)}
              y={-1450+i*86}
              width={680}
              height={62}
              radius={12}
              fill={i === 34 ? coral : muted}
              stroke={i === 34 ? '#ff9aaa' : '#34465f'}
              lineWidth={3}
            >
              <Circle x={-292} size={18} fill={i === 34 ? ink : '#7d8da5'}/>
              <Line points={[[-250, 0], [250, 0]]} stroke={i === 34 ? ink : '#607089'} lineWidth={8}/>
            </Rect>
          ))}
        </Rect>
        <Circle ref={scanner} x={300} y={-520} size={108} stroke={cyan} lineWidth={14} fill={'#07111fcc'}>
          <Line points={[[38, 38], [86, 86]]} stroke={cyan} lineWidth={16} lineCap={'round'}/>
        </Circle>
        <Rect y={680} width={720} height={210} radius={28} fill={'#07111fee'} stroke={cyan} lineWidth={3}>
          <Txt y={-46} text={'LẦN THỬ'} fill={'#8fa1ba'} fontSize={30} fontWeight={700}/>
          <Txt y={35} text={() => String(checks())} fill={cyan} fontSize={82} fontWeight={900}/>
        </Rect>
      </Rect>

      <Rect ref={binary} width={940} height={1760} radius={42} fill={'#0d1a2c'} opacity={0}>
        <Txt y={-650} text={'≈ 20 LẦN'} fill={cyan} fontSize={96} fontWeight={900}/>
        <Txt y={-545} text={'CHIA ĐÔI LIÊN TỤC'} fill={ink} fontSize={38} fontWeight={700}/>
        <Rect y={0} width={850} height={250} radius={30} fill={'#07111f'}>
          <Rect width={820} height={110} radius={18} fill={muted}/>
          <Rect
            ref={active}
            x={rangeX}
            width={rangeWidth}
            height={110}
            radius={18}
            fill={cyan}
          />
          <Circle x={270} size={34} fill={coral} stroke={ink} lineWidth={7}/>
          <Line
            ref={probe}
            x={probeX}
            points={[[0, -105], [0, 105]]}
            stroke={ink}
            lineWidth={9}
            lineCap={'round'}
          />
        </Rect>
        <Rect y={390} width={820} height={150} radius={24} fill={'#13233a'}>
          <Txt text={'1/2  →  1/4  →  1/8  →  …  →  1'} fill={ink} fontSize={46} fontWeight={800}/>
        </Rect>
      </Rect>

      <Rect ref={compare} width={940} height={1760} radius={42} fill={'#0d1a2c'} opacity={0}>
        <Txt y={-720} text={'CÙNG MỘT LẦN KIỂM TRA'} fill={ink} fontSize={48} fontWeight={800}/>

        <Rect y={-300} width={850} height={430} radius={30} fill={'#101f34'}>
          <Txt y={-145} text={'TUẦN TỰ'} fill={'#9fb0c8'} fontSize={34} fontWeight={800}/>
          {sequentialCells.map((cell, i) => (
            <Rect
              ref={cell}
              key={'seq-'+String(i)}
              x={-375+i*50}
              y={10}
              width={40}
              height={108}
              radius={8}
              fill={i === 15 ? coral : '#59708d'}
            />
          ))}
          <Circle ref={linearPointer} x={-375} y={120} size={42} fill={ink} stroke={cyan} lineWidth={8}/>
          <Txt y={178} text={'− 1 ô'} fill={cyan} fontSize={42} fontWeight={900}/>
        </Rect>

        <Rect y={300} width={850} height={430} radius={30} fill={'#101f34'}>
          <Txt y={-145} text={'NHỊ PHÂN'} fill={cyan} fontSize={34} fontWeight={800}/>
          {Array.from({length: 16}, (_, i) => (
            <Rect
              ref={i < 8 ? halfCells[i] : undefined}
              key={'bin-'+String(i)}
              x={-375+i*50}
              y={10}
              width={40}
              height={108}
              radius={8}
              fill={i === 15 ? coral : cyan}
            />
          ))}
          <Circle ref={binaryPointer} x={0} y={120} size={42} fill={ink} stroke={cyan} lineWidth={8}/>
          <Circle ref={target} x={375} y={10} size={22} fill={ink}/>
          <Txt y={178} text={'− 1/2'} fill={cyan} fontSize={42} fontWeight={900}/>
        </Rect>
      </Rect>
    </Rect>
  );

  yield* all(
    list().y(-1900, 5.2, easeInOutCubic),
    tween(5.2, value => checks(Math.round(value * 987654)), easeInOutCubic),
    chain(...Array.from({length: 13}, (_, i) => scanner().y(-520+i*86, 0.4, easeInOutCubic)))
  );
  yield* linear().opacity(0, 0.8, easeInOutCubic);

  yield* chain(
    binary().opacity(1, 0.4, easeInOutCubic),
    all(rangeWidth(410, 0.75, easeInOutCubic), rangeX(205, 0.75, easeInOutCubic), probeX(205, 0.75, easeInOutCubic)),
    all(rangeWidth(205, 0.75, easeInOutCubic), rangeX(307.5, 0.75, easeInOutCubic), probeX(307.5, 0.75, easeInOutCubic)),
    all(rangeWidth(102.5, 0.75, easeInOutCubic), rangeX(256.25, 0.75, easeInOutCubic), probeX(256.25, 0.75, easeInOutCubic)),
    all(rangeWidth(51.25, 0.75, easeInOutCubic), rangeX(281.9, 0.75, easeInOutCubic), probeX(281.9, 0.75, easeInOutCubic)),
    all(rangeWidth(25.6, 0.75, easeInOutCubic), rangeX(269.1, 0.75, easeInOutCubic), probeX(269.1, 0.75, easeInOutCubic)),
    all(rangeWidth(12.8, 0.75, easeInOutCubic), rangeX(275.5, 0.75, easeInOutCubic), probeX(275.5, 0.75, easeInOutCubic)),
    waitFor(0.5),
    binary().opacity(0, 0.6, easeInOutCubic)
  );

  yield* chain(
    compare().opacity(1, 0.4, easeInOutCubic),
    waitFor(0.3),
    all(
      linearPointer().position([-325, 120], 1.2, easeInOutCubic),
      sequentialCells[0]().opacity(0.16, 1.2, easeInOutCubic),
      binaryPointer().position([200, 120], 1.2, easeInOutCubic),
      ...halfCells.map(cell => cell().opacity(0.12, 1.2, easeInOutCubic))
    ),
    waitFor(2.9),
    target().scale([1.5, 1.5], 0.3, easeInOutCubic),
    target().scale([1, 1], 0.3, easeInOutCubic),
    compare().opacity(0, 0.6, easeInOutCubic)
  );
});
