import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, sequence, createRef, createSignal, waitFor, waitUntil, useDuration, useThread, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const orbit = createRef<Circle>();
  const title = createRef<Txt>();
  const rayUpper = createRef<Line>();
  const rayMiddle = createRef<Line>();
  const rayLower = createRef<Line>();
  const moonEast = createRef<Layout>();
  const moonSouth = createRef<Layout>();
  const moonWest = createRef<Layout>();
  const moonNorth = createRef<Layout>();
  const travelMoon = createRef<Layout>();
  const halfMeter = createRef<Layout>();
  const sightLine = createRef<Line>();
  const eye = createRef<Layout>();
  const phaseConnector = createRef<Line>();
  const phaseWindow = createRef<Rect>();
  const travelProgress = createSignal(0);

  const sunX = -470;
  const sunY = -100;
  const earthX = 110;
  const earthY = -100;
  const orbitRadius = 320;
  const moonPosition = () => {
    const angle = travelProgress() * Math.PI * 2;
    return [
      earthX + Math.cos(angle) * orbitRadius,
      earthY + Math.sin(angle) * orbitRadius,
    ] as [number, number];
  };
  const lightRotation = () => {
    const [moonX, moonY] = moonPosition();
    return Math.atan2(sunY - moonY, sunX - moonX) * 180 / Math.PI - 180;
  };

  view.add(
    <Layout key='scene-root' width={1080} height={1920}>
      <Rect key='space-background' width={1080} height={1920} fill='#07111f' />

      <Txt
        key='illumination-title'
        ref={title}
        y={-760}
        text={'LUÔN ½ SÁNG'}
        fill='#f4f7fb'
        fontFamily={'Arial'}
        fontSize={58}
        fontWeight={700}
        opacity={0}
      />

      <Line key='light-ray-upper' ref={rayUpper} points={[[-430, -430], [510, -430]]} stroke='#ffd86b' lineWidth={8} opacity={0.42} end={0} />
      <Line key='light-ray-middle' ref={rayMiddle} points={[[-430, -100], [510, -100]]} stroke='#ffd86b' lineWidth={8} opacity={0.5} end={0} />
      <Line key='light-ray-lower' ref={rayLower} points={[[-430, 230], [510, 230]]} stroke='#ffd86b' lineWidth={8} opacity={0.42} end={0} />

      <Circle key='orbit-path' ref={orbit} x={earthX} y={earthY} width={orbitRadius * 2} height={orbitRadius * 2} stroke='#58708d' lineWidth={5} lineDash={[18, 16]} opacity={0} />

      <Line
        key='earth-sight-line'
        ref={sightLine}
        points={() => [[earthX + 22, earthY], moonPosition()]}
        stroke='#77e6ff'
        lineWidth={6}
        lineDash={[14, 12]}
        opacity={0}
      />
      <Line
        key='phase-connector-line'
        ref={phaseConnector}
        points={() => [moonPosition(), [110, 470]]}
        stroke='#77e6ff'
        lineWidth={4}
        opacity={0}
      />

      <Circle key='solar-source-glow' x={sunX} y={sunY} width={250} height={250} fill='#f6bd35' opacity={0.22} />
      <Circle key='solar-source-core' x={sunX} y={sunY} width={180} height={180} fill='#ffd44d' />

      <Circle key='earth-body' x={earthX} y={earthY} width={154} height={154} fill='#2388c9' stroke='#73d5ef' lineWidth={7} />
      <Circle key='earth-land-mark' x={earthX - 24} y={earthY - 16} width={56} height={32} fill='#61bd78' rotation={-18} />

      <Layout key='earth-eye-group' ref={eye} x={earthX + 42} y={earthY - 8} opacity={0} scale={[0, 0]}>
        <Circle key='earth-eye-white' width={42} height={26} fill='#f7fbff' />
        <Circle key='earth-eye-pupil' width={13} height={13} fill='#092033' />
      </Layout>

      <Layout key='moon-east-group' ref={moonEast} x={earthX + orbitRadius} y={earthY} scale={[0, 0]}>
        <Circle key='moon-east-disk' width={86} height={86} fill='#252c38' stroke='#7b8491' lineWidth={4} clip>
          <Rect key='moon-east-lit-half' x={-21.5} width={43} height={86} fill='#e6e1d5' />
        </Circle>
      </Layout>
      <Layout key='moon-south-group' ref={moonSouth} x={earthX} y={earthY + orbitRadius} rotation={28} scale={[0, 0]}>
        <Circle key='moon-south-disk' width={86} height={86} fill='#252c38' stroke='#7b8491' lineWidth={4} clip>
          <Rect key='moon-south-lit-half' x={-21.5} width={43} height={86} fill='#e6e1d5' />
        </Circle>
      </Layout>
      <Layout key='moon-west-group' ref={moonWest} x={earthX - orbitRadius} y={earthY} scale={[0, 0]}>
        <Circle key='moon-west-disk' width={86} height={86} fill='#252c38' stroke='#7b8491' lineWidth={4} clip>
          <Rect key='moon-west-lit-half' x={-21.5} width={43} height={86} fill='#e6e1d5' />
        </Circle>
      </Layout>
      <Layout key='moon-north-group' ref={moonNorth} x={earthX} y={earthY - orbitRadius} rotation={-28} scale={[0, 0]}>
        <Circle key='moon-north-disk' width={86} height={86} fill='#252c38' stroke='#7b8491' lineWidth={4} clip>
          <Rect key='moon-north-lit-half' x={-21.5} width={43} height={86} fill='#e6e1d5' />
        </Circle>
      </Layout>

      <Layout
        key='travel-moon-group'
        ref={travelMoon}
        position={() => moonPosition()}
        rotation={() => lightRotation()}
        scale={[0, 0]}
        opacity={0}
      >
        <Circle key='travel-moon-disk' width={104} height={104} fill='#252c38' stroke='#9ca5af' lineWidth={5} clip>
          <Rect key='travel-moon-lit-half' x={-26} width={52} height={104} fill='#eee9dd' />
        </Circle>
        <Line key='terminator-guide-line' points={[[0, -48], [0, 48]]} stroke='#ffffff' lineWidth={3} opacity={0.7} />
      </Layout>

      <Layout
        key='half-meter-group'
        ref={halfMeter}
        position={() => {
          const [moonX, moonY] = moonPosition();
          return [moonX + 112, moonY - 96] as [number, number];
        }}
        opacity={0}
        scale={[0, 0]}
      >
        <Circle key='half-meter-disk' width={64} height={64} fill='#252c38' stroke='#ffffff' lineWidth={3} clip>
          <Rect key='half-meter-lit-half' x={-16} width={32} height={64} fill='#eee9dd' />
        </Circle>
        <Txt key='half-meter-label' y={54} text={'½'} fill='#ffffff' fontFamily={'Arial'} fontSize={34} fontWeight={700} />
      </Layout>

      <Rect
        key='phase-window-frame'
        ref={phaseWindow}
        x={110}
        y={570}
        width={350}
        height={310}
        radius={34}
        fill='#0d1b2d'
        stroke='#77e6ff'
        lineWidth={6}
        scale={[0, 0]}
        opacity={0}
      >
        <Txt key='view-angle-label' y={-105} text={'GÓC NHÌN'} fill='#77e6ff' fontFamily={'Arial'} fontSize={30} fontWeight={700} />
        <Circle key='phase-disk-clip' y={35} width={164} height={164} fill='#eee9dd' clip>
          <Circle key='phase-shadow-overlay' x={42} width={164} height={164} fill='#252c38' />
        </Circle>
      </Rect>
    </Layout>,
  );

  yield* waitUntil('beat:152e534d-1091-42d7-aadf-b0015284b59e:start');
  const beatOneDuration = useDuration('beat:152e534d-1091-42d7-aadf-b0015284b59e:end');
  const beatOneEndTime = useThread().time() + beatOneDuration;
  yield* all(
    title().opacity(1, beatOneDuration * 0.12),
    orbit().opacity(0.72, beatOneDuration * 0.12),
    rayUpper().end(1, beatOneDuration * 0.18, easeInOutCubic),
    rayMiddle().end(1, beatOneDuration * 0.18, easeInOutCubic),
    rayLower().end(1, beatOneDuration * 0.18, easeInOutCubic),
  );
  yield* sequence(
    beatOneDuration * 0.08,
    moonEast().scale([1, 1], beatOneDuration * 0.12, easeInOutCubic),
    moonSouth().scale([1, 1], beatOneDuration * 0.12, easeInOutCubic),
    moonWest().scale([1, 1], beatOneDuration * 0.12, easeInOutCubic),
    moonNorth().scale([1, 1], beatOneDuration * 0.12, easeInOutCubic),
  );
  yield* waitFor(Math.max(0, beatOneEndTime - useThread().time()));

  yield* waitUntil('beat:13f503c8-f33c-4aed-bdf3-49a988a6ecb5:start');
  const beatTwoDuration = useDuration('beat:13f503c8-f33c-4aed-bdf3-49a988a6ecb5:end');
  const beatTwoEndTime = useThread().time() + beatTwoDuration;
  yield* all(
    moonEast().opacity(0, beatTwoDuration * 0.08),
    moonSouth().opacity(0, beatTwoDuration * 0.08),
    moonWest().opacity(0, beatTwoDuration * 0.08),
    moonNorth().opacity(0, beatTwoDuration * 0.08),
    travelMoon().opacity(1, beatTwoDuration * 0.08),
    travelMoon().scale([1, 1], beatTwoDuration * 0.08, easeInOutCubic),
    halfMeter().opacity(1, beatTwoDuration * 0.08),
    halfMeter().scale([1, 1], beatTwoDuration * 0.08, easeInOutCubic),
  );
  yield* travelProgress(0.72, beatTwoDuration * 0.58, easeInOutCubic);
  yield* all(
    eye().opacity(1, beatTwoDuration * 0.1),
    eye().scale([1, 1], beatTwoDuration * 0.1, easeInOutCubic),
    sightLine().opacity(0.9, beatTwoDuration * 0.1),
  );
  yield* all(
    phaseConnector().opacity(0.7, beatTwoDuration * 0.1),
    phaseWindow().opacity(1, beatTwoDuration * 0.12),
    phaseWindow().scale([1, 1], beatTwoDuration * 0.12, easeInOutCubic),
  );
  yield* waitFor(Math.max(0, beatTwoEndTime - useThread().time()));
});
