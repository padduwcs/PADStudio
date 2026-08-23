import {Buffer} from 'node:buffer';
import {z} from 'zod';
import type {VoiceVisualPlan} from '../shared/topic.ts';
import type {VideoFrame} from '../shared/videoFormat.ts';

const semanticIdPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
const componentIdPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;
const randomLikeSegmentPattern = /^[a-f0-9]{8,}$/i;

export const motionCanvasVisualKindValues = ['tree', 'graph', 'process', 'comparison', 'trajectory', 'orbit', 'grid', 'queue', 'stack', 'gauge'] as const;
export const motionCanvasMotionValues = ['reveal', 'flow', 'focus', 'pulse', 'orbit', 'compare'] as const;

const emphasisValues = ['primary', 'secondary', 'muted'] as const;
const componentId = z.string().trim().min(1).max(42).regex(componentIdPattern).refine(
  value => !value.split('-').some(segment => randomLikeSegmentPattern.test(segment)),
  'Component ids must be semantic and stable.',
);
// Scene Spec is an illustration contract, not a prose layout language.  Keep
// every textual affordance deliberately short so the compiler has room for
// the diagram to carry the explanation.
const compactText = z.string().trim().min(1).max(18);
const optionalCompactText = compactText.nullable();

// Codex structured output accepts `anyOf`, but rejects JSON Schema `oneOf`.
// Zod emits `oneOf` for discriminatedUnion, whereas this union emits `anyOf`
// while preserving the same runtime validation and inferred element type.
const MotionCanvasSceneSpecElementSchema = z.union([
  z.object({type: z.literal('node'), id: componentId, shape: z.enum(['circle', 'pill', 'diamond', 'hexagon']), label: optionalCompactText, value: z.string().trim().min(1).max(10).nullable(), emphasis: z.enum(emphasisValues), concepts: z.array(compactText).min(1).max(2)}).strict(),
  z.object({type: z.literal('gate'), id: componentId, state: z.enum(['open', 'closed', 'check', 'warning']), label: optionalCompactText, value: z.string().trim().min(1).max(10).nullable(), emphasis: z.enum(emphasisValues), concepts: z.array(compactText).min(1).max(2)}).strict(),
  z.object({type: z.literal('icon'), id: componentId, icon: z.enum(['spark', 'check', 'warning', 'target', 'clock', 'shield', 'database']), label: optionalCompactText, emphasis: z.enum(emphasisValues), concepts: z.array(compactText).min(1).max(2)}).strict(),
]);
const MotionCanvasSceneSpecRelationshipSchema = z.object({id: componentId, type: z.enum(['edge', 'arrow', 'path']), from: componentId, to: componentId, via: z.array(componentId).max(3), label: z.string().trim().min(1).max(12).nullable(), emphasis: z.enum(emphasisValues)}).strict();
const MotionCanvasSceneSpecGroupSchema = z.object({id: componentId, label: z.string().trim().min(1).max(12).nullable(), members: z.array(componentId).min(2).max(7), emphasis: z.enum(emphasisValues)}).strict();
const MotionCanvasSceneSpecMotionSchema = z.object({kind: z.enum(motionCanvasMotionValues), targets: z.array(componentId).min(1).max(4), direction: z.enum(['left', 'right', 'up', 'down', 'clockwise']).nullable()}).strict();
const MotionCanvasSceneSpecPlanAlignmentSchema = z.object({planTerms: z.array(compactText).min(1).max(3)}).strict();

export const MotionCanvasSceneSpecBeatSchema = z.object({
  beatId: z.string().uuid(),
  visualId: z.string().trim().min(3).max(52).regex(semanticIdPattern).refine(value => !value.split('-').some(segment => randomLikeSegmentPattern.test(segment)), 'visualId must be semantic and stable.'),
  headline: z.string().trim().min(1).max(32),
  caption: z.string().trim().min(1).max(30).nullable(),
  template: z.enum(motionCanvasVisualKindValues),
  focus: z.enum(['left', 'center', 'right']),
  planAlignment: MotionCanvasSceneSpecPlanAlignmentSchema,
  elements: z.array(MotionCanvasSceneSpecElementSchema).min(2).max(7),
  relationships: z.array(MotionCanvasSceneSpecRelationshipSchema).max(10),
  groups: z.array(MotionCanvasSceneSpecGroupSchema).max(3),
  motions: z.array(MotionCanvasSceneSpecMotionSchema).min(1).max(3),
}).strict().superRefine((beat, context) => {
  const elementIds = new Set(beat.elements.map(element => element.id));
  const allIds = [...beat.elements.map(element => element.id), ...beat.relationships.map(relationship => relationship.id), ...beat.groups.map(group => group.id)];
  if (new Set(allIds).size !== allIds.length) context.addIssue({code: 'custom', message: 'Element, relationship, and group ids must be unique.'});
  for (const relationship of beat.relationships) for (const endpoint of [relationship.from, relationship.to, ...relationship.via]) if (!elementIds.has(endpoint)) context.addIssue({code: 'custom', path: ['relationships'], message: `Relationship ${relationship.id} references unknown element ${endpoint}.`});
  for (const group of beat.groups) if (new Set(group.members).size !== group.members.length || group.members.some(member => !elementIds.has(member))) context.addIssue({code: 'custom', path: ['groups'], message: `Group ${group.id} must contain unique declared elements.`});
  for (const motion of beat.motions) if (new Set(motion.targets).size !== motion.targets.length || motion.targets.some(target => !elementIds.has(target))) context.addIssue({code: 'custom', path: ['motions'], message: 'Motion targets must be unique declared elements.'});
  if (['tree', 'graph', 'process', 'trajectory', 'queue'].includes(beat.template) && beat.relationships.length === 0) context.addIssue({code: 'custom', path: ['relationships'], message: `${beat.template} needs at least one explicit relationship.`});
  const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
  const concepts = new Set(beat.elements.flatMap(element => element.concepts).map(comparable));
  for (const term of beat.planAlignment.planTerms) if (!concepts.has(comparable(term))) context.addIssue({code: 'custom', path: ['planAlignment', 'planTerms'], message: `Plan term "${term}" must ground a visual element concept.`});
  const text = [beat.headline, beat.caption ?? '', ...beat.elements.flatMap(element => [element.label ?? '', 'value' in element ? element.value ?? '' : '']), ...beat.relationships.map(relationship => relationship.label ?? ''), ...beat.groups.map(group => group.label ?? '')].join(' ').trim();
  if (text.length > 118 || (text ? text.split(/\s+/u).filter(Boolean).length : 0) > 20) context.addIssue({code: 'custom', message: 'One beat may render at most 118 text characters and 20 words.'});
});

