import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {z} from 'zod';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {analyzeRgbaFrame, parseHexColor, type VisualSampleMetrics} from './visualViability.ts';

export const VISUAL_QUALITY_GATE_VERSION = 1;
export const visualQualityThresholds = {
  safeMarginXRatio: 0.08,
  safeMarginYRatio: 0.07,
  minimumVisibleRatio: 0.98,
  maximumBlockOverlapRatio: 0.35,
  minimumTextPixels: 18,
  minimumTextContrast: 3,
  minimumBeatImageDelta: 0.002,
  maximumIssues: 64,
} as const;

export const VisualQualityIssueSchema = z.object({
  code: z.enum(['empty-frame', 'unexpected-block', 'missing-active-block', 'clipped-block', 'outside-safe-area', 'block-overlap', 'text-clipped', 'text-too-small', 'text-low-contrast', 'static-beats', 'renderer-error']),
  sceneId: z.string().uuid(), beatId: z.string().uuid().nullable(), timeSeconds: z.number().nonnegative(), semanticKey: z.string().nullable(),
  bounds: z.object({x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative()}).nullable(),
  reason: z.string().min(1).max(600),
}).strict();
export type VisualQualityIssue = z.infer<typeof VisualQualityIssueSchema>;

const BoundsSchema = z.object({x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative()}).strict();
export const VisualQualitySummarySchema = z.object({
  version: z.literal(VISUAL_QUALITY_GATE_VERSION), status: z.enum(['passed', 'failed']), validatedAt: z.string().datetime(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  scenes: z.array(z.object({sceneId: z.string().uuid(), samples: z.array(z.object({beatId: z.string().uuid(), phase: z.enum(['stable-start', 'middle', 'pre-exit']), timeSeconds: z.number().nonnegative(), frame: z.number().int().nonnegative(), metrics: z.object({verdict: z.string(), contentRatio: z.number(), dominantColorRatio: z.number()}).strict(), activeBlocks: z.array(z.string()).max(12), imageDeltaFromPreviousBeat: z.number().nullable()}).strict()).max(30)}).strict()).max(128),
  issues: z.array(VisualQualityIssueSchema).max(visualQualityThresholds.maximumIssues),
}).strict();
export type VisualQualitySummary = z.infer<typeof VisualQualitySummarySchema>;

export interface QualityNodeSnapshot { key: string; parentKey?: string | null; blockAncestor?: string | null; ancestorKeys?: string[]; managed?: boolean; bounds: {x: number; y: number; width: number; height: number}; visibleBounds?: {x: number; y: number; width: number; height: number}; opacity?: number; effectiveOpacity?: number; kind?: 'block' | 'text' | 'other'; fontSize?: number; fill?: string | null; localBackground?: string | null; }
export interface QualityRenderedFrame { width: number; height: number; rgba: Uint8Array; nodes: QualityNodeSnapshot[]; }
export interface QualitySample {sampleId: string; sceneId: string; beatId: string; phase: 'stable-start' | 'middle' | 'pre-exit'; timeSeconds: number; frame: number;}
export interface MotionCanvasFrameRenderer { render(options: {scenes: MotionCanvasSourceScene[]; samples: QualitySample[]; frame: {width: number; height: number; fps: number}; workspaceDirectory?: string; projectFile?: string; managedKeysByBeat?: Map<string, string[]>}): Promise<Map<string, QualityRenderedFrame>>; }
export interface MotionCanvasVisualQualityGate { validate(options: {scenes: MotionCanvasSourceScene[]; lifecycle: Map<string, {stay: string[]}>; frame: {width: number; height: number; fps: number}; backgroundColor?: string | null; workspaceDirectory?: string; projectFile?: string;}): Promise<VisualQualitySummary>; }

export class MotionCanvasVisualQualityError extends Error {
  readonly summary: VisualQualitySummary;
  constructor(summary: VisualQualitySummary, message = 'Rendered Motion Canvas visual quality gate failed.') { super(message); this.summary = summary; }
}

function keyOf(sample: QualitySample) { return sample.sampleId; }
function sourceHash(scenes: MotionCanvasSourceScene[]) { const hash = createHash('sha256'); for (const scene of [...scenes].sort((a,b) => a.id.localeCompare(b.id))) {hash.update(scene.id); hash.update('\0'); hash.update(scene.source); hash.update('\0');} return hash.digest('hex'); }
export function visualValidationIsCurrent(summary: Pick<VisualQualitySummary, 'sourceHash'>, scenes: MotionCanvasSourceScene[]) { return summary.sourceHash === sourceHash(scenes); }
function area(b: QualityNodeSnapshot['bounds']) { return b.width * b.height; }
function intersection(a: QualityNodeSnapshot['bounds'], b: QualityNodeSnapshot['bounds']) { const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)); const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); return width * height; }
function isVisible(node: QualityNodeSnapshot) { return (node.effectiveOpacity ?? node.opacity ?? 1) > 0.01 && area(node.visibleBounds ?? node.bounds) > 1; }
function contrast(fill: string | null | undefined, background: string | null | undefined) { const fg = parseHexColor(fill); const bg = parseHexColor(background); if (!fg || !bg) return null; const l = (rgb: readonly number[]) => {const c = rgb.map(v => {const x=v/255; return x <= .04045 ? x / 12.92 : ((x+.055)/1.055) ** 2.4;}); return .2126*c[0]!+.7152*c[1]!+.0722*c[2]!;}; const values = [l(fg),l(bg)].sort((x,y)=>y-x); return (values[0]!+.05)/(values[1]!+.05); }
function pixelDelta(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) return 1; let total = 0; for (let i=0;i<a.length;i+=4) total += (Math.abs(a[i]! - b[i]!) + Math.abs(a[i+1]! - b[i+1]!) + Math.abs(a[i+2]! - b[i+2]!)) / (255 * 3); return total / (a.length / 4); }

