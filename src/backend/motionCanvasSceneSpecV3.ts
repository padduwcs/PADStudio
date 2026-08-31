import {Buffer} from 'node:buffer';
import {z} from 'zod';
import type {VisualIntent, VoiceVisualPlan} from '../shared/topic.ts';
import type {VideoFrame} from '../shared/videoFormat.ts';
import {resolveMotionCanvasPresentationPalette} from './motionCanvasSceneSpec.ts';
import {isKnownMotionCanvasIconId, MOTION_CANVAS_ICON_PREFIXES, resolveMotionCanvasIcon, suggestMotionCanvasIconIds} from './motionCanvasIconLibrary.ts';

const semanticIdPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
const randomLikeSegmentPattern = /^[a-f0-9]{8,}$/i;
const semanticId = z.string().trim().min(3).max(52).regex(semanticIdPattern).refine(
  value => !value.split('-').some(segment => randomLikeSegmentPattern.test(segment)),
  'Ids must be stable semantic names, not random values.',
);
const emphasisValues = ['primary', 'secondary', 'muted'] as const;
const paletteRoleValues = ['background', 'surface', 'primary', 'accent', 'text', 'transparent'] as const;
const hexColor = /^#[0-9a-fA-F]{6}$/;
export const sceneSpecV3ActionKindValues = ['reveal', 'move', 'flow', 'focus', 'pulse', 'swap', 'transform', 'compare'] as const;

const NormalizedPointSchema = z.object({x: z.number().min(-0.55).max(0.55), y: z.number().min(-0.55).max(0.55)}).strict();
const NormalizedBoxSchema = z.object({
  x: z.number().min(-0.46).max(0.46),
  y: z.number().min(-0.38).max(0.38),
  width: z.number().min(0.08).max(0.86),
  height: z.number().min(0.06).max(0.7),
}).strict();

const iconIdPattern = new RegExp(`^(?:${MOTION_CANVAS_ICON_PREFIXES.join('|')}):[a-z][a-z0-9-]*$`, 'u');

/** Closed renderer primitives; their composition is open-ended. */
export const MotionCanvasScenePartV3Schema = z.object({
  id: semanticId,
  primitive: z.enum(['rect', 'circle', 'ellipse', 'line', 'polygon', 'path', 'icon', 'text']),
  x: z.number().min(-0.55).max(0.55),
  y: z.number().min(-0.55).max(0.55),
  width: z.number().min(0.01).max(1.2),
  height: z.number().min(0.01).max(1.2),
  rotation: z.number().min(-180).max(180),
  fillRole: z.enum(paletteRoleValues),
  strokeRole: z.enum(paletteRoleValues),
  // A visual bible palette establishes the overall language, but a concrete
  // subject may need semantically meaningful colours (blood, traffic lights,
  // chemical states, flags, autumn pigments, and so on). These optional
  // literals keep that information instead of collapsing every distinction
  // into one generic accent.
  fillColor: z.string().regex(hexColor).nullable().optional(),
  strokeColor: z.string().regex(hexColor).nullable().optional(),
  strokeWidth: z.number().min(0).max(0.04),
  cornerRadius: z.number().min(0).max(0.5),
  points: z.array(NormalizedPointSchema).max(10),
  text: z.string().trim().min(1).max(18).nullable(),
  // Freehand path data cannot draw a recognizable silhouette; keep it for
  // abstract, non-representational decorative curves and motion trails only.
  pathData: z.string().trim().min(4).max(600).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/u).nullable().optional(),
  // A concrete real-world object (leaf, patient, vehicle, sun, ...) must be a
  // known glyph from a bundled icon set, never an invented silhouette.
  iconId: z.string().trim().min(3).max(60).regex(iconIdPattern).nullable().optional(),
}).strict().superRefine((part, context) => {
  if ((part.primitive === 'line' || part.primitive === 'polygon') && part.points.length < 2) {
    context.addIssue({code: 'custom', path: ['points'], message: 'Line and polygon parts require at least two points.'});
  }
  if (part.primitive === 'text' && !part.text) {
    context.addIssue({code: 'custom', path: ['text'], message: 'Text parts require text.'});
  }
  if (part.primitive !== 'text' && part.text) {
    context.addIssue({code: 'custom', path: ['text'], message: 'Only text parts may contain text.'});
  }
  if (part.primitive === 'path' && !part.pathData) {
    context.addIssue({code: 'custom', path: ['pathData'], message: 'Path parts require safe SVG path data.'});
  }
  if (part.primitive !== 'path' && part.pathData) {
    context.addIssue({code: 'custom', path: ['pathData'], message: 'Only path parts may contain SVG path data.'});
  }
  if (part.primitive === 'icon' && !part.iconId) {
    context.addIssue({code: 'custom', path: ['iconId'], message: 'Icon parts require iconId in the form "ph:name" or "tabler:name".'});
  }
  if (part.primitive !== 'icon' && part.iconId) {
    context.addIssue({code: 'custom', path: ['iconId'], message: 'Only icon parts may contain iconId.'});
  }
  if (part.primitive === 'icon' && part.iconId && !isKnownMotionCanvasIconId(part.iconId)) {
    const suggestions = suggestMotionCanvasIconIds(part.iconId.split(':').slice(1).join(':'));
    const hint = suggestions.length > 0 ? ` Close matches: ${suggestions.join(', ')}.` : '';
    context.addIssue({code: 'custom', path: ['iconId'], message: `Unknown icon id "${part.iconId}". Use a real Phosphor ("ph:name") or Tabler ("tabler:name") regular/outline glyph.${hint}`});
  }
});