export const MotionCanvasSceneSpecSchema = z.object({version: z.literal(2), visualAnchor: z.string().trim().min(3).max(100), beats: z.array(MotionCanvasSceneSpecBeatSchema).min(1).max(5)}).strict();
/** Read-only support for source created before Scene Spec v2. */
const LegacyMotionCanvasSceneSpecSchema = z.object({version: z.literal(1), visualAnchor: z.string(), beats: z.array(z.object({beatId: z.string().uuid(), visualId: z.string(), headline: z.string(), caption: z.string().nullable(), visualKind: z.string(), motion: z.string(), focus: z.enum(['left', 'center', 'right']), items: z.array(z.object({label: z.string(), value: z.string().nullable(), emphasis: z.string()}).strict())}).strict())}).strict();

export type MotionCanvasSceneSpec = z.infer<typeof MotionCanvasSceneSpecSchema>;
export type ExtractedMotionCanvasSceneSpec = MotionCanvasSceneSpec | z.infer<typeof LegacyMotionCanvasSceneSpecSchema>;
type PlannedBeat = VoiceVisualPlan['sections'][number]['beats'][number];
type SceneSpecBeat = MotionCanvasSceneSpec['beats'][number];
type SceneSpecElement = SceneSpecBeat['elements'][number];
type Palette = NonNullable<VoiceVisualPlan['visualBible']>['palette'];
type Typography = NonNullable<VoiceVisualPlan['visualBible']>['typographyScale'];
const SPEC_HEADER = '// pad-scene-spec-v2:';
const LEGACY_SPEC_HEADER = '// pad-scene-spec-v1:';

function sourceText(value: string) { return JSON.stringify(value.replace(/\s+/g, ' ').trim()); }
function semanticNodeKey(visualId: string, role: string) { const suffix = `-${role}`; const base = visualId.slice(0, Math.max(3, 80 - suffix.length)).replace(/-+$/u, ''); return `${base}${suffix}`; }
function normalizeText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/đ/gu, 'd').replace(/\s+/gu, ' ').trim(); }

export function sceneSpecPlanAlignmentIssues(beat: SceneSpecBeat, plan: Pick<PlannedBeat, 'visualDescription' | 'visualPurpose' | 'animationDescription'>) {
  const plannedText = normalizeText([plan.visualDescription, plan.visualPurpose ?? '', plan.animationDescription].join(' '));
  const concepts = new Set(beat.elements.flatMap(element => element.concepts).map(normalizeText));
  const issues: string[] = [];
  for (const term of beat.planAlignment.planTerms) {
    const normalized = normalizeText(term);
    if (!plannedText.includes(normalized)) issues.push(`plan term "${term}" does not occur in this beat's visual plan.`);
    if (!concepts.has(normalized)) issues.push(`plan term "${term}" is not bound to an illustrative element.`);
  }
  return issues;
}

/**
 * Template choice is compiler policy, not a fragile pass/fail test of whether
 * a model selected the same enum word as our natural-language heuristic.  A
 * Scene Spec still declares its preferred template, but an explicit visual
 * metaphor in the reviewed Visual Plan wins deterministically at compile
 * time.  This preserves semantic fidelity without turning a valid model
 * response into a dead-end generation failure.
 */
export function templateRequiredByVisualPlan(plan: Pick<PlannedBeat, 'visualDescription' | 'visualPurpose' | 'animationDescription'>): SceneSpecBeat['template'] | null {
  const plannedText = normalizeText([plan.visualDescription, plan.visualPurpose ?? '', plan.animationDescription].join(' '));
  const expectations: Array<{pattern: RegExp; template: SceneSpecBeat['template']}> = [
    {pattern: /\b(heap|cha|con|theo tang|cay)\b/u, template: 'tree'},
    {pattern: /\b(vong|bao quanh|quay)\b/u, template: 'orbit'},
    {pattern: /\b(duong ray|hang doi|fifo|vao truoc)\b/u, template: 'queue'},
    {pattern: /\b(lan|so sanh|doi chieu|khac voi)\b/u, template: 'comparison'},
    {pattern: /\b(quy dao|vuot|truot|di toi|nhay qua|uon cong)\b/u, template: 'trajectory'},
    {pattern: /\b(luoi|o vuong)\b/u, template: 'grid'},
    {pattern: /\b(chong|xep lop)\b/u, template: 'stack'},
    {pattern: /\b(do thi|cac dinh|dinh.*canh|canh.*dinh)\b/u, template: 'graph'},
  ];
  return expectations.find(expectation => expectation.pattern.test(plannedText))?.template ?? null;
}

