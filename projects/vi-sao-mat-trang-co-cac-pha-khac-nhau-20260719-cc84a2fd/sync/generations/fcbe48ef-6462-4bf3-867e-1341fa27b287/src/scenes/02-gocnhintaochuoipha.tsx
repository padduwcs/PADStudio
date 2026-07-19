import {makeScene2D, Rect, Circle, Line, Txt, Layout} from '@motion-canvas/2d';
import {all, chain, createRef, createSignal, tween, waitFor, waitUntil, useDuration, useThread, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const orbitMoon = createRef<Layout>();
  const mainModel = createRef<Layout>();
  const phasePanel = createRef<Layout>();
  const eclipseModel = createRef<Layout>();
  const eclipseMoon = createRef<Circle>();

  const moonX = createSignal(-330);
  const moonY = createSignal(180);
  const visibleLight = createSignal(0.02);
  const angleEnd = createSignal(181);
  const eclipseOpacity = createSignal(0);

  view.fill('#07111f');
  view.add(
    <Layout key="scene-root" width={1080} height={1920}>
      <Layout key="orbit-model" ref={mainModel} width={1080} height={1240} y={-250}>
        <Circle
          key="solar-source"
          x={-470}
          y={180}
          size={210}
          fill="#ffd45a"
          shadowColor="#ffd45a66"
          shadowBlur={38}
        />
        <Line key="upper-light-ray" points={[[-390, 65], [410, 65]]} stroke="#ffd45a88" lineWidth={5} endArrow />
        <Line key="middle-light-ray" points={[[-390, 180], [410, 180]]} stroke="#ffd45aaa" lineWidth={5} endArrow />
        <Line key="lower-light-ray" points={[[-390, 295], [410, 295]]} stroke="#ffd45a88" lineWidth={5} endArrow />

        <Circle
          key="lunar-orbit"
          x={0}
          y={180}
          width={660}
          height={520}
          stroke="#7694b755"
          lineWidth={5}
          lineDash={[18, 14]}
        />
        <Circle key="view-angle-arc" x={0} y={180} size={150} startAngle={180} endAngle={angleEnd} stroke="#62d9ff" lineWidth={9} />
        <Line
          key="observer-sight-line"
          points={() => [[28, 160], [moonX(), moonY()]]}
          stroke="#62d9ff99"
          lineWidth={5}
          lineDash={[14, 12]}
          endArrow
        />

        <Circle key="earth-body" x={0} y={180} size={154} fill="#287cc9" stroke="#71d6ff" lineWidth={7} />
        <Circle key="earth-land" x={-25} y={155} width={58} height={34} fill="#58c985" rotation={-18} />
        <Layout key="observer-eye" x={35} y={118} rotation={-18}>
          <Circle key="observer-eye-outline" width={45} height={25} stroke="#ffffff" lineWidth={5} />
          <Circle key="observer-eye-pupil" size={10} fill="#ffffff" />
        </Layout>

        <Layout key="orbiting-moon" ref={orbitMoon} x={moonX} y={moonY}>
          <Circle key="moon-dark-body" size={92} fill="#59616d" stroke="#dce4ec" lineWidth={4} clip>
            <Rect key="moon-sunlit-half" x={-23} width={46} height={96} fill="#f3f0d7" />
          </Circle>
        </Layout>
      </Layout>

      <Layout key="phase-observation-panel" ref={phasePanel} y={570} direction="column" alignItems="center" gap={24}>
        <Txt key="view-angle-label" text="GÓC NHÌN" fill="#62d9ff" fontSize={42} fontWeight={700} />
        <Rect key="phase-display-frame" width={390} height={390} radius={42} fill="#101d30" stroke="#31506f" lineWidth={5}>
          <Circle key="phase-disc-clip" size={270} fill="#252b35" stroke="#dce4ec" lineWidth={5} clip>
            <Rect
              key="visible-lit-region"
              x={() => -135 + visibleLight() * 135}
              width={() => Math.max(1, visibleLight() * 270)}
              height={280}
              fill="#f6f2d8"
            />
          </Circle>
        </Rect>
        <Layout key="phase-sequence-guide" direction="row" gap={22}>
          <Circle key="new-phase-marker" size={34} fill="#252b35" stroke="#708096" lineWidth={3} />
          <Circle key="crescent-phase-marker" size={34} fill="#6f7069" stroke="#9ca8b5" lineWidth={3} />
          <Circle key="quarter-phase-marker" size={34} fill="#aaa99b" stroke="#cbd3dc" lineWidth={3} />
          <Circle key="gibbous-phase-marker" size={34} fill="#d8d4bd" stroke="#e1e5e9" lineWidth={3} />
          <Circle key="full-phase-marker" size={34} fill="#f6f2d8" stroke="#ffffff" lineWidth={3} />
        </Layout>
      </Layout>

      <Layout key="eclipse-model" ref={eclipseModel} opacity={eclipseOpacity} y={210}>
        <Txt key="eclipse-distinction-label" text="NGUYỆT THỰ ≠ PHA" y={-370} fill="#ff9f78" fontSize={50} fontWeight={700} />
        <Circle key="eclipse-sun" x={-390} size={190} fill="#ffd45a" />
        <Line key="eclipse-upper-ray" points={[[-290, -75], [-70, -75]]} stroke="#ffd45aaa" lineWidth={5} endArrow />
        <Line key="eclipse-lower-ray" points={[[-290, 75], [-70, 75]]} stroke="#ffd45aaa" lineWidth={5} endArrow />
        <Line
          key="earth-shadow-cone"
          points={[[-20, -72], [430, -20], [430, 20], [-20, 72]]}
          closed
          fill="#02050bcc"
          stroke="#ff7c6855"
          lineWidth={4}
        />
        <Circle key="eclipse-earth" size={150} fill="#287cc9" stroke="#71d6ff" lineWidth={7} />
        <Circle key="eclipsed-moon" ref={eclipseMoon} x={410} size={88} fill="#f3f0d7" stroke="#ffffff" lineWidth={4} />
        <Line key="alignment-axis" points={[[-480, 0], [480, 0]]} stroke="#ffffff44" lineWidth={3} lineDash={[12, 12]} />
      </Layout>
    </Layout>,
  );

  yield* waitUntil('beat:d9fb6062-fb59-4378-bbb2-b083167b58ce:start');
  const firstBeatDuration = useDuration('beat:d9fb6062-fb59-4378-bbb2-b083167b58ce:end');
  const firstBeatEndTime = useThread().time() + firstBeatDuration;
  yield* tween(firstBeatDuration * 0.94, value => {
    const progress = easeInOutCubic(value);
    const angle = Math.PI * (1 - progress);
    moonX(Math.cos(angle) * 330);
    moonY(180 - Math.sin(angle) * 260);
    visibleLight(progress);
    angleEnd(181 + progress * 179);
  });
  yield* waitFor(Math.max(0, firstBeatEndTime - useThread().time()));

  yield* waitUntil('beat:ba8d54bc-0e7a-492a-bdbf-426392fedc67:start');
  const secondBeatDuration = useDuration('beat:ba8d54bc-0e7a-492a-bdbf-426392fedc67:end');
  const secondBeatEndTime = useThread().time() + secondBeatDuration;
  yield* chain(
    tween(secondBeatDuration * 0.54, value => {
      const progress = easeInOutCubic(value);
      const angle = Math.PI * progress;
      moonX(Math.cos(angle) * 330);
      moonY(180 + Math.sin(angle) * 260);
      visibleLight(1 - progress);
      angleEnd(360 - progress * 179);
    }),
    all(
      mainModel().opacity(0, secondBeatDuration * 0.1),
      phasePanel().opacity(0, secondBeatDuration * 0.1),
      eclipseOpacity(1, secondBeatDuration * 0.1),
    ),
    eclipseMoon().position.x(150, secondBeatDuration * 0.16, easeInOutCubic),
    eclipseMoon().fill('#8e473d', secondBeatDuration * 0.05),
  );
  yield* waitFor(Math.max(0, secondBeatEndTime - useThread().time()));
});
