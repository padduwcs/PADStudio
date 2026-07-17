import {Circle, Layout, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const bg = '#090D1A';
  const panel = '#151C31';
  const dim = '#2A324B';
  const cyan = '#42E8E0';
  const yellow = '#FFD65A';
  const white = '#F7FAFF';

  view.fill(bg);

  const header = createRef<Txt>();
  const bars = createRef<Rect>();
  const barWidths = [840, 420, 210, 105].map(() => createSignal(0));
  const barRefs = [0, 1, 2, 3].map(() => createRef<Rect>());
  const labels = ['n', 'n/2', 'n/4', 'n/8'];

  const tiers = createRef<Rect>();
  const tierRows = [0, 1, 2, 3].map(() => createRef<Layout>());
  const tierCells = Array.from({length: 4}, () =>
    Array.from({length: 16}, () => createRef<Rect>()),
  );
  const cursor = createRef<Circle>();
  const litCounts = [16, 8, 4, 2];

  const formula = createRef<Rect>();
  const formulaA = createRef<Txt>();
  const formulaB = createRef<Txt>();
  const link = createRef<Line>();

  const compare = createRef<Rect>();
  const nWidth = createSignal(380);
  const doubleWidth = createSignal(760);
  const doubleLabel = createRef<Txt>();
  const badge = createRef<Rect>();

  view.add(
    <>
      <Txt
        ref={header}
        y={-780}
        text={'PHẠM VI CÒN LẠI'}
        fill={white}
        fontFamily={'Arial'}
        fontSize={58}
        fontWeight={800}
        opacity={0}
      />

      <Rect ref={bars} width={920} height={720} y={40} opacity={0}>
        {barRefs.map((ref, i) => (
          <Rect
            key={'bar-' + String(i)}
            ref={ref}
            y={-240 + i * 165}
            width={barWidths[i]}
            height={94}
            radius={22}
            fill={i === 3 ? yellow : cyan}
            shadowColor={'#00000088'}
            shadowBlur={18}
          >
            <Txt
              text={labels[i]}
              x={i === 0 ? -360 : -Math.max(70, 360 / Math.pow(2, i))}
              fill={white}
              fontFamily={'Arial'}
              fontSize={42}
              fontWeight={700}
            />
          </Rect>
        ))}
      </Rect>

      <Rect ref={tiers} width={950} height={760} y={20} opacity={0}>
        {tierRows.map((rowRef, row) => (
          <Layout
            key={'tier-' + String(row)}
            ref={rowRef}
            layout
            direction={'row'}
            gap={10}
            y={-235 + row * 155}
          >
            {tierCells[row].map((cellRef, cell) => (
              <Rect
                key={'cell-' + String(row) + '-' + String(cell)}
                ref={cellRef}
                width={44}
                height={88}
                radius={12}
                fill={cell < litCounts[row] ? cyan : dim}
                opacity={0}
              />
            ))}
          </Layout>
        ))}
        <Circle
          ref={cursor}
          x={-455}
          y={-235}
          width={24}
          height={24}
          fill={yellow}
          shadowColor={yellow}
          shadowBlur={20}
        />
      </Rect>

      <Rect ref={formula} y={585} width={880} height={310} opacity={0}>
        <Txt
          ref={formulaA}
          y={-78}
          text={'n / 2ᵏ ≈ 1   →   2ᵏ ≈ n'}
          fill={cyan}
          fontFamily={'Arial'}
          fontSize={55}
          fontWeight={700}
          opacity={0}
        />
        <Line
          ref={link}
          points={[[-260, 4], [260, 4]]}
          stroke={yellow}
          lineWidth={8}
          end={0}
          endArrow
        />
        <Txt
          ref={formulaB}
          y={94}
          text={'k ≈ log₂(n)'}
          fill={yellow}
          fontFamily={'Arial'}
          fontSize={72}
          fontWeight={800}
          opacity={0}
        />
      </Rect>

      <Rect ref={compare} width={940} height={900} y={40} opacity={0}>
        <Txt
          text={'n'}
          x={-410}
          y={-190}
          fill={white}
          fontFamily={'Arial'}
          fontSize={48}
          fontWeight={800}
        />
        <Rect y={-190} width={nWidth} height={120} radius={26} fill={cyan} />

        <Txt
          ref={doubleLabel}
          text={'2n'}
          x={-410}
          y={80}
          fill={white}
          fontFamily={'Arial'}
          fontSize={48}
          fontWeight={800}
        />
        <Rect y={80} width={doubleWidth} height={120} radius={26} fill={yellow} />

        <Rect
          ref={badge}
          y={360}
          width={420}
          height={150}
          radius={75}
          fill={panel}
          stroke={yellow}
          lineWidth={7}
          opacity={0}
          scale={[0.7, 0.7]}
        >
          <Txt
            text={'+ 1 bước'}
            fill={yellow}
            fontFamily={'Arial'}
            fontSize={58}
            fontWeight={800}
          />
        </Rect>
      </Rect>
    </>,
  );

  yield* all(
    header().opacity(1, 0.4),
    bars().opacity(1, 0.4),
    barWidths[0](840, 0.7, easeInOutCubic),
  );
  for (let i = 1; i < 4; i++) {
    yield* all(
      barRefs[i - 1]().opacity(0.28, 0.45),
      barWidths[i](840 / Math.pow(2, i), 0.9, easeInOutCubic),
    );
  }
  yield* waitFor(2.6);

  header().text('MỖI TẦNG GIỮ LẠI 1/2');
  yield* all(bars().opacity(0, 0.5), tiers().opacity(1, 0.5));
  for (let row = 0; row < 4; row++) {
    yield* all(
      cursor().y(-235 + row * 155, 0.85, easeInOutCubic),
      ...tierCells[row].map((cell, index) =>
        cell().opacity(index < litCounts[row] ? 1 : 0.16, 0.85),
      ),
    );
  }
  yield* chain(
    tierRows[3]().scale([1.08, 1.08], 0.55, easeInOutCubic),
    tierRows[3]().scale([1, 1], 0.55, easeInOutCubic),
  );
  yield* waitFor(2);

  header().text('CHIA ĐẾN KHI CÒN 1');
  yield* formula().opacity(1, 0.5);
  for (let row = 0; row < 4; row++) {
    yield* chain(
      tierRows[row]().scale([1.05, 1.05], 0.25, easeInOutCubic),
      tierRows[row]().scale([1, 1], 0.25, easeInOutCubic),
    );
  }
  yield* formulaA().opacity(1, 0.8);
  yield* link().end(1, 0.8, easeInOutCubic);
  yield* formulaB().opacity(1, 0.8);
  yield* waitFor(2.1);

  header().text('GẤP ĐÔI DỮ LIỆU');
  yield* all(
    tiers().opacity(0, 0.6),
    formula().opacity(0, 0.6),
    compare().opacity(1, 0.6),
  );
  yield* doubleWidth(380, 0.9, easeInOutCubic);
  doubleLabel().text('n');
  for (let i = 0; i < 4; i++) {
    yield* all(
      nWidth(380 / Math.pow(2, i + 1), 0.65, easeInOutCubic),
      doubleWidth(380 / Math.pow(2, i + 1), 0.65, easeInOutCubic),
    );
  }
  yield* all(
    badge().opacity(1, 0.8),
    badge().scale([1, 1], 0.8, easeInOutCubic),
  );
  yield* waitFor(2.1);
});