function compilerResolvedSpec(spec: MotionCanvasSceneSpec, beats: PlannedBeat[]): MotionCanvasSceneSpec {
  return {
    ...spec,
    beats: spec.beats.map((beat, index) => ({
      ...beat,
      template: templateRequiredByVisualPlan(beats[index]!) ?? beat.template,
    })),
  };
}

type PresentationPalette = {background: string; surface: string; primary: string; accent: string; text: string};

function isDarkColour(value: string) {
  const hex = value.trim().replace(/^#/u, '');
  if (!/^[\da-f]{6}$/iu.test(hex)) return true;
  const [red, green, blue] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = (channel: number) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red!) + 0.7152 * linear(green!) + 0.0722 * linear(blue!) < 0.42;
}

/**
 * Earlier planners used a high-saturation cyan/yellow-on-black default.  It
 * passed contrast checks but read like a developer palette rather than an
 * editorial explanation.  Preserve deliberate palettes, but deterministically
 * upgrade the two legacy defaults so existing projects improve on their next
 * compile without requiring their Visual Plan to be regenerated.
 */
export function resolveMotionCanvasPresentationPalette(palette: PresentationPalette, backgroundColor?: string): PresentationPalette {
  const normalized = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, value.trim().toLowerCase()])) as PresentationPalette;
  const legacyDark = normalized.surface === '#171a1f' && normalized.primary === '#35d6e5' && normalized.accent === '#ffc857' && normalized.text === '#f5f7fa';
  const legacyGreen = normalized.surface === '#173b31' && normalized.primary === '#51b68e' && normalized.accent === '#f5c451' && normalized.text === '#f7fbf8';
  if (!legacyDark && !legacyGreen) return palette;
  const background = backgroundColor ?? palette.background;
  return isDarkColour(background)
    ? {background, surface: '#1B263B', primary: '#86C5FF', accent: '#FFB86B', text: '#F8F5EE'}
    : {background, surface: '#EDF2F7', primary: '#2867A4', accent: '#C86A2B', text: '#17212B'};
}

function emphasisColor(emphasis: SceneSpecElement['emphasis'] | SceneSpecBeat['relationships'][number]['emphasis'], palette: Palette) { return emphasis === 'primary' ? palette.accent : emphasis === 'secondary' ? palette.primary : palette.surface; }
function textColorFor(emphasis: SceneSpecElement['emphasis'], palette: Palette) { return emphasis === 'muted' ? palette.text : palette.background; }
function layoutGeometry(beat: PlannedBeat, focus: SceneSpecBeat['focus']) {
  const density = beat.compositionContract?.density ?? 'balanced'; const densityScale = density === 'sparse' ? 0.92 : density === 'dense' ? 1.06 : 1;
  switch (beat.compositionContract?.layout ?? 'center-focus') {
    case 'left-right-split': return {widthRatio: 0.48, heightRatio: 0.6 * densityScale, xRatio: focus === 'right' ? 0.22 : -0.22, yRatio: 0};
    case 'top-bottom-stack': return {widthRatio: 0.82, heightRatio: 0.48 * densityScale, xRatio: 0, yRatio: focus === 'right' ? 0.18 : -0.18};
    case 'grid': return {widthRatio: 0.72, heightRatio: 0.58 * densityScale, xRatio: focus === 'left' ? -0.1 : focus === 'right' ? 0.1 : 0, yRatio: 0};
    case 'full-bleed': return {widthRatio: 0.9, heightRatio: 0.72, xRatio: 0, yRatio: 0};
    default: return {widthRatio: 0.76, heightRatio: 0.56 * densityScale, xRatio: 0, yRatio: 0};
  }
}