const SceneEntityV3Schema = z.object({
  id: semanticId,
  intentId: semanticId,
  description: z.string().trim().min(8).max(240),
  role: z.enum(emphasisValues),
  box: NormalizedBoxSchema,
  label: z.string().trim().min(1).max(18).nullable(),
  parts: z.array(MotionCanvasScenePartV3Schema).min(1).max(12),
}).strict();

const SceneRelationshipV3Schema = z.object({
  id: semanticId,
  intentId: semanticId.nullable(),
  from: semanticId,
  to: semanticId,
  style: z.enum(['line', 'arrow', 'dashed', 'curved', 'spatial']),
  label: z.string().trim().min(1).max(14).nullable(),
  emphasis: z.enum(emphasisValues),
  via: z.array(NormalizedPointSchema).max(3),
}).strict();

const SceneActionV3Schema = z.object({
  id: semanticId,
  intentId: semanticId.nullable(),
  kind: z.enum(sceneSpecV3ActionKindValues),
  targets: z.array(semanticId).min(1).max(4),
  direction: z.enum(['left', 'right', 'up', 'down', 'clockwise', 'counterclockwise']).nullable(),
  amount: z.number().min(0.01).max(0.3),
}).strict();

export const MotionCanvasSceneSpecBeatV3Schema = z.object({
  beatId: z.string().uuid(),
  visualId: semanticId,
  headline: z.string().trim().min(1).max(30).nullable(),
  motifHints: z.array(z.string().trim().min(2).max(80)).max(5),
  fidelity: z.enum(['designed', 'simplified', 'placeholder']),
  entities: z.array(SceneEntityV3Schema).min(1).max(10),
  relationships: z.array(SceneRelationshipV3Schema).max(14),
  actions: z.array(SceneActionV3Schema).min(1).max(10),
  decorations: z.array(MotionCanvasScenePartV3Schema).max(12),
}).strict().superRefine((beat, context) => {
  const entityIds = new Set(beat.entities.map(entity => entity.id));
  const ids = [
    ...beat.entities.map(entity => entity.id),
    ...beat.relationships.map(relation => relation.id),
    ...beat.actions.map(action => action.id),
    ...beat.decorations.map(part => part.id),
  ];
  if (new Set(ids).size !== ids.length) context.addIssue({code: 'custom', message: 'Scene graph ids must be unique.'});
  if (new Set(beat.entities.map(entity => entity.intentId)).size !== beat.entities.length) {
    context.addIssue({code: 'custom', path: ['entities'], message: 'Each semantic entity binding must have one composite entity.'});
  }
  for (const [index, relation] of beat.relationships.entries()) {
    if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) {
      context.addIssue({code: 'custom', path: ['relationships', index], message: 'Relationship endpoints must reference declared entities.'});
    }
  }
  for (const [index, action] of beat.actions.entries()) {
    if (new Set(action.targets).size !== action.targets.length || action.targets.some(target => !entityIds.has(target))) {
      context.addIssue({code: 'custom', path: ['actions', index], message: 'Action targets must be unique declared entities.'});
    }
  }
  for (const [entityIndex, entity] of beat.entities.entries()) {
    if (new Set(entity.parts.map(part => part.id)).size !== entity.parts.length) {
      context.addIssue({code: 'custom', path: ['entities', entityIndex, 'parts'], message: 'Part ids must be unique inside an entity.'});
    }
  }
  const renderedText = [
    beat.headline ?? '',
    ...beat.entities.flatMap(entity => [entity.label ?? '', ...entity.parts.map(part => part.text ?? '')]),
    ...beat.relationships.map(relation => relation.label ?? ''),
    ...beat.decorations.map(part => part.text ?? ''),
  ].join(' ').trim();
  if (renderedText.length > 150 || renderedText.split(/\s+/u).filter(Boolean).length > 26) {
    context.addIssue({code: 'custom', message: 'Scene graph text exceeds the visual-first budget.'});
  }
});

export const MotionCanvasSceneSpecV3Schema = z.object({
  version: z.literal(3),
  visualAnchor: z.string().trim().min(3).max(120),
  beats: z.array(MotionCanvasSceneSpecBeatV3Schema).min(1).max(5),
}).strict();

export type MotionCanvasSceneSpecV3 = z.infer<typeof MotionCanvasSceneSpecV3Schema>;

/** Runtime/layout keys stay unique when one semantic entity persists across
 * beats, while retaining a deterministic Visual Intent binding. */
export function motionCanvasSemanticEvidenceKey(intentId: string, visualId: string) {
  return `${intentId}-at-${visualId}`.slice(0, 80).replace(/-+$/u, '');
}
export type MotionCanvasSceneSpecBeatV3 = MotionCanvasSceneSpecV3['beats'][number];
type PlannedBeat = VoiceVisualPlan['sections'][number]['beats'][number];
type Palette = NonNullable<VoiceVisualPlan['visualBible']>['palette'];
type Typography = NonNullable<VoiceVisualPlan['visualBible']>['typographyScale'];

const SPEC_HEADER_V3 = '// pad-scene-spec-v3:';

function sourceText(value: string) { return JSON.stringify(value.replace(/\s+/g, ' ').trim()); }
function nodeKey(visualId: string, role: string) {
  const suffix = `-${role}`;
  return `${visualId.slice(0, Math.max(3, 80 - suffix.length)).replace(/-+$/u, '')}${suffix}`;
}

export function encodeMotionCanvasSceneSpecV3(spec: MotionCanvasSceneSpecV3) {
  return Buffer.from(JSON.stringify(spec), 'utf8').toString('base64url');
}

