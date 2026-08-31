import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {VoiceVisualPlan} from '../shared/topic.ts';
import {
  validateMotionCanvasBackground,
  validateMotionCanvasBeatLifecycle,
  validateMotionCanvasContainerContract,
  validateMotionCanvasResponsiveLayout,
  validateMotionCanvasSceneSource,
  validateMotionCanvasTimingContract,
  type MotionCanvasSourceScene,
} from './motionCanvasGenerator.ts';
import {buildMotionCanvasSemanticValidation} from './motionCanvasVisualQuality.ts';
import {createMotionCanvasWorkspace} from './motionCanvasWorkspace.ts';
import {
  compileMotionCanvasSceneSpecV3,
  extractMotionCanvasSceneSpecV3,
  fitMotionCanvasSceneSpecV3ToSafeGeometry,
  MotionCanvasSceneSpecV3Schema,
  sceneSpecV3PlanAlignmentIssues,
  type MotionCanvasSceneSpecV3,
} from './motionCanvasSceneSpecV3.ts';

const beatId = '10000000-0000-4000-8000-000000000301';
const sceneId = '10000000-0000-4000-8000-000000000302';
const sectionId = '10000000-0000-4000-8000-000000000303';
const frame = {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const};
const visualIntent = {
  message: 'A critical patient must visibly move ahead of a routine patient.',
  viewerShouldInfer: 'Urgency changes dispatch order even though the routine patient arrived first.',
  abstraction: 'mixed' as const,
  entities: [
    {id: 'routine-patient', kind: 'waiting patient', label: 'Thường', role: 'support' as const, appearance: 'A seated patient with a blue identity badge.', state: 'waiting first', mustShow: true},
    {id: 'critical-patient', kind: 'critical patient', label: 'Khẩn', role: 'primary' as const, appearance: 'A patient with an orange emergency badge.', state: 'highest urgency', mustShow: true},
    {id: 'treatment-room', kind: 'hospital room', label: 'Điều trị', role: 'context' as const, appearance: 'A hospital treatment doorway with a medical cross.', state: 'ready', mustShow: true},
  ],
  relations: [
    {id: 'priority-before-arrival', type: 'priority overrides arrival order', from: 'critical-patient', to: 'routine-patient', description: 'The critical patient is ordered before the earlier routine patient.', mustShow: true},
    {id: 'dispatch-to-treatment', type: 'dispatch destination', from: 'critical-patient', to: 'treatment-room', description: 'The critical patient moves into the treatment room.', mustShow: true},
  ],
  actions: [
    {id: 'critical-patient-dispatch', actor: 'critical-patient', verb: 'moves ahead into', target: 'treatment-room', description: 'The critical patient advances past the routine patient.', fromState: 'waiting', toState: 'in treatment', mustShow: true},
  ],
};

const beat: VoiceVisualPlan['sections'][number]['beats'][number] = {
  id: beatId,
  voiceover: 'Bệnh nhân khẩn cấp được điều trị trước người đến sớm nhưng ổn định.',
  spokenVoiceover: 'Bệnh nhân khẩn cấp được điều trị trước người đến sớm nhưng ổn định.',
  visualPurpose: 'Cho thấy mức khẩn cấp thay đổi thứ tự phục vụ.',
  visualDescription: 'Hai bệnh nhân khác trạng thái đứng trước phòng điều trị; người khẩn cấp vượt lên.',
  animationDescription: 'Bệnh nhân khẩn cấp di chuyển theo mũi tên vào phòng điều trị.',
  visualIntent,
  visualLifecycle: {enter: ['block-priority-story'], stay: ['block-priority-story', 'priority-state-label'], exit: ['block-priority-story']},
  primaryBlock: 'block-priority-story',
  compositionContract: {visualFocus: 'Bệnh nhân khẩn cấp đang tiến vào phòng điều trị.', hierarchy: ['block-priority-story', 'priority-state-label'], semanticRole: 'contrast', layout: 'center-focus', density: 'balanced', spacingNotes: 'Giữ khoảng trống giữa hai bệnh nhân và cửa phòng để đường chuyển động dễ đọc.'},
  visualHoldSeconds: 0,
  durationSeconds: 8,
};

const basePart = {
  x: 0,
  y: 0,
  width: 0.7,
  height: 0.7,
  rotation: 0,
  fillRole: 'primary' as const,
  strokeRole: 'text' as const,
  strokeWidth: 0.006,
  cornerRadius: 0.12,
  points: [],
  text: null,
};

