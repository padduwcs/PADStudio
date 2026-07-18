import {makeScene2D, Rect, Circle, Line, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, easeInOutCubic, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const blue = '#38A7FF';
  const yellow = '#FFC857';
  const green = '#55D98A';
  const ink = '#DCEBFA';
  const bg = '#0B1524';

  const boxes = Array.from({length: 4}, () => createRef<Rect>());
  const dots = Array.from({length: 4}, () => createRef<Circle>());
  const panels = Array.from({length: 3}, () => createRef<Rect>());
  const guide = createRef<Line>();
  const focus = createRef<Circle>();
  const resultTray = createRef<Rect>();
  const boxSizes = [620, 470, 320, 170];

  view.fill(bg);
  view.add(
    <Layout width={1080} height={1920}>
      <Circle
        ref={focus}
        position={[-90, -170]}
        size={690}
        stroke={blue}
        lineWidth={10}
        opacity={0.18}
      />

      {boxSizes.map((size, index) => (
        <Rect
          key={String(index)}
          ref={boxes[index]}
          position={[-90, -170]}
          width={size}
          height={size}
          radius={34}
          lineWidth={18}
          stroke={index === 0 ? blue : yellow}
          fill={index === 0 ? '#123A59' : '#392F1C'}
        />
      ))}

      <Rect
        ref={resultTray}
        position={[0, 570]}
        width={500}
        height={150}
        radius={75}
        stroke={ink}
        lineWidth={6}
        opacity={0}
      >
        {dots.map((dot, index) => (
          <Circle
            key={String(index)}
            ref={dot}
            position={[-150 + index * 100, 0]}
            size={62}
            fill={green}
            stroke={'#B9FFD5'}
            lineWidth={5}
            opacity={0}
            scale={[0, 0]}
          />
        ))}
      </Rect>

      <Layout opacity={0} ref={panels[0]} position={[-330, -360]}>
        <Rect width={270} height={300} radius={30} stroke={blue} lineWidth={8} fill={'#10273C'}>
          <Rect position={[-38, 35]} width={130} height={130} radius={18} stroke={blue} lineWidth={10}/>
          <Rect position={[38, -35]} width={86} height={86} radius={14} stroke={blue} lineWidth={10}/>
        </Rect>
      </Layout>
      <Layout opacity={0} ref={panels[1]} position={[0, -360]}>
        <Rect width={270} height={300} radius={30} stroke={yellow} lineWidth={8} fill={'#302817'}>
          <Rect position={[0, -65]} width={150} height={95} radius={16} stroke={yellow} lineWidth={9}/>
          <Rect position={[0, 25]} width={105} height={68} radius={14} stroke={yellow} lineWidth={9}/>
          <Rect position={[0, 92]} width={62} height={42} radius={11} stroke={yellow} lineWidth={8}/>
        </Rect>
      </Layout>
      <Layout opacity={0} ref={panels[2]} position={[330, -360]}>
        <Rect width={270} height={300} radius={30} stroke={green} lineWidth={8} fill={'#173526'}>
          <Rect width={145} height={145} radius={24} stroke={green} lineWidth={11}/>
          <Circle size={42} fill={green}/>
        </Rect>
      </Layout>

      <Line
        ref={guide}
        points={[[-330, -165], [0, -165], [330, -165], [330, 155], [0, 320]]}
        stroke={ink}
        lineWidth={8}
        radius={24}
        end={0}
        endArrow
        arrowSize={24}
        opacity={0}
      />
    </Layout>,
  );

  yield* waitUntil('beat:135f098a-4806-4831-99ef-9e54a84c9628:start');
  const beat1Duration = useDuration('beat:135f098a-4806-4831-99ef-9e54a84c9628:end');
  yield* chain(
    all(
      boxes[0]().fill('#164E76', beat1Duration * 0.18, easeInOutCubic),
      boxes[0]().lineWidth(28, beat1Duration * 0.18, easeInOutCubic),
      focus().opacity(0.55, beat1Duration * 0.18),
    ),
    all(
      resultTray().opacity(1, beat1Duration * 0.12),
      dots[0]().opacity(1, beat1Duration * 0.12),
      dots[0]().scale([1, 1], beat1Duration * 0.12, easeInOutCubic),
    ),
    all(
      boxes[0]().stroke(yellow, beat1Duration * 0.30),
      boxes[1]().stroke(blue, beat1Duration * 0.30),
      boxes[1]().fill('#164E76', beat1Duration * 0.30),
      focus().size(520, beat1Duration * 0.30, easeInOutCubic),
    ),
    all(
      boxes[2]().stroke(blue, beat1Duration * 0.20),
      boxes[3]().stroke(blue, beat1Duration * 0.20),
      focus().size(230, beat1Duration * 0.20, easeInOutCubic),
      focus().opacity(0.85, beat1Duration * 0.20),
    ),
    focus().opacity(0.25, beat1Duration * 0.20),
  );
  yield* waitUntil('beat:135f098a-4806-4831-99ef-9e54a84c9628:end');

  yield* waitUntil('beat:9968e088-be00-45af-b49a-88aa9d6ed085:start');
  const beat2Duration = useDuration('beat:9968e088-be00-45af-b49a-88aa9d6ed085:end');
  yield* chain(
    all(
      boxes[0]().opacity(0.12, beat2Duration * 0.24),
      boxes[1]().opacity(0.12, beat2Duration * 0.24),
      boxes[2]().opacity(0.12, beat2Duration * 0.24),
      boxes[3]().position([-150, -90], beat2Duration * 0.24, easeInOutCubic),
      boxes[3]().scale([1.35, 1.35], beat2Duration * 0.24, easeInOutCubic),
      resultTray().position([245, -90], beat2Duration * 0.24, easeInOutCubic),
      resultTray().width(180, beat2Duration * 0.24),
    ),
    all(
      boxes[3]().stroke(green, beat2Duration * 0.28),
      boxes[3]().fill('#1B5135', beat2Duration * 0.28),
      focus().position([-150, -90], beat2Duration * 0.28),
      focus().size(270, beat2Duration * 0.28),
      focus().stroke(green, beat2Duration * 0.28),
      focus().opacity(0.75, beat2Duration * 0.28),
    ),
    all(
      dots[0]().fill(green, beat2Duration * 0.20),
      dots[0]().scale([1.25, 1.25], beat2Duration * 0.20, easeInOutCubic),
      resultTray().stroke(green, beat2Duration * 0.20),
    ),
    all(
      dots[0]().scale([1, 1], beat2Duration * 0.28, easeInOutCubic),
      focus().opacity(0.18, beat2Duration * 0.28),
    ),
  );
  yield* waitUntil('beat:9968e088-be00-45af-b49a-88aa9d6ed085:end');

  yield* waitUntil('beat:b43015b8-712a-4c73-97cb-ebd0771ad96b:start');
  const beat3Duration = useDuration('beat:b43015b8-712a-4c73-97cb-ebd0771ad96b:end');
  yield* chain(
    all(
      ...boxes.map((box, index) => box().position([-300 + index * 200, 180 - index * 175], beat3Duration * 0.16, easeInOutCubic)),
      ...boxes.map(box => box().width(210, beat3Duration * 0.16)),
      ...boxes.map(box => box().height(210, beat3Duration * 0.16)),
      ...boxes.map(box => box().scale([1, 1], beat3Duration * 0.16)),
      ...boxes.map(box => box().opacity(1, beat3Duration * 0.16)),
      resultTray().position([0, 570], beat3Duration * 0.16),
      resultTray().width(500, beat3Duration * 0.16),
      focus().opacity(0, beat3Duration * 0.16),
    ),
    all(
      boxes[3]().stroke(green, beat3Duration * 0.21),
      boxes[3]().fill('#1B5135', beat3Duration * 0.21),
      dots[0]().scale([1.18, 1.18], beat3Duration * 0.21),
    ),
    all(
      boxes[2]().stroke(green, beat3Duration * 0.21),
      boxes[2]().fill('#1B5135', beat3Duration * 0.21),
      dots[1]().opacity(1, beat3Duration * 0.21),
      dots[1]().scale([1, 1], beat3Duration * 0.21, easeInOutCubic),
    ),
    all(
      boxes[1]().stroke(green, beat3Duration * 0.21),
      boxes[1]().fill('#1B5135', beat3Duration * 0.21),
      dots[2]().opacity(1, beat3Duration * 0.21),
      dots[2]().scale([1, 1], beat3Duration * 0.21, easeInOutCubic),
    ),
    all(
      boxes[0]().stroke(green, beat3Duration * 0.21),
      boxes[0]().fill('#1B5135', beat3Duration * 0.21),
      dots[3]().opacity(1, beat3Duration * 0.21),
      dots[3]().scale([1, 1], beat3Duration * 0.21, easeInOutCubic),
    ),
  );
  yield* waitUntil('beat:b43015b8-712a-4c73-97cb-ebd0771ad96b:end');

  yield* waitUntil('beat:a745c2aa-2300-4e42-b313-6f5a8bde6eaa:start');
  const beat4Duration = useDuration('beat:a745c2aa-2300-4e42-b313-6f5a8bde6eaa:end');
  yield* chain(
    all(
      ...panels.map(panel => panel().opacity(1, beat4Duration * 0.20)),
      ...boxes.map((box, index) => box().position([0, 410], beat4Duration * 0.20, easeInOutCubic)),
      ...boxes.map((box, index) => box().width(500 - index * 95, beat4Duration * 0.20)),
      ...boxes.map((box, index) => box().height(500 - index * 95, beat4Duration * 0.20)),
      resultTray().position([0, 790], beat4Duration * 0.20),
      guide().opacity(0.8, beat4Duration * 0.20),
    ),
    guide().end(0.31, beat4Duration * 0.15, easeInOutCubic),
    guide().end(0.56, beat4Duration * 0.15, easeInOutCubic),
    guide().end(0.78, beat4Duration * 0.15, easeInOutCubic),
    guide().end(1, beat4Duration * 0.15, easeInOutCubic),
    all(
      ...boxes.map(box => box().lineWidth(24, beat4Duration * 0.20, easeInOutCubic)),
      ...dots.map(dot => dot().scale([1.15, 1.15], beat4Duration * 0.10, easeInOutCubic)),
      resultTray().fill('#173526', beat4Duration * 0.20),
      guide().stroke(green, beat4Duration * 0.20),
    ),
  );
  yield* waitUntil('beat:a745c2aa-2300-4e42-b313-6f5a8bde6eaa:end');
});
