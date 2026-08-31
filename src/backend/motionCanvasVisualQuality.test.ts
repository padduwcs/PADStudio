import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER, type MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import type {BeatCompositionContract, VoiceVisualPlan} from '../shared/topic.ts';
import {buildMotionCanvasSemanticValidation, MotionCanvasVisualQualityError, MotionCanvasVisualValidationGateError, VISUAL_QUALITY_GATE_VERSION, assertVisualValidationCurrent, formatVisualQualityRetryGuidance, motionCanvasSceneSourceHash, partitionWaivedVisualQualityIssues, retryRenderedSceneQualityOnce, validateRenderedMotionCanvas, visualQualityFailureIsRendererOnly, visualQualitySamples, visualValidationIsCurrent, visualValidationIsReusable, withTemporaryVisualQualityWorkspace, type BeatQualityContract, type MotionCanvasVisualEvidence, type QualityRenderedFrame, type VisualQualitySummary} from './motionCanvasVisualQuality.ts';

const sceneId = '10000000-0000-4000-8000-000000000001';
const beatOne = '10000000-0000-4000-8000-000000000011';
const beatTwo = '10000000-0000-4000-8000-000000000012';
const scene: MotionCanvasSourceScene = {id: sceneId, outlineSectionId: '10000000-0000-4000-8000-000000000002', name: 'Quality scene', filePath: 'src/scenes/quality-scene.tsx', durationSeconds: 8, source: '// pad-semantic:bindings-v1\n<Rect key="main-concept" /><Line key="concept-link" /><Rect key="concept-change" />', timingEvents: [{beatId: beatOne,startEvent:`beat:${beatOne}:start`,endEvent:`beat:${beatOne}:end`,plannedDurationSeconds:4},{beatId: beatTwo,startEvent:`beat:${beatTwo}:start`,endEvent:`beat:${beatTwo}:end`,plannedDurationSeconds:4}]};
const lifecycle = new Map([[beatOne,{stay:['block-one']}],[beatTwo,{stay:['block-two']}]]);
const semanticPlan = {
  sections: [{
    outlineSectionId: scene.outlineSectionId,
    beats: [{
      id: beatOne,
      visualIntent: {
        entities: [
          {id: 'main-concept', mustShow: true},
          {id: 'optional-detail', mustShow: false},
        ],
        relations: [{id: 'concept-link', mustShow: true}],
        actions: [{id: 'concept-change', mustShow: true}],
      },
    }],
  }],
} as unknown as VoiceVisualPlan;
function pixels(color: [number,number,number,number], accent = false) { const output = new Uint8Array(100*100*4); for(let i=0;i<output.length;i+=4){output[i]=color[0];output[i+1]=color[1];output[i+2]=color[2];output[i+3]=color[3];} if(accent) for(let i=0;i<600;i+=4){output[i]=255;output[i+1]=255;output[i+2]=255;} return output; }
function frame(nodes: QualityRenderedFrame['nodes'], accent=true, color:[number,number,number,number]=[16,35,29,255]): QualityRenderedFrame {return {width:100,height:100,rgba:pixels(color,accent),nodes,png:Buffer.from('test-png')};}
async function inspect(factory: (sample: ReturnType<typeof visualQualitySamples>[number]) => QualityRenderedFrame) { return validateRenderedMotionCanvas({scenes:[scene],lifecycle,frame:{width:100,height:100,fps:10},backgroundColor:'#10231D',renderer:{async render(input){return new Map(input.samples.map(sample=>[`${sample.sceneId}:${sample.beatId}:${sample.phase}`,factory(sample)]));}},now:'2026-01-01T00:00:00.000Z'}); }
const safe = (key:string) => ({key,bounds:{x:12,y:12,width:40,height:30},visibleBounds:{x:12,y:12,width:40,height:30},opacity:1,kind:'block' as const});
function failed(work: Promise<unknown>, code: string) { return assert.rejects(work, error => error instanceof MotionCanvasVisualQualityError && error.summary.issues.some(issue=>issue.code===code)); }

test('renderer-only quality failures are infrastructure faults, not scene repair guidance', () => {
  const rendererIssue = {code:'renderer-error' as const,sceneId,beatId:null,timeSeconds:0,semanticKey:null,bounds:null,reason:'Browser timeout.'};
  const timelineMismatch = {...rendererIssue,reason:'Quality sample sample-id rendered scene earlier-scene, expected later-scene.'};
  const contentIssue = {...rendererIssue,code:'frame-too-sparse' as const};
  assert.equal(visualQualityFailureIsRendererOnly({issues:[rendererIssue]}), true);
  assert.equal(visualQualityFailureIsRendererOnly({issues:[timelineMismatch]}), false);
  assert.equal(visualQualityFailureIsRendererOnly({issues:[rendererIssue,contentIssue]}), false);
  assert.equal(visualQualityFailureIsRendererOnly({issues:[]}), false);
});

