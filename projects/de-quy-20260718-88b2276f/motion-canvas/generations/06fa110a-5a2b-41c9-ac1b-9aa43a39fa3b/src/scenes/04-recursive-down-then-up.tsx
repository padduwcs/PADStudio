import {makeScene2D, Rect, Circle, Line, Txt} from '@motion-canvas/2d';
import {all, chain, sequence, createRef, waitUntil, useDuration, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const blue = '#3B82F6';
  const yellow = '#F6C94C';
  const green = '#42C978';
  const ink = '#17324D';
  const pale = '#EDF5FC';

  const boxes = [createRef<Rect>(), createRef<Rect>(), createRef<Rect>(), createRef<Rect>()];
  const lids = [createRef<Line>(), createRef<Line>(), createRef<Line>(), createRef<Line>()];
  const result = createRef<Circle>();
  const downPath = createRef<Line>();
  const upPath = createRef<Line>();
  const downMark = createRef<Txt>();
  const upMark = createRef<Txt>();

  const positions: [number, number][] = [
    [-300, -540],
    [-100, -200],
    [100, 130],
    [300, 440],
  ];
  const sizes: [number, number][] = [
    [440, 270],
    [340, 220],
    [250, 170],
    [170, 120],
  ];
  const lidPositions: [number, number][] = positions.map((p, i) => [p[0], p[1] - sizes[i][1] / 2]);

  view.fill('#F8FBFF');
  view.add(
    <>
      <Rect
        width={900}
        height={1540}
        radius={50}
        fill={pale}
        stroke={'#D8E7F3'}
        lineWidth={5}
      />

      <Line
        ref={downPath}
        points={[[420, -560], [420, 470]]}
        stroke={blue}
        lineWidth={18}
        endArrow
        arrowSize={34}
        end={0}
        opacity={0}
      />
      <Line
        ref={upPath}
        points={[[470, 470], [470, -560]]}
        stroke={green}
        lineWidth={18}
        endArrow
        arrowSize={34}
        end={0}
        opacity={0}
      />
      <Txt ref={downMark} text={'↓'} position={[420, -700]} fontSize={88} fill={blue} opacity={0}/>
      <Txt ref={upMark} text={'↑'} position={[470, -700]} fontSize={88} fill={green} opacity={0}/>

      {sizes.map((size, i) => (
        <Rect
          key={'box-' + String(i)}
          ref={boxes[i]}
          width={size[0]}
          height={size[1]}
          position={i === 0 ? [0, -200] : i === 1 ? [0, -200] : positions[i]}
          radius={28}
          fill={blue}
          stroke={ink}
          lineWidth={12}
          opacity={i < 2 ? 1 : 0}
          scale={i === 1 ? 0.64 : i > 1 ? 0.75 : 1}
        />
      ))}

      {sizes.map((size, i) => (
        <Line
          key={'lid-' + String(i)}
          ref={lids[i]}
          points={[[-size[0] / 2, 0], [size[0] / 2, 0]]}
          position={i === 0 ? [0, -335] : i === 1 ? [0, -310] : lidPositions[i]}
          stroke={ink}
          lineWidth={18}
          lineCap={'round'}
          rotation={-18}
          opacity={i < 2 ? 1 : 0}
          scale={i === 1 ? 0.64 : i > 1 ? 0.75 : 1}
        />
      ))}

      <Circle
        ref={result}
        size={66}
        position={positions[3]}
        fill={'#FFF7B2'}
        stroke={green}
        lineWidth={12}
        shadowColor={green}
        shadowBlur={28}
        opacity={0}
        scale={0.2}
      />
    </>,
  );

  yield* waitUntil('beat:6ad7847f-33e9-45c5-a0b8-43d8f6db793b:start');
  {
    const beatDuration = useDuration('beat:6ad7847f-33e9-45c5-a0b8-43d8f6db793b:end');
    yield* chain(
      all(
        boxes[0]().position(positions[0], beatDuration * 0.38, easeInOutCubic),
        boxes[0]().fill(yellow, beatDuration * 0.3),
        lids[0]().position(lidPositions[0], beatDuration * 0.38, easeInOutCubic),
      ),
      all(
        boxes[1]().position(positions[1], beatDuration * 0.34, easeInOutCubic),
        boxes[1]().scale(1, beatDuration * 0.34, easeInOutCubic),
        lids[1]().position(lidPositions[1], beatDuration * 0.34, easeInOutCubic),
        lids[1]().scale(1, beatDuration * 0.34, easeInOutCubic),
      ),
    );
  }
  yield* waitUntil('beat:6ad7847f-33e9-45c5-a0b8-43d8f6db793b:end');

  yield* waitUntil('beat:9a8cf26a-ac7f-4608-806e-fc9b101e9f0e:start');
  {
    const beatDuration = useDuration('beat:9a8cf26a-ac7f-4608-806e-fc9b101e9f0e:end');
    yield* all(
      downPath().opacity(1, beatDuration * 0.08),
      downPath().end(1, beatDuration * 0.82, easeInOutCubic),
      downMark().opacity(1, beatDuration * 0.12),
      sequence(
        beatDuration * 0.22,
        all(
          boxes[1]().fill(yellow, beatDuration * 0.16),
          boxes[2]().opacity(1, beatDuration * 0.12),
          boxes[2]().scale(1, beatDuration * 0.18, easeInOutCubic),
          lids[2]().opacity(1, beatDuration * 0.12),
          lids[2]().scale(1, beatDuration * 0.18, easeInOutCubic),
        ),
        all(
          boxes[2]().fill(yellow, beatDuration * 0.16),
          boxes[3]().opacity(1, beatDuration * 0.12),
          boxes[3]().scale(1, beatDuration * 0.18, easeInOutCubic),
          lids[3]().opacity(1, beatDuration * 0.12),
          lids[3]().scale(1, beatDuration * 0.18, easeInOutCubic),
        ),
      ),
    );
  }
  yield* waitUntil('beat:9a8cf26a-ac7f-4608-806e-fc9b101e9f0e:end');

  yield* waitUntil('beat:ab652f37-1fd8-455a-8ba8-34a85df38c40:start');
  {
    const beatDuration = useDuration('beat:ab652f37-1fd8-455a-8ba8-34a85df38c40:end');
    yield* chain(
      all(
        boxes[3]().fill(green, beatDuration * 0.24),
        result().opacity(1, beatDuration * 0.18),
        result().scale(1, beatDuration * 0.24, easeInOutCubic),
      ),
      all(
        downPath().opacity(0, beatDuration * 0.14),
        downMark().opacity(0, beatDuration * 0.14),
        upPath().opacity(1, beatDuration * 0.12),
        upPath().end(1, beatDuration * 0.48, easeInOutCubic),
        upMark().opacity(1, beatDuration * 0.18),
      ),
    );
  }
  yield* waitUntil('beat:ab652f37-1fd8-455a-8ba8-34a85df38c40:end');

  yield* waitUntil('beat:11c1d084-f338-4257-b0b0-7821c73348b7:start');
  {
    const beatDuration = useDuration('beat:11c1d084-f338-4257-b0b0-7821c73348b7:end');
    yield* chain(
      all(
        result().position(positions[2], beatDuration * 0.2, easeInOutCubic),
        boxes[2]().fill(green, beatDuration * 0.2),
        lids[3]().rotation(0, beatDuration * 0.2),
        lids[2]().rotation(0, beatDuration * 0.2),
      ),
      all(
        result().position(positions[1], beatDuration * 0.2, easeInOutCubic),
        boxes[1]().fill(green, beatDuration * 0.2),
        lids[1]().rotation(0, beatDuration * 0.2),
      ),
      all(
        result().position(positions[0], beatDuration * 0.2, easeInOutCubic),
        boxes[0]().fill(green, beatDuration * 0.2),
        lids[0]().rotation(0, beatDuration * 0.2),
      ),
      all(
        result().scale(0.45, beatDuration * 0.12),
        result().opacity(0, beatDuration * 0.12),
        upPath().opacity(0.32, beatDuration * 0.12),
        upMark().opacity(0.32, beatDuration * 0.12),
      ),
    );
  }
  yield* waitUntil('beat:11c1d084-f338-4257-b0b0-7821c73348b7:end');
});
