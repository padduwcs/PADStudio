import {Buffer} from 'node:buffer';
import {z} from 'zod';
import type {VoiceVisualPlan} from '../shared/topic.ts';
import type {VideoFrame} from '../shared/videoFormat.ts';

const semanticIdPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
const randomLikeSegmentPattern = /^[a-f0-9]{8,}$/i;

export const motionCanvasVisualKindValues = [
  'cards',
  'comparison',
  'gauge',
  'graph',
  'grid',
  'orbit',
  'pipeline',
  'queue',
  'routes',
  'spotlight',
  'stack',
  'timeline',
  'tree',
] as const;

export const motionCanvasMotionValues = [
  'ascend',
  'compare',
  'descend',
  'focus',
  'flow',
  'orbit',
  'pulse',
  'reveal',
] as const;

const MotionCanvasSceneSpecItemSchema = z.object({
  label: z.string().trim().min(1).max(28),
  value: z.string().trim().min(1).max(18).nullable(),
  emphasis: z.enum(['primary', 'secondary', 'muted']),
}).strict();

export const MotionCanvasSceneSpecBeatSchema = z.object({
  beatId: z.string().uuid(),
  visualId: z.string().trim().min(3).max(52).regex(semanticIdPattern).refine(
    value => !value.split('-').some(segment => randomLikeSegmentPattern.test(segment)),
    'visualId must be semantic and stable.',
  ),
  headline: z.string().trim().min(1).max(44),
  caption: z.string().trim().min(1).max(64).nullable(),
  visualKind: z.enum(motionCanvasVisualKindValues),
  motion: z.enum(motionCanvasMotionValues),
  focus: z.enum(['left', 'center', 'right']),
  items: z.array(MotionCanvasSceneSpecItemSchema).min(2).max(5),
}).strict();

export const MotionCanvasSceneSpecSchema = z.object({
  version: z.literal(1),
  visualAnchor: z.string().trim().min(3).max(72),
  beats: z.array(MotionCanvasSceneSpecBeatSchema).min(1).max(5),
}).strict();

export type MotionCanvasSceneSpec = z.infer<typeof MotionCanvasSceneSpecSchema>;
type PlannedBeat = VoiceVisualPlan['sections'][number]['beats'][number];
type SceneSpecBeat = MotionCanvasSceneSpec['beats'][number];

const SPEC_HEADER = '// pad-scene-spec-v1:';
const roleWords = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'] as const;

function sourceText(value: string) {
  return JSON.stringify(value.replace(/\s+/g, ' ').trim());
}

function semanticNodeKey(visualId: string, role: string) {
  const suffix = `-${role}`;
  const maximumBaseLength = Math.max(3, 80 - suffix.length);
  const base = visualId.slice(0, maximumBaseLength).replace(/-+$/u, '');
  return `${base}${suffix}`;
}

function itemColor(
  item: SceneSpecBeat['items'][number],
  palette: NonNullable<VoiceVisualPlan['visualBible']>['palette'],
) {
  if (item.emphasis === 'primary') return palette.accent;
  if (item.emphasis === 'secondary') return palette.primary;
  return palette.surface;
}

function textColorFor(
  item: SceneSpecBeat['items'][number],
  palette: NonNullable<VoiceVisualPlan['visualBible']>['palette'],
) {
  return item.emphasis === 'muted' ? palette.text : palette.background;
}