type DiagramPoint = {x: number; y: number; width: number; height: number};
function diagramPositions(template: SceneSpecBeat['template'], count: number): DiagramPoint[] {
  const horizontal = Array.from({length: count}, (_item, index) => ({x: count === 1 ? 0 : -0.34 + (0.68 * index) / Math.max(1, count - 1), y: 0.1, width: Math.min(0.22, 0.7 / Math.max(2, count)), height: 0.16}));
  if (template === 'tree') return [[0, -0.18], [-0.25, 0.01], [0.25, 0.01], [-0.36, 0.2], [0, 0.2], [0.36, 0.2], [0, 0.31]].slice(0, count).map(point => ({x: point[0]!, y: point[1]!, width: 0.19, height: 0.14}));
  if (template === 'graph') return Array.from({length: count}, (_item, index) => { const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, count); return {x: Math.cos(angle) * 0.28, y: 0.08 + Math.sin(angle) * 0.18, width: 0.17, height: 0.14}; });
  if (template === 'trajectory') return [[-0.36, 0.25], [-0.14, 0.08], [0.08, -0.07], [0.3, -0.24], [0.38, 0.16], [0, 0.3], [-0.22, -0.2]].slice(0, count).map(point => ({x: point[0]!, y: point[1]!, width: 0.16, height: 0.13}));
  if (template === 'orbit') return Array.from({length: count}, (_item, index) => { if (index === 0) return {x: 0, y: 0.08, width: 0.22, height: 0.17}; const angle = -Math.PI / 2 + (Math.PI * 2 * (index - 1)) / Math.max(1, count - 1); return {x: Math.cos(angle) * 0.31, y: 0.08 + Math.sin(angle) * 0.22, width: 0.15, height: 0.12}; });
  if (template === 'grid' || template === 'comparison') {
    const columns = count > 4 ? 3 : Math.min(2, count);
    const rows = Math.ceil(count / columns);
    const width = columns === 3 ? 0.2 : 0.28;
    const height = rows > 3 ? 0.1 : 0.13;
    return Array.from({length: count}, (_item, index) => ({
      x: (index % columns - (columns - 1) / 2) * (columns === 3 ? 0.27 : 0.42),
      y: -0.14 + Math.floor(index / columns) * (rows > 3 ? 0.14 : 0.18),
      width,
      height,
    }));
  }
  if (template === 'stack') {
    const spacing = count > 1 ? Math.min(0.1, 0.5 / (count - 1)) : 0;
    return Array.from({length: count}, (_item, index) => ({x: 0, y: -0.18 + index * spacing, width: 0.5, height: Math.min(0.1, Math.max(0.07, spacing - 0.015))}));
  }
  if (template === 'gauge') {
    const supportCount = Math.max(0, count - 1);
    const columns = supportCount > 4 ? 3 : Math.min(2, Math.max(1, supportCount));
    return Array.from({length: count}, (_item, index) => {
      if (index === 0) return {x: 0, y: -0.15, width: 0.27, height: 0.18};
      const supportIndex = index - 1;
      return {
        x: (supportIndex % columns - (columns - 1) / 2) * (columns === 3 ? 0.27 : 0.42),
        y: 0.1 + Math.floor(supportIndex / columns) * 0.16,
        width: columns === 3 ? 0.18 : 0.24,
        height: 0.12,
      };
    });
  }
  return horizontal;
}

function captionYRatio(beat: SceneSpecBeat) {
  const lowestElement = Math.max(
    ...diagramPositions(beat.template, beat.elements.length).map(
      point => point.y + point.height / 2,
    ),
  );
  return Math.min(0.45, Math.max(0.34, lowestElement + 0.105));
}

function iconGlyphSource(icon: Extract<SceneSpecElement, {type: 'icon'}>['icon'], key: string, width: string, height: string, color: string) {
  const line = (role: string, points: string) => `<Line key="${key}-${role}" points={${points}} stroke={${sourceText(color)}} lineWidth={canvasWidth * 0.006} lineCap={'round'} lineJoin={'round'} />`;
  switch (icon) {
    case 'check': return line('check', `[[-${width} * 0.22, 0], [-${width} * 0.05, ${height} * 0.17], [${width} * 0.25, -${height} * 0.2]]`);
    case 'warning': return `${line('warning-left', `[[0, -${height} * 0.25], [0, ${height} * 0.08]]`)}\n${line('warning-dot', `[[0, ${height} * 0.21], [0, ${height} * 0.22]]`)}`;
    case 'target': return `<Circle key="${key}-target-ring" width={${width} * 0.48} height={${height} * 0.48} fill={'#00000000'} stroke={${sourceText(color)}} lineWidth={canvasWidth * 0.005} />\n${line('target-cross', `[[-${width} * 0.3, 0], [${width} * 0.3, 0]]`)}`;
    case 'clock': return `${line('clock-hand-a', `[[0, 0], [0, -${height} * 0.23]]`)}\n${line('clock-hand-b', `[[0, 0], [${width} * 0.18, ${height} * 0.1]]`)}`;
    case 'shield': return `${line('shield-left', `[[0, -${height} * 0.28], [-${width} * 0.22, -${height} * 0.1], [-${width} * 0.13, ${height} * 0.26], [0, ${height} * 0.32]]`)}\n${line('shield-right', `[[0, -${height} * 0.28], [${width} * 0.22, -${height} * 0.1], [${width} * 0.13, ${height} * 0.26], [0, ${height} * 0.32]]`)}`;
    case 'database': return `${line('database-top', `[[-${width} * 0.22, -${height} * 0.14], [${width} * 0.22, -${height} * 0.14]]`)}\n${line('database-bottom', `[[-${width} * 0.22, ${height} * 0.16], [${width} * 0.22, ${height} * 0.16]]`)}`;
    case 'spark': default: return `${line('spark-a', `[[0, -${height} * 0.28], [0, ${height} * 0.28]]`)}\n${line('spark-b', `[[-${width} * 0.28, 0], [${width} * 0.28, 0]]`)}`;
  }
}