const spec: MotionCanvasSceneSpecV3 = {
  version: 3,
  visualAnchor: 'Hospital priority as visible movement between people and treatment.',
  beats: [{
    beatId,
    visualId: 'emergency-priority-story',
    headline: null,
    motifHints: ['hospital waiting area', 'priority overtakes arrival'],
    fidelity: 'designed',
    entities: [
      {id: 'routine-patient-figure', intentId: 'routine-patient', description: 'Seated routine patient with blue badge.', role: 'secondary', box: {x: -0.3, y: 0.12, width: 0.2, height: 0.2}, label: 'Thường', parts: [
        {...basePart, id: 'routine-head-shape', primitive: 'circle', y: -0.28, width: 0.3, height: 0.3},
        {...basePart, id: 'routine-body-shape', primitive: 'rect', y: 0.18, width: 0.55, height: 0.58, cornerRadius: 0.3},
      ]},
      {id: 'critical-patient-figure', intentId: 'critical-patient', description: 'Moving critical patient with emergency badge.', role: 'primary', box: {x: 0, y: -0.08, width: 0.22, height: 0.22}, label: 'Khẩn', parts: [
        {...basePart, id: 'critical-head-shape', primitive: 'circle', y: -0.28, width: 0.3, height: 0.3, fillRole: 'accent'},
        {...basePart, id: 'critical-body-shape', primitive: 'rect', y: 0.18, width: 0.55, height: 0.58, fillRole: 'accent', cornerRadius: 0.3},
      ]},
      {id: 'treatment-room-door', intentId: 'treatment-room', description: 'Treatment doorway with a visible cross.', role: 'muted', box: {x: 0.32, y: 0.08, width: 0.23, height: 0.28}, label: 'Điều trị', parts: [
        {...basePart, id: 'room-door-shape', primitive: 'rect', width: 0.72, height: 0.86, fillRole: 'surface', cornerRadius: 0.04},
        {...basePart, id: 'room-cross-vertical', primitive: 'rect', y: -0.08, width: 0.12, height: 0.38, fillRole: 'accent'},
        {...basePart, id: 'room-cross-horizontal', primitive: 'rect', y: -0.08, width: 0.38, height: 0.12, fillRole: 'accent'},
      ]},
    ],
    relationships: [
      {id: 'priority-order-arrow', intentId: 'priority-before-arrival', from: 'critical-patient-figure', to: 'routine-patient-figure', style: 'curved', label: null, emphasis: 'primary', via: [{x: -0.12, y: -0.22}]},
      {id: 'treatment-dispatch-arrow', intentId: 'dispatch-to-treatment', from: 'critical-patient-figure', to: 'treatment-room-door', style: 'arrow', label: null, emphasis: 'primary', via: []},
    ],
    actions: [{id: 'dispatch-movement-action', intentId: 'critical-patient-dispatch', kind: 'flow', targets: ['critical-patient-figure'], direction: 'right', amount: 0.08}],
    decorations: [],
  }],
};

function plan(): VoiceVisualPlan {
  return {
    voiceDirection: 'Đọc rõ ràng theo bản đã duyệt.',
    visualDirection: 'Minh họa trực tiếp bằng đối tượng và chuyển động.',
    visualBible: {palette: {background: '#10231D', surface: '#1B263B', primary: '#86C5FF', accent: '#FFB86B', text: '#F8F5EE'}, typographyScale: {title: 64, label: 34, body: 28}, shapeLanguage: 'Composite vector objects with a consistent rounded geometry.', diagramLanguage: 'Relationships appear behind concrete entities with clear arrow direction.', motionTempo: 'One meaningful subject movement per beat with a stable reading hold.', transitionConvention: 'Preserve the visual anchor between adjacent beats and fade detail layers.', visualAnchor: 'Hospital priority shown through persistent people, order, and destination.'},
    timingCalibration: {source: 'default', whitespaceTokensPerMinute: 132, charactersPerSecond: 14, voiceId: null, modelId: null, voiceName: null, sampleCount: 0},
    sections: [{outlineSectionId: sectionId, stateHandoff: {incoming: null, outgoing: null}, beats: [beat]}],
    status: 'approved', contentRevision: 1, narrationRevision: 1, sourceOutlineContentRevision: 1,
    generation: {generationId: '10000000-0000-4000-8000-000000000304', provider: 'local', tool: 'narration-structure', algorithmVersion: 'test', generatedAt: '2026-01-01T00:00:00.000Z'},
  };
}

