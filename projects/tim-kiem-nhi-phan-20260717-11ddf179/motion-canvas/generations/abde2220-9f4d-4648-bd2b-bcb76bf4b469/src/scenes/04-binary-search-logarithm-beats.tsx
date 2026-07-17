import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, createSignal, tween, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const left = createRef<Rect>();
  const right = createRef<Rect>();
  const bar = createRef<Rect>();
  const bars = Array.from({length: 4}, () => createRef<Rect>());
  const grid = createRef<Layout>();
  const probe = createRef<Circle>();
  const eq1 = createRef<Txt>();
  const eq2 = createRef<Txt>();
  const nBox = createRef<Rect>();
  const twoNBox = createRef<Rect>();
  const nLabel = createRef<Txt>();
  const twoNLabel = createRef<Txt>();
  const steps = createSignal(0);
  const cut = createSignal(0);
  const keep = createSignal(1);
  const sweep = createSignal(0);
  const focus = createSignal(0);

  view.fill('#08111f');

  view.add(
    <Layout width={1080} height={1920} direction="column" justifyContent="space-between" padding={80}>
      <Layout ref={grid} width={920} height={900} direction="column" justifyContent="space-between">
        <Rect ref={bars[0]} width={920} height={140} radius={28} fill="#1b2840" />
        <Rect ref={bars[1]} width={690} height={140} radius={28} fill="#142033" opacity={0.95} />
        <Rect ref={bars[2]} width={460} height={140} radius={28} fill="#10192a" opacity={0.9} />
        <Rect ref={bars[3]} width={230} height={140} radius={28} fill="#0d1523" opacity={0.85} />
      </Layout>

      <Layout width={920} height={560} direction="column" justifyContent="space-between" alignItems="center">
        <Layout width={920} height={260} justifyContent="space-between" alignItems="center">
          <Rect ref={nBox} width={380} height={220} radius={36} fill="#12213a" lineWidth={4} stroke="#4ee1ff" />
          <Rect ref={twoNBox} width={420} height={220} radius={36} fill="#151827" lineWidth={4} stroke="#ff9f43" />
        </Layout>
        <Layout width={920} height={220} justifyContent="space-between" alignItems="center">
          <Txt ref={eq1} text={'2^k ≈ n'} fontSize={72} fontWeight={800} fill="#d7f8ff" />
          <Txt ref={eq2} text={'k ≈ log₂(n)'} fontSize={72} fontWeight={800} fill="#ffd9b0" />
        </Layout>
      </Layout>

      <Layout width={920} height={280} direction="column" justifyContent="space-between" alignItems="center">
        <Rect ref={bar} width={920} height={140} radius={28} fill="#11213a" />
        <Circle ref={probe} x={0} y={0} size={58} fill="#ffffff" opacity={0.95} />
        <Layout width={920} height={120} justifyContent="space-between" alignItems="center">
          <Txt ref={nLabel} text={'n'} fontSize={54} fontWeight={700} fill="#7fd8ff" />
          <Txt ref={twoNLabel} text={'2n'} fontSize={54} fontWeight={700} fill="#ffb25f" />
        </Layout>
      </Layout>
    </Layout>
  );

  const showBars = function* () {
    yield* bars[0]().fill('#2a3d63', 0.25, easeInOutCubic);
    yield* all(
      bars[1]().x(-115, 0.25, easeInOutCubic),
      bars[2]().x(-230, 0.25, easeInOutCubic),
      bars[3]().x(-345, 0.25, easeInOutCubic),
    );
    yield* all(
      bars[1]().width(690, 0.15),
      bars[2]().width(460, 0.15),
      bars[3]().width(230, 0.15),
    );
  };

  yield* chain(
    showBars(),
    tween(1.2, v => { cut(v * 3); }),
    waitFor(0.2),
    tween(1.3, v => { keep(1 - 0.2 * v); }),
    waitFor(0.2),
    tween(1.2, v => { sweep(v); }),
    waitFor(0.2),
    tween(1.2, v => { focus(v); }),
  );

  yield* sequence(
    0.15,
    bars[0]().scale([1, 1.05], 0.12, easeInOutCubic),
    bars[1]().scale([1, 1.05], 0.12, easeInOutCubic),
    bars[2]().scale([1, 1.05], 0.12, easeInOutCubic),
    bars[3]().scale([1, 1.05], 0.12, easeInOutCubic),
  );

  yield* all(
    nBox().scale([1, 1], 0.01),
    twoNBox().scale([1, 1], 0.01),
    eq1().opacity(1, 0.01),
    eq2().opacity(1, 0.01),
    probe().opacity(1, 0.01),
  );

  yield* chain(
    tween(0.9, v => { steps(v * 1.5); }),
    tween(0.9, v => { steps(1.5 + v * 1.5); }),
    tween(0.9, v => { steps(3 + v * 1.5); }),
    tween(0.9, v => { steps(4.5 + v * 1.5); }),
  );

  yield* all(
    nBox().x(-220, 0.35, easeInOutCubic),
    twoNBox().x(220, 0.35, easeInOutCubic),
  );

  yield* chain(
    tween(1.0, v => { cut(3 - v * 2.25); }),
    tween(1.0, v => { cut(0.75 - v * 0.5); }),
    tween(1.0, v => { keep(0.8 + 0.2 * v); }),
  );

  yield* all(
    probe().x(-290, 0.35, easeInOutCubic),
    probe().size(72, 0.35, easeInOutCubic),
  );

  yield* chain(
    tween(1.0, v => { sweep(v); }),
    tween(1.0, v => { focus(v); }),
    waitFor(0.5),
  );
});