function elementSource(beat: SceneSpecBeat, element: SceneSpecElement, point: DiagramPoint, palette: Palette, typography: Typography, widthName: string, heightName: string, refName: string) {
  const key = semanticNodeKey(beat.visualId, `${element.id}-element`), shapeKey = semanticNodeKey(beat.visualId, `${element.id}-shape`), labelKey = semanticNodeKey(beat.visualId, `${element.id}-label`);
  const width = `${widthName} * ${point.width}`, height = `${heightName} * ${point.height}`, color = emphasisColor(element.emphasis, palette), textColor = textColorFor(element.emphasis, palette);
  // A semantic component gets one compact label, never a title plus a second
  // value line.  This cuts text density without discarding the value itself.
  const displayText = element.label && 'value' in element && element.value
    ? `${element.label} · ${element.value}`
    : element.label ?? ('value' in element ? element.value : null);
  const label = displayText ? `<Txt key="${labelKey}" text={${sourceText(displayText)}} width={${width} * 0.82} fill={${sourceText(textColor)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={${typography.label}} textAlign={'center'} />` : '';
  const textContent = label;
  let surface: string;
  let containsText = false;
  if (element.type === 'icon') { containsText = true; surface = `          <Circle key="${shapeKey}" width={${width}} height={${height}} fill={${sourceText(color)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005}>\n            ${iconGlyphSource(element.icon, semanticNodeKey(beat.visualId, `${element.id}-glyph`), width, height, textColor)}\n            ${textContent}\n          </Circle>`; }
  else if (element.type === 'gate') { containsText = true; surface = `          <Rect key="${shapeKey}" width={${width}} height={${height}} radius={canvasWidth * 0.018} fill={${sourceText(color)}} stroke={${sourceText(element.state === 'warning' ? palette.accent : palette.primary)}} lineWidth={canvasWidth * 0.006}>
            <Rect key="${shapeKey}-diamond-mark" width={${width} * 0.36} height={${height} * 0.36} radius={canvasWidth * 0.006} rotation={45} fill={'#00000000'} stroke={${sourceText(element.state === 'warning' ? palette.accent : palette.primary)}} lineWidth={canvasWidth * 0.003} />
            ${textContent}
          </Rect>`; }
  else if (element.shape === 'circle') { containsText = true; surface = `          <Circle key="${shapeKey}" width={${width}} height={${height}} fill={${sourceText(color)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006}>\n            ${textContent}\n          </Circle>`; }
  else if (element.shape === 'diamond') { containsText = true; surface = `          <Rect key="${shapeKey}" width={${width}} height={${height}} radius={canvasWidth * 0.014} fill={${sourceText(color)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006}>
            <Rect key="${shapeKey}-diamond-mark" width={${width} * 0.4} height={${height} * 0.4} radius={canvasWidth * 0.006} rotation={45} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.003} />
            ${textContent}
          </Rect>`; }
  else { containsText = true; surface = `          <Rect key="${shapeKey}" width={${width}} height={${height}} radius={${element.shape === 'pill' ? `${height} * 0.42` : 'canvasWidth * 0.018'}} fill={${sourceText(color)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006}>\n            ${textContent}\n          </Rect>`; }
  return `          <Layout key="${key}" ref={${refName}} x={${widthName} * ${point.x}} y={${heightName} * ${point.y}} width={${width}} height={${height}}>
${surface}
${!containsText && label ? `            ${label}` : ''}
          </Layout>`;
}

function groupSource(beat: SceneSpecBeat, group: SceneSpecBeat['groups'][number], positions: Map<string, DiagramPoint>, palette: Palette, widthName: string, heightName: string) {
  const memberPoints = group.members.map(member => positions.get(member)!).filter(Boolean); if (memberPoints.length < 2) return '';
  const left = Math.min(...memberPoints.map(point => point.x - point.width / 2)) - 0.05, right = Math.max(...memberPoints.map(point => point.x + point.width / 2)) + 0.05, top = Math.min(...memberPoints.map(point => point.y - point.height / 2)) - 0.05, bottom = Math.max(...memberPoints.map(point => point.y + point.height / 2)) + 0.05;
  const label = group.label ? `\n          <Txt key="${semanticNodeKey(beat.visualId, `${group.id}-group-label`)}" text={${sourceText(group.label)}} x={${widthName} * ${left + 0.04}} y={${heightName} * ${top + 0.025}} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={canvasWidth * 0.018} />` : '';
  return `          <Rect key="${semanticNodeKey(beat.visualId, `${group.id}-group`)}" x={${widthName} * ${(left + right) / 2}} y={${heightName} * ${(top + bottom) / 2}} width={${widthName} * ${right - left}} height={${heightName} * ${bottom - top}} radius={canvasWidth * 0.025} fill={'#00000000'} stroke={${sourceText(emphasisColor(group.emphasis, palette))}} lineWidth={canvasWidth * 0.004} lineDash={[canvasWidth * 0.012, canvasWidth * 0.008]} />${label}`;
}

function relationshipSource(beat: SceneSpecBeat, relationship: SceneSpecBeat['relationships'][number], positions: Map<string, DiagramPoint>, palette: Palette, widthName: string, heightName: string) {
  const ordered = [relationship.from, ...relationship.via, relationship.to].map(id => positions.get(id)).filter((point): point is DiagramPoint => Boolean(point)); if (ordered.length < 2) return '';
  const points = ordered.map(point => `[${widthName} * ${point.x}, ${heightName} * ${point.y}]`).join(', '), color = emphasisColor(relationship.emphasis, palette), arrow = relationship.type === 'arrow' ? ' endArrow' : '', dashed = relationship.type === 'path' ? ` lineDash={[canvasWidth * 0.012, canvasWidth * 0.008]}` : '', labelPoint = ordered[Math.floor(ordered.length / 2)]!;
  const label = relationship.label ? `\n          <Txt key="${semanticNodeKey(beat.visualId, `${relationship.id}-relationship-label`)}" text={${sourceText(relationship.label)}} x={${widthName} * ${labelPoint.x}} y={${heightName} * ${labelPoint.y - 0.075}} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={canvasWidth * 0.018} textAlign={'center'} />` : '';
  return `          <Line key="${semanticNodeKey(beat.visualId, `${relationship.id}-relationship`)}" points={[${points}]} stroke={${sourceText(color)}} lineWidth={canvasWidth * ${relationship.type === 'arrow' ? '0.008' : '0.005'}} lineCap={'round'} lineJoin={'round'}${arrow}${dashed} />${label}`;
}

