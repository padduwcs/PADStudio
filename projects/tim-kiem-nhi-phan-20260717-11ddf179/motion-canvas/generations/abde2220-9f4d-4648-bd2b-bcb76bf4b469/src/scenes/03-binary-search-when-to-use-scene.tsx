import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, createSignal, tween, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  const note = createRef<Txt>();
  const row = createRef<Layout>();
  const sortedLabel = createRef<Txt>();
  const monotonicLabel = createRef<Txt>();
  const messyLabel = createRef<Txt>();
  const compareLabel = createRef<Txt>();
  const sortedPane = createRef<Rect>();
  const monotonicPane = createRef<Rect>();
  const messyPane = createRef<Rect>();
  const comparePane = createRef<Rect>();
  const leftMask = createRef<Rect>();
  const rightMask = createRef<Rect>();
  const midLine = createRef<Line>();
  const thresholdLine = createRef<Line>();
  const pointer = createRef<Circle>();
  const checkDot = createRef<Circle>();
  const targetDot = createRef<Circle>();
  const gate = createRef<Rect>();

  const phase = createSignal(0);
  const midX = createSignal(0);
  const thresholdX = createSignal(0);
  const pointerX = createSignal(-280);
  const targetX = createSignal(-250);
  const targetY = createSignal(0);
  const gateWidth = createSignal(540);
  const leftMaskW = createSignal(0);
  const rightMaskW = createSignal(0);
  const sortedOpacity = createSignal(1);
  const monoOpacity = createSignal(0);
  const messyOpacity = createSignal(0);
  const compareOpacity = createSignal(0);

  view.fill('#0b1020');
  view.add(
    <Rect width="100%" height="100%" fill="#0b1020">
      <Txt
        ref={title}
        text="KHI NÀO MỚI DÙNG?"
        y={-820}
        fontSize={54}
        fontWeight={800}
        fill="#f5f7ff"
        opacity={0}
      />
      <Txt
        ref={note}
        text="chỉ khi có thứ tự hoặc đơn điệu"
        y={-745}
        fontSize={30}
        fill="#9fb0ff"
        opacity={0}
      />

      <Layout y={-40} direction="column" gap={34} alignItems="center">
        <Rect ref={sortedPane} width={920} height={290} radius={34} fill="#111a33" stroke="#2a3c77" lineWidth={3} opacity={1}>
          <Txt ref={sortedLabel} text="CÓ THỨ TỰ" x={-350} y={-105} fontSize={26} fontWeight={700} fill="#9fb0ff" opacity={0.95} />
          <Layout ref={row} direction="row" gap={18} x={0} y={20} opacity={sortedOpacity}>
            {['12', '24', '40', '55', '68', '80', '91'].map((t, i) => (
              <Rect key={t} width={88} height={88} radius={18} fill={i === 3 ? '#4c7dff' : '#e8eeff'} opacity={i === 3 ? 1 : 0.96}>
                <Txt text={t} fontSize={34} fontWeight={800} fill={i === 3 ? '#ffffff' : '#0b1020'} />
              </Rect>
            ))}
          </Layout>
          <Line ref={midLine} points={[[-80, -10], [-80, 130]]} stroke="#7ce1ff" lineWidth={8} endArrow={true} opacity={0.95} x={midX} />
          <Circle ref={pointer} x={pointerX} y={112} size={34} fill="#7ce1ff" opacity={0.95} />
          <Rect ref={leftMask} x={-240} y={18} width={leftMaskW} height={118} fill="#0b1020" opacity={0.82} radius={18} />
          <Rect ref={rightMask} x={240} y={18} width={rightMaskW} height={118} fill="#0b1020" opacity={0.82} radius={18} />
        </Rect>

        <Rect ref={monotonicPane} width={920} height={290} radius={34} fill="#111a33" stroke="#2a3c77" lineWidth={3} opacity={0}>
          <Txt ref={monotonicLabel} text="ĐƠN ĐIỆU" x={-350} y={-105} fontSize={26} fontWeight={700} fill="#9fb0ff" opacity={0.95} />
          <Line points={[-320, 88, 320, 88]} stroke="#26345f" lineWidth={8} lineCap="round" opacity={0.8} />
          <Line points={[-240, 70, -110, 20, 10, -20, 110, -60, 250, -96]} stroke="#6df2b3" lineWidth={12} lineJoin="round" lineCap="round" />
          <Line ref={thresholdLine} points={[[0, 120], [0, -120]]} stroke="#ffcf5a" lineWidth={8} endArrow={true} x={thresholdX} />
          <Circle ref={checkDot} size={34} fill="#ffcf5a" x={thresholdX} y={-20} />
          <Txt text="AN TOÀN" x={-210} y={118} fontSize={24} fontWeight={700} fill="#6df2b3" opacity={0.95} />
          <Txt text="QUÁ TẢI" x={205} y={118} fontSize={24} fontWeight={700} fill="#ff7d88" opacity={0.95} />
        </Rect>

        <Rect ref={messyPane} width={920} height={290} radius={34} fill="#111a33" stroke="#2a3c77" lineWidth={3} opacity={0}>
          <Txt ref={messyLabel} text="LỘN XỘN" x={-350} y={-105} fontSize={26} fontWeight={700} fill="#9fb0ff" opacity={0.95} />
          <Layout direction="row" gap={16} y={14}>
            {['91', '12', '80', '24', '55', '40', '68'].map((t, i) => (
              <Rect key={t} width={82} height={82} radius={18} fill={i === 2 ? '#4c7dff' : '#e8eeff'} opacity={0.96} rotation={i % 2 === 0 ? -3 : 3}>
                <Txt text={t} fontSize={32} fontWeight={800} fill={i === 2 ? '#ffffff' : '#0b1020'} />
              </Rect>
            ))}
          </Layout>
          <Circle ref={targetDot} size={36} fill="#ff6d7a" x={targetX} y={targetY} opacity={1} />
          <Txt text="80" x={-250} y={112} fontSize={24} fontWeight={800} fill="#ff6d7a" opacity={0.95} />
          <Txt text="40" x={-10} y={112} fontSize={24} fontWeight={800} fill="#7ce1ff" opacity={0.95} />
          <Rect ref={gate} width={gateWidth} height={126} radius={20} stroke="#ff6d7a" lineWidth={5} fill={'#00000000'} opacity={0.85} />
        </Rect>

        <Rect ref={comparePane} width={920} height={290} radius={34} fill="#111a33" stroke="#2a3c77" lineWidth={3} opacity={0}>
          <Txt ref={compareLabel} text="KIỂM TRA GIỮA?" x={-330} y={-105} fontSize={26} fontWeight={700} fill="#9fb0ff" opacity={0.95} />
          <Rect x={-205} y={8} width={290} height={140} radius={28} fill="#17213f" stroke="#3a528f" lineWidth={3}>
            <Txt text="CÓ" y={-36} fontSize={30} fontWeight={800} fill="#6df2b3" />
            <Txt text="LOẠI AN TOÀN" y={12} fontSize={28} fontWeight={700} fill="#e8eeff" />
            <Txt text="1 NỬA" y={56} fontSize={28} fontWeight={700} fill="#e8eeff" />
          </Rect>
          <Rect x={205} y={8} width={290} height={140} radius={28} fill="#17213f" stroke="#3a528f" lineWidth={3}>
            <Txt text="KHÔNG" y={-36} fontSize={30} fontWeight={800} fill="#ff7d88" />
            <Txt text="KHÔNG DÙNG" y={12} fontSize={28} fontWeight={700} fill="#e8eeff" />
            <Txt text="BINARY" y={56} fontSize={28} fontWeight={700} fill="#e8eeff" />
          </Rect>
        </Rect>
      </Layout>
    </Rect>,
  );

  yield* all(
    title().opacity(1, 0.45),
    note().opacity(1, 0.45),
  );
  yield* waitFor(0.35);

  yield* all(
    phase(1, 0.1),
    pointerX(-40, 0.7, easeInOutCubic),
    leftMaskW(238, 0.7, easeInOutCubic),
    rightMaskW(238, 0.7, easeInOutCubic),
    midX(-80, 0.7, easeInOutCubic),
  );
  yield* waitFor(0.35);

  yield* all(
    sortedPane().opacity(0, 0.45),
    monotonicPane().opacity(1, 0.45),
    sortedLabel().opacity(0, 0.2),
    monotonicLabel().opacity(1, 0.2),
  );
  yield* all(
    thresholdX(180, 1.2, easeInOutCubic),
    checkDot().x(180, 1.2, easeInOutCubic),
  );
  yield* waitFor(0.35);

  yield* all(
    monotonicPane().opacity(0, 0.45),
    messyPane().opacity(1, 0.45),
    targetX(-210, 0.8, easeInOutCubic),
    gateWidth(390, 0.8, easeInOutCubic),
  );
  yield* waitFor(0.3);
  yield* all(
    targetDot().scale([1.3, 1.3], 0.25),
    targetDot().fill('#ffcf5a', 0.25),
  );
  yield* waitFor(0.3);
  yield* all(
    targetDot().scale([1, 1], 0.25),
    targetDot().fill('#ff6d7a', 0.25),
  );
  yield* waitFor(0.25);

  yield* all(
    messyPane().opacity(0, 0.45),
    comparePane().opacity(1, 0.45),
  );
  yield* waitFor(0.35);
  yield* chain(
    comparePane().scale([1.02, 1.02], 0.2),
    comparePane().scale([1, 1], 0.2),
  );
  yield* waitFor(0.45);
});