function layoutGeometry(
  beat: PlannedBeat,
  focus: SceneSpecBeat['focus'],
) {
  const layout = beat.compositionContract?.layout ?? 'center-focus';
  const density = beat.compositionContract?.density ?? 'balanced';
  const densityScale = density === 'sparse' ? 0.92 : density === 'dense' ? 1.06 : 1;
  switch (layout) {
    case 'left-right-split':
      return {
        widthRatio: 0.48,
        heightRatio: 0.56 * densityScale,
        xRatio: focus === 'right' ? 0.22 : -0.22,
        yRatio: 0,
      };
    case 'top-bottom-stack':
      return {
        widthRatio: 0.82,
        heightRatio: 0.42 * densityScale,
        xRatio: 0,
        yRatio: focus === 'right' ? 0.18 : -0.18,
      };
    case 'grid':
      return {
        widthRatio: 0.68,
        heightRatio: 0.54 * densityScale,
        xRatio: focus === 'left' ? -0.1 : focus === 'right' ? 0.1 : 0,
        yRatio: 0,
      };
    case 'full-bleed':
      return {
        widthRatio: 0.88,
        heightRatio: 0.68,
        xRatio: 0,
        yRatio: 0,
      };
    default:
      return {
        widthRatio: 0.72,
        heightRatio: 0.5 * densityScale,
        xRatio: 0,
        yRatio: 0,
      };
  }
}

function itemCardSource(
  beat: SceneSpecBeat,
  item: SceneSpecBeat['items'][number],
  itemIndex: number,
  xRatio: number,
  yRatio: number,
  widthRatio: number,
  heightRatio: number,
  palette: NonNullable<VoiceVisualPlan['visualBible']>['palette'],
  typography: NonNullable<VoiceVisualPlan['visualBible']>['typographyScale'],
  widthName: string,
  heightName: string,
) {
  const role = roleWords[itemIndex] ?? 'quinary';
  const cardKey = semanticNodeKey(beat.visualId, `${role}-card`);
  const labelKey = semanticNodeKey(beat.visualId, `${role}-label`);
  const valueKey = semanticNodeKey(beat.visualId, `${role}-value`);
  return `          <Rect
            key="${cardKey}"
            x={${widthName} * ${xRatio}}
            y={${heightName} * ${yRatio}}
            width={${widthName} * ${widthRatio}}
            height={${heightName} * ${heightRatio}}
            radius={canvasWidth * 0.025}
            fill={${sourceText(itemColor(item, palette))}}
            stroke={${sourceText(item.emphasis === 'muted' ? palette.primary : itemColor(item, palette))}}
            lineWidth={canvasWidth * 0.005}
          >
            <Txt
              key="${labelKey}"
              text={${sourceText(item.label)}}
              y={${item.value ? `-${heightName} * 0.045` : '0'}}
              width={${widthName} * ${Math.max(0.12, widthRatio - 0.035)}}
              fill={${sourceText(textColorFor(item, palette))}}
              fontFamily={${sourceText('Times New Roman, Times, serif')}}
              fontSize={${typography.label}}
              textAlign={'center'}
            />
${item.value ? `            <Txt
              key="${valueKey}"
              text={${sourceText(item.value)}}
              y={${heightName} * 0.055}
              fill={${sourceText(textColorFor(item, palette))}}
              fontFamily={${sourceText('Times New Roman, Times, serif')}}
              fontSize={${typography.body}}
              textAlign={'center'}
            />` : ''}
          </Rect>`;
}