function templateDecorationSource(beat: SceneSpecBeat, palette: Palette, widthName: string, heightName: string) {
  if (beat.template === 'orbit') return `          <Circle key="${semanticNodeKey(beat.visualId, 'orbit-ring')}" width={${widthName} * 0.66} height={${heightName} * 0.5} y={${heightName} * 0.08} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005} />`;
  if (beat.template === 'gauge') return `          <Circle key="${semanticNodeKey(beat.visualId, 'gauge-ring')}" width={${widthName} * 0.34} height={${heightName} * 0.34} y={${heightName} * 0.08} fill={'#00000000'} stroke={${sourceText(palette.accent)}} lineWidth={canvasWidth * 0.012} />`;
  if (beat.template === 'comparison') return `          <Line key="${semanticNodeKey(beat.visualId, 'comparison-divider')}" points={[[0, ${heightName} * -0.16], [0, ${heightName} * 0.33]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005} />`;
  if (beat.template === 'queue') return `          <Rect key="${semanticNodeKey(beat.visualId, 'queue-rail')}" width={${widthName} * 0.78} height={${heightName} * 0.24} y={${heightName} * 0.1} radius={canvasWidth * 0.028} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005} />
          <Line key="${semanticNodeKey(beat.visualId, 'queue-direction')}" points={[[${widthName} * -0.34, ${heightName} * 0.1], [${widthName} * 0.34, ${heightName} * 0.1]]} stroke={${sourceText(palette.accent)}} lineWidth={canvasWidth * 0.006} endArrow />`;
  if (beat.template === 'process') return `          <Line key="${semanticNodeKey(beat.visualId, 'process-flowline')}" points={[[${widthName} * -0.36, ${heightName} * 0.1], [${widthName} * 0.36, ${heightName} * 0.1]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.008} endArrow />`;
  if (beat.template === 'trajectory') return `          <Line key="${semanticNodeKey(beat.visualId, 'trajectory-path')}" points={[[${widthName} * -0.4, ${heightName} * 0.27], [${widthName} * -0.15, ${heightName} * 0.08], [${widthName} * 0.08, -${heightName} * 0.07], [${widthName} * 0.36, -${heightName} * 0.25]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005} lineDash={[canvasWidth * 0.012, canvasWidth * 0.008]} endArrow />`;
  if (beat.template === 'tree') return `          <Line key="${semanticNodeKey(beat.visualId, 'tree-canopy')}" points={[[0, -${heightName} * 0.18], [${widthName} * -0.27, ${heightName} * 0.03], [${widthName} * 0.27, ${heightName} * 0.03]]} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.004} lineCap={'round'} lineJoin={'round'} />`;
  if (beat.template === 'stack') return `          <Rect key="${semanticNodeKey(beat.visualId, 'stack-frame')}" width={${widthName} * 0.6} height={${heightName} * 0.56} y={${heightName} * 0.04} radius={canvasWidth * 0.024} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.005} />`;
  if (beat.template === 'grid') return `          <Rect key="${semanticNodeKey(beat.visualId, 'grid-frame')}" width={${widthName} * 0.78} height={${heightName} * 0.58} y={${heightName} * 0.05} radius={canvasWidth * 0.025} fill={'#00000000'} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.004} />`;
  return '';
}

function visualTemplateSource(beat: SceneSpecBeat, palette: Palette, typography: Typography, widthName: string, heightName: string, refForElement: (index: number) => string) {
  const points = diagramPositions(beat.template, beat.elements.length), positions = new Map(beat.elements.map((element, index) => [element.id, points[index]!]));
  return [...beat.groups.map(group => groupSource(beat, group, positions, palette, widthName, heightName)), templateDecorationSource(beat, palette, widthName, heightName), ...beat.relationships.map(relationship => relationshipSource(beat, relationship, positions, palette, widthName, heightName)), ...beat.elements.map((element, index) => elementSource(beat, element, points[index]!, palette, typography, widthName, heightName, refForElement(index)))].filter(Boolean).join('\n');
}

function validateSpecAgainstPlan(spec: MotionCanvasSceneSpec, beats: PlannedBeat[]) {
  if (spec.beats.length !== beats.length || spec.beats.some((beat, index) => beat.beatId !== beats[index]!.id) || new Set(spec.beats.map(beat => beat.visualId)).size !== spec.beats.length) throw new Error('Scene Spec must preserve every planned beat in order with a unique semantic visualId.');
  for (let index = 0; index < spec.beats.length; index += 1) { const issues = sceneSpecPlanAlignmentIssues(spec.beats[index]!, beats[index]!); if (issues.length) throw new Error(`Scene Spec beat ${index + 1} is not aligned with its visual plan: ${issues.join(' ')}`); }
}

