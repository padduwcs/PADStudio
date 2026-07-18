import {makeScene2D, Rect, Circle, Line, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, easeInOutCubic, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const blue = '#3182F6';
  const yellow = '#F6C84C';
  const green = '#39C77A';
  const dark = '#10233F';
  const pale = '#EAF2FF';

  const outer = createRef<Rect>();
  const middle = createRef<Rect>();
  const inner = createRef<Rect>();
  const outerLid = createRef<Rect>();
  const middleLid = createRef<Rect>();
  const innerLid = createRef<Rect>();
  const pointer = createRef<Line>();
  const treasure = createRef<Circle>();
  const glow = createRef<Circle>();

  view.fill('#F7FAFF');
  view.add(
    <Layout width={900} height={1660}>
      <Circle
        ref={glow}
        position={[0, 465]}
        size={180}
        fill={'#FFE58A'}
        opacity={0}
      />

      <Rect
        ref={outer}
        position={[0, 0]}
        size={[760, 690]}
        radius={58}
        fill={blue}
        stroke={dark}
        lineWidth={12}
      />
      <Rect
        ref={outerLid}
        position={[0, -350]}
        size={[820, 105]}
        radius={35}
        fill={blue}
        stroke={dark}
        lineWidth={12}
      />

      <Rect
        ref={middle}
        position={[0, 45]}
        size={[470, 420]}
        radius={46}
        fill={yellow}
        stroke={dark}
        lineWidth={11}
        opacity={0}
      />
      <Rect
        ref={middleLid}
        position={[0, -175]}
        size={[510, 82]}
        radius={28}
        fill={yellow}
        stroke={dark}
        lineWidth={11}
        opacity={0}
      />

      <Rect
        ref={inner}
        position={[0, 78]}
        size={[245, 215]}
        radius={32}
        fill={yellow}
        stroke={dark}
        lineWidth={10}
        opacity={0}
      />
      <Rect
        ref={innerLid}
        position={[0, -40]}
        size={[275, 65]}
        radius={22}
        fill={yellow}
        stroke={dark}
        lineWidth={10}
        opacity={0}
      />

      <Circle
        ref={treasure}
        position={[0, 485]}
        size={70}
        fill={'#FFF4A8'}
        stroke={dark}
        lineWidth={9}
        opacity={0}
        scale={0.3}
      />

      <Line
        ref={pointer}
        points={[[360, -500], [235, -500]]}
        stroke={pale}
        lineWidth={24}
        endArrow
        arrowSize={38}
        opacity={0}
      />
    </Layout>,
  );

  // Beat 1 — lớp vỏ lớn trở nên trong để lộ cùng một hình dạng nhỏ hơn.
  yield* waitFor(1);
  yield* all(
    outer().opacity(0.24, 4, easeInOutCubic),
    outerLid().opacity(0.24, 4, easeInOutCubic),
    middle().opacity(1, 4, easeInOutCubic),
    middleLid().opacity(1, 4, easeInOutCubic),
    middle().scale(1.06, 4, easeInOutCubic),
    middleLid().scale(1.06, 4, easeInOutCubic),
  );
  yield* waitFor(7);

  // Beat 2 — mở từng lớp và tiến sâu vào cùng một cấu trúc.
  yield* chain(
    all(
      outerLid().rotation(-16, 2, easeInOutCubic),
      outerLid().y(-415, 2, easeInOutCubic),
      middle().fill(blue, 2),
      middleLid().fill(blue, 2),
    ),
    waitFor(1),
    all(
      middleLid().rotation(-16, 2, easeInOutCubic),
      middleLid().y(-245, 2, easeInOutCubic),
      inner().opacity(1, 2, easeInOutCubic),
      innerLid().opacity(1, 2, easeInOutCubic),
      outer().scale(1.12, 2, easeInOutCubic),
      outerLid().scale(1.12, 2, easeInOutCubic),
    ),
    waitFor(1),
    all(
      inner().fill(blue, 2),
      innerLid().fill(blue, 2),
      inner().scale(1.18, 2, easeInOutCubic),
      innerLid().scale(1.18, 2, easeInOutCubic),
      outer().opacity(0.1, 2),
      middle().opacity(0.34, 2),
    ),
    waitFor(4),
  );

  // Beat 3 — ba kích thước tách ra; cùng một động tác mở được lặp lại.
  outerLid().rotation(0);
  middleLid().rotation(0);
  innerLid().rotation(0);
  yield* all(
    outer().position([0, -520], 3, easeInOutCubic),
    outerLid().position([0, -735], 3, easeInOutCubic),
    outer().scale(0.56, 3, easeInOutCubic),
    outerLid().scale(0.56, 3, easeInOutCubic),
    outer().opacity(1, 3),
    outerLid().opacity(1, 3),
    outer().fill(yellow, 3),
    outerLid().fill(yellow, 3),
    middle().position([0, 0], 3, easeInOutCubic),
    middleLid().position([0, -175], 3, easeInOutCubic),
    middle().scale(0.78, 3, easeInOutCubic),
    middleLid().scale(0.78, 3, easeInOutCubic),
    middle().opacity(1, 3),
    middle().fill(yellow, 3),
    middleLid().fill(yellow, 3),
    inner().position([0, 470], 3, easeInOutCubic),
    innerLid().position([0, 345], 3, easeInOutCubic),
    inner().scale(1.12, 3, easeInOutCubic),
    innerLid().scale(1.12, 3, easeInOutCubic),
    inner().fill(yellow, 3),
    innerLid().fill(yellow, 3),
  );

  yield* sequence(
    2.5,
    chain(
      all(
        pointer().opacity(1, 0.35),
        pointer().position([0, 0], 0.35),
        outer().fill(blue, 0.35),
        outerLid().fill(blue, 0.35),
      ),
      outerLid().rotation(-18, 1.3, easeInOutCubic),
      all(pointer().opacity(0, 0.35), outer().fill(yellow, 0.35), outerLid().fill(yellow, 0.35)),
    ),
    chain(
      all(
        pointer().opacity(1, 0.35),
        pointer().position([0, 500], 0.35),
        middle().fill(blue, 0.35),
        middleLid().fill(blue, 0.35),
      ),
      middleLid().rotation(-18, 1.3, easeInOutCubic),
      all(pointer().opacity(0, 0.35), middle().fill(yellow, 0.35), middleLid().fill(yellow, 0.35)),
    ),
    chain(
      all(
        pointer().opacity(1, 0.35),
        pointer().position([0, 970], 0.35),
        inner().fill(blue, 0.35),
        innerLid().fill(blue, 0.35),
      ),
      innerLid().rotation(-18, 1.3, easeInOutCubic),
      pointer().opacity(0, 0.35),
    ),
  );
  yield* waitFor(3);

  // Beat 4 — hộp cuối không còn hộp con: vật cần lấy xuất hiện và chuyển sang hoàn tất.
  yield* all(
    outer().opacity(0.13, 2),
    outerLid().opacity(0.13, 2),
    middle().opacity(0.18, 2),
    middleLid().opacity(0.18, 2),
    inner().fill(blue, 2),
    innerLid().fill(blue, 2),
  );
  yield* all(
    innerLid().y(285, 3, easeInOutCubic),
    innerLid().rotation(-24, 3, easeInOutCubic),
    treasure().opacity(1, 3, easeInOutCubic),
    treasure().scale(1, 3, easeInOutCubic),
  );
  yield* all(
    inner().fill(green, 3, easeInOutCubic),
    innerLid().fill(green, 3, easeInOutCubic),
    treasure().fill('#FFFFFF', 3, easeInOutCubic),
  );
  yield* all(
    glow().opacity(0.55, 1, easeInOutCubic),
    glow().scale(1.5, 2, easeInOutCubic),
    treasure().scale(1.18, 1, easeInOutCubic).to(1, 1, easeInOutCubic),
  );
  yield* waitFor(3);
});
