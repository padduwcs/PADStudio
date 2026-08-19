import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {MotionCanvasVisualQualityError, retryRenderedSceneQualityOnce, validateRenderedMotionCanvas, visualQualitySamples, visualValidationIsCurrent, withTemporaryVisualQualityWorkspace, type QualityRenderedFrame} from './motionCanvasVisualQuality.ts';

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
  const value=await retryRenderedSceneQualityOnce({async validate(){validations++; if(validations===1) throw new MotionCanvasVisualQualityError({version:1,status:'failed',validatedAt:'2026-01-01T00:00:00.000Z',sourceHash:'a'.repeat(64),scenes:[],issues:[{code:'empty-frame',sceneId,beatId:beatOne,timeSeconds:0,semanticKey:null,bounds:null,reason:'empty'}]}); return 'passed';},async regenerateFailedScenes(summary){retries++;assert.deepEqual([...new Set(summary.issues.map(issue=>issue.sceneId))],[sceneId]);}});
  assert.equal(value,'passed');assert.equal(retries,1);assert.equal(validations,2);
  await assert.rejects(retryRenderedSceneQualityOnce({async validate(){throw new MotionCanvasVisualQualityError({version:1,status:'failed',validatedAt:'2026-01-01T00:00:00.000Z',sourceHash:'a'.repeat(64),scenes:[],issues:[{code:'empty-frame',sceneId,beatId:beatOne,timeSeconds:0,semanticKey:null,bounds:null,reason:'empty'}]});},async regenerateFailedScenes(){}}), MotionCanvasVisualQualityError);
  assert.equal(visualValidationIsCurrent({sourceHash:'a'.repeat(64)},[scene]),false);
  let temporary=''; await withTemporaryVisualQualityWorkspace(async directory=>{temporary=directory; await access(directory);}); await assert.rejects(access(temporary));
});