test('Scene Graph v3 compiles arbitrary composite objects without a template and passes source contracts', () => {
  const source = compileMotionCanvasSceneSpecV3({spec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  assert.equal(extractMotionCanvasSceneSpecV3(source)?.version, 3);
  assert.doesNotMatch(source, /template/u);
  assert.match(source, /critical-patient-figure-entity/u);
  assert.match(source, /semantic-action:critical-patient-dispatch/u);
  validateMotionCanvasSceneSource(source);
  validateMotionCanvasBackground(source, '#10231D');
  validateMotionCanvasContainerContract(source);
  validateMotionCanvasTimingContract(source, [beat]);
  validateMotionCanvasBeatLifecycle(source, [beat], frame);
  validateMotionCanvasResponsiveLayout(source, frame, [beat]);
});

test('Scene Graph v3 compiler fits model-authored boxes and parts inside their parent', () => {
  const unsafe: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {
            ...entity,
            box: {x: 0.46, y: -0.38, width: 0.86, height: 0.7},
            parts: entity.parts.map(part => ({
              ...part,
              x: 0.55,
              y: -0.55,
              width: 1.2,
              height: 1.2,
            })),
          }),
    }],
  };
  const fitted = fitMotionCanvasSceneSpecV3ToSafeGeometry(unsafe);
  const entity = fitted.beats[0]!.entities[0]!;
  const part = entity.parts[0]!;
  assert.ok(Math.abs(entity.box.x) + entity.box.width / 2 <= 0.461);
  assert.ok(Math.abs(entity.box.y) + entity.box.height / 2 <= 0.421);
  assert.ok(Math.abs(part.x) + part.width / 2 <= 0.461);
  assert.ok(Math.abs(part.y) + part.height / 2 <= 0.461);
  const clusterMinimumX = Math.min(...fitted.beats[0]!.entities.map(item => item.box.x - item.box.width / 2));
  const clusterMaximumX = Math.max(...fitted.beats[0]!.entities.map(item => item.box.x + item.box.width / 2));
  assert.ok(Math.abs((clusterMinimumX + clusterMaximumX) / 2) < 0.02);
  const source = compileMotionCanvasSceneSpecV3({
    spec: unsafe,
    beats: [beat],
    outlineTitle: 'Priority',
    frame,
    backgroundColor: '#10231D',
    visualBible: plan().visualBible,
  });
  assert.deepEqual(extractMotionCanvasSceneSpecV3(source), fitted);
});

test('Scene Graph v3 scales normalized SVG path data to the entity box', () => {
  const pathSpec: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {
            ...entity,
            parts: [{
              ...entity.parts[0]!,
              primitive: 'path' as const,
              pathData: 'M 0.5 0.02 C 0.9 0.2 0.9 0.8 0.5 0.98 C 0.1 0.8 0.1 0.2 0.5 0.02 Z',
            }],
          }),
    }],
  };
  const source = compileMotionCanvasSceneSpecV3({spec: pathSpec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  // The fixture contains other composite parts; select the path authored by
  // this test instead of whichever SVG path happens to be emitted first.
  const pathLine = source.split('\n').find(line => line.includes("M 0.5 0.02 C 0.9 0.2")) ?? '';
  assert.match(pathLine, /scale=\{\[/u);
  assert.doesNotMatch(pathLine, /\/ 10/u);
  assert.doesNotMatch(pathLine, /\/ 100/u);
  assert.match(pathLine, /lineWidth=\{canvasWidth \* 0\.006 \/ Math\.max\(/u);
});

test('Scene Graph v3 passes the real immutable workspace TypeScript preparation', async context => {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-scene-graph-v3-'));
  context.after(() => rm(projectsDirectory, {recursive: true, force: true}));
  const source = compileMotionCanvasSceneSpecV3({spec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  const scene: MotionCanvasSourceScene = {id: sceneId, outlineSectionId: sectionId, name: 'Priority scene', filePath: 'src/scenes/01-priority.tsx', durationSeconds: 8, timingEvents: [{beatId, startEvent: `beat:${beatId}:start`, endEvent: `beat:${beatId}:end`, plannedDurationSeconds: 8}], source};
  const workspace = createMotionCanvasWorkspace(projectsDirectory);
  const prepared = await workspace.prepare('scene-graph-project', '10000000-0000-4000-8000-000000000305', [scene], frame);
  assert.equal(prepared.sourceScenes[0]?.id, sceneId);
  assert.match(prepared.validation.sourceHash, /^[a-f0-9]{64}$/u);
});

test('v3 semantic alignment rejects a missing required relation even when the scene remains renderable', () => {
  const broken = {...spec.beats[0]!, relationships: spec.beats[0]!.relationships.slice(1)};
  assert.match(sceneSpecV3PlanAlignmentIssues(broken, beat).join(' '), /priority-before-arrival/u);
});

test('legacy V3 semantic validation remains degraded without direct binding and runtime evidence', () => {
  const designedSource = compileMotionCanvasSceneSpecV3({spec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  const scene: MotionCanvasSourceScene = {id: sceneId, outlineSectionId: sectionId, name: 'Priority scene', filePath: 'src/scenes/01-priority.tsx', durationSeconds: 8, timingEvents: [{beatId, startEvent: `beat:${beatId}:start`, endEvent: `beat:${beatId}:end`, plannedDurationSeconds: 8}], source: designedSource};
  const designed = buildMotionCanvasSemanticValidation([scene], plan(), undefined, '2026-01-01T00:00:00.000Z');
  assert.equal(designed.status, 'degraded');
  assert.equal(designed.scenes[0]?.coverage, 0);

  const simplifiedSpec: MotionCanvasSceneSpecV3 = {...spec, beats: [{...spec.beats[0]!, fidelity: 'simplified'}]};
  const simplified = buildMotionCanvasSemanticValidation([{...scene, source: compileMotionCanvasSceneSpecV3({spec: simplifiedSpec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible})}], plan(), undefined, '2026-01-01T00:00:00.000Z');
  assert.equal(simplified.status, 'degraded');
  assert.equal(simplified.scenes[0]?.coverage, 0);
  assert.equal(simplified.scenes[0]?.fallbackLevel, 'none');
});

test('Scene Graph v3 rejects an icon part with an unknown iconId instead of accepting an invented silhouette', () => {
  const iconSpec: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {...entity, parts: [{...basePart, id: 'invented-leaf-shape', primitive: 'icon' as const, iconId: 'mdi:this-does-not-exist-as-an-icon'}]}),
    }],
  };
  const result = MotionCanvasSceneSpecV3Schema.safeParse(iconSpec);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /Unknown icon id/u);
});

test('Scene Graph v3 requires iconId only on icon parts', () => {
  const missingIconId: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {...entity, parts: [{...basePart, id: 'bare-icon-part', primitive: 'icon' as const}]}),
    }],
  };
  assert.equal(MotionCanvasSceneSpecV3Schema.safeParse(missingIconId).success, false);

  const strayIconId: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {...entity, parts: [{...basePart, id: 'circle-with-icon-id', primitive: 'circle' as const, iconId: 'mdi:leaf'}]}),
    }],
  };
  assert.equal(MotionCanvasSceneSpecV3Schema.safeParse(strayIconId).success, false);
});