function elementMotionSource(beat: SceneSpecBeat, beatNumber: number, refs: Map<string, {ref: string; x: string; y: string}>) {
  const duration = `Math.min(0.3, beatDuration${beatNumber} * 0.055)`;
  return beat.motions.map(motion => {
    const targets = motion.targets.map(target => refs.get(target)).filter((target): target is {ref: string; x: string; y: string} => Boolean(target)), direction = motion.direction ?? 'right', property = direction === 'up' || direction === 'down' ? 'y' : 'x', delta = direction === 'left' ? '-safeWidth * 0.018' : direction === 'up' ? '-safeHeight * 0.018' : direction === 'down' ? 'safeHeight * 0.018' : 'safeWidth * 0.018';
    const calls = targets.flatMap(target => {
      const ref = target.ref;
      const rest = property === 'x' ? target.x : target.y;
      switch (motion.kind) {
        case 'flow': return [`${ref}().${property}(${rest} + ${delta}, ${duration}, easeInOutCubic)`, `${ref}().${property}(${rest}, ${duration}, easeInOutCubic)`];
        case 'orbit': return [`${ref}().rotation(${direction === 'clockwise' ? 7 : -7}, ${duration}, easeInOutCubic)`, `${ref}().rotation(0, ${duration}, easeInOutCubic)`];
        case 'compare': return [`${ref}().scale([1.04, 0.96], ${duration}, easeInOutCubic)`, `${ref}().scale([1, 1], ${duration}, easeInOutCubic)`];
        case 'focus': case 'pulse': case 'reveal': default: return [`${ref}().scale([1.04, 1.04], ${duration}, easeInOutCubic)`, `${ref}().scale([1, 1], ${duration}, easeInOutCubic)`];
      }
    });
    return calls.length ? `  yield* all(\n    ${calls.join(',\n    ')},\n  );` : '';
  }).filter(Boolean).join('\n');
}

export function encodeMotionCanvasSceneSpec(spec: MotionCanvasSceneSpec) { return Buffer.from(JSON.stringify(spec), 'utf8').toString('base64url'); }
export function extractMotionCanvasSceneSpec(source: string): ExtractedMotionCanvasSceneSpec | null {
  const decode = (header: string, schema: typeof MotionCanvasSceneSpecSchema | typeof LegacyMotionCanvasSceneSpecSchema) => { const line = source.split(/\r?\n/u).find(candidate => candidate.startsWith(header)); if (!line) return null; try { const decoded = Buffer.from(line.slice(header.length).trim(), 'base64url').toString('utf8'); const parsed = schema.safeParse(JSON.parse(decoded)); return parsed.success ? parsed.data : null; } catch { return null; } };
  return decode(SPEC_HEADER, MotionCanvasSceneSpecSchema) ?? decode(LEGACY_SPEC_HEADER, LegacyMotionCanvasSceneSpecSchema);
}
export function isMotionCanvasSceneSpecV2(spec: unknown): spec is MotionCanvasSceneSpec {
  return Boolean(spec && typeof spec === 'object' && 'version' in spec && (spec as {version?: unknown}).version === 2);
}