export function extractMotionCanvasSceneSpecV3(source: string) {
  const line = source.split(/\r?\n/u).find(candidate => candidate.startsWith(SPEC_HEADER_V3));
  if (!line) return null;
  try {
    const decoded = Buffer.from(line.slice(SPEC_HEADER_V3.length).trim(), 'base64url').toString('utf8');
    const parsed = MotionCanvasSceneSpecV3Schema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isMotionCanvasSceneSpecV3(spec: unknown): spec is MotionCanvasSceneSpecV3 {
  return MotionCanvasSceneSpecV3Schema.safeParse(spec).success;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fitBoxInsideParent(
  box: MotionCanvasSceneSpecV3['beats'][number]['entities'][number]['box'],
) {
  // Leave a normalized gutter for strokes, labels and browser rounding. The
  // compiler promises layout safety, so model-authored coordinates may choose
  // composition but may never push a semantic entity beyond its parent.
  const width = Math.min(box.width, 0.76);
  const height = Math.min(box.height, 0.6);
  return {
    ...box,
    width,
    height,
    x: clamp(box.x, -0.46 + width / 2, 0.46 - width / 2),
    y: clamp(box.y, -0.42 + height / 2, 0.42 - height / 2),
  };
}

function fitPartInsideParent(
  part: MotionCanvasSceneSpecV3['beats'][number]['entities'][number]['parts'][number],
) {
  const width = Math.min(part.width, 0.76);
  const height = Math.min(part.height, 0.76);
  const points = part.points.map(point => ({
    x: clamp(point.x, -0.4, 0.4),
    y: clamp(point.y, -0.4, 0.4),
  }));
  const pointMinimumX = points.length
    ? Math.min(...points.map(point => point.x))
    : -width / 2;
  const pointMaximumX = points.length
    ? Math.max(...points.map(point => point.x))
    : width / 2;
  const pointMinimumY = points.length
    ? Math.min(...points.map(point => point.y))
    : -height / 2;
  const pointMaximumY = points.length
    ? Math.max(...points.map(point => point.y))
    : height / 2;
  return {
    ...part,
    width,
    height,
    points,
    x: clamp(part.x, -0.46 - pointMinimumX, 0.46 - pointMaximumX),
    y: clamp(part.y, -0.46 - pointMinimumY, 0.46 - pointMaximumY),
  };
}

function centerEntityCluster(
  entities: MotionCanvasSceneSpecV3['beats'][number]['entities'],
) {
  const fitted = entities.map(entity => ({
    ...entity,
    box: fitBoxInsideParent(entity.box),
    parts: entity.parts.map(fitPartInsideParent),
  }));
  const minimumX = Math.min(...fitted.map(entity => entity.box.x - entity.box.width / 2));
  const maximumX = Math.max(...fitted.map(entity => entity.box.x + entity.box.width / 2));
  const minimumY = Math.min(...fitted.map(entity => entity.box.y - entity.box.height / 2));
  const maximumY = Math.max(...fitted.map(entity => entity.box.y + entity.box.height / 2));
  const offsetX = (minimumX + maximumX) / 2;
  const offsetY = (minimumY + maximumY) / 2;
  return fitted.map(entity => ({
    ...entity,
    box: fitBoxInsideParent({
      ...entity.box,
      x: entity.box.x - offsetX,
      y: entity.box.y - offsetY,
    }),
  }));
}

/** Deterministic visual-director boundary between open AI composition and TSX. */
export function fitMotionCanvasSceneSpecV3ToSafeGeometry(
  input: MotionCanvasSceneSpecV3,
  beats: readonly Pick<PlannedBeat, 'id' | 'visualIntent'>[] = [],
): MotionCanvasSceneSpecV3 {
  const plannedBeatsById = new Map(beats.map(beat => [beat.id, beat]));
  return MotionCanvasSceneSpecV3Schema.parse({
    ...input,
    beats: input.beats.map(beat => ({
      ...beat,
      entities: centerEntityCluster(
        pullImplicitlyConnectedEntitiesTogether(beat.entities, beat.relationships, plannedBeatsById.get(beat.beatId)),
      ),
      decorations: beat.decorations.map(fitPartInsideParent),
    })),
  });
}

export function sceneSpecV3PlanAlignmentIssues(beat: MotionCanvasSceneSpecBeatV3, plan: Pick<PlannedBeat, 'visualIntent'>) {
  const intent = plan.visualIntent;
  if (!intent) return ['Beat trong kế hoạch hình ảnh chưa có yêu cầu ngữ nghĩa có cấu trúc.'];
  const intentEntities = new Set(intent.entities.map(entity => entity.id));
  const intentRelations = new Set(intent.relations.map(relation => relation.id));
  const intentActions = new Set(intent.actions.map(action => action.id));
  const boundEntities = new Set(beat.entities.map(entity => entity.intentId));
  const boundRelations = new Set(beat.relationships.flatMap(relation => relation.intentId ? [relation.intentId] : []));
  const boundActions = new Set(beat.actions.flatMap(action => action.intentId ? [action.intentId] : []));
  const issues: string[] = [];
  for (const entity of intent.entities) {
    if (entity.mustShow && !boundEntities.has(entity.id)) issues.push(`Required entity ${entity.id} is not visibly bound.`);
  }
  for (const relation of intent.relations) {
    if (relation.mustShow && !boundRelations.has(relation.id)) issues.push(`Required relation ${relation.id} is not visibly bound.`);
  }
  for (const action of intent.actions) {
    if (action.mustShow && !boundActions.has(action.id)) issues.push(`Required action ${action.id} is not visibly bound.`);
  }
  for (const entity of beat.entities) if (!intentEntities.has(entity.intentId)) issues.push(`Entity ${entity.id} binds unknown intent ${entity.intentId}.`);
  for (const relation of beat.relationships) if (relation.intentId && !intentRelations.has(relation.intentId)) issues.push(`Relationship ${relation.id} binds unknown intent ${relation.intentId}.`);
  for (const action of beat.actions) if (action.intentId && !intentActions.has(action.intentId)) issues.push(`Action ${action.id} binds unknown intent ${action.intentId}.`);
  if (beat.fidelity === 'placeholder') issues.push('Scene is explicitly marked as a placeholder.');
  return issues;
}

export function sceneSpecV3SemanticCoverage(beat: MotionCanvasSceneSpecBeatV3, intent: VisualIntent | undefined) {
  if (!intent) return {coverage: 0, missingIntentIds: ['visual-intent-missing'], status: 'failed' as const};
  const required = [
    ...intent.entities.filter(item => item.mustShow).map(item => item.id),
    ...intent.relations.filter(item => item.mustShow).map(item => item.id),
    ...intent.actions.filter(item => item.mustShow).map(item => item.id),
  ];
  const bound = new Set([
    ...beat.entities.map(item => item.intentId),
    ...beat.relationships.flatMap(item => item.intentId ? [item.intentId] : []),
    ...beat.actions.flatMap(item => item.intentId ? [item.intentId] : []),
  ]);
  const missingIntentIds = required.filter(id => !bound.has(id));
  const coverage = required.length ? (required.length - missingIntentIds.length) / required.length : 1;
  const status = missingIntentIds.length || beat.fidelity === 'placeholder'
    ? 'failed' as const
    : beat.fidelity === 'simplified'
      ? 'degraded' as const
      : 'passed' as const;
  return {coverage, missingIntentIds, status};
}

function validateAgainstPlan(spec: MotionCanvasSceneSpecV3, beats: PlannedBeat[]) {
  if (
    spec.beats.length !== beats.length ||
    spec.beats.some((beat, index) => beat.beatId !== beats[index]!.id) ||
    new Set(spec.beats.map(beat => beat.visualId)).size !== spec.beats.length
  ) throw new Error('Scene Spec v3 must preserve every planned beat in order with unique semantic visual ids.');
  for (let index = 0; index < spec.beats.length; index += 1) {
    const issues = sceneSpecV3PlanAlignmentIssues(spec.beats[index]!, beats[index]!);
    if (issues.length) throw new Error(`Scene Spec v3 beat ${index + 1} is not aligned: ${issues.join(' ')}`);
  }
}

function roleColor(role: typeof paletteRoleValues[number], palette: Palette) {
  return role === 'transparent' ? '#00000000' : palette[role];
}

const semanticNamedColours: Array<[RegExp, string]> = [
  [/\b(?:red|ruby|crimson|scarlet)\b/iu, '#C84B45'],
  [/\b(?:orange|amber)\b/iu, '#E68132'],
  [/\b(?:yellow|gold|golden)\b/iu, '#F2C94C'],
  [/\b(?:blue|cyan|azure)\b/iu, '#58A6D6'],
  [/\b(?:purple|violet|magenta)\b/iu, '#9B6BD3'],
  [/\b(?:brown|wood|branch|stem)\b/iu, '#8B6546'],
  [/\b(?:white|snow)\b/iu, '#F4F1E8'],
  [/\b(?:black|shadow)\b/iu, '#1B1D20'],
];

function partColour(
  part: z.infer<typeof MotionCanvasScenePartV3Schema>,
  channel: 'fill' | 'stroke',
  palette: Palette,
) {
  const explicit = channel === 'fill' ? part.fillColor : part.strokeColor;
  const role = channel === 'fill' ? part.fillRole : part.strokeRole;
  if (explicit) return explicit;
  if (role === 'transparent' || role === 'background' || role === 'surface' || role === 'text') {
    return roleColor(role, palette);
  }
  const semanticName = `${part.id} ${part.text ?? ''}`;
  const semantic = semanticNamedColours.find(([pattern]) => pattern.test(semanticName));
  return semantic?.[1] ?? roleColor(role, palette);
}

function emphasisColor(role: typeof emphasisValues[number], palette: Palette) {
  return role === 'primary' ? palette.accent : role === 'secondary' ? palette.primary : palette.surface;
}
function compositionGeometry(beat: PlannedBeat) {
  const densityScale = beat.compositionContract?.density === 'sparse' ? 0.92 : beat.compositionContract?.density === 'dense' ? 1.05 : 1;
  switch (beat.compositionContract?.layout) {
    case 'left-right-split': return {width: 0.82, height: 0.62 * densityScale, x: -0.04, y: 0};
    case 'top-bottom-stack': return {width: 0.82, height: 0.58 * densityScale, x: 0, y: 0.03};
    case 'grid': return {width: 0.84, height: 0.64 * densityScale, x: 0, y: 0};
    case 'full-bleed': return {width: 0.9, height: 0.72, x: 0, y: 0};
    default: return {width: 0.82, height: 0.62 * densityScale, x: 0, y: 0};
  }
}

function partSource(part: z.infer<typeof MotionCanvasScenePartV3Schema>, visualId: string, prefix: string, width: string, height: string, palette: Palette, typography: Typography) {
  const key = nodeKey(visualId, `${prefix}-${part.id}-part`);
  const x = `${width} * ${part.x}`;
  const y = `${height} * ${part.y}`;
  const w = `${width} * ${part.width}`;
  const h = `${height} * ${part.height}`;
  const fill = sourceText(partColour(part, 'fill', palette));
  const stroke = sourceText(partColour(part, 'stroke', palette));
  const decorationOpacity = prefix === 'scene' ? ' opacity={0.38}' : '';
  const common = `key="${key}" x={${x}} y={${y}} width={${w}} height={${h}} rotation={${part.rotation}} fill={${fill}} stroke={${stroke}} lineWidth={canvasWidth * ${part.strokeWidth}}${decorationOpacity}`;
  if (part.primitive === 'circle' || part.primitive === 'ellipse') return `<Circle ${common} />`;
  if (part.primitive === 'rect') return `<Rect ${common} radius={Math.min(${w}, ${h}) * ${part.cornerRadius}} />`;
  if (part.primitive === 'text') return `<Txt key="${key}" text={${sourceText(part.text ?? '')}} x={${x}} y={${y}} width={${w}} height={${h}} fill={${sourceText(part.fillRole === 'transparent' ? palette.text : partColour(part, 'fill', palette))}} fontFamily={'Times New Roman, Times, serif'} fontSize={${typography.body}} textAlign={'center'}${decorationOpacity} />`;
  if (part.primitive === 'icon') {
    // Resolved against a bundled icon set (see motionCanvasIconLibrary.ts):
    // a real, professionally drawn glyph instead of a model-invented
    // silhouette. The schema already rejects unknown iconId values before a
    // spec reaches the compiler, so a miss here can only mean the icon
    // library itself changed; render nothing rather than break the scene.
    const icon = resolveMotionCanvasIcon(part.iconId ?? '');
    if (!icon) return '';
    const lineWidth = `canvasWidth * ${part.strokeWidth} * ${icon.viewBoxWidth} / Math.max(${w}, ${h})`;
    return `<Path key="${key}" data={${sourceText(icon.d)}} x={${x}} y={${y}} scale={[${w} / ${icon.viewBoxWidth}, ${h} / ${icon.viewBoxHeight}]} rotation={${part.rotation}} fill={${fill}} stroke={${stroke}} lineWidth={${lineWidth}}${decorationOpacity} />`;
  }
  if (part.primitive === 'path') {
    const coordinates = [
      ...(part.pathData ?? '').matchAll(
        /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/giu,
      ),
    ]
      .map(match => Number(match[0]))
      .filter(Number.isFinite);
    // Visual Director prompts use a 0..1 local path viewbox. Motion Canvas Path
    // coordinates are literal local units, so one normalized unit must fill the
    // requested part box. Legacy specs using an SVG-like 0..100 viewbox retain
    // the /100 conversion.
    const normalizedViewBox = coordinates.length > 0 && Math.max(...coordinates.map(Math.abs)) <= 2;
    const divisor = normalizedViewBox ? '' : ' / 100';
    const strokeViewBoxMultiplier = normalizedViewBox ? '' : ' * 100';
    // `scale` also scales a Motion Canvas Path's stroke. Counter-scale the
    // local line width so a normalized silhouette fills its requested box
    // without turning a 6-10px outline into a screen-sized band.
    const lineWidth = `canvasWidth * ${part.strokeWidth}${strokeViewBoxMultiplier} / Math.max(${w}, ${h})`;
    return `<Path key="${key}" data={${sourceText(part.pathData ?? '')}} x={${x}} y={${y}} scale={[${w}${divisor}, ${h}${divisor}]} rotation={${part.rotation}} fill={${fill}} stroke={${stroke}} lineWidth={${lineWidth}}${decorationOpacity} />`;
  }
  const points = part.points.map(point => `[${width} * ${point.x}, ${height} * ${point.y}]`).join(', ');
  return `<Line key="${key}" x={${x}} y={${y}} points={[${points}]} stroke={${stroke}} fill={${part.primitive === 'polygon' ? fill : "'#00000000'"}} lineWidth={canvasWidth * ${part.strokeWidth}} lineCap={'round'} lineJoin={'round'}${part.primitive === 'polygon' ? ' closed' : ''}${decorationOpacity} />`;
}

function entitySource(beat: MotionCanvasSceneSpecBeatV3, entity: MotionCanvasSceneSpecBeatV3['entities'][number], entityIndex: number, width: string, height: string, palette: Palette, typography: Typography, refName: string) {
  const w = `${width} * ${entity.box.width}`;
  const h = `${height} * ${entity.box.height}`;
  const parts = entity.parts.map(part => partSource(part, beat.visualId, entity.id, w, h, palette, typography)).join('\n            ');
  const labelSize = entity.role === 'primary' ? typography.label : typography.body;
  const label = entity.label ? `<Txt key="${nodeKey(beat.visualId, `${entity.id}-entity-label`)}" text={${sourceText(entity.label)}} y={${h} * 0.38} width={${w} * 0.92} fill={${sourceText(palette.text)}} fontFamily={'Times New Roman, Times, serif'} fontSize={${labelSize}} textAlign={'center'} />` : '';
  return `          <Layout key="${motionCanvasSemanticEvidenceKey(entity.intentId, beat.visualId)}" ref={${refName}} x={${width} * ${entity.box.x}} y={${height} * ${entity.box.y}} width={${w}} height={${h}}>
            ${parts}
            ${label}
          </Layout>`;
}

/**
 * Containment, overlap and attachment are meant to already be visible in the
 * composite object positions, so their connector is deliberately suppressed
 * here (an extra line would turn an illustration back into a generic node
 * diagram). That promise only holds if something actually pulls those
 * entities into contact; see pullImplicitlyConnectedEntitiesTogether, which
 * uses this exact predicate so the two decisions can never disagree.
 */
function relationshipConnectorIsRedundant(relationship: MotionCanvasSceneSpecBeatV3['relationships'][number], plannedBeat: Pick<PlannedBeat, 'visualIntent'> | undefined) {
  const intentType = plannedBeat?.visualIntent?.relations.find(item => item.id === relationship.intentId)?.type ?? '';
  return relationship.style === 'spatial' || /(?:inside|within|cover|contain|coexist|attached|part[- ]of|forms?[- ]on)/iu.test(intentType);
}

/** Radius of the ellipse inscribed in `box`, measured along a unit direction. */
function ellipseRadiusAlongDirection(box: {width: number; height: number}, dirX: number, dirY: number) {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  if (halfWidth <= 0 || halfHeight <= 0) return 0;
  const denominator = Math.sqrt((dirX / halfWidth) ** 2 + (dirY / halfHeight) ** 2);
  return denominator > 0 ? 1 / denominator : 0;
}

/**
 * A relationship whose connector is suppressed as redundant (see above) still
 * needs its two entities to actually touch, or the "attachment" it describes
 * silently disappears into two unrelated floating shapes. This nudges the
 * `to` entity toward `from` — never further apart — just enough to close the
 * gap, using each box's ellipse radius along the connecting direction so it
 * behaves reasonably whether the pair sits side by side or diagonally.
 */
function pullImplicitlyConnectedEntitiesTogether(
  entities: MotionCanvasSceneSpecV3['beats'][number]['entities'],
  relationships: MotionCanvasSceneSpecV3['beats'][number]['relationships'],
  plannedBeat: Pick<PlannedBeat, 'visualIntent'> | undefined,
) {
  const boxes = new Map(entities.map(entity => [entity.id, entity.box]));
  for (const relationship of relationships) {
    if (relationship.from === relationship.to || !relationshipConnectorIsRedundant(relationship, plannedBeat)) continue;
    const fromBox = boxes.get(relationship.from);
    const toBox = boxes.get(relationship.to);
    if (!fromBox || !toBox) continue;
    const dx = toBox.x - fromBox.x;
    const dy = toBox.y - fromBox.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) continue;
    const dirX = dx / distance;
    const dirY = dy / distance;
    const desiredDistance = (ellipseRadiusAlongDirection(fromBox, dirX, dirY) + ellipseRadiusAlongDirection(toBox, dirX, dirY)) * 0.82;
    if (distance <= desiredDistance) continue;
    boxes.set(relationship.to, {...toBox, x: fromBox.x + dirX * desiredDistance, y: fromBox.y + dirY * desiredDistance});
  }
  return entities.map(entity => ({...entity, box: boxes.get(entity.id)!}));
}

function relationshipSource(beat: MotionCanvasSceneSpecBeatV3, relationship: MotionCanvasSceneSpecBeatV3['relationships'][number], entities: Map<string, MotionCanvasSceneSpecBeatV3['entities'][number]>, width: string, height: string, palette: Palette, typography: Typography, plannedBeat: PlannedBeat) {
  if (relationshipConnectorIsRedundant(relationship, plannedBeat) && !relationship.intentId) {
    return '';
  }
  const from = entities.get(relationship.from)!;
  const to = entities.get(relationship.to)!;
  const points = [
    {x: from.box.x, y: from.box.y},
    ...relationship.via,
    {x: to.box.x, y: to.box.y},
  ].map(point => `[${width} * ${point.x}, ${height} * ${point.y}]`).join(', ');
  const colour = sourceText(emphasisColor(relationship.emphasis, palette));
  const dash = relationship.style === 'dashed' ? ' lineDash={[canvasWidth * 0.012, canvasWidth * 0.008]}' : '';
  const arrow = relationship.style === 'arrow' || relationship.style === 'curved' ? ' endArrow' : '';
  const midX = (from.box.x + to.box.x) / 2;
  const midY = (from.box.y + to.box.y) / 2 - 0.055;
  const label = relationship.label ? `\n          <Txt key="${nodeKey(beat.visualId, `${relationship.id}-relationship-label`)}" text={${sourceText(relationship.label)}} x={${width} * ${midX}} y={${height} * ${midY}} fill={${sourceText(palette.text)}} fontFamily={'Times New Roman, Times, serif'} fontSize={${typography.body}} />` : '';
  return `          <Line key="${relationship.intentId ? motionCanvasSemanticEvidenceKey(relationship.intentId, beat.visualId) : nodeKey(beat.visualId, `${relationship.id}-relationship`)}" points={[${points}]} stroke={${colour}} lineWidth={canvasWidth * ${relationship.emphasis === 'primary' ? 0.008 : 0.005}} lineCap={'round'} lineJoin={'round'}${dash}${arrow} />${label}`;
}

/** Give each semantic action a small visible cue with its exact intent key,
 * allowing the runtime semantic gate to prove the action was on screen. */
function actionEvidenceSource(beat: MotionCanvasSceneSpecBeatV3, width: string, height: string, palette: Palette) {
  const entities = new Map(beat.entities.map(entity => [entity.id, entity]));
  return beat.actions.flatMap(action => {
    if (!action.intentId) return [];
    const target = entities.get(action.targets[0] ?? '');
    if (!target) return [];
    const directionX = action.direction === 'left' ? -1 : action.direction === 'right' ? 1 : 0;
    const directionY = action.direction === 'up' ? -1 : action.direction === 'down' ? 1 : 0;
    const startX = target.box.x - directionX * 0.055;
    const startY = target.box.y - directionY * 0.055;
    const endX = target.box.x + (directionX || 1) * 0.055;
    const endY = target.box.y + directionY * 0.055;
    return [`          <Line key="${motionCanvasSemanticEvidenceKey(action.intentId, beat.visualId)}" points={[[${width} * ${startX}, ${height} * ${startY}], [${width} * ${endX}, ${height} * ${endY}]]} stroke={${sourceText(palette.accent)}} lineWidth={canvasWidth * 0.006} lineCap={'round'} endArrow opacity={0.72} />`];
  }).join('\n');
}

function actionSource(beat: MotionCanvasSceneSpecBeatV3, beatIndex: number, refs: Map<string, {name: string; x: string; y: string}>) {
  const duration = `Math.min(0.34, beatDuration${beatIndex + 1} * 0.07)`;
  return beat.actions.map(action => {
    const targets = action.targets.map(target => refs.get(target)).filter((target): target is {name: string; x: string; y: string} => Boolean(target));
    const calls = targets.flatMap(target => {
      const vertical = action.direction === 'up' || action.direction === 'down';
      const property = vertical ? 'y' : 'x';
      const rest = vertical ? target.y : target.x;
      const sign = action.direction === 'left' || action.direction === 'up' ? -1 : 1;
      const delta = `${vertical ? 'safeHeight' : 'safeWidth'} * ${action.amount * sign}`;
      if (action.kind === 'move' || action.kind === 'flow') return [`${target.name}().${property}(${rest} + ${delta}, ${duration}, easeInOutCubic)`, `${target.name}().${property}(${rest}, ${duration}, easeInOutCubic)`];
      if (action.kind === 'transform') return [`${target.name}().rotation(${action.direction === 'counterclockwise' ? -10 : 10}, ${duration}, easeInOutCubic)`, `${target.name}().rotation(0, ${duration}, easeInOutCubic)`];
      if (action.kind === 'swap' || action.kind === 'compare') return [`${target.name}().scale([1.06, 0.96], ${duration}, easeInOutCubic)`, `${target.name}().scale([1, 1], ${duration}, easeInOutCubic)`];
      return [`${target.name}().scale([1.07, 1.07], ${duration}, easeInOutCubic)`, `${target.name}().scale([1, 1], ${duration}, easeInOutCubic)`];
    });
    return calls.length ? `  // semantic-action:${action.intentId ?? action.id}\n  yield* all(\n    ${calls.join(',\n    ')},\n  );` : '';
  }).filter(Boolean).join('\n');
}

export function compileMotionCanvasSceneSpecV3(options: {spec: MotionCanvasSceneSpecV3; beats: PlannedBeat[]; outlineTitle: string; frame: VideoFrame; backgroundColor: string; visualBible: VoiceVisualPlan['visualBible']}) {
  const {beats, backgroundColor} = options;
  const spec = fitMotionCanvasSceneSpecV3ToSafeGeometry(options.spec, beats);
  validateAgainstPlan(spec, beats);
  const fallbackBible = {palette: {background: backgroundColor, surface: '#1B263B', primary: '#86C5FF', accent: '#FFB86B', text: '#F8F5EE'}, typographyScale: {title: 64, label: 34, body: 28}};
  const palette = resolveMotionCanvasPresentationPalette(options.visualBible?.palette ?? fallbackBible.palette, backgroundColor);
  const typography = options.visualBible?.typographyScale ?? fallbackBible.typographyScale;
  const lifecycleKeys = [...new Set(beats.flatMap(beat => [...(beat.visualLifecycle?.enter ?? []), ...(beat.visualLifecycle?.stay ?? []), ...(beat.visualLifecycle?.exit ?? [])]))];
  const primaryKeys = new Set(beats.map(beat => beat.primaryBlock).filter((key): key is string => Boolean(key)));
  const nodes = lifecycleKeys.map((key, index) => {
    const primaryBeat = beats.findIndex(beat => beat.primaryBlock === key);
    const firstBeat = beats.findIndex(beat => [...(beat.visualLifecycle?.enter ?? []), ...(beat.visualLifecycle?.stay ?? []), ...(beat.visualLifecycle?.exit ?? [])].includes(key));
    const beatIndex = primaryBeat >= 0 ? primaryBeat : Math.max(0, firstBeat);
    return {key, name: `lifecycleNode${index + 1}`, width: `lifecycleNode${index + 1}Width`, height: `lifecycleNode${index + 1}Height`, primary: primaryKeys.has(key), beatIndex, geometry: compositionGeometry(beats[beatIndex]!), supportIndex: lifecycleKeys.slice(0, index).filter(item => !primaryKeys.has(item)).length};
  });
  const nodeByKey = new Map(nodes.map(node => [node.key, node]));
  const entityRef = (beatIndex: number, entityIndex: number) => `beat${beatIndex + 1}Entity${entityIndex + 1}`;
  const primarySources = nodes.filter(node => node.primary).map(node => {
    const beatIndexes = beats.map((beat, index) => beat.primaryBlock === node.key ? index : -1).filter(index => index >= 0);
    const details = beatIndexes.map(beatIndex => {
      const sceneBeat = spec.beats[beatIndex]!;
      const entityMap = new Map(sceneBeat.entities.map(entity => [entity.id, entity]));
      const headline = sceneBeat.headline ? `<Txt key="${nodeKey(sceneBeat.visualId, 'headline-label')}" text={${sourceText(sceneBeat.headline)}} y={-${node.height} * 0.46} width={${node.width} * 0.9} fill={${sourceText(palette.text)}} fontFamily={'Times New Roman, Times, serif'} fontSize={${typography.title}} textAlign={'center'} />` : '';
      const decorations = sceneBeat.decorations.map(part => partSource(part, sceneBeat.visualId, 'scene', node.width, node.height, palette, typography)).join('\n          ');
      const relationships = sceneBeat.relationships.map(relation => relationshipSource(sceneBeat, relation, entityMap, node.width, node.height, palette, typography, beats[beatIndex]!)).join('\n');
      const actionEvidence = actionEvidenceSource(sceneBeat, node.width, node.height, palette);
      const entities = sceneBeat.entities.map((entity, index) => entitySource(sceneBeat, entity, index, node.width, node.height, palette, typography, entityRef(beatIndex, index))).join('\n');
      return `        <Layout key="${nodeKey(sceneBeat.visualId, 'detail-layer')}" ref={beatDetail${beatIndex + 1}} opacity={0} width={${node.width}} height={${node.height}}>
          ${headline}
          ${decorations}
${relationships}
${actionEvidence}
${entities}
        </Layout>`;
    }).join('\n');
    return `      <Layout key="${node.key}" ref={${node.name}} width={${node.width}} height={${node.height}} x={safeWidth * ${node.geometry.x}} y={canvasHeight} opacity={0}>
${details}
      </Layout>`;
  }).join('\n');
  // In Scene Graph v3, secondary lifecycle keys identify semantic detail
  // layers already drawn inside the primary composite. Keep an attached ref
  // for the timing contract, but never invent a generic diamond/card merely
  // because the planner declared another lifecycle key.
  const supportSources = nodes.filter(node => !node.primary).map(node =>
    `        <Layout key="${node.key}" ref={${node.name}} width={0} height={0} x={0} y={0} opacity={0} />`,
  ).join('\n');
  const timing = beats.map((beat, beatIndex) => {
    const lifecycle = beat.visualLifecycle!;
    const primary = nodeByKey.get(beat.primaryBlock!)!;
    const enter = lifecycle.enter.flatMap(key => {
      const node = nodeByKey.get(key)!;
      const restY = node.primary ? `safeHeight * ${node.geometry.y}` : `safeHeight * ${-0.26 + (node.supportIndex % 3) * 0.25}`;
      return [`    ${node.name}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`, `    ${node.name}().y(${restY}, enterDuration${beatIndex + 1}, easeInOutCubic)`];
    });
    const retained = lifecycle.stay.filter(key => !lifecycle.enter.includes(key)).map(key => `    ${nodeByKey.get(key)!.name}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`);
    const exit = lifecycle.exit.flatMap(key => {
      const node = nodeByKey.get(key)!;
      return [`    ${node.name}().opacity(0, exitDuration${beatIndex + 1}, easeInOutCubic)`, `    ${node.name}().y(canvasHeight, exitDuration${beatIndex + 1}, easeInOutCubic)`];
    });
    const refs = new Map(spec.beats[beatIndex]!.entities.map((entity, index) => [entity.id, {name: entityRef(beatIndex, index), x: `${primary.width} * ${entity.box.x}`, y: `${primary.height} * ${entity.box.y}`} ]));
    return `  // lifecycle:beat:${beat.id}:enter=${lifecycle.enter.join(',')}|stay=${lifecycle.stay.join(',')}|exit=${lifecycle.exit.join(',')}|primary=${beat.primaryBlock}
  yield* waitUntil('beat:${beat.id}:start');
  const beatDuration${beatIndex + 1} = useDuration('beat:${beat.id}:end');
  const beatEndTime${beatIndex + 1} = useThread().time() + beatDuration${beatIndex + 1};
  const enterDuration${beatIndex + 1} = Math.min(0.45, Math.max(0.08, beatDuration${beatIndex + 1} * 0.1));
  const exitDuration${beatIndex + 1} = Math.min(0.4, Math.max(0.08, beatDuration${beatIndex + 1} * 0.09));
  yield* all(
${[...enter, ...retained, `    beatDetail${beatIndex + 1}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`].join(',\n')},
  );
${actionSource(spec.beats[beatIndex]!, beatIndex, refs)}
  yield* waitFor(Math.max(0, beatEndTime${beatIndex + 1} - useThread().time() - exitDuration${beatIndex + 1}));
  yield* all(
    beatDetail${beatIndex + 1}().opacity(0, exitDuration${beatIndex + 1}, easeInOutCubic),
${exit.join(',\n')},
  );
  yield* waitFor(Math.max(0, beatEndTime${beatIndex + 1} - useThread().time()));`;
  }).join('\n\n');

  return `// pad-semantic:bindings-v1
${SPEC_HEADER_V3}${encodeMotionCanvasSceneSpecV3(spec)}
import {Circle, Layout, Line, makeScene2D, Path, Rect, Txt} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * 0.08;
  const safeMarginY = canvasHeight * 0.07;
  const safeWidth = canvasWidth - safeMarginX * 2;
  const safeHeight = canvasHeight - safeMarginY * 2;
${nodes.map(node => `  const ${node.name} = createRef<${node.primary ? 'Layout' : 'Rect'}>();\n  const ${node.width} = ${node.primary ? `safeWidth * ${node.geometry.width}` : 'safeWidth * 0.08'};\n  const ${node.height} = ${node.primary ? `safeHeight * ${node.geometry.height}` : 'safeWidth * 0.08'};`).join('\n')}
${beats.map((_beat, index) => `  const beatDetail${index + 1} = createRef<Layout>();`).join('\n')}
${spec.beats.flatMap((beat, beatIndex) => beat.entities.map((_entity, entityIndex) => `  const ${entityRef(beatIndex, entityIndex)} = createRef<Layout>();`)).join('\n')}

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

${timing}
});
`;
}