test('Scene Graph v3 compiles a known icon into its real vector path, not a heuristic-fitted primitive', () => {
  const iconSpec: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index
        ? entity
        : {...entity, parts: [{...basePart, id: 'real-leaf-shape', primitive: 'icon' as const, iconId: 'ph:leaf'}]}),
    }],
  };
  assert.equal(MotionCanvasSceneSpecV3Schema.safeParse(iconSpec).success, true);
  const source = compileMotionCanvasSceneSpecV3({spec: iconSpec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  const iconLine = source.split('\n').find(line => line.includes('real-leaf-shape')) ?? '';
  assert.match(iconLine, /<Path /u);
  assert.match(iconLine, /scale=\{\[.* \/ 256, .* \/ 256\]\}/u);
  validateMotionCanvasSceneSource(source);
});

test('a relationship whose connector is suppressed as redundant pulls its entities into contact instead of leaving them floating apart', () => {
  const farApartSpec: MotionCanvasSceneSpecV3 = {
    ...spec,
    beats: [{
      ...spec.beats[0]!,
      entities: spec.beats[0]!.entities.map((entity, index) => index === 2
        ? {...entity, box: {...entity.box, x: 0.45, y: -0.35}}
        : entity),
      relationships: [
        ...spec.beats[0]!.relationships,
        {id: 'implicit-attachment', intentId: null, from: 'critical-patient-figure', to: 'treatment-room-door', style: 'spatial', label: null, emphasis: 'primary', via: []},
      ],
    }],
  };
  const fitted = fitMotionCanvasSceneSpecV3ToSafeGeometry(farApartSpec, [beat]);
  const from = fitted.beats[0]!.entities.find(entity => entity.id === 'critical-patient-figure')!;
  const to = fitted.beats[0]!.entities.find(entity => entity.id === 'treatment-room-door')!;
  const gapBefore = Math.hypot(0.45 - spec.beats[0]!.entities[1]!.box.x, -0.35 - spec.beats[0]!.entities[1]!.box.y);
  const gapAfter = Math.hypot(to.box.x - from.box.x, to.box.y - from.box.y);
  assert.ok(gapAfter < gapBefore, 'entities connected by a suppressed-connector relationship should move closer together');
  assert.ok(gapAfter < (Math.max(from.box.width, from.box.height) + Math.max(to.box.width, to.box.height)) / 2, 'pulled entities should end up touching, not merely closer');

  const source = compileMotionCanvasSceneSpecV3({spec: farApartSpec, beats: [beat], outlineTitle: 'Priority', frame, backgroundColor: '#10231D', visualBible: plan().visualBible});
  assert.doesNotMatch(source, /implicit-attachment-relationship/u);
});
