import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, createRef, createSignal, tween, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  const hint = createRef<Txt>();
  const panel = createRef<Rect>();
  const bars = Array.from({length: 4}, () => createRef<Rect>());
  const barFills = Array.from({length: 4}, () => createRef<Rect>());
  const barTexts = Array.from({length: 4}, () => createRef<Txt>());
  const pointer = createRef<Circle>();
  const pointerLabel = createRef<Txt>();
  const leftCard = createRef<Rect>();
  const rightCard = createRef<Rect>();
  const formula = createRef<Rect>();
  const f1 = createRef<Txt>();
  const f2 = createRef<Txt>();
  const compareTag = createRef<Txt>();
  const stepCount = createSignal(0);
  const cut = createSignal(0);

  view.fill('#07111f');
  view.add(
    <Layout width={'100%'} height={'100%'} direction={'column'} justifyContent={'start'} alignItems={'center'} gap={40}>
      <Txt ref={title} text={'Mỗi lần kiểm tra, loại chắc một nửa'} y={140} fontSize={54} fontWeight={800} fill={'#f6f7fb'} opacity={0} />
      <Txt ref={hint} text={'n → n/2 → n/4 → n/8'} y={210} fontSize={34} fontWeight={700} fill={'#8ea2c7'} opacity={0} />

      <Rect ref={panel} width={920} height={1120} radius={36} fill={'#0c1728'} stroke={'#20324f'} lineWidth={4} y={110} opacity={0}>
        <Layout width={'100%'} height={'100%'} direction={'column'} justifyContent={'space-evenly'} alignItems={'center'} padding={50}>
          <Rect ref={bars[0]} width={760} height={120} radius={24} fill={'#16233a'} opacity={1}>
            <Rect ref={barFills[0]} width={760} height={120} radius={24} fill={'#48d4ff'} opacity={0.95} alignSelf={'start'} />
            <Txt ref={barTexts[0]} text={'n'} fontSize={40} fontWeight={800} fill={'#07111f'} />
          </Rect>
          <Rect ref={bars[1]} width={760} height={120} radius={24} fill={'#16233a'} opacity={0.85}>
            <Rect ref={barFills[1]} width={380} height={120} radius={24} fill={'#5af09a'} opacity={0.95} alignSelf={'start'} />
            <Txt ref={barTexts[1]} text={'n/2'} fontSize={40} fontWeight={800} fill={'#07111f'} />
          </Rect>
          <Rect ref={bars[2]} width={760} height={120} radius={24} fill={'#16233a'} opacity={0.7}>
            <Rect ref={barFills[2]} width={190} height={120} radius={24} fill={'#ffd166'} opacity={0.95} alignSelf={'start'} />
            <Txt ref={barTexts[2]} text={'n/4'} fontSize={40} fontWeight={800} fill={'#07111f'} />
          </Rect>
          <Rect ref={bars[3]} width={760} height={120} radius={24} fill={'#16233a'} opacity={0.55}>
            <Rect ref={barFills[3]} width={95} height={120} radius={24} fill={'#ff7a90'} opacity={0.95} alignSelf={'start'} />
            <Txt ref={barTexts[3]} text={'n/8'} fontSize={40} fontWeight={800} fill={'#07111f'} />
          </Rect>
        </Layout>
      </Rect>

      <Circle ref={pointer} x={0} y={340} size={26} fill={'#ffffff'} opacity={0} />
      <Txt ref={pointerLabel} text={'chỉ giữ phần còn sáng'} y={385} fontSize={28} fontWeight={700} fill={'#c9d7ee'} opacity={0} />

      <Layout y={760} width={'100%'} height={470} direction={'row'} justifyContent={'center'} alignItems={'center'} gap={34}>
        <Rect ref={leftCard} width={360} height={360} radius={32} fill={'#0c1728'} stroke={'#30496f'} lineWidth={4} opacity={0}>
          <Txt text={'n'} fontSize={66} fontWeight={900} fill={'#48d4ff'} y={-72} />
          <Txt text={'↓ /2'} fontSize={42} fontWeight={800} fill={'#8ea2c7'} y={-10} />
          <Txt text={'↓ /2'} fontSize={42} fontWeight={800} fill={'#8ea2c7'} y={56} />
          <Txt text={'↓ /2'} fontSize={42} fontWeight={800} fill={'#8ea2c7'} y={122} />
        </Rect>
        <Rect ref={rightCard} width={360} height={360} radius={32} fill={'#0c1728'} stroke={'#30496f'} lineWidth={4} opacity={0}>
          <Txt ref={f1} text={'n / 2^k'} fontSize={56} fontWeight={900} fill={'#5af09a'} y={-60} opacity={1} />
          <Txt ref={f2} text={'→ 1'} fontSize={56} fontWeight={900} fill={'#ffd166'} y={10} opacity={0} />
          <Txt text={'k ≈ log₂(n)'} fontSize={40} fontWeight={800} fill={'#f6f7fb'} y={105} opacity={0.9} />
        </Rect>
      </Layout>

      <Rect ref={formula} y={1320} width={940} height={250} radius={30} fill={'#101d33'} stroke={'#2c4569'} lineWidth={4} opacity={0}>
        <Txt text={'2^k ≈ n   →   k ≈ log₂(n)'} fontSize={54} fontWeight={900} fill={'#f6f7fb'} />
        <Txt ref={compareTag} text={'2n chỉ thêm 1 lần kiểm tra'} y={78} fontSize={32} fontWeight={800} fill={'#8ea2c7'} opacity={0} />
      </Rect>
    </Layout>,
  );

  yield* all(
    title().opacity(1, 0.6),
    hint().opacity(1, 0.6),
    panel().opacity(1, 0.6),
  );

  yield* waitFor(0.4);

  yield* all(bars[0]().opacity(1, 0.5), barFills[0]().width(760, 0.5));
  yield* waitFor(0.2);
  yield* all(bars[1]().opacity(1, 0.5), barFills[1]().width(380, 0.5));
  yield* waitFor(0.2);
  yield* all(bars[2]().opacity(1, 0.5), barFills[2]().width(190, 0.5));
  yield* waitFor(0.2);
  yield* all(bars[3]().opacity(1, 0.5), barFills[3]().width(95, 0.5));

  yield* waitFor(0.6);

  yield* all(pointer().opacity(1, 0.4), pointerLabel().opacity(1, 0.4));
  yield* tween(5.7, (t) => {
    const p = easeInOutCubic(t);
    const row = Math.min(3, Math.floor(p * 4));
    const local = p * 4 - row;
    pointer().y(340 + row * 158 + local * 18);
    stepCount(row + local);
    cut(p);
    const alive = [1, 0.5, 0.25, 0.125];
    for (let i = 0; i < 4; i++) {
      barFills[i]().opacity(i <= row ? 0.95 : 0.18);
      if (i === row) barFills[i]().width(760 * alive[i] * (1 - local * 0.15));
    }
  });

  yield* waitFor(0.3);

  yield* all(
    leftCard().opacity(1, 0.5),
    rightCard().opacity(1, 0.5),
  );
  yield* waitFor(0.35);
  yield* f2().opacity(1, 0.5);
  yield* waitFor(0.25);
  yield* all(f1().fill('#ffd166', 0.5), f2().fill('#48d4ff', 0.5));
  yield* waitFor(0.25);
  yield* formula().opacity(1, 0.5);
  yield* all(
    compareTag().opacity(1, 0.5),
    title().text('Muốn còn 1 phần tử, phải chia đôi đến khi đủ nhỏ', 0.5),
  );
  yield* waitFor(0.5);

  yield* all(
    leftCard().x(-210, 0.8),
    rightCard().x(210, 0.8),
    formula().y(1380, 0.8),
  );
  const nBox = createRef<Rect>();
  const twoNBox = createRef<Rect>();
  const bridge = createRef<Line>();
  view.add(
    <Layout y={1600} width={960} height={250} direction={'row'} justifyContent={'center'} alignItems={'center'} gap={42}>
      <Rect ref={nBox} width={300} height={160} radius={24} fill={'#16233a'} stroke={'#48d4ff'} lineWidth={4} opacity={0}>
        <Txt text={'n'} fontSize={70} fontWeight={900} fill={'#48d4ff'} />
      </Rect>
      <Line ref={bridge} points={[[-46, 0], [46, 0]]} stroke={'#8ea2c7'} lineWidth={8} endArrow={true} opacity={0} />
      <Rect ref={twoNBox} width={300} height={160} radius={24} fill={'#16233a'} stroke={'#ffd166'} lineWidth={4} opacity={0}>
        <Txt text={'2n'} fontSize={70} fontWeight={900} fill={'#ffd166'} />
      </Rect>
    </Layout>,
  );
  yield* all(
    nBox().opacity(1, 0.5),
    bridge().opacity(1, 0.5),
    twoNBox().opacity(1, 0.5),
  );
  yield* waitFor(0.1);
  yield* all(nBox().scale([1, 1], 0.01), twoNBox().scale([1, 1], 0.01));
  yield* waitFor(0.2);
  yield* all(
    twoNBox().x(40, 0.5),
    compareTag().text('gấp đôi dữ liệu → thêm 1 nhịp chia đôi', 0.01),
  );
  yield* waitFor(0.2);
  yield* all(title().fill('#ffffff', 0.5), hint().opacity(0.85, 0.5));

  yield* waitFor(1.5);
});
