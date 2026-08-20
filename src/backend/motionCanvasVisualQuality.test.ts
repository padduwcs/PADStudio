import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import type {BeatCompositionContract} from '../shared/topic.ts';
import {MotionCanvasVisualQualityError, MotionCanvasVisualValidationGateError, VISUAL_QUALITY_GATE_VERSION, assertVisualValidationCurrent, motionCanvasSceneSourceHash, retryRenderedSceneQualityOnce, validateRenderedMotionCanvas, visualQualitySamples, visualValidationIsCurrent, visualValidationIsReusable, withTemporaryVisualQualityWorkspace, type BeatQualityContract, type QualityRenderedFrame} from './motionCanvasVisualQuality.ts';

const sceneId = '10000000-0000-4000-8000-000000000001';
const beatOne = '10000000-0000-4000-8000-000000000011';
const beatTwo = '10000000-0000-4000-8000-000000000012';
const scene: MotionCanvasSourceScene = {id: sceneId, outlineSectionId: '10000000-0000-4000-8000-000000000002', name: 'Quality scene', filePath: 'src/scenes/quality-scene.tsx', durationSeconds: 8, source: 'source-a', timingEvents: [{beatId: beatOne,startEvent:`beat:${beatOne}:start`,endEvent:`beat:${beatOne}:end`,plannedDurationSeconds:4},{beatId: beatTwo,startEvent:`beat:${beatTwo}:start`,endEvent:`beat:${beatTwo}:end`,plannedDurationSeconds:4}]};
const lifecycle = new Map([[beatOne,{stay:['block-one']}],[beatTwo,{stay:['block-two']}]]);
function pixels(color: [number,number,number,number], accent = false) { const output = new Uint8Array(100*100*4); for(let i=0;i<output.length;i+=4){output[i]=color[0];output[i+1]=color[1];output[i+2]=color[2];output[i+3]=color[3];} if(accent) for(let i=0;i<600;i+=4){output[i]=255;output[i+1]=255;output[i+2]=255;} return output; }
function frame(nodes: QualityRenderedFrame['nodes'], accent=true, color:[number,number,number,number]=[16,35,29,255]): QualityRenderedFrame {return {width:100,height:100,rgba:pixels(color,accent),nodes};}
async function inspect(factory: (sample: ReturnType<typeof visualQualitySamples>[number]) => QualityRenderedFrame) { return validateRenderedMotionCanvas({scenes:[scene],lifecycle,frame:{width:100,height:100,fps:10},backgroundColor:'#10231D',renderer:{async render(input){return new Map(input.samples.map(sample=>[`${sample.sceneId}:${sample.beatId}:${sample.phase}`,factory(sample)]));}},now:'2026-01-01T00:00:00.000Z'}); }
const safe = (key:string) => ({key,bounds:{x:12,y:12,width:40,height:30},visibleBounds:{x:12,y:12,width:40,height:30},opacity:1,kind:'block' as const});
function failed(work: Promise<unknown>, code: string) { return assert.rejects(work, error => error instanceof MotionCanvasVisualQualityError && error.summary.issues.some(issue=>issue.code===code)); }

test('rendered frame gate rejects empty/uniform, unsafe, clipped, overlap, stale block and certain text faults', async () => {
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two')],false)), 'empty-frame');
  await failed(inspect(sample=>frame([{...safe(sample.beatId===beatOne?'block-one':'block-two'),bounds:{x:80,y:12,width:30,height:30}}])), 'outside-safe-area');
  await failed(inspect(sample=>frame([{...safe(sample.beatId===beatOne?'block-one':'block-two'),visibleBounds:{x:12,y:12,width:20,height:30}}])), 'clipped-block');
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two'), {...safe(sample.beatId===beatOne?'block-two':'block-one'),bounds:{x:15,y:15,width:40,height:30}}])), 'unexpected-block');
  await failed(inspect(sample=>frame([safe(sample.beatId===beatOne?'block-one':'block-two'), {key:'text-tiny',kind:'text',bounds:{x:12,y:50,width:20,height:10},visibleBounds:{x:12,y:50,width:10,height:10},fontSize:12,fill:'#183024',opacity:1}])), 'text-too-small');
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
    {key: 'overlay-panel', kind: 'other' as const, bounds: {x: 30, y: 30, width: 40, height: 30}, visibleBounds: {x: 30, y: 30, width: 40, height: 30}, opacity: 1, effectiveOpacity: 1},
  ]}));
  assert.ok(codes.includes('content-occluded'));
  assert.ok(!codes.includes('block-overlap'));
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