test('timeline mismatch renderer errors are attributed to the scene still running', async () => {
  const actualBeatId = '10000000-0000-4000-8000-000000000013';
  const expectedBeatId = '10000000-0000-4000-8000-000000000014';
  const actualScene: MotionCanvasSourceScene = {
    ...scene,
    id: '10000000-0000-4000-8000-000000000015',
    outlineSectionId: '10000000-0000-4000-8000-000000000016',
    name: 'Actual scene',
    filePath: 'src/scenes/actual-scene.tsx',
    durationSeconds: 4,
    timingEvents: [{beatId: actualBeatId, startEvent: `beat:${actualBeatId}:start`, endEvent: `beat:${actualBeatId}:end`, plannedDurationSeconds: 4}],
  };
  const expectedScene: MotionCanvasSourceScene = {
    ...scene,
    id: '10000000-0000-4000-8000-000000000017',
    outlineSectionId: '10000000-0000-4000-8000-000000000018',
    name: 'Expected scene',
    filePath: 'src/scenes/expected-scene.tsx',
    durationSeconds: 4,
    timingEvents: [{beatId: expectedBeatId, startEvent: `beat:${expectedBeatId}:start`, endEvent: `beat:${expectedBeatId}:end`, plannedDurationSeconds: 4}],
  };
  const expectedSample = visualQualitySamples([actualScene, expectedScene], 10)
    .find(sample => sample.sceneId === expectedScene.id)!;
  let caught: unknown;
  try {
    await validateRenderedMotionCanvas({
      scenes: [actualScene, expectedScene],
      lifecycle: new Map(),
      frame: {width: 100, height: 100, fps: 10},
      renderer: {async render() {
        throw new Error(`Quality sample ${expectedSample.sampleId} rendered scene actual-scene, expected expected-scene.`);
      }},
      now: '2026-01-01T00:00:00.000Z',
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof MotionCanvasVisualQualityError);
  assert.equal(caught.summary.issues[0]?.sceneId, actualScene.id);
  assert.equal(visualQualityFailureIsRendererOnly(caught.summary), false);
  assert.match(caught.summary.issues[0]?.reason ?? '', /exceeded its declared timing budget/u);
  assert.match(formatVisualQualityRetryGuidance(caught.summary.issues), /timeline mismatch/u);
});

function semanticVisualEvidence(visibleSemanticKeys: string[], sourceScene: MotionCanvasSourceScene = scene) {
  return {
    sourceHash: motionCanvasSceneSourceHash([sourceScene]),
    scenes: [{sceneId: sourceScene.id, samples: [{
      beatId: beatOne,
      phase: 'middle' as const,
      timeSeconds: 2,
      frame: 20,
      metrics: {verdict: 'viable', contentRatio: 0.2, dominantColorRatio: 0.5},
      activeBlocks: [],
      visibleSemanticKeys,
      imageDeltaFromPreviousBeat: null,
    }]}],
  } as unknown as Pick<VisualQualitySummary, 'sourceHash' | 'scenes'>;
}

test('semantic validation passes only when direct Visual Intent ids are bound and visible', () => {
  const summary = buildMotionCanvasSemanticValidation(
    [scene],
    semanticPlan,
    semanticVisualEvidence(['main-concept', 'concept-link', 'concept-change']),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'passed');
  assert.equal(summary.scenes[0]?.status, 'passed');
  assert.equal(summary.scenes[0]?.coverage, 1);
  assert.equal(summary.scenes[0]?.fallbackLevel, 'none');
  assert.deepEqual(summary.scenes[0]?.missingIntentIds, []);
});

test('legacy translated Scene Spec v3-style keys do not satisfy direct semantic validation', () => {
  const legacyScene = {
    ...scene,
    source: '// pad-semantic:bindings-v1\n<Rect key="main-concept-at-visual-one" /><Line key="concept-link-at-visual-one" /><Rect key="concept-change-at-visual-one" />',
  };
  const summary = buildMotionCanvasSemanticValidation(
    [legacyScene],
    semanticPlan,
    semanticVisualEvidence(['main-concept-at-visual-one', 'concept-link-at-visual-one', 'concept-change-at-visual-one'], legacyScene),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'failed');
  assert.equal(summary.scenes[0]?.status, 'failed');
  assert.equal(summary.scenes[0]?.coverage, 0);
  assert.deepEqual(summary.scenes[0]?.missingIntentIds, [
    'main-concept',
    'concept-link',
    'concept-change',
  ]);
});

test('semantic validation fails when a required direct JSX key is missing from source', () => {
  const incompleteScene = {
    ...scene,
    source: '// pad-semantic:bindings-v1\n<Rect key="main-concept" /><Line key="concept-link" />',
  };
  const summary = buildMotionCanvasSemanticValidation(
    [incompleteScene],
    semanticPlan,
    semanticVisualEvidence(['main-concept', 'concept-link', 'concept-change'], incompleteScene),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'failed');
  assert.equal(summary.scenes[0]?.coverage, 2 / 3);
  assert.deepEqual(summary.scenes[0]?.missingIntentIds, ['concept-change']);
});

test('semantic validation fails when a required Visual Intent key is not visible at its beat', () => {
  const summary = buildMotionCanvasSemanticValidation(
    [scene],
    semanticPlan,
    semanticVisualEvidence(['main-concept', 'concept-link']),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'failed');
  assert.equal(summary.scenes[0]?.coverage, 2 / 3);
  assert.deepEqual(summary.scenes[0]?.missingIntentIds, ['concept-change']);
});

test('semantic validation keeps historical frame evidence degraded rather than claiming a false verdict', () => {
  const summary = buildMotionCanvasSemanticValidation(
    [scene],
    semanticPlan,
    undefined,
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'degraded');
  assert.equal(summary.scenes[0]?.coverage, 0);
  assert.deepEqual(summary.scenes[0]?.unverifiedIntentIds, [
    'main-concept',
    'concept-link',
    'concept-change',
  ]);
});

test('semantic validation degrades pre-contract source that is missing the binding marker', () => {
  const preContractScene = {
    ...scene,
    source: scene.source.replace('// pad-semantic:bindings-v1\n', ''),
  };
  const summary = buildMotionCanvasSemanticValidation(
    [preContractScene],
    semanticPlan,
    semanticVisualEvidence(['main-concept', 'concept-link', 'concept-change'], preContractScene),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'degraded');
  assert.equal(summary.scenes[0]?.status, 'degraded');
  assert.equal(summary.scenes[0]?.coverage, 0);
  assert.equal(summary.scenes[0]?.fallbackLevel, 'none');
  assert.deepEqual(summary.scenes[0]?.unverifiedIntentIds, [
    'main-concept',
    'concept-link',
    'concept-change',
  ]);
});

test('semantic validation keeps deterministic fallback output degraded and unverified', () => {
  const fallbackScene = {
    ...scene,
    source: `// ${MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER}\n${scene.source}`,
  };
  const summary = buildMotionCanvasSemanticValidation(
    [fallbackScene],
    semanticPlan,
    semanticVisualEvidence(['main-concept', 'concept-link', 'concept-change'], fallbackScene),
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'degraded');
  assert.equal(summary.scenes[0]?.status, 'degraded');
  assert.equal(summary.scenes[0]?.coverage, 0);
  assert.equal(summary.scenes[0]?.fallbackLevel, 'simplified');
  assert.deepEqual(summary.scenes[0]?.unverifiedIntentIds, [
    'main-concept',
    'concept-link',
    'concept-change',
  ]);
});

test('stale runtime/source evidence does not pass direct semantic validation', () => {
  const currentEvidence = semanticVisualEvidence(['main-concept', 'concept-link', 'concept-change']);
  const summary = buildMotionCanvasSemanticValidation(
    [scene],
    semanticPlan,
    {...currentEvidence, sourceHash: '0'.repeat(64)},
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(summary.status, 'degraded');
  assert.equal(summary.scenes[0]?.status, 'degraded');
  assert.equal(summary.scenes[0]?.coverage, 0);
  assert.deepEqual(summary.scenes[0]?.unverifiedIntentIds, [
    'main-concept',
    'concept-link',
    'concept-change',
  ]);
});

test('partitionWaivedVisualQualityIssues moves a stalled scene\'s issues out and can turn a failing summary into a passing one', () => {
  const otherSceneId = '10000000-0000-4000-8000-000000000099';
  const stalledIssue = {code:'plan-misaligned' as const, sceneId, beatId:null, timeSeconds:0, semanticKey:null, bounds:null, reason:'Scene không hội tụ.'};
  const otherIssue = {code:'block-overlap' as const, sceneId: otherSceneId, beatId:null, timeSeconds:0, semanticKey:null, bounds:null, reason:'Chồng khối khác.'};
  const summary: VisualQualitySummary = {version: VISUAL_QUALITY_GATE_VERSION, status:'failed', validatedAt:'2026-01-01T00:00:00.000Z', sourceHash:'a'.repeat(64), scenes:[], issues:[stalledIssue]};

  const onlyStalled = partitionWaivedVisualQualityIssues(summary, new Set([sceneId]));
  assert.equal(onlyStalled.summary.status, 'passed');
  assert.deepEqual(onlyStalled.summary.issues, []);
  assert.equal(onlyStalled.waived.length, 1);
  assert.equal(onlyStalled.waived[0]!.sceneId, sceneId);
  assert.deepEqual(onlyStalled.waived[0]!.issueCodes, ['plan-misaligned']);

  const mixed = partitionWaivedVisualQualityIssues({...summary, issues:[stalledIssue, otherIssue]}, new Set([sceneId]));
  assert.equal(mixed.summary.status, 'failed');
  assert.deepEqual(mixed.summary.issues, [otherIssue]);
  assert.equal(mixed.waived.length, 1);
  assert.equal(mixed.waived[0]!.sceneId, sceneId);

  const noneWaived = partitionWaivedVisualQualityIssues(summary, new Set());
  assert.equal(noneWaived.summary.status, 'failed');
  assert.deepEqual(noneWaived.waived, []);
});

test('smoke quality mode renders only the middle frame of each beat', async () => {
  let sampleCount = 0;
  const summary = await validateRenderedMotionCanvas({
    scenes:[scene],
    lifecycle,
    frame:{width:100,height:100,fps:10},
    backgroundColor:'#10231D',
    mode:'smoke',
    renderer:{async render(input){
      sampleCount = input.samples.length;
      return new Map(input.samples.map(sample => [
        sample.sampleId,
        frame(
          [safe(sample.beatId===beatOne?'block-one':'block-two')],
          true,
          sample.beatId===beatOne?[16,35,29,255]:[20,40,34,255],
        ),
      ]));
    }},
    now:'2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.status, 'passed');
  assert.equal(sampleCount, 2);
  assert.ok(summary.scenes.every(entry =>
    entry.samples.every(sample => sample.phase === 'middle'),
  ));
  assert.ok(summary.scenes[0]?.samples[0]?.visibleSemanticKeys?.includes('block-one'));
});

test('rendered frame gate rejects empty/uniform, unsafe, clipped, overlap, stale block and certain text faults', async () => {
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two')],false)), 'empty-frame');
  await failed(inspect(sample=>frame([{...safe(sample.beatId===beatOne?'block-one':'block-two'),bounds:{x:80,y:12,width:30,height:30}}])), 'outside-safe-area');
  await failed(inspect(sample=>frame([{...safe(sample.beatId===beatOne?'block-one':'block-two'),visibleBounds:{x:12,y:12,width:20,height:30}}])), 'clipped-block');
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two'), {...safe(sample.beatId===beatOne?'block-two':'block-one'),bounds:{x:15,y:15,width:40,height:30}}])), 'unexpected-block');
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two'), {key:'text-tiny',kind:'text',bounds:{x:12,y:50,width:20,height:10},visibleBounds:{x:12,y:50,width:10,height:10},fontSize:12,fill:'#183024',opacity:1}])), 'text-too-small');
});

test('rendered frame gate reports overlapping independent text boxes', async () => {
  await failed(inspect(sample => frame([
    safe(sample.beatId===beatOne?'block-one':'block-two'),
    {key:'first-label',kind:'text',bounds:{x:20,y:50,width:30,height:12},visibleBounds:{x:20,y:50,width:30,height:12},fontSize:24,fill:'#F7FBF8',localBackground:'#10231D',opacity:1,text:'Một'},
    {key:'second-label',kind:'text',bounds:{x:24,y:50,width:30,height:12},visibleBounds:{x:24,y:50,width:30,height:12},fontSize:24,fill:'#F7FBF8',localBackground:'#10231D',opacity:1,text:'Hai'},
  ])), 'text-overlap');
});

test('valid changing safe blocks pass and records per-beat image deltas', async () => {
  const summary = await inspect(sample => frame([safe(sample.beatId===beatOne?'block-one':'block-two')],true,sample.beatId===beatOne?[16,35,29,255]:[20,40,34,255]));
  assert.equal(summary.status, 'passed');
  assert.ok(summary.scenes[0]?.samples.some(sample=>sample.imageDeltaFromPreviousBeat !== null));
});

test('two expected blocks with excessive overlap fail', async () => {
  const two = new Map([[beatOne,{stay:['block-one','block-two']}],[beatTwo,{stay:['block-one','block-two']}]]);
  await failed(validateRenderedMotionCanvas({scenes:[scene],lifecycle:two,frame:{width:100,height:100,fps:10},backgroundColor:'#10231D',renderer:{async render(input){return new Map(input.samples.map(s=>[`${s.sceneId}:${s.beatId}:${s.phase}`,frame([safe('block-one'),{...safe('block-two'),bounds:{x:15,y:15,width:40,height:30}}]) ]));}},now:'2026-01-01T00:00:00.000Z'}), 'block-overlap');
});

test('nested lifecycle blocks do not count as independent overlap', async () => {
  const nestedLifecycle = new Map([[beatOne,{stay:['block-parent','block-child']}],[beatTwo,{stay:['block-parent','block-child']}]]);
  const summary = await validateRenderedMotionCanvas({
    scenes:[scene],
    lifecycle:nestedLifecycle,
    frame:{width:100,height:100,fps:10},
    backgroundColor:'#10231D',
    renderer:{async render(input){return new Map(input.samples.map(sample=>[
      sample.sampleId,
      frame([
        safe('block-parent'),
        {...safe('block-child'),bounds:{x:15,y:15,width:30,height:20},ancestorKeys:['block-parent'],parentKey:'block-parent',blockAncestor:'block-parent'},
      ],true,sample.beatId===beatOne?[16,35,29,255]:[20,40,34,255]),
    ]));}},
    now:'2026-01-01T00:00:00.000Z',
  });
  assert.equal(summary.status, 'passed');
});

test('sample timeline keeps every beat beyond the former 96-sample boundary', () => {
  const scenes = Array.from({length: 33}, (_, index): MotionCanvasSourceScene => {
    const suffix = String(index + 1).padStart(12, '0');
    const id = `20000000-0000-4000-8000-${suffix}`;
    const beatId = `30000000-0000-4000-8000-${suffix}`;
    return {
      id,
      outlineSectionId: `40000000-0000-4000-8000-${suffix}`,
      name: `Scene ${index + 1}`,
      filePath: `src/scenes/scene-${index + 1}.tsx`,
      durationSeconds: 4,
      source: `source-${index + 1}`,
      timingEvents: [{beatId,startEvent:`beat:${beatId}:start`,endEvent:`beat:${beatId}:end`,plannedDurationSeconds:4}],
    };
  });
  const samples = visualQualitySamples(scenes, 10);
  assert.equal(samples.length, 99);
  assert.equal(samples.at(-1)?.sceneId, scenes.at(-1)?.id);
  assert.ok((samples.at(-1)?.frame ?? 0) > 1_280);
});

test('issue budget is fair per scene so one broken scene cannot hide later failures', async () => {
  const makeScene = (index: number, beatCount: number) => {
    const id = randomUUID();
    const beatIds = Array.from({length: beatCount}, () => randomUUID());
    return {
      scene: {
        id,
        outlineSectionId: randomUUID(),
        name: `Broken scene ${index}`,
        filePath: `src/scenes/0${index}-broken.tsx`,
        durationSeconds: beatCount * 4,
        source: `broken-${index}`,
        timingEvents: beatIds.map(beatId => ({
          beatId,
          startEvent: `beat:${beatId}:start`,
          endEvent: `beat:${beatId}:end`,
          plannedDurationSeconds: 4,
        })),
      } satisfies MotionCanvasSourceScene,
      beatIds,
    };
  };
  const first = makeScene(1, 5);
  const second = makeScene(2, 1);
  const scenes = [first.scene, second.scene];
  const contracts = new Map(
    [...first.beatIds, ...second.beatIds].map(beatId => [
      beatId,
      {stay: ['block-required']},
    ]),
  );

  const failure = await validateRenderedMotionCanvas({
    scenes,
    lifecycle: contracts,
    frame: {width: 100, height: 100, fps: 10},
    backgroundColor: '#10231D',
    renderer: {
      async render(input) {
        return new Map(input.samples.map(sample => [
          sample.sampleId,
          frame(Array.from({length: 25}, (_, index) => ({
            key: `faulty-label-${index}`,
            kind: 'text' as const,
            bounds: {x: 10, y: 10, width: 30, height: 8},
            visibleBounds: {x: 10, y: 10, width: 30, height: 8},
            opacity: 1,
            fontSize: 10,
            fill: '#10231D',
            localBackground: '#10231D',
            text: 'x'.repeat(100),
          })), false),
        ]));
      },
    },
    now: '2026-01-01T00:00:00.000Z',
  }).then(() => null, (error: unknown) => {
    if (error instanceof MotionCanvasVisualQualityError) return error.summary;
    throw error;
  });

  assert.ok(failure);
  assert.ok(failure.issues.some(issue => issue.sceneId === first.scene.id));
  assert.ok(failure.issues.some(issue => issue.sceneId === second.scene.id));
  assert.ok(failure.issues.filter(issue => issue.sceneId === first.scene.id).length <= 12);
});

test('one retry regenerates only failed scene, persistent failure rejects, hash stale and temp cleanup are explicit', async () => {
  let validations=0, retries=0;
  const value=await retryRenderedSceneQualityOnce({async validate(){validations++; if(validations===1) throw new MotionCanvasVisualQualityError({version:VISUAL_QUALITY_GATE_VERSION,status:'failed',validatedAt:'2026-01-01T00:00:00.000Z',sourceHash:'a'.repeat(64),scenes:[],issues:[{code:'empty-frame',sceneId,beatId:beatOne,timeSeconds:0,semanticKey:null,bounds:null,reason:'empty'}]}); return 'passed';},async regenerateFailedScenes(summary){retries++;assert.deepEqual([...new Set(summary.issues.map(issue=>issue.sceneId))],[sceneId]);}});
  assert.equal(value,'passed');assert.equal(retries,1);assert.equal(validations,2);
  await assert.rejects(retryRenderedSceneQualityOnce({async validate(){throw new MotionCanvasVisualQualityError({version:VISUAL_QUALITY_GATE_VERSION,status:'failed',validatedAt:'2026-01-01T00:00:00.000Z',sourceHash:'a'.repeat(64),scenes:[],issues:[{code:'empty-frame',sceneId,beatId:beatOne,timeSeconds:0,semanticKey:null,bounds:null,reason:'empty'}]});},async regenerateFailedScenes(){}}), MotionCanvasVisualQualityError);
  assert.equal(visualValidationIsCurrent({sourceHash:'a'.repeat(64)},[scene]),false);
  let temporary=''; await withTemporaryVisualQualityWorkspace(async directory=>{temporary=directory; await access(directory);}); await assert.rejects(access(temporary));
});

const bible = {
  palette: {background: '#10231D', surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
  typographyScale: {title: 88, label: 42, body: 34},
  shapeLanguage: 'Thẻ bo góc nhất quán.',
  diagramLanguage: 'Sơ đồ trung tâm với nhãn ngắn.',
  motionTempo: 'Nhịp vừa, mỗi beat một chuyển động.',
  transitionConvention: 'Giữ anchor giữa các scene bằng fade ngắn.',
  visualAnchor: 'Khối trung tâm đại diện chủ đề video.',
};
function contract(overrides: Partial<BeatCompositionContract> = {}): BeatCompositionContract {
  return {
    visualFocus: 'Khối trung tâm giữ toàn bộ sự chú ý của beat này.',
    hierarchy: ['block-one', 'block-two'],
    semanticRole: 'claim',
    layout: 'center-focus',
    density: 'balanced',
    spacingNotes: 'Giữ khoảng thở rộng quanh khối trung tâm.',
    ...overrides,
  };
}
function run(options: {lifecycle: Map<string, BeatQualityContract>; nodes: (sample: ReturnType<typeof visualQualitySamples>[number]) => QualityRenderedFrame['nodes']; visualBible?: typeof bible; scenes?: MotionCanvasSourceScene[]; sceneHandoff?: Map<string, {incoming: string | null; outgoing: string | null}>}) {
  const scenes = options.scenes ?? [scene];
  return validateRenderedMotionCanvas({
    scenes,
    lifecycle: options.lifecycle,
    frame: {width: 100, height: 100, fps: 10},
    backgroundColor: '#10231D',
    visualBible: options.visualBible,
    sceneHandoff: options.sceneHandoff,
    renderer: {async render(input) { return new Map(input.samples.map(sample => [sample.sampleId, frame(options.nodes(sample), true, sample.beatId === beatOne ? [16,35,29,255] : [20,40,34,255])])); }},
    now: '2026-01-01T00:00:00.000Z',
  });
}
async function codesOf(work: Promise<unknown>) {
  try { await work; return [] as string[]; } catch (error) {
    if (!(error instanceof MotionCanvasVisualQualityError)) throw error;
    return [...new Set(error.summary.issues.map(issue => issue.code))];
  }
}
const bothBeats = (value: BeatQualityContract) => new Map([[beatOne, value], [beatTwo, value]]);

test('frame density detects an almost empty and an overfilled frame', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  assert.ok((await codesOf(run({lifecycle, nodes: () => [{...safe('block-one'), bounds: {x: 45, y: 45, width: 6, height: 6}, visibleBounds: {x: 45, y: 45, width: 6, height: 6}}]}))).includes('frame-too-sparse'));
  assert.ok((await codesOf(run({lifecycle, nodes: () => [{...safe('block-one'), bounds: {x: 0, y: 0, width: 100, height: 100}, visibleBounds: {x: 0, y: 0, width: 100, height: 100}}]}))).includes('frame-too-dense'));
  assert.ok((await codesOf(run({lifecycle, nodes: () => [safe('block-one'), ...Array.from({length: 44}, (_, index) => ({key: `chip-${index}`, kind: 'other' as const, bounds: {x: 12, y: 12, width: 4, height: 4}, visibleBounds: {x: 12, y: 12, width: 4, height: 4}, opacity: 1}))]}))).includes('frame-too-dense'));
});

test('keyed Layout containers do not count as conceptual visual components', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  const nodesWith = (paintedCount: number) => [
    safe('block-one'),
    ...Array.from({length: 7}, (_, index) => ({
      key: `block-group-${index}`,
      kind: 'block' as const,
      isContainer: true,
      ancestorKeys: ['block-one'],
      bounds: {x: 12, y: 12, width: 40, height: 30},
      visibleBounds: {x: 12, y: 12, width: 40, height: 30},
      opacity: 1,
      effectiveOpacity: 1,
    })),
    ...Array.from({length: paintedCount}, (_, index) => ({
      key: `primitive-${index}`,
      kind: 'other' as const,
      ancestorKeys: ['block-one'],
      bounds: {x: 16, y: 16, width: 2, height: 2},
      visibleBounds: {x: 16, y: 16, width: 2, height: 2},
      opacity: 1,
      effectiveOpacity: 1,
    })),
  ];
  assert.deepEqual(await codesOf(run({lifecycle, nodes: () => nodesWith(39)})), []);
  assert.ok((await codesOf(run({lifecycle, nodes: () => nodesWith(40)}))).includes('frame-too-dense'));
});

test('primary block must dominate and sit inside its declared focus zone', async () => {
  const lifecycle = bothBeats({stay: ['block-one', 'block-two'], primaryBlock: 'block-one', compositionContract: contract()});
  const codes = await codesOf(run({lifecycle, nodes: () => [
    {...safe('block-one'), bounds: {x: 12, y: 12, width: 10, height: 10}, visibleBounds: {x: 12, y: 12, width: 10, height: 10}},
    {...safe('block-two'), bounds: {x: 45, y: 45, width: 40, height: 40}, visibleBounds: {x: 45, y: 45, width: 40, height: 40}},
  ]}));
  assert.ok(codes.includes('primary-block-not-prominent'));

  const offCenter = bothBeats({stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one']})});
  assert.ok((await codesOf(run({lifecycle: offCenter, nodes: () => [{...safe('block-one'), bounds: {x: 9, y: 8, width: 30, height: 30}, visibleBounds: {x: 9, y: 8, width: 30, height: 30}}]}))).includes('primary-block-off-center'));
  assert.deepEqual(await codesOf(run({lifecycle: offCenter, nodes: () => [{...safe('block-one'), bounds: {x: 35, y: 35, width: 30, height: 30}, visibleBounds: {x: 35, y: 35, width: 30, height: 30}}]})), []);
});

test('adjacent blocks that almost touch report insufficient spacing, not overlap', async () => {
  const lifecycle = bothBeats({stay: ['block-one', 'block-two']});
  const codes = await codesOf(run({lifecycle, nodes: () => [
    {...safe('block-one'), bounds: {x: 12, y: 12, width: 30, height: 30}, visibleBounds: {x: 12, y: 12, width: 30, height: 30}},
    {...safe('block-two'), bounds: {x: 43, y: 12, width: 30, height: 30}, visibleBounds: {x: 43, y: 12, width: 30, height: 30}},
  ]}));
  assert.deepEqual(codes, ['insufficient-spacing']);
});

test('text overflow, competing titles and font sizes outside the bible are separate faults', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  const overflow = await codesOf(run({lifecycle, nodes: () => [
    safe('block-one'),
    {key: 'concept-label', kind: 'text' as const, blockAncestor: 'block-one', ancestorKeys: ['block-one'], bounds: {x: 12, y: 12, width: 60, height: 30}, visibleBounds: {x: 12, y: 12, width: 60, height: 30}, opacity: 1, fontSize: 20},
  ]}));
  // The oversized box that trips the container-overflow check also covers
  // more glyph area than the block it overflows, so both faults are real.
  assert.deepEqual(overflow, ['text-overflow', 'text-overrepresented']);

  const twoTitles = await codesOf(run({lifecycle, visualBible: bible, nodes: () => [
    safe('block-one'),
    {key: 'title-left', kind: 'text' as const, bounds: {x: 12, y: 60, width: 20, height: 10}, visibleBounds: {x: 12, y: 60, width: 20, height: 10}, opacity: 1, fontSize: 88},
    {key: 'title-right', kind: 'text' as const, bounds: {x: 60, y: 60, width: 20, height: 10}, visibleBounds: {x: 60, y: 60, width: 20, height: 10}, opacity: 1, fontSize: 88},
  ]}));
  assert.deepEqual(twoTitles, ['text-hierarchy-violation']);

  const drift = await codesOf(run({lifecycle, visualBible: bible, nodes: () => [
    safe('block-one'),
    {key: 'title-left', kind: 'text' as const, bounds: {x: 12, y: 60, width: 20, height: 10}, visibleBounds: {x: 12, y: 60, width: 20, height: 10}, opacity: 1, fontSize: 88},
    {key: 'stray-caption', kind: 'text' as const, bounds: {x: 60, y: 60, width: 20, height: 10}, visibleBounds: {x: 60, y: 60, width: 20, height: 10}, opacity: 1, fontSize: 60},
  ]}));
  assert.deepEqual(drift, ['typography-drift']);
});

test('a caption over the character limit is flagged even when its box is small', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  const longCaption = await codesOf(run({lifecycle, nodes: () => [
    safe('block-one'),
    {key: 'long-caption', kind: 'text' as const, bounds: {x: 12, y: 60, width: 20, height: 10}, visibleBounds: {x: 12, y: 60, width: 20, height: 10}, opacity: 1, fontSize: 20, text: 'A'.repeat(120)},
  ]}));
  assert.deepEqual(longCaption, ['caption-too-long']);
});

test('text glyph area dominating the occupied frame is flagged as text-overrepresented', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  const textHeavy = await codesOf(run({lifecycle, nodes: () => [
    safe('block-one'),
    {key: 'big-caption', kind: 'text' as const, bounds: {x: 12, y: 50, width: 50, height: 40}, visibleBounds: {x: 12, y: 50, width: 50, height: 40}, opacity: 1, fontSize: 20, text: 'Label'},
  ]}));
  assert.deepEqual(textHeavy, ['text-overrepresented']);
});

test('a short caption nested in its block clears both text-quantity checks', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  const modest = await codesOf(run({lifecycle, nodes: () => [
    safe('block-one'),
    {key: 'short-label', kind: 'text' as const, blockAncestor: 'block-one', ancestorKeys: ['block-one'], bounds: {x: 16, y: 16, width: 20, height: 10}, visibleBounds: {x: 16, y: 16, width: 20, height: 10}, opacity: 1, fontSize: 20, text: 'Nhị phân'},
  ]}));
  assert.deepEqual(modest, []);
});

test('fills outside the visual bible palette report palette drift', async () => {
  const lifecycle = bothBeats({stay: ['block-one']});
  assert.deepEqual(await codesOf(run({lifecycle, visualBible: bible, nodes: () => [{...safe('block-one'), fill: '#ff00ff'}]})), ['palette-drift']);
  assert.deepEqual(await codesOf(run({lifecycle, visualBible: bible, nodes: () => [{...safe('block-one'), fill: '#51B68E'}]})), []);
});

test('a front node burying important content is occlusion, not peer block overlap', async () => {
  const lifecycle = bothBeats({stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'})});
  const codes = await codesOf(run({lifecycle, nodes: () => [
    {...safe('block-one'), bounds: {x: 30, y: 30, width: 40, height: 30}, visibleBounds: {x: 30, y: 30, width: 40, height: 30}},
    {key: 'overlay-panel', kind: 'other' as const, fill: '#1D2939', bounds: {x: 30, y: 30, width: 40, height: 30}, visibleBounds: {x: 30, y: 30, width: 40, height: 30}, opacity: 1, effectiveOpacity: 1},
  ]}));
  assert.ok(codes.includes('content-occluded'));
  assert.ok(!codes.includes('block-overlap'));
});

test('visual quality failure returns only issue-linked frame evidence and related nodes', async () => {
  const lifecycle = bothBeats({
    stay: ['block-one'],
    primaryBlock: 'block-one',
    compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'}),
  });
  const samples = visualQualitySamples([scene], 10);
  const rendered = new Map(samples.map(sample => {
    const nodes: QualityRenderedFrame['nodes'] = [
      {...safe('block-one'), bounds: {x: 20, y: 20, width: 60, height: 40}, visibleBounds: {x: 20, y: 20, width: 60, height: 40}},
      {key: 'important-label', kind: 'text' as const, ancestorKeys: ['block-one'], bounds: {x: 35, y: 35, width: 20, height: 10}, visibleBounds: {x: 35, y: 35, width: 20, height: 10}, opacity: 1, fontSize: 20, text: 'Nhãn'},
      ...(sample.beatId === beatTwo && sample.phase === 'middle'
        ? [{key: 'overlay-panel', kind: 'other' as const, fill: '#1D2939', bounds: {x: 35, y: 35, width: 20, height: 10}, visibleBounds: {x: 35, y: 35, width: 20, height: 10}, opacity: 1, effectiveOpacity: 1}]
        : []),
    ];
    return [sample.sampleId, {...frame(nodes), png: Buffer.from(sample.sampleId)}] as const;
  }));
  let callbackEvidence: MotionCanvasVisualEvidence[] = [];

  await assert.rejects(
    validateRenderedMotionCanvas({
      scenes: [scene],
      lifecycle,
      frame: {width: 100, height: 100, fps: 10},
      backgroundColor: '#10231D',
      renderer: {render: async () => rendered},
      onFailure: evidence => {
        callbackEvidence = evidence;
      },
      now: '2026-01-01T00:00:00.000Z',
    }),
    error => {
      if (!(error instanceof MotionCanvasVisualQualityError)) return false;
      assert.equal(error.evidence.length, 1);
      const only = error.evidence[0]!;
      assert.equal(only.sceneId, scene.id);
      assert.equal(only.beatId, beatTwo);
      assert.equal(only.phase, 'middle');
      assert.equal(only.frame, samples.find(sample => sample.beatId === beatTwo && sample.phase === 'middle')!.frame);
      assert.equal(only.png.toString(), only.sceneId + ':' + only.beatId + ':middle');
      assert.ok(only.issues.some(issue => issue.code === 'content-occluded'));
      assert.ok(only.nodes.some(node => node.key === 'overlay-panel'));
      assert.ok(only.nodes.some(node => node.key === 'important-label'));
      return true;
    },
  );
  assert.equal(callbackEvidence.length, 1);
});

test('a transparent range outline does not falsely occlude content', async () => {
  const lifecycle = bothBeats({stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'})});
  const codes = await codesOf(run({lifecycle, nodes: () => [
    {...safe('block-one'), bounds: {x: 20, y: 20, width: 60, height: 40}, visibleBounds: {x: 20, y: 20, width: 60, height: 40}},
    {key: 'important-label', kind: 'text' as const, blockAncestor: 'block-one', ancestorKeys: ['block-one'], bounds: {x: 35, y: 35, width: 20, height: 10}, visibleBounds: {x: 35, y: 35, width: 20, height: 10}, opacity: 1, fontSize: 20, text: 'Nhãn'},
    {key: 'range-outline', kind: 'other' as const, fill: '#00000000', bounds: {x: 20, y: 20, width: 60, height: 40}, visibleBounds: {x: 20, y: 20, width: 60, height: 40}, opacity: 1, effectiveOpacity: 1},
  ]}));
  assert.ok(!codes.includes('content-occluded'));
});

test('a Layout range diagram does not falsely occlude its sibling cell labels', async () => {
  const lifecycle = bothBeats({stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'})});
  const cellNodes = [
    'cell-value-three',
    'cell-value-seven',
    'cell-value-eleven',
    'cell-value-fifteen',
    'cell-value-nineteen',
    'cell-value-twenty-three',
    'cell-value-twenty-seven',
  ].map((key, index) => ({
    key,
    kind: 'text' as const,
    ancestorKeys: ['block-array-anchor'],
    bounds: {x: 30 + index * 7, y: 45, width: 5, height: 10},
    visibleBounds: {x: 30 + index * 7, y: 45, width: 5, height: 10},
    opacity: 1,
    effectiveOpacity: 1,
    fontSize: 20,
    text: String(index + 1),
  }));
  const nodes = [
    {...safe('block-one'), bounds: {x: 20, y: 20, width: 60, height: 60}, visibleBounds: {x: 20, y: 20, width: 60, height: 60}},
    ...cellNodes,
    {key: 'block-range-diagram', kind: 'block' as const, isContainer: true, fill: null, opacity: 1, effectiveOpacity: 1, bounds: {x: 20, y: 20, width: 60, height: 60}, visibleBounds: {x: 20, y: 20, width: 60, height: 60}},
  ];
  const codes = await codesOf(run({lifecycle, nodes: () => nodes}));
  assert.ok(!codes.includes('content-occluded'));
});

test('quality retry guidance carries exact issue, frame and semantic node context', () => {
  const issue = {code: 'content-occluded' as const, sceneId, beatId: beatTwo, timeSeconds: 6, semanticKey: 'block-range-diagram>cell-value-three', bounds: {x: 30, y: 45, width: 5, height: 10}, reason: 'Node block-range-diagram is drawn over and covers most of cell-value-three.'};
  const evidence: MotionCanvasVisualEvidence[] = [{
    sceneId,
    beatId: beatTwo,
    phase: 'middle',
    frame: 420,
    timeSeconds: 6,
    png: Buffer.from('evidence'),
    issues: [issue],
    nodes: [
      {key: 'block-range-diagram', kind: 'block', isContainer: true, fill: null, effectiveOpacity: 1, bounds: {x: 20, y: 20, width: 60, height: 60}},
      {key: 'cell-value-three', kind: 'text', isContainer: false, fill: '#FFFFFF', effectiveOpacity: 1, bounds: issue.bounds},
    ],
  }];
  const guidance = formatVisualQualityRetryGuidance([issue], evidence);
  assert.match(guidance, /issue=content-occluded/);
  assert.match(guidance, /phase=middle frame=420 timeSeconds=6/);
  assert.match(guidance, /semanticKey=block-range-diagram>cell-value-three/);
  assert.match(guidance, /block-range-diagram\[kind=block;container=true/);
  assert.match(guidance, /targetBounds=\(30\.0,45\.0,5\.0x10\.0\)/);
});

test('a shared anchor may not teleport between beats unless the beat is a transition', async () => {
  const nodes = (sample: ReturnType<typeof visualQualitySamples>[number]) => [
    sample.beatId === beatOne
      ? {...safe('block-one'), bounds: {x: 10, y: 10, width: 26, height: 26}, visibleBounds: {x: 10, y: 10, width: 26, height: 26}}
      : {...safe('block-one'), bounds: {x: 64, y: 64, width: 26, height: 26}, visibleBounds: {x: 64, y: 64, width: 26, height: 26}},
  ];
  const stable = {stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'})};
  assert.ok((await codesOf(run({lifecycle: bothBeats(stable), nodes}))).includes('layout-jump-excessive'));
  const cut = new Map([[beatOne, stable], [beatTwo, {...stable, compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed', semanticRole: 'transition'})}]]);
  assert.deepEqual(await codesOf(run({lifecycle: cut, nodes})), []);
});

test('the scene handoff boundary is checked with the same anchor rule', async () => {
  const secondSceneId = '10000000-0000-4000-8000-000000000003';
  const beatThree = '10000000-0000-4000-8000-000000000013';
  const one: MotionCanvasSourceScene = {...scene, timingEvents: [scene.timingEvents![0]!]};
  const two: MotionCanvasSourceScene = {id: secondSceneId, outlineSectionId: '10000000-0000-4000-8000-000000000004', name: 'Second', filePath: 'src/scenes/second.tsx', durationSeconds: 4, source: 'source-b', timingEvents: [{beatId: beatThree, startEvent: `beat:${beatThree}:start`, endEvent: `beat:${beatThree}:end`, plannedDurationSeconds: 4}]};
  const anchored = {stay: ['block-one'], primaryBlock: 'block-one', compositionContract: contract({hierarchy: ['block-one', 'block-one'], layout: 'full-bleed'})};
  const lifecycle = new Map([[beatOne, anchored], [beatThree, anchored]]);
  const handoff = new Map([[one.id, {incoming: null, outgoing: 'Giữ anchor cho scene sau.'}], [two.id, {incoming: 'Kế thừa anchor từ scene trước.', outgoing: null}]]);
  const nodes = (sample: ReturnType<typeof visualQualitySamples>[number]) => [
    sample.sceneId === one.id
      ? {...safe('block-one'), bounds: {x: 10, y: 10, width: 26, height: 26}, visibleBounds: {x: 10, y: 10, width: 26, height: 26}}
      : {...safe('block-one'), bounds: {x: 64, y: 64, width: 26, height: 26}, visibleBounds: {x: 64, y: 64, width: 26, height: 26}},
  ];
  assert.ok((await codesOf(run({scenes: [one, two], lifecycle, sceneHandoff: handoff, nodes}))).includes('layout-jump-excessive'));
  assert.deepEqual(await codesOf(run({scenes: [one, two], lifecycle, nodes})), []);
});

test('approve, apply and restore block on missing, failed, stale-shape or stale-source evidence', () => {
  const hash = motionCanvasSceneSourceHash([scene]);
  const passing = {version: VISUAL_QUALITY_GATE_VERSION, status: 'passed' as const, sourceHash: hash};
  assert.doesNotThrow(() => assertVisualValidationCurrent({visualValidation: passing}, [scene]));
  assert.equal(visualValidationIsReusable(passing, [scene]), true);
  const reasons = [
    [undefined, 'missing'],
    [{version: VISUAL_QUALITY_GATE_VERSION - 1, status: 'passed' as const, sourceHash: hash}, 'stale-version'],
    [{version: VISUAL_QUALITY_GATE_VERSION, status: 'failed' as const, sourceHash: hash}, 'failed'],
    [{version: VISUAL_QUALITY_GATE_VERSION, status: 'passed' as const, sourceHash: 'b'.repeat(64)}, 'stale-source'],
  ] as const;
  for (const [visualValidation, reason] of reasons) {
    assert.equal(visualValidationIsReusable(visualValidation, [scene]), false);
    assert.throws(() => assertVisualValidationCurrent({visualValidation}, [scene]), error =>
      error instanceof MotionCanvasVisualValidationGateError && error.reason === reason && error.code === 'MOTION_CANVAS_VISUAL_VALIDATION_REQUIRED');
  }
});