function visualTemplateSource(
  beat: SceneSpecBeat,
  palette: NonNullable<VoiceVisualPlan['visualBible']>['palette'],
  typography: NonNullable<VoiceVisualPlan['visualBible']>['typographyScale'],
  widthName: string,
  heightName: string,
) {
  const items = beat.items;
  const cards: string[] = [];
  const lines: string[] = [];
  const lineKey = (role: string) => semanticNodeKey(beat.visualId, role);

  if (beat.visualKind === 'tree' || beat.visualKind === 'graph') {
    const positions = [
      [0, -0.04],
      [-0.24, 0.2],
      [0.24, 0.2],
      [-0.34, 0.36],
      [0.34, 0.36],
    ] as const;
    for (let index = 1; index < Math.min(items.length, positions.length); index += 1) {
      const [x, y] = positions[index]!;
      const parent = beat.visualKind === 'tree' ? positions[Math.floor((index - 1) / 2)]! : positions[0]!;
      lines.push(`          <Line key="${lineKey(`${roleWords[index] ?? 'quinary'}-edge`)}" points={[[${widthName} * ${parent[0]}, ${heightName} * ${parent[1]}], [${widthName} * ${x}, ${heightName} * ${y}]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006} />`);
    }
    for (let index = 0; index < Math.min(items.length, positions.length); index += 1) {
      const [x, y] = positions[index]!;
      cards.push(itemCardSource(beat, items[index]!, index, x, y, 0.23, 0.16, palette, typography, widthName, heightName));
    }
  } else if (beat.visualKind === 'stack') {
    for (let index = 0; index < items.length; index += 1) {
      cards.push(itemCardSource(beat, items[index]!, index, 0, -0.02 + index * 0.15, 0.58, 0.12, palette, typography, widthName, heightName));
    }
  } else if (beat.visualKind === 'queue' || beat.visualKind === 'pipeline' || beat.visualKind === 'timeline') {
    const count = items.length;
    const start = -0.34;
    const step = count > 1 ? 0.68 / (count - 1) : 0;
    lines.push(`          <Line key="${lineKey('flow-track')}" points={[[${widthName} * -0.39, ${heightName} * 0.14], [${widthName} * 0.39, ${heightName} * 0.14]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.008} endArrow />`);
    for (let index = 0; index < count; index += 1) {
      cards.push(itemCardSource(beat, items[index]!, index, start + step * index, 0.14, Math.min(0.24, 0.72 / count), 0.18, palette, typography, widthName, heightName));
    }
  } else if (beat.visualKind === 'orbit' || beat.visualKind === 'gauge' || beat.visualKind === 'spotlight') {
    lines.push(`          <Circle key="${lineKey('focus-ring')}" width={${widthName} * 0.48} height={${widthName} * 0.48} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.009} />`);
    const positions = [[0, 0], [-0.34, 0.18], [0.34, 0.18], [0, 0.34], [0, -0.28]] as const;
    for (let index = 0; index < Math.min(items.length, positions.length); index += 1) {
      const [x, y] = positions[index]!;
      cards.push(itemCardSource(beat, items[index]!, index, x, y, index === 0 ? 0.3 : 0.2, index === 0 ? 0.2 : 0.14, palette, typography, widthName, heightName));
    }
  } else if (beat.visualKind === 'routes') {
    lines.push(`          <Line key="${lineKey('primary-route')}" points={[[${widthName} * -0.36, ${heightName} * 0.28], [${widthName} * -0.08, ${heightName} * 0.06], [${widthName} * 0.3, ${heightName} * -0.12]]} stroke={${sourceText(palette.accent)}} lineWidth={canvasWidth * 0.012} endArrow lineCap={'round'} lineJoin={'round'} />`);
    lines.push(`          <Line key="${lineKey('secondary-route')}" points={[[${widthName} * -0.3, ${heightName} * -0.08], [${widthName} * 0.02, ${heightName} * 0.18], [${widthName} * 0.34, ${heightName} * 0.04]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.007} endArrow lineCap={'round'} lineJoin={'round'} />`);
    const positions = [[-0.34, 0.28], [-0.3, -0.08], [0.3, -0.12], [0.34, 0.04], [0, 0.18]] as const;
    for (let index = 0; index < Math.min(items.length, positions.length); index += 1) {
      const [x, y] = positions[index]!;
      cards.push(itemCardSource(beat, items[index]!, index, x, y, 0.22, 0.15, palette, typography, widthName, heightName));
    }
  } else {
    const positions: Array<readonly [number, number]> = items.length <= 2
      ? [[-0.23, 0.1], [0.23, 0.1]]
      : [[-0.27, 0.08], [0, 0.08], [0.27, 0.08], [-0.14, 0.29], [0.14, 0.29]];
    for (let index = 0; index < items.length; index += 1) {
      const [x, y] = positions[index]!;
      cards.push(itemCardSource(beat, items[index]!, index, x, y, items.length <= 2 ? 0.4 : 0.25, 0.2, palette, typography, widthName, heightName));
    }
    if (beat.visualKind === 'comparison') {
      lines.push(`          <Line key="${lineKey('comparison-divider')}" points={[[0, ${heightName} * -0.02], [0, ${heightName} * 0.3]]} stroke={${sourceText(palette.text)}} lineWidth={canvasWidth * 0.005} />`);
    }
  }

  return [...lines, ...cards].join('\n');
}