/** Samples happen after the short enter window, in the middle, and immediately
 * before the short exit window. Reported seconds are scene-local while frame
 * numbers are global across the Motion Canvas project. */
export function visualQualitySamples(scenes: MotionCanvasSourceScene[], fps: number): QualitySample[] {
  const samples: QualitySample[] = [];
  let projectStart = 0;
  for (const scene of scenes) { let sceneStart = 0; for (const event of scene.timingEvents ?? []) { const d = event.plannedDurationSeconds; const inset = Math.min(Math.max(0.12, d * .12), Math.max(.12, d / 3)); const times: Array<[QualitySample['phase'], number]> = [['stable-start', Math.min(d - .01, inset)], ['middle', d * .5], ['pre-exit', Math.max(inset, d - inset)]]; for (const [phase, offset] of times) { const local = sceneStart + Math.max(0, offset); samples.push({sampleId:`${scene.id}:${event.beatId}:${phase}`,sceneId: scene.id, beatId: event.beatId, phase, timeSeconds: local, frame: Math.max(0, Math.round((projectStart + local) * fps))}); } sceneStart += d; } projectStart += sceneStart; }
  return samples;
}

export async function validateRenderedMotionCanvas(options: {scenes: MotionCanvasSourceScene[]; lifecycle: Map<string, {stay: string[]}>; frame: {width: number; height: number; fps: number}; backgroundColor?: string | null; renderer: MotionCanvasFrameRenderer; workspaceDirectory?: string; projectFile?: string; now?: string;}): Promise<VisualQualitySummary> {
  const samples = visualQualitySamples(options.scenes, options.frame.fps); const issues: VisualQualityIssue[] = []; const push = (issue: VisualQualityIssue) => {if (issues.length < visualQualityThresholds.maximumIssues) issues.push(issue);};
  let rendered: Map<string, QualityRenderedFrame>;
  try { rendered = await options.renderer.render({scenes: options.scenes, samples, frame: options.frame, workspaceDirectory: options.workspaceDirectory, projectFile: options.projectFile, managedKeysByBeat: new Map([...options.lifecycle].map(([id,value])=>[id,value.stay]))}); } catch (error) { const scene = options.scenes[0]!; const summary = {version: 1 as const, status: 'failed' as const, validatedAt: options.now ?? new Date().toISOString(), sourceHash: sourceHash(options.scenes), scenes: [], issues: [{code: 'renderer-error' as const, sceneId: scene.id, beatId: null, timeSeconds: 0, semanticKey: null, bounds: null, reason: error instanceof Error ? error.message.slice(0,600) : 'Renderer failed.'}]}; throw new MotionCanvasVisualQualityError(VisualQualitySummarySchema.parse(summary), 'Motion Canvas frame renderer failed.'); }
  const sceneEntries: VisualQualitySummary['scenes'] = []; const middleByScene = new Map<string, QualityRenderedFrame[]>();
  const managedBlocksByScene = new Map(options.scenes.map(scene => [scene.id, new Set(samples.filter(sample => sample.sceneId === scene.id).flatMap(sample => options.lifecycle.get(sample.beatId)?.stay ?? []).filter(key => key.startsWith('block-')))]));
  for (const scene of options.scenes) { const sampleRows: VisualQualitySummary['scenes'][number]['samples'] = []; for (const sample of samples.filter(x=>x.sceneId===scene.id)) { const render = rendered.get(keyOf(sample)); const lifecycle = options.lifecycle.get(sample.beatId); if (!render || !lifecycle) { push({code:'renderer-error', sceneId:scene.id, beatId:sample.beatId, timeSeconds:sample.timeSeconds, semanticKey:null, bounds:null, reason:!render?'Renderer did not return requested frame.':'Missing beat lifecycle.'}); continue; } const metrics = analyzeRgbaFrame({frame:sample.frame,timeSeconds:sample.timeSeconds,sceneId:scene.id,width:render.width,height:render.height,rgba:render.rgba,backgroundColor:options.backgroundColor}); if (metrics.verdict !== 'viable') push({code:'empty-frame',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`RGBA verdict is ${metrics.verdict}.`}); const managedBlocks = managedBlocksByScene.get(scene.id)!; const activeBlocks = render.nodes.filter(node=>node.key.startsWith('block-') && managedBlocks.has(node.key) && isVisible(node)); const expected = new Set(lifecycle.stay.filter(key=>key.startsWith('block-'))); for (const node of activeBlocks) if (!expected.has(node.key)) push({code:'unexpected-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Visible lifecycle-managed block is not in this beat lifecycle.stay.'}); for (const key of expected) if (!activeBlocks.some(n=>n.key===key)) push({code:'missing-active-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:key,bounds:null,reason:'Expected active block is not visibly rendered.'}); const safe={x:render.width*visualQualityThresholds.safeMarginXRatio,y:render.height*visualQualityThresholds.safeMarginYRatio,width:render.width*(1-2*visualQualityThresholds.safeMarginXRatio),height:render.height*(1-2*visualQualityThresholds.safeMarginYRatio)}; for (const node of activeBlocks) { const visible=node.visibleBounds??node.bounds; if (area(visible)<area(node.bounds)*visualQualityThresholds.minimumVisibleRatio) push({code:'clipped-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Runtime visible area is clipped.'}); if (node.bounds.x<safe.x || node.bounds.y<safe.y || node.bounds.x+node.bounds.width>safe.x+safe.width || node.bounds.y+node.bounds.height>safe.y+safe.height) push({code:'outside-safe-area',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Active block exceeds quantified safe area.'}); } for(let i=0;i<activeBlocks.length;i++) for(let j=i+1;j<activeBlocks.length;j++){const a=activeBlocks[i]!,b=activeBlocks[j]!;if(a.ancestorKeys?.includes(b.key)||b.ancestorKeys?.includes(a.key))continue;const shared=intersection(a.bounds,b.bounds); if(shared/Math.max(1,Math.min(area(a.bounds),area(b.bounds)))>visualQualityThresholds.maximumBlockOverlapRatio) push({code:'block-overlap',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:`${a.key},${b.key}`,bounds:a.bounds,reason:'Independent active blocks overlap above threshold.'});} for(const node of render.nodes.filter(n=>n.kind==='text'&&isVisible(n))){const visible=node.visibleBounds??node.bounds;if(area(visible)<area(node.bounds)*visualQualityThresholds.minimumVisibleRatio) push({code:'text-clipped',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Text visible area is clipped.'});if(node.fontSize!==undefined&&node.fontSize<visualQualityThresholds.minimumTextPixels) push({code:'text-too-small',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Text font size is below deterministic minimum.'});const ratio=contrast(node.fill,node.localBackground??options.backgroundColor);if(ratio!==null&&ratio<visualQualityThresholds.minimumTextContrast)push({code:'text-low-contrast',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Text contrast ${ratio.toFixed(2)} is below ${visualQualityThresholds.minimumTextContrast}.`});}
    if(sample.phase==='middle') {const values=middleByScene.get(scene.id)??[];values.push(render);middleByScene.set(scene.id,values);} sampleRows.push({beatId:sample.beatId,phase:sample.phase,timeSeconds:sample.timeSeconds,frame:sample.frame,metrics:{verdict:metrics.verdict,contentRatio:metrics.contentRatio,dominantColorRatio:metrics.dominantColorRatio},activeBlocks:activeBlocks.map(n=>n.key),imageDeltaFromPreviousBeat:null}); }
    const middles=middleByScene.get(scene.id)??[]; for(let index=1;index<middles.length;index++){const delta=pixelDelta(middles[index-1]!.rgba,middles[index]!.rgba); const row=sampleRows.filter(x=>x.phase==='middle')[index]!;row.imageDeltaFromPreviousBeat=delta;if(delta<visualQualityThresholds.minimumBeatImageDelta)push({code:'static-beats',sceneId:scene.id,beatId:row.beatId,timeSeconds:row.timeSeconds,semanticKey:null,bounds:null,reason:`Middle-frame delta ${delta.toFixed(5)} is below threshold.`});} sceneEntries.push({sceneId:scene.id,samples:sampleRows}); }
  if (sceneEntries.some(scene => scene.samples.length !== samples.filter(sample=>sample.sceneId===scene.sceneId).length)) push({code:'renderer-error',sceneId:options.scenes[0]!.id,beatId:null,timeSeconds:0,semanticKey:null,bounds:null,reason:'One or more required beat samples are missing.'});
  const summary=VisualQualitySummarySchema.parse({version:VISUAL_QUALITY_GATE_VERSION,status:issues.length?'failed':'passed',validatedAt:options.now??new Date().toISOString(),sourceHash:sourceHash(options.scenes),scenes:sceneEntries,issues}); if(summary.status==='failed') throw new MotionCanvasVisualQualityError(summary); return summary;
}

export function createMotionCanvasVisualQualityGate(renderer: MotionCanvasFrameRenderer): MotionCanvasVisualQualityGate {
  return {
    async validate(options) { return validateRenderedMotionCanvas({...options, renderer}); },
  };
}

/** The quality runtime may use this for browser/Vite cache only. Frames are
 * never copied into the immutable generation workspace. */
export async function withTemporaryVisualQualityWorkspace<T>(work: (directory: string) => Promise<T>, root = os.tmpdir()): Promise<T> {
  const directory = await mkdtemp(path.join(root, 'pad-motion-quality-'));
  try { return await work(directory); } finally {
    if (process.env.PAD_QUALITY_DEBUG === '1') process.stderr.write(`[motion-quality] removing ${directory}\n`);
    let cleanupError: unknown;
    for (const delay of [0, 250, 500, 1_000, 2_000, 4_000, 8_000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await rm(directory, {recursive: true, force: true});
        cleanupError = undefined;
        break;
      } catch (error) {
        cleanupError = error;
      }
    }
    if (cleanupError) throw cleanupError;
    if (process.env.PAD_QUALITY_DEBUG === '1') process.stderr.write('[motion-quality] temporary workspace removed\n');
  }
}

export async function retryRenderedSceneQualityOnce<T>(work: {validate: () => Promise<T>; regenerateFailedScenes: (summary: VisualQualitySummary) => Promise<void>}): Promise<T> {
  try { return await work.validate(); } catch (error) {
    if (!(error instanceof MotionCanvasVisualQualityError)) throw error;
    await work.regenerateFailedScenes(error.summary);
    return work.validate();
  }
}
