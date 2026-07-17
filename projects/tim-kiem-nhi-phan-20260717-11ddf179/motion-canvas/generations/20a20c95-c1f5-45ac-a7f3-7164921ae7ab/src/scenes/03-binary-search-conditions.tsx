import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, waitFor, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#070B16');

  const orderedPanel = createRef<Layout>();
  const monotonePanel = createRef<Layout>();
  const messyPanel = createRef<Layout>();
  const verdictPanel = createRef<Layout>();
  const orderedDivider = createRef<Line>();
  const scan = createRef<Circle>();
  const threshold = createRef<Line>();
  const messyPointer = createRef<Line>();
  const badCut = createRef<Rect>();
  const compareDivider = createRef<Line>();
  const stop = createRef<Circle>();
  const ordered: Rect[] = [];
  const levels: Rect[] = [];
  const messy: Rect[] = [];
  const safeRow: Rect[] = [];
  const unsafeRow: Rect[] = [];
  const orderedValues = ['10', '20', '30', '40', '50', '60', '70', '80'];
  const messyValues = ['80', '15', '65', '40', '10', '95', '30'];

  view.add(
    <Rect width={1080} height={1920} fill={'#070B16'}>
      <Txt y={-780} text={'KHI NÀO ĐƯỢC CHIA ĐÔI?'} fill={'#F4F7FF'} fontSize={48} fontWeight={800}/>

      <Layout ref={orderedPanel} opacity={0}>
        <Txt y={-500} text={'CÓ THỨ TỰ'} fill={'#62E6A7'} fontSize={42} fontWeight={800}/>
        <Line ref={orderedDivider} points={[[0, -230], [0, 250]]} stroke={'#FFD166'} lineWidth={8} end={0}/>
        {orderedValues.map((value, i) => (
          <Rect
            key={'ordered-' + String(i)}
            ref={node => {ordered[i] = node;}}
            x={-378 + i * 108}
            y={i % 2 === 0 ? -95 : 100}
            width={88}
            height={112}
            radius={18}
            fill={'#173252'}
            stroke={i === 6 ? '#62E6A7' : '#37658B'}
            lineWidth={i === 6 ? 7 : 3}
          >
            <Txt text={value} fill={'#F4F7FF'} fontSize={34} fontWeight={700}/>
          </Rect>
        ))}
        <Txt x={-220} y={180} text={'NHỎ HƠN'} fill={'#74849E'} fontSize={28} fontWeight={700}/>
        <Txt x={220} y={180} text={'LỚN HƠN'} fill={'#62E6A7'} fontSize={28} fontWeight={700}/>
      </Layout>

      <Layout ref={monotonePanel} opacity={0}>
        <Txt y={-500} text={'CHỈ ĐỔI MỘT LẦN'} fill={'#FFD166'} fontSize={42} fontWeight={800}/>
        {Array.from({length: 9}, (_, i) => (
          <Rect
            key={'level-' + String(i)}
            ref={node => {levels[i] = node;}}
            x={-360 + i * 90}
            y={80 - i * 26}
            width={70}
            height={170 + i * 52}
            radius={14}
            fill={'#18233D'}
          />
        ))}
        <Circle ref={scan} x={-360} y={-330} size={30} fill={'#FFFFFF'} shadowColor={'#FFFFFF'} shadowBlur={18}/>
        <Line ref={threshold} points={[[45, -390], [45, 400]]} stroke={'#FFD166'} lineWidth={8} end={0}/>
        <Txt x={-190} y={400} text={'AN TOÀN'} fill={'#62E6A7'} fontSize={30} fontWeight={800}/>
        <Txt x={250} y={400} text={'QUÁ TẢI'} fill={'#FF5C78'} fontSize={30} fontWeight={800}/>
      </Layout>

      <Layout ref={messyPanel} opacity={0}>
        <Txt y={-500} text={'LỘN XỘN'} fill={'#FF5C78'} fontSize={42} fontWeight={800}/>
        {messyValues.map((value, i) => (
          <Rect
            key={'messy-' + String(i)}
            ref={node => {messy[i] = node;}}
            x={-330 + i * 110}
            width={88}
            height={112}
            radius={18}
            fill={'#19243A'}
            stroke={i === 0 ? '#62E6A7' : '#344966'}
            lineWidth={i === 0 ? 7 : 3}
          >
            <Txt text={value} fill={'#F4F7FF'} fontSize={34} fontWeight={700}/>
          </Rect>
        ))}
        <Line ref={messyPointer} points={[[0, -210], [0, -75]]} stroke={'#FFD166'} lineWidth={10} endArrow arrowSize={20} end={0}/>
        <Rect ref={badCut} x={-220} width={430} height={190} radius={24} fill={'#FF5C78'} opacity={0}/>
        <Txt x={-330} y={160} text={'80'} fill={'#62E6A7'} fontSize={32} fontWeight={800}/>
        <Txt y={160} text={'40'} fill={'#FFD166'} fontSize={32} fontWeight={800}/>
      </Layout>

      <Layout ref={verdictPanel} opacity={0}>
        <Txt y={-560} text={'LOẠI CHẮC CHẮN?'} fill={'#F4F7FF'} fontSize={44} fontWeight={800}/>
        <Txt x={-430} y={-245} text={'✓'} fill={'#62E6A7'} fontSize={54} fontWeight={900}/>
        <Txt x={-430} y={245} text={'?'} fill={'#FF5C78'} fontSize={54} fontWeight={900}/>
        <Line ref={compareDivider} points={[[0, -410], [0, -75]]} stroke={'#FFD166'} lineWidth={7} end={0}/>
        {['10', '20', '30', '40', '50', '60', '70'].map((value, i) => (
          <Rect
            key={'safe-' + String(i)}
            ref={node => {safeRow[i] = node;}}
            x={-300 + i * 100}
            y={-245}
            width={78}
            height={96}
            radius={14}
            fill={'#173252'}
            stroke={i === 5 ? '#62E6A7' : '#37658B'}
            lineWidth={i === 5 ? 6 : 2}
          >
            <Txt text={value} fill={'#F4F7FF'} fontSize={28} fontWeight={700}/>
          </Rect>
        ))}
        {messyValues.map((value, i) => (
          <Rect
            key={'unsafe-' + String(i)}
            ref={node => {unsafeRow[i] = node;}}
            x={-300 + i * 100}
            y={245}
            width={78}
            height={96}
            radius={14}
            fill={'#19243A'}
            stroke={i === 0 ? '#62E6A7' : '#344966'}
            lineWidth={i === 0 ? 6 : 2}
          >
            <Txt text={value} fill={'#F4F7FF'} fontSize={28} fontWeight={700}/>
          </Rect>
        ))}
        <Rect x={-175} y={245} width={350} height={150} radius={20} fill={'#FF5C78'} opacity={0.08}/>
        <Circle ref={stop} x={0} y={500} size={118} stroke={'#FF5C78'} lineWidth={12} scale={[0, 0]}>
          <Line points={[[-30, 30], [30, -30]]} stroke={'#FF5C78'} lineWidth={12}/>
        </Circle>
      </Layout>
    </Rect>
  );

  // Beat 1 — dữ liệu tự xếp lại, rồi nửa nhỏ hơn được loại an toàn.
  yield* orderedPanel().opacity(1, 0.5);
  yield* sequence(0.13, ...ordered.map(card => card.y(0, 0.59, easeInOutCubic)));
  yield* orderedDivider().end(1, 0.8, easeInOutCubic);
  yield* all(
    ...ordered.slice(0, 4).map(card => card.opacity(0.14, 1)),
    ordered[6].scale([1.14, 1.14], 1, easeInOutCubic),
  );
  yield* waitFor(2.7);
  yield* orderedPanel().opacity(0, 0.5);

  // Beat 2 — trạng thái đi một chiều và chỉ có một ngưỡng chuyển đổi.
  yield* monotonePanel().opacity(1, 0.5);
  yield* all(
    scan().x(360, 2.4, easeInOutCubic),
    sequence(0.24, ...levels.map((bar, i) => bar.fill(i < 5 ? '#2CCB8A' : '#FF5C78', 0.48))),
  );
  yield* threshold().end(1, 0.8, easeInOutCubic);
  yield* waitFor(2.8);
  yield* monotonePanel().opacity(0, 0.5);

  // Beat 3 — quyết định theo ô giữa sẽ xóa nhầm mục tiêu 80 ở bên trái.
  yield* messyPanel().opacity(1, 0.5);
  yield* all(
    messyPointer().end(1, 1, easeInOutCubic),
    messy[3].fill('#654B1D', 1),
  );
  yield* badCut().opacity(0.32, 0.9);
  yield* chain(
    all(
      messy[0].fill('#245D4D', 0.6),
      messy[0].scale([1.2, 1.2], 0.6, easeInOutCubic),
      messy[0].stroke('#FFFFFF', 0.6),
    ),
    all(
      messy[0].scale([1, 1], 0.6, easeInOutCubic),
      badCut().fill('#FF254F', 0.6),
    ),
  );
  yield* waitFor(2.9);
  yield* messyPanel().opacity(0, 0.5);

  // Beat 4 — cùng thao tác, nhưng chỉ hàng có trật tự cho phép loại một phía.
  yield* verdictPanel().opacity(1, 0.5);
  yield* compareDivider().end(1, 0.8, easeInOutCubic);
  yield* all(
    ...safeRow.slice(0, 4).map(card => card.opacity(0.12, 1.2)),
    safeRow[5].scale([1.12, 1.12], 1.2, easeInOutCubic),
  );
  yield* all(
    ...unsafeRow.slice(0, 4).map(card => card.fill('#4B2634', 1.2)),
    unsafeRow[0].stroke('#FFFFFF', 1.2),
  );
  yield* stop().scale([1, 1], 0.8, easeInOutCubic);
  yield* waitFor(2.5);
});
