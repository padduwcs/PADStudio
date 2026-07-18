import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, createRef, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const blue = '#3B82F6';
  const yellow = '#F6C453';
  const green = '#35C77A';
  const ink = '#17324D';
  const pale = '#EAF2F8';
  const boxGroup = createRef<Rect>();
  const outer = createRef<Rect>();
  const inner1 = createRef<Rect>();
  const inner2 = createRef<Rect>();
  const inner3 = createRef<Rect>();
  const firstCount = createRef<Circle>();
  const lastGroup = createRef<Rect>();
  const lastBox = createRef<Rect>();
  const lastCount = createRef<Circle>();
  const stairs = createRef<Rect>();
  const summary = createRef<Rect>();
  const finished = createRef<Rect>();
  const pathDot = createRef<Circle>();

  const stairBoxes = [createRef<Rect>(), createRef<Rect>(), createRef<Rect>(), createRef<Rect>()];
  const stairCounts = [
    [createRef<Circle>()],
    [createRef<Circle>(), createRef<Circle>()],
    [createRef<Circle>(), createRef<Circle>(), createRef<Circle>()],
    [createRef<Circle>(), createRef<Circle>(), createRef<Circle>(), createRef<Circle>()],
  ];

  view.fill('#F7FBFE');
  view.add(
    <>
      <Rect ref={boxGroup} width={850} height={1050} y={-180} opacity={0}>
        <Rect ref={outer} width={760} height={920} radius={42} lineWidth={18} stroke={ink} fill={pale}/>
        <Rect ref={inner1} width={590} height={700} radius={36} lineWidth={16} stroke={ink} fill={yellow}/>
        <Rect ref={inner2} width={420} height={490} radius={30} lineWidth={14} stroke={ink} fill={yellow}/>
        <Rect ref={inner3} width={245} height={275} radius={24} lineWidth={12} stroke={ink} fill={yellow}/>
        <Circle ref={firstCount} x={315} y={-390} width={74} height={74} fill={blue} stroke={'#FFFFFF'} lineWidth={10} opacity={0}/>
      </Rect>

      <Rect ref={lastGroup} width={850} height={900} y={-120} opacity={0}>
        <Rect ref={lastBox} width={340} height={380} radius={34} lineWidth={16} stroke={ink} fill={blue}/>
        <Line points={[[-125, -70], [0, 35], [125, -70]]} stroke={'#FFFFFF'} lineWidth={16} lineCap={'round'}/>
        <Circle ref={lastCount} x={300} width={92} height={92} fill={green} stroke={ink} lineWidth={10} opacity={0}/>
      </Rect>

      <Rect ref={stairs} width={940} height={1450} opacity={0}>
        {stairBoxes.map((box, i) => {
          const y = -480 + i * 320;
          const size = 190 + i * 70;
          return (
            <Rect key={String(i)} ref={box} x={-270 + i * 45} y={y} width={size} height={210} radius={26} lineWidth={12} stroke={ink} fill={yellow}>
              {stairCounts[i].map((dot, j) => (
                <Circle key={String(j)} ref={dot} x={310 + j * 70 - i * 18} width={54} height={54} fill={green} opacity={0}/>
              ))}
            </Rect>
          );
        })}
        <Line points={[[0, -370], [45, -160], [90, 160], [135, 480]]} stroke={ink} lineWidth={10} endArrow arrowSize={24} opacity={0.28}/>
      </Rect>

      <Rect ref={summary} width={940} height={1500} opacity={0}>
        <Rect y={-500} width={810} height={330} radius={38} fill={'#E8F2FF'}>
          <Rect x={-190} width={250} height={230} radius={28} stroke={blue} lineWidth={15}/>
          <Rect x={210} width={150} height={140} radius={22} stroke={blue} lineWidth={15}/>
          <Line points={[[-45, 0], [115, 0]]} stroke={ink} lineWidth={9} endArrow arrowSize={22}/>
        </Rect>
        <Rect y={0} width={810} height={330} radius={38} fill={'#FFF6D9'}>
          {[0, 1, 2, 3].map(i => (
            <Rect key={String(i)} x={-260 + i * 175} width={230 - i * 42} height={230 - i * 42} radius={24} stroke={yellow} lineWidth={14}/>
          ))}
          <Line points={[[-340, 135], [340, 135]]} stroke={ink} lineWidth={9} endArrow arrowSize={22}/>
        </Rect>
        <Rect y={500} width={810} height={330} radius={38} fill={'#E4F8EC'}>
          <Rect width={260} height={230} radius={28} stroke={green} fill={green} lineWidth={15}/>
          <Circle width={34} height={34} fill={'#FFFFFF'}/>
        </Rect>
        <Line points={[[390, -500], [440, 0], [390, 500]]} stroke={ink} lineWidth={8} opacity={0.22}/>
        <Circle ref={pathDot} x={390} y={-500} width={54} height={54} fill={blue}/>
      </Rect>

      <Rect ref={finished} width={760} height={920} radius={44} lineWidth={18} stroke={ink} fill={green} opacity={0} scale={0.82}>
        <Rect width={590} height={700} radius={36} lineWidth={15} stroke={'#FFFFFF'} opacity={0.9}/>
        <Rect width={420} height={490} radius={30} lineWidth={13} stroke={'#FFFFFF'} opacity={0.9}/>
        <Rect width={245} height={275} radius={24} lineWidth={11} stroke={'#FFFFFF'} opacity={0.9}/>
        <Txt text={'4'} fontSize={126} fontWeight={800} fill={'#FFFFFF'}/>
      </Rect>
    </>,
  );

  // Beat 1 — một hộp hiện tại, phần bên trong còn chờ.
  yield* boxGroup().opacity(1, 2, easeInOutCubic);
  yield* outer().fill(blue, 2, easeInOutCubic);
  yield* all(
    firstCount().opacity(1, 1),
    firstCount().position([390, -500], 3, easeInOutCubic),
  );
  yield* all(
    outer().fill(yellow, 3, easeInOutCubic),
    inner1().fill(blue, 3, easeInOutCubic),
    inner2().fill('#DCEBFF', 3),
    inner3().fill('#DCEBFF', 3),
  );
  yield* waitFor(2);

  // Beat 2 — hộp cuối là trường hợp dừng.
  yield* all(boxGroup().opacity(0, 2), lastGroup().opacity(1, 2));
  yield* lastBox().fill(green, 3, easeInOutCubic);
  yield* all(lastCount().opacity(1, 2), lastCount().scale([1.18, 1.18], 1).to([1, 1], 1));
  yield* waitFor(4);

  // Beat 3 — quay ra ngoài, kết quả tăng từ một đến bốn.
  yield* all(lastGroup().opacity(0, 2), stairs().opacity(1, 2));
  for (let i = 0; i < 4; i++) {
    yield* all(
      stairBoxes[i]().fill(green, 2.25, easeInOutCubic),
      ...stairCounts[i].map(dot => dot().opacity(1, 2.25, easeInOutCubic)),
    );
  }
  yield* waitFor(2);

  // Beat 4 — cùng dạng, nhỏ dần, có điểm dừng, rồi hoàn tất.
  yield* all(stairs().opacity(0, 2), summary().opacity(1, 2));
  yield* all(pathDot().position([390, -500], 3), pathDot().fill(blue, 3));
  yield* pathDot().position([440, 0], 3, easeInOutCubic);
  yield* all(pathDot().position([390, 500], 2, easeInOutCubic), pathDot().fill(green, 2));
  yield* chain(
    pathDot().position([440, 0], 1, easeInOutCubic),
    pathDot().position([390, -500], 1, easeInOutCubic),
    all(summary().opacity(0, 1), finished().opacity(1, 1), finished().scale([1, 1], 1, easeInOutCubic)),
  );
});
