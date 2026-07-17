import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, easeInOutCubic, tween, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#081018');

  const titleRef = createRef<Txt>();
  const subtitleRef = createRef<Txt>();
  const leftPane = createRef<Layout>();
  const rightPane = createRef<Layout>();
  const arrowRef = createRef<Line>();
  const questionRef = createRef<Circle>();
  const checkRef = createRef<Circle>();
  const unsafeRef = createRef<Rect>();
  const safeRef = createRef<Rect>();
  const midTagRef = createRef<Rect>();
  const midTextRef = createRef<Txt>();
  const verdictRef = createRef<Txt>();
  const monoRef = createRef<Txt>();

  const step = createSignal(0);
  const dim = createSignal(0.22);
  const split = createSignal(0);
  const arrowX = createSignal(0);
  const pulse = createSignal(0);

  const sorted = ['12', '19', '27', '41', '58', '73', '89'];
  const unsorted = ['60', '15', '80', '40', '92', '21', '55'];

  view.add(
    <Layout direction={'column'} gap={34} width={1080} height={1920} padding={72} alignItems={'center'}>
      <Layout direction={'column'} gap={16} alignItems={'center'}>
        <Txt
          ref={titleRef}
          text={'KHI NÀO ĐƯỢC CHIA ĐÔI?'}
          fill={'#f4f7fb'}
          fontSize={74}
          fontWeight={800}
        />
        <Txt
          ref={subtitleRef}
          text={'Chỉ khi kiểm tra ở giữa loại chắc chắn được một phía'}
          fill={'#9fb1c7'}
          fontSize={30}
        />
      </Layout>

      <Layout direction={'row'} gap={28} width={936} height={320} justifyContent={'space-between'}>
        <Layout ref={leftPane} direction={'column'} gap={18} width={456} height={320}>
          <Txt text={'DÃY CÓ THỨ TỰ'} fill={'#8df2ff'} fontSize={24} fontWeight={700} />
          <Rect radius={28} fill={'#0f1a27'} width={456} height={246} stroke={'#26405a'} lineWidth={2}>
            <Layout direction={'row'} gap={12} padding={18} width={'100%'} height={'100%'} alignItems={'center'} justifyContent={'center'}>
              {sorted.map((v, i) => (
                <Rect key={String(i)} width={54} height={74} radius={16} fill={i === 3 ? '#ffc94d' : '#173147'} opacity={i === 3 ? 1 : 0.95}>
                  <Txt text={v} fill={'#f4f7fb'} fontSize={30} fontWeight={700} />
                </Rect>
              ))}
            </Layout>
          </Rect>
        </Layout>

        <Layout ref={rightPane} direction={'column'} gap={18} width={456} height={320}>
          <Txt text={'DỮ LIỆU LỘN XỘN'} fill={'#ff8ea1'} fontSize={24} fontWeight={700} />
          <Rect radius={28} fill={'#1a1014'} width={456} height={246} stroke={'#5a2633'} lineWidth={2}>
            <Layout direction={'row'} gap={12} padding={18} width={'100%'} height={'100%'} alignItems={'center'} justifyContent={'center'}>
              {unsorted.map((v, i) => (
                <Rect key={String(i)} width={54} height={74} radius={16} fill={i === 2 ? '#ff5d6d' : '#2a1720'} opacity={0.95}>
                  <Txt text={v} fill={'#f4f7fb'} fontSize={30} fontWeight={700} />
                </Rect>
              ))}
            </Layout>
          </Rect>
        </Layout>
      </Layout>

      <Layout direction={'column'} gap={14} width={936}>
        <Rect ref={safeRef} radius={28} width={936} height={220} fill={'#0d1722'} stroke={'#183248'} lineWidth={2} opacity={0.92}>
          <Layout direction={'column'} padding={24} gap={16} width={'100%'} height={'100%'}>
            <Txt text={'ĐƠN ĐIỆU / CÓ NGƯỠNG'} fill={'#8df2ff'} fontSize={24} fontWeight={700} />
            <Layout direction={'row'} alignItems={'center'} width={'100%'} height={120}>
              <Line points={[[-360, 0], [360, 0]]} stroke={'#6e87a3'} lineWidth={4} endArrow={false} />
              <Line points={[[-130, -52], [-130, 52]]} stroke={'#8df2ff'} lineWidth={4} />
              <Line points={[[140, -52], [140, 52]]} stroke={'#ff8ea1'} lineWidth={4} />
              <Circle ref={checkRef} x={-260} y={0} size={34} fill={'#2ae6a6'} />
              <Circle x={-170} y={0} size={34} fill={'#2ae6a6'} />
              <Circle x={-70} y={0} size={34} fill={'#2ae6a6'} />
              <Circle x={30} y={0} size={34} fill={'#ffc94d'} />
              <Circle x={130} y={0} size={34} fill={'#ff5d6d'} />
              <Circle x={230} y={0} size={34} fill={'#ff5d6d'} />
              <Circle x={330} y={0} size={34} fill={'#ff5d6d'} />
            </Layout>
          </Layout>
        </Rect>

        <Rect ref={unsafeRef} radius={28} width={936} height={220} fill={'#191115'} stroke={'#5a2633'} lineWidth={2} opacity={0.92}>
          <Layout direction={'column'} padding={24} gap={16} width={'100%'} height={'100%'}>
            <Txt text={'KHÔNG THỨ TỰ = KHÔNG LOẠI AN TOÀN'} fill={'#ff8ea1'} fontSize={24} fontWeight={700} />
            <Layout direction={'row'} alignItems={'center'} width={'100%'} height={120}>
              <Line points={[[-360, 0], [360, 0]]} stroke={'#6e87a3'} lineWidth={4} endArrow={false} />
              <Circle ref={questionRef} x={-140} y={0} size={34} fill={'#ff8ea1'} />
              <Circle x={-25} y={0} size={34} fill={'#2a1720'} />
              <Circle x={90} y={0} size={34} fill={'#2a1720'} />
              <Circle x={205} y={0} size={34} fill={'#2a1720'} />
              <Circle x={320} y={0} size={34} fill={'#2a1720'} />
            </Layout>
          </Layout>
        </Rect>
      </Layout>

      <Layout direction={'column'} gap={12} alignItems={'center'}>
        <Rect ref={midTagRef} radius={18} padding={18} fill={'#122130'} stroke={'#2f4e69'} lineWidth={2}>
          <Txt ref={midTextRef} text={'KIỂM TRA Ở GIỮA'} fill={'#f4f7fb'} fontSize={28} fontWeight={700} />
        </Rect>
        <Txt ref={verdictRef} text={'Chưa đủ điều kiện để chia đôi'} fill={'#d5deea'} fontSize={28} />
      </Layout>

      <Txt ref={monoRef} text={'O(log n) = chia đôi lặp lại'} fill={'#8df2ff'} fontSize={32} fontWeight={700} />
    </Layout>,
  );

  yield* chain(
    all(titleRef().opacity(1, 0.5), subtitleRef().opacity(1, 0.5)),
    waitFor(0.4),
    all(leftPane().opacity(1, 0.5), rightPane().opacity(1, 0.5)),
    waitFor(0.6),
  );

  yield* tween(1.2, value => {
    const t = easeInOutCubic(value);
    step(t * 0.33);
    dim(0.22 + 0.55 * t);
  });

  yield* all(
    verdictRef().text('Chỉ dùng khi có thứ tự hoặc đơn điệu', 0.5),
    safeRef().scale([1.02, 1.02], 0.5),
    unsafeRef().scale([0.98, 0.98], 0.5),
  );

  yield* waitFor(1.0);

  yield* chain(
    all(midTagRef().scale([1.04, 1.04], 0.35), pulse(1, 0.35)),
    waitFor(0.35),
    all(midTagRef().scale([1, 1], 0.25), pulse(0, 0.25)),
  );

  yield* all(
    questionRef().fill('#ff8ea1', 0.4),
    unsafeRef().opacity(1, 0.4),
  );

  yield* tween(1.0, value => {
    const p = easeInOutCubic(value);
    split(p);
    arrowX(-120 + 240 * p);
  });

  yield* all(
    monoRef().text('loại chắc chắn một phía', 0.4),
    checkRef().fill('#42f5b6', 0.4),
  );

  yield* waitFor(0.8);

  yield* chain(
    all(verdictRef().text('Không có thứ tự thì không được phép đoán', 0.45), questionRef().scale([1.18, 1.18], 0.25)),
    waitFor(0.45),
    all(questionRef().scale([1, 1], 0.25), unsafeRef().opacity(0.82, 0.25)),
  );

  yield* tween(1.2, value => {
    const t = easeInOutCubic(value);
    step(0.33 + 0.67 * t);
    dim(0.77 - 0.35 * t);
  });

  yield* all(
    titleRef().text('VÌ SAO O(LOG N)?', 0.4),
    subtitleRef().text('Mỗi lần kiểm tra hợp lệ là một lần chia đôi', 0.4),
  );

  yield* waitFor(1.2);
});