function validateSpecAgainstPlan(spec: MotionCanvasSceneSpec, beats: PlannedBeat[]) {
  if (
    spec.beats.length !== beats.length ||
    spec.beats.some((beat, index) => beat.beatId !== beats[index]!.id) ||
    new Set(spec.beats.map(beat => beat.visualId)).size !== spec.beats.length
  ) {
    throw new Error('Scene Spec must preserve every planned beat in order with a unique semantic visualId.');
  }
}

function beatMotionSource(
  beat: SceneSpecBeat,
  detailRef: string,
  beatNumber: number,
) {
  const duration = `Math.min(0.35, beatDuration${beatNumber} * 0.06)`;
  switch (beat.motion) {
    case 'ascend':
      return `  yield* ${detailRef}().y(-safeHeight * 0.025, ${duration}, easeInOutCubic);\n  yield* ${detailRef}().y(0, ${duration}, easeInOutCubic);`;
    case 'descend':
      return `  yield* ${detailRef}().y(safeHeight * 0.025, ${duration}, easeInOutCubic);\n  yield* ${detailRef}().y(0, ${duration}, easeInOutCubic);`;
    case 'flow':
      return `  yield* ${detailRef}().x(safeWidth * 0.025, ${duration}, easeInOutCubic);\n  yield* ${detailRef}().x(0, ${duration}, easeInOutCubic);`;
    case 'orbit':
      return `  yield* ${detailRef}().rotation(3, ${duration}, easeInOutCubic);\n  yield* ${detailRef}().rotation(0, ${duration}, easeInOutCubic);`;
    case 'compare':
      return `  yield* ${detailRef}().scale([1.03, 0.98], ${duration}, easeInOutCubic);\n  yield* ${detailRef}().scale([1, 1], ${duration}, easeInOutCubic);`;
    case 'focus':
    case 'pulse':
    case 'reveal':
    default:
      return `  yield* ${detailRef}().scale([1.025, 1.025], ${duration}, easeInOutCubic);\n  yield* ${detailRef}().scale([1, 1], ${duration}, easeInOutCubic);`;
  }
}

export function encodeMotionCanvasSceneSpec(spec: MotionCanvasSceneSpec) {
  return Buffer.from(JSON.stringify(spec), 'utf8').toString('base64url');
}

