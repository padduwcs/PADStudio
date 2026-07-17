import {all, chain, createRef, createSignal, easeInOutCubic, tween, waitFor} from "@motion-canvas/core";
import {makeScene2D, Rect, Circle, Line, Txt, Layout} from "@motion-canvas/2d";

export default makeScene2D(function* (view) {
  const axis = createRef<Rect>();
  const leftShade = createRef<Rect>();
  const rightShade = createRef<Rect>();
  const focus = createRef<Rect>();
  const pointer = createRef<Circle>();
  const answer = createRef<Circle>();
  const answerText = createRef<Txt>();
  const title = createRef<Txt>();
  const hint = createRef<Txt>();

  const pointerX = createSignal(0);
  const pointerY = createSignal(0);
  const focusX = createSignal(0);
  const focusW = createSignal(0);
  const leftW = createSignal(0);
  const rightW = createSignal(0);
  const answerOpacity = createSignal(0);
  const pulse = createSignal(0);

  view.add(
    <Layout width={1080} height={1920} direction="column" justifyContent="space-between" alignItems="center" padding={90}>
      <Rect width={1080} height={1920} fill="#0B1020" />
      <Txt ref={title} text="đoán số" fontSize={44} fill="#9FB4FF" opacity={0.9} />

      <Layout width={900} height={980} direction="column" justifyContent="center" alignItems="center">
        <Rect ref={axis} width={900} height={8} radius={4} fill="#D7E0FF" opacity={0.35} />

        <Rect ref={leftShade} x={-225} y={0} width={leftW} height={76} radius={20} fill="#FF4D6D" opacity={0.22} />
        <Rect ref={rightShade} x={225} y={0} width={rightW} height={76} radius={20} fill="#3AE0A0" opacity={0.18} />
        <Rect ref={focus} x={focusX} y={0} width={focusW} height={92} radius={24} stroke="#F7D66B" lineWidth={6} fill="#F7D66B" opacity={0.12} />

        <Line points={[[-450, 0], [450, 0]]} stroke="#C7D2FE" lineWidth={6} endArrow={false} opacity={0.9} />
        {Array.from({ length: 21 }, (_, i) => {
          const x = -450 + i * 45;
          return <Rect key={`tick-${i}`} x={x} y={0} width={4} height={i % 5 === 0 ? 40 : 24} radius={2} fill="#E5ECFF" opacity={i % 5 === 0 ? 0.9 : 0.45} />;
        })}

        <Txt text="1" x={-450} y={64} fontSize={28} fill="#C7D2FE" opacity={0.9} />
        <Txt text="50" x={0} y={64} fontSize={30} fill="#F7D66B" opacity={0.95} />
        <Txt text="100" x={450} y={64} fontSize={28} fill="#C7D2FE" opacity={0.9} />

        <Circle ref={pointer} x={pointerX} y={pointerY} size={56} fill="#FFFFFF" stroke="#F7D66B" lineWidth={8} shadowBlur={20} shadowColor="#F7D66B" />
        <Txt text="50" x={pointerX} y={pointerY} fontSize={26} fill="#0B1020" fontWeight={700} opacity={0.95} />

        <Circle ref={answer} x={174} y={-132} size={64} fill="#3AE0A0" opacity={answerOpacity} />
        <Txt ref={answerText} text="73" x={174} y={-132} fontSize={30} fill="#062016" fontWeight={800} opacity={answerOpacity} />
      </Layout>

      <Txt ref={hint} text="mỗi câu trả lời cắt đôi phần còn lại" fontSize={38} fill="#E5ECFF" opacity={0.82} />
    </Layout>
  );

  pointerX(0);
  pointerY(-70);
  focusX(0);
  focusW(900);
  leftW(450);
  rightW(450);

  yield* chain(
    tween(0.9, t => {
      pulse(easeInOutCubic(Math.sin(t * Math.PI)));
    }),
    waitFor(0.15)
  );

  yield* all(
    title().opacity(1, 0.5),
    hint().opacity(0.85, 0.5),
    pointer().scale([1.08, 1.08], 0.5),
    waitFor(0.1)
  );
  yield* pointer().scale([1, 1], 0.35);
  yield* waitFor(1.25);

  yield* all(
    leftW(0, 1.5, easeInOutCubic),
    rightW(450, 1.5, easeInOutCubic),
    focusW(450, 1.5, easeInOutCubic),
    focusX(225, 1.5, easeInOutCubic),
    pointerX(225, 1.5, easeInOutCubic)
  );
  yield* waitFor(1.0);

  yield* all(
    title().text("chỉ giữ nửa có thể đúng", 0.4),
    hint().text("51 → 100", 0.4),
    pointer().fill("#F7D66B", 0.4),
    pointer().stroke("#FFFFFF", 0.4),
    pointerX(337.5, 1.3, easeInOutCubic),
    focusX(337.5, 1.3, easeInOutCubic),
    focusW(225, 1.3, easeInOutCubic)
  );
  yield* waitFor(1.1);

  yield* all(
    title().text("lại chia đôi tiếp", 0.35),
    hint().text("75 → 73", 0.35),
    pointerX(315, 1.2, easeInOutCubic),
    focusX(292.5, 1.2, easeInOutCubic),
    focusW(112.5, 1.2, easeInOutCubic)
  );
  yield* waitFor(0.5);

  yield* all(
    answerOpacity(1, 0.5),
    pointer().scale([1.18, 1.18], 0.35),
    pointer().shadowBlur(35, 0.35),
    hint().text("đây là 73", 0.3)
  );
  yield* pointer().scale([1, 1], 0.3);
  yield* waitFor(1.15);

  yield* all(
    focus().opacity(0.95, 0.4),
    answer().scale([1.12, 1.12], 0.4),
    answerText().scale([1.08, 1.08], 0.4)
  );
  yield* waitFor(0.9);
});