export function compileMotionCanvasSceneSpec(options: {spec: MotionCanvasSceneSpec; beats: PlannedBeat[]; outlineTitle: string; frame: VideoFrame; backgroundColor: string; visualBible: VoiceVisualPlan['visualBible'];}) {
  const {beats, backgroundColor} = options;
  const spec = compilerResolvedSpec(options.spec, beats);
  validateSpecAgainstPlan(spec, beats);
  const fallbackBible = {palette: {background: backgroundColor, surface: '#171A1F', primary: '#35D6E5', accent: '#FFC857', text: '#F5F7FA'}, typographyScale: {title: 64, label: 34, body: 28}};
  const palette = resolveMotionCanvasPresentationPalette(options.visualBible?.palette ?? fallbackBible.palette, backgroundColor), typography = options.visualBible?.typographyScale ?? fallbackBible.typographyScale;
  const lifecycleKeys = [...new Set(beats.flatMap(beat => [...(beat.visualLifecycle?.enter ?? []), ...(beat.visualLifecycle?.stay ?? []), ...(beat.visualLifecycle?.exit ?? [])]))], primaryKeys = new Set(beats.map(beat => beat.primaryBlock));
  const nodeRecords = lifecycleKeys.map((key, index) => { const primaryBeatIndex = beats.findIndex(beat => beat.primaryBlock === key), firstBeatIndex = beats.findIndex(beat => [...(beat.visualLifecycle?.enter ?? []), ...(beat.visualLifecycle?.stay ?? []), ...(beat.visualLifecycle?.exit ?? [])].includes(key)), beatIndex = primaryBeatIndex >= 0 ? primaryBeatIndex : Math.max(0, firstBeatIndex), geometry = layoutGeometry(beats[beatIndex]!, spec.beats[beatIndex]!.focus); return {key, refName: `lifecycleNode${index + 1}`, widthName: `lifecycleNode${index + 1}Width`, heightName: `lifecycleNode${index + 1}Height`, isPrimary: primaryKeys.has(key), beatIndex, geometry, supportIndex: lifecycleKeys.slice(0, index).filter(candidate => !primaryKeys.has(candidate)).length}; });
  const nodeByKey = new Map(nodeRecords.map(node => [node.key, node])); const elementRefName = (beatIndex: number, elementIndex: number) => `beat${beatIndex + 1}Element${elementIndex + 1}`;
  const primarySources = nodeRecords.filter(node => node.isPrimary).map(node => {
    const relatedBeatIndexes = beats.map((beat, index) => beat.primaryBlock === node.key ? index : -1).filter(index => index >= 0);
    const details = relatedBeatIndexes.map(beatIndex => { const sceneBeat = spec.beats[beatIndex]!, detailRef = `beatDetail${beatIndex + 1}`; return `        <Layout key="${semanticNodeKey(sceneBeat.visualId, 'detail-layer')}" ref={${detailRef}} opacity={0} width={${node.widthName}} height={${node.heightName}}>
          <Rect key="${semanticNodeKey(sceneBeat.visualId, 'visual-surface')}" width={${node.widthName}} height={${node.heightName}} radius={canvasWidth * 0.04} fill={${sourceText(palette.surface)}} stroke={${sourceText(palette.primary)}} lineWidth={canvasWidth * 0.006} />
          <Txt key="${semanticNodeKey(sceneBeat.visualId, 'headline')}" text={${sourceText(sceneBeat.headline)}} y={-${node.heightName} * 0.39} width={${node.widthName} * 0.86} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={${typography.title}} textAlign={'center'} />
${visualTemplateSource(sceneBeat, palette, typography, node.widthName, node.heightName, elementIndex => elementRefName(beatIndex, elementIndex))}
${sceneBeat.caption ? `          <Txt key="${semanticNodeKey(sceneBeat.visualId, 'caption')}" text={${sourceText(sceneBeat.caption)}} y={${node.heightName} * ${captionYRatio(sceneBeat)}} width={${node.widthName} * 0.8} fill={${sourceText(palette.text)}} fontFamily={${sourceText('Times New Roman, Times, serif')}} fontSize={${typography.body}} textAlign={'center'} />` : ''}
        </Layout>`; }).join('\n');
    return `      <Layout key="${node.key}" ref={${node.refName}} width={${node.widthName}} height={${node.heightName}} x={safeWidth * ${node.geometry.xRatio}} y={canvasHeight} opacity={0}>
${details}
      </Layout>`;
  }).join('\n');
  const supportSources = nodeRecords.filter(node => !node.isPrimary).map(node => { const column = node.supportIndex % 2 === 0 ? -1 : 1, row = Math.floor(node.supportIndex / 2) % 3; return `        <Rect key="${node.key}" ref={${node.refName}} width={safeWidth * 0.1} height={safeWidth * 0.1} radius={canvasWidth * 0.022} fill={${sourceText(node.supportIndex % 2 === 0 ? palette.accent : palette.primary)}} rotation={45} x={safeWidth * ${column * 0.4}} y={canvasHeight} opacity={0} />`; }).join('\n');
  const timingSources = beats.map((beat, beatIndex) => {
    const planned = beat.visualLifecycle!, detailRef = `beatDetail${beatIndex + 1}`;
    const enter = planned.enter.flatMap(key => { const node = nodeByKey.get(key)!, restY = node.isPrimary ? `safeHeight * ${node.geometry.yRatio}` : `safeHeight * ${-0.25 + (node.supportIndex % 3) * 0.25}`; return [`    ${node.refName}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`, `    ${node.refName}().y(${restY}, enterDuration${beatIndex + 1}, easeInOutCubic)`]; });
    const retained = planned.stay.filter(key => !planned.enter.includes(key)).flatMap(key => { const node = nodeByKey.get(key)!; return [`    ${node.refName}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`]; });
    const exit = planned.exit.flatMap(key => { const node = nodeByKey.get(key)!; return [`    ${node.refName}().opacity(0, exitDuration${beatIndex + 1}, easeInOutCubic)`, `    ${node.refName}().y(canvasHeight, exitDuration${beatIndex + 1}, easeInOutCubic)`]; });
    const allEnter = [...enter, ...retained, `    ${detailRef}().opacity(1, enterDuration${beatIndex + 1}, easeInOutCubic)`];
    const points = diagramPositions(spec.beats[beatIndex]!.template, spec.beats[beatIndex]!.elements.length);
    const refs = new Map(spec.beats[beatIndex]!.elements.map((element, index) => [element.id, {
      ref: elementRefName(beatIndex, index),
      x: `${nodeByKey.get(beat.primaryBlock!)!.widthName} * ${points[index]!.x}`,
      y: `${nodeByKey.get(beat.primaryBlock!)!.heightName} * ${points[index]!.y}`,
    }]));
    return `  // lifecycle:beat:${beat.id}:enter=${planned.enter.join(',')}|stay=${planned.stay.join(',')}|exit=${planned.exit.join(',')}|primary=${beat.primaryBlock}
  yield* waitUntil('beat:${beat.id}:start');
  const beatDuration${beatIndex + 1} = useDuration('beat:${beat.id}:end');
  const beatEndTime${beatIndex + 1} = useThread().time() + beatDuration${beatIndex + 1};
  const enterDuration${beatIndex + 1} = Math.min(0.45, Math.max(0.08, beatDuration${beatIndex + 1} * 0.1));
  const exitDuration${beatIndex + 1} = Math.min(0.4, Math.max(0.08, beatDuration${beatIndex + 1} * 0.09));
  yield* all(
${allEnter.join(',\n')},
  );
${elementMotionSource(spec.beats[beatIndex]!, beatIndex + 1, refs)}
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
${spec.beats.flatMap((beat, beatIndex) => beat.elements.map((_element, elementIndex) => `  const ${elementRefName(beatIndex, elementIndex)} = createRef<Layout>();`)).join('\n')}

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