export function extractMotionCanvasSceneSpec(source: string) {
  const line = source.split(/\r?\n/u).find(candidate => candidate.startsWith(SPEC_HEADER));
  if (!line) return null;
  try {
    const decoded = Buffer.from(line.slice(SPEC_HEADER.length).trim(), 'base64url').toString('utf8');
    const parsed = MotionCanvasSceneSpecSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function compileMotionCanvasSceneSpec(options: {
  spec: MotionCanvasSceneSpec;
  beats: PlannedBeat[];
  outlineTitle: string;
  frame: VideoFrame;
  backgroundColor: string;
  visualBible: VoiceVisualPlan['visualBible'];
}) {
  const {spec, beats, backgroundColor} = options;
  validateSpecAgainstPlan(spec, beats);
  const fallbackBible = {
    palette: {
      background: backgroundColor,
      surface: '#171A1F',
      primary: '#35D6E5',
      accent: '#FFC857',
      text: '#F5F7FA',
    },
    typographyScale: {title: 64, label: 34, body: 28},
  };
  const palette = options.visualBible?.palette ?? fallbackBible.palette;
  const typography = options.visualBible?.typographyScale ?? fallbackBible.typographyScale;
  const lifecycleKeys = [...new Set(beats.flatMap(beat => [
    ...(beat.visualLifecycle?.enter ?? []),
    ...(beat.visualLifecycle?.stay ?? []),
    ...(beat.visualLifecycle?.exit ?? []),
  ]))];
  const primaryKeys = new Set(beats.map(beat => beat.primaryBlock));
  const nodeRecords = lifecycleKeys.map((key, index) => {
    const primaryBeatIndex = beats.findIndex(beat => beat.primaryBlock === key);
    const firstBeatIndex = beats.findIndex(beat => [
      ...(beat.visualLifecycle?.enter ?? []),
      ...(beat.visualLifecycle?.stay ?? []),
      ...(beat.visualLifecycle?.exit ?? []),
    ].includes(key));
    const beatIndex = primaryBeatIndex >= 0 ? primaryBeatIndex : Math.max(0, firstBeatIndex);
    const geometry = layoutGeometry(beats[beatIndex]!, spec.beats[beatIndex]!.focus);
    return {
      key,
      refName: `lifecycleNode${index + 1}`,
      widthName: `lifecycleNode${index + 1}Width`,
      heightName: `lifecycleNode${index + 1}Height`,
      isPrimary: primaryKeys.has(key),
      beatIndex,
      geometry,
      supportIndex: lifecycleKeys.slice(0, index).filter(candidate => !primaryKeys.has(candidate)).length,
    };
  });
  const nodeByKey = new Map(nodeRecords.map(node => [node.key, node]));

  const primarySources = nodeRecords.filter(node => node.isPrimary).map(node => {
    const relatedBeatIndexes = beats.map((beat, index) => beat.primaryBlock === node.key ? index : -1).filter(index => index >= 0);
    const details = relatedBeatIndexes.map(beatIndex => {
      const sceneBeat = spec.beats[beatIndex]!;
      const detailRef = `beatDetail${beatIndex + 1}`;
      return `        <Layout key="${semanticNodeKey(sceneBeat.visualId, 'detail-layer')}" ref={${detailRef}} opacity={0} width={${node.widthName}} height={${node.heightName}}>
          <Rect key="${semanticNodeKey(sceneBeat.visualId, 'visual-surface')}" width={${node.widthName}} height={${node.heightName}} radius={canvasWidth * 0.04} fill={${sourceText(palette.surface)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006} />
          <Txt key="${semanticNodeKey(sceneBeat.visualId, 'headline')}" text={${sourceText(sceneBeat.headline)}} y={-${node.heightName} * 0.38} width={${node.widthName} * 0.86} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={${typography.title}} textAlign={'center'} />
${visualTemplateSource(sceneBeat, palette, typography, node.widthName, node.heightName)}
${sceneBeat.caption ? `          <Txt key="${semanticNodeKey(sceneBeat.visualId, 'caption')}" text={${sourceText(sceneBeat.caption)}} y={${node.heightName} * 0.41} width={${node.widthName} * 0.82} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={${typography.body}} textAlign={'center'} />` : ''}
        </Layout>`;
    }).join('\n');
    return `      <Layout key="${node.key}" ref={${node.refName}} width={${node.widthName}} height={${node.heightName}} x={safeWidth * ${node.geometry.xRatio}} y={canvasHeight} opacity={0}>
${details}
      </Layout>`;
  }).join('\n');

  const supportSources = nodeRecords.filter(node => !node.isPrimary).map(node => {
    const column = node.supportIndex % 2 === 0 ? -1 : 1;
    const row = Math.floor(node.supportIndex / 2) % 3;
    const yRatio = -0.25 + row * 0.25;
    return `        <Rect key="${node.key}" ref={${node.refName}} width={safeWidth * 0.1} height={safeWidth * 0.1} radius={canvasWidth * 0.022} fill={${sourceText(node.supportIndex % 2 === 0 ? palette.accent : palette.primary)}} rotation={45} x={safeWidth * ${column * 0.4}} y={canvasHeight} opacity={0} />`;
  }).join('\n');

  const timingSources = beats.map((beat, beatIndex) => {
    const planned = beat.visualLifecycle!;
    const detailRef = `beatDetail${beatIndex + 1}`;
    const enter = planned.enter.flatMap(key => {
      const node = nodeByKey.get(key)!;
      const restY = node.isPrimary ? `safeHeight * ${node.geometry.yRatio}` : `safeHeight * ${-0.25 + (node.supportIndex % 3) * 0.25}`;
      return [
        `    ${node.refName}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`,
        `    ${node.refName}().y(${restY}, enterDuration${beatIndex + 1}, easeInOutCubic)`,
      ];
    });
    const retained = planned.stay.filter(key => !planned.enter.includes(key)).flatMap(key => {
      const node = nodeByKey.get(key)!;
      return [`    ${node.refName}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`];
    });
    const exit = planned.exit.flatMap(key => {
      const node = nodeByKey.get(key)!;
      return [
        `    ${node.refName}().opacity(0, exitDuration${beatIndex + 1}, easeInOutCubic)`,
        `    ${node.refName}().y(canvasHeight, exitDuration${beatIndex + 1}, easeInOutCubic)`,
      ];
    });
    const allEnter = [...enter, ...retained, `    ${detailRef}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`];
    return `  // lifecycle:beat:${beat.id}:enter=${planned.enter.join(',')}|stay=${planned.stay.join(',')}|exit=${planned.exit.join(',')}|primary=${beat.primaryBlock}
  yield* waitUntil('beat:${beat.id}:start');
  const beatDuration${beatIndex + 1} = useDuration('beat:${beat.id}:end');
  const beatEndTime${beatIndex + 1} = useThread().time() + beatDuration${beatIndex + 1};
  const enterDuration${beatIndex + 1} = Math.min(0.45, Math.max(0.08, beatDuration${beatIndex + 1} * 0.1));
  const exitDuration${beatIndex + 1} = Math.min(0.4, Math.max(0.08, beatDuration${beatIndex + 1} * 0.09));
  yield* all(
${allEnter.join(',\n')},
  );
${beatMotionSource(spec.beats[beatIndex]!, detailRef, beatIndex + 1)}
  yield* waitFor(Math.max(0, beatEndTime${beatIndex + 1} - useThread().time() - exitDuration${beatIndex + 1}));
  yield* all(
    ${detailRef}().opacity(0, exitDuration${beatIndex + 1}, easeInOutCubic),
${exit.join(',\n')},
  );
  yield* waitFor(Math.max(0, beatEndTime${beatIndex + 1} - useThread().time()));`;
  }).join('\n\n');

  return `${SPEC_HEADER}${encodeMotionCanvasSceneSpec(spec)}
import {Circle, Layout, Line, makeScene2D, Rect, Txt} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const safeWidth = canvasWidth - safeMarginX * 2;
  const safeHeight = canvasHeight - safeMarginY * 2;
${nodeRecords.map(node => `  const ${node.refName} = createRef<${node.isPrimary ? 'Layout' : 'Rect'}>();\n  const ${node.widthName} = ${node.isPrimary ? `safeWidth * ${node.geometry.widthRatio}` : 'safeWidth * 0.1'};\n  const ${node.heightName} = ${node.isPrimary ? `safeHeight * ${node.geometry.heightRatio}` : 'safeWidth * 0.1'};`).join('\n')}
${beats.map((_beat, index) => `  const beatDetail${index + 1} = createRef<Layout>();`).join('\n')}

  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={${sourceText(backgroundColor)}}>
      <Layout key="scene-content-root" width={safeWidth} height={safeHeight}>
${primarySources}
        <Layout key="block-lifecycle-support-layer" width={safeWidth} height={safeHeight}>
${supportSources}
        </Layout>
      </Layout>
    </Rect>,
  );

${timingSources}
});
`;
}
