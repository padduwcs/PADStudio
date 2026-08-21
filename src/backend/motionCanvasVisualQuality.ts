import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {z} from 'zod';
import {visualQualityIssueCodeValues, type BeatCompositionContract, type VoiceVisualPlanContent} from '../shared/topic.ts';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import {analyzeRgbaFrame, parseHexColor, wcagContrastRatio} from './visualViability.ts';

export const VISUAL_QUALITY_GATE_VERSION = 3;
export const visualQualityThresholds = {
  safeMarginXRatio: 0.08,
  safeMarginYRatio: 0.07,
  minimumVisibleRatio: 0.98,
  maximumBlockOverlapRatio: 0.35,
  minimumTextPixels: 18,
  minimumTextContrast: 3,
  minimumBeatImageDelta: 0.002,
  /** Occupied area of visible semantic content versus the whole canvas. */
  minimumFrameOccupancyRatio: 0.05,
  maximumFrameOccupancyRatio: 0.92,
  maximumVisibleSemanticNodes: 40,
  /** Inter-block breathing room, relative to the shorter canvas edge. */
  minimumBlockGapRatio: 0.015,
  /** How far a text box may exceed its own container block. */
  textOverflowToleranceRatio: 0.04,
  /** Rendered font sizes are compared as ratios so the check is resolution independent. */
  typographyRatioTolerance: 0.12,
  paletteChannelTolerance: 24,
  occlusionCoverageRatio: 0.5,
  /** Anchor displacement between consecutive beats, relative to the frame diagonal. */
  maximumLayoutJumpRatio: 0.3,
  /** Combined glyph area of visible text nodes versus occupied visual content area. */
  maximumTextAreaShareRatio: 0.3,
  /** Character length of a single Txt node's rendered string. */
  maximumTextCharacters: 90,
  maximumIssues: 64,
  maximumIssuesPerScene: 12,
} as const;

export const VisualQualityIssueSchema = z.object({
  code: z.enum(visualQualityIssueCodeValues),
  sceneId: z.string().uuid(), beatId: z.string().uuid().nullable(), timeSeconds: z.number().nonnegative(), semanticKey: z.string().nullable(),
  bounds: z.object({x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative()}).nullable(),
  reason: z.string().min(1).max(600),
}).strict();
export type VisualQualityIssue = z.infer<typeof VisualQualityIssueSchema>;

export const VisualQualitySummarySchema = z.object({
  version: z.literal(VISUAL_QUALITY_GATE_VERSION), status: z.enum(['passed', 'failed']), validatedAt: z.string().datetime(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  scenes: z.array(z.object({sceneId: z.string().uuid(), samples: z.array(z.object({beatId: z.string().uuid(), phase: z.enum(['stable-start', 'middle', 'pre-exit']), timeSeconds: z.number().nonnegative(), frame: z.number().int().nonnegative(), metrics: z.object({verdict: z.string(), contentRatio: z.number(), dominantColorRatio: z.number()}).strict(), activeBlocks: z.array(z.string()).max(12), imageDeltaFromPreviousBeat: z.number().nullable()}).strict()).max(30)}).strict()).max(128),
  issues: z.array(VisualQualityIssueSchema).max(visualQualityThresholds.maximumIssues),
}).strict();
export type VisualQualitySummary = z.infer<typeof VisualQualitySummarySchema>;

export interface QualityNodeSnapshot { key: string; parentKey?: string | null; blockAncestor?: string | null; ancestorKeys?: string[]; managed?: boolean; bounds: {x: number; y: number; width: number; height: number}; visibleBounds?: {x: number; y: number; width: number; height: number}; opacity?: number; effectiveOpacity?: number; kind?: 'block' | 'text' | 'other'; fontSize?: number; fill?: string | null; localBackground?: string | null; text?: string | null; }
export interface QualityRenderedFrame { width: number; height: number; rgba: Uint8Array; nodes: QualityNodeSnapshot[]; }
export interface QualitySample {sampleId: string; sceneId: string; beatId: string; phase: 'stable-start' | 'middle' | 'pre-exit'; timeSeconds: number; frame: number;}
/** What one beat promised the frame would contain and look like. */
export interface BeatQualityContract {stay: string[]; primaryBlock?: string; compositionContract?: BeatCompositionContract;}
export type QualityVisualBible = NonNullable<VoiceVisualPlanContent['visualBible']>;
export interface MotionCanvasFrameRenderer { render(options: {scenes: MotionCanvasSourceScene[]; samples: QualitySample[]; frame: {width: number; height: number; fps: number}; workspaceDirectory?: string; projectFile?: string; managedKeysByBeat?: Map<string, string[]>}): Promise<Map<string, QualityRenderedFrame>>; }
export interface MotionCanvasVisualQualityGate { validate(options: {scenes: MotionCanvasSourceScene[]; lifecycle: Map<string, BeatQualityContract>; frame: {width: number; height: number; fps: number}; backgroundColor?: string | null; visualBible?: QualityVisualBible | null; sceneHandoff?: Map<string, {incoming: string | null; outgoing: string | null}>; workspaceDirectory?: string; projectFile?: string;}): Promise<VisualQualitySummary>; }

export class MotionCanvasVisualQualityError extends Error {
  readonly summary: VisualQualitySummary;
  constructor(summary: VisualQualitySummary, message = 'Rendered Motion Canvas visual quality gate failed.') { super(message); this.summary = summary; }
}

/** Thrown when a bundle is approved, applied or restored without rendered-frame
 * evidence that is passing, current in shape, and tied to these exact sources. */
export class MotionCanvasVisualValidationGateError extends Error {
  readonly code = 'MOTION_CANVAS_VISUAL_VALIDATION_REQUIRED';
  readonly reason: 'missing' | 'failed' | 'stale-version' | 'stale-source';
  constructor(reason: MotionCanvasVisualValidationGateError['reason'], message: string) { super(message); this.reason = reason; }
}

function keyOf(sample: QualitySample) { return sample.sampleId; }
/** Canonical hash binding rendered-frame evidence to the exact scene sources. */
export function motionCanvasSceneSourceHash(scenes: MotionCanvasSourceScene[]) { const hash = createHash('sha256'); for (const scene of [...scenes].sort((a,b) => a.id.localeCompare(b.id))) {hash.update(scene.id); hash.update('\0'); hash.update(scene.source); hash.update('\0');} return hash.digest('hex'); }
export function visualValidationIsCurrent(summary: Pick<VisualQualitySummary, 'sourceHash'>, scenes: MotionCanvasSourceScene[]) { return summary.sourceHash === motionCanvasSceneSourceHash(scenes); }

type StoredVisualValidation = {version: number; status: 'passed' | 'failed'; sourceHash: string} | undefined | null;

/** True only when the stored evidence can be reused verbatim: current gate
 * shape, passing verdict, and hashed over exactly these scene sources. */
export function visualValidationIsReusable(summary: StoredVisualValidation, scenes: MotionCanvasSourceScene[]) {
  return Boolean(summary && summary.version === VISUAL_QUALITY_GATE_VERSION && summary.status === 'passed' && visualValidationIsCurrent(summary, scenes));
}

/**
 * The single rule every approve/apply/restore path uses. Rendered-frame
 * evidence is authoritative: missing, failed, old-shape or stale-hash evidence
 * always blocks, and no other signal (richness, contentRatio, node counts) may
 * stand in for it.
 */
export function assertVisualValidationCurrent(bundle: {visualValidation?: StoredVisualValidation}, scenes: MotionCanvasSourceScene[]) {
  const summary = bundle.visualValidation;
  if (!summary) throw new MotionCanvasVisualValidationGateError('missing', 'Bundle Motion Canvas chưa có bằng chứng kiểm tra khung hình đã render.');
  if (summary.version !== VISUAL_QUALITY_GATE_VERSION) throw new MotionCanvasVisualValidationGateError('stale-version', `Bằng chứng kiểm tra khung hình thuộc phiên bản ${summary.version}, cần phiên bản ${VISUAL_QUALITY_GATE_VERSION}.`);
  if (summary.status !== 'passed') throw new MotionCanvasVisualValidationGateError('failed', 'Bundle Motion Canvas chưa vượt qua kiểm tra khung hình đã render.');
  if (!visualValidationIsCurrent(summary, scenes)) throw new MotionCanvasVisualValidationGateError('stale-source', 'Bằng chứng kiểm tra khung hình không khớp với source scene hiện tại.');
}

/** Turns a failed gate's issues into guidance text an automatic regeneration
 * retry can act on, instead of re-rolling the section blind. Callers should
 * append this to any pre-existing human-supplied guidance, not replace it. */
export function formatVisualQualityRetryGuidance(issues: VisualQualityIssue[]): string {
  if (issues.length === 0) return '';
  const lines = issues.map(issue => `- ${issue.sceneId}/${issue.beatId ?? 'scene'}${issue.semanticKey ? ` (${issue.semanticKey})` : ''}: ${issue.reason}`);
  const visibilityGuidance = issues.some(issue =>
    ['empty-frame', 'missing-active-block', 'frame-too-sparse'].includes(
      issue.code,
    ),
  )
    ? [
        'Keep every information-bearing primary visual visible throughout the stable-start, middle, and pre-exit samples. The exit animation belongs only in the reserved final exit window; never hide the visual early and wait on an empty frame.',
      ]
    : [];
  return [
    'Lượt render trước bị kiểm tra khung hình từ chối vì các lý do sau. Bản sinh lại phải khắc phục triệt để từng lý do, không chỉ đổi màu hoặc rút gọn chữ để né qua kiểm tra:',
    ...visibilityGuidance,
    ...lines,
  ].join('\n').slice(0, 4_000);
}

type Bounds = QualityNodeSnapshot['bounds'];
function area(b: Bounds) { return b.width * b.height; }
function intersection(a: Bounds, b: Bounds) { const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)); const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); return width * height; }
function clipTo(b: Bounds, width: number, height: number) { const x = Math.max(0, b.x); const y = Math.max(0, b.y); return {x, y, width: Math.max(0, Math.min(width, b.x + b.width) - x), height: Math.max(0, Math.min(height, b.y + b.height) - y)}; }
function center(b: Bounds) { return {x: b.x + b.width / 2, y: b.y + b.height / 2}; }
/** Largest axis gap between two boxes; zero when they overlap on both axes. */
function separation(a: Bounds, b: Bounds) { const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width); const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height); return Math.max(gapX, gapY); }
function nested(a: QualityNodeSnapshot, b: QualityNodeSnapshot) { return Boolean(a.ancestorKeys?.includes(b.key) || b.ancestorKeys?.includes(a.key)); }
function isVisible(node: QualityNodeSnapshot) { return (node.effectiveOpacity ?? node.opacity ?? 1) > 0.01 && area(node.visibleBounds ?? node.bounds) > 1; }
function pixelDelta(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) return 1; let total = 0; for (let i=0;i<a.length;i+=4) total += (Math.abs(a[i]! - b[i]!) + Math.abs(a[i+1]! - b[i+1]!) + Math.abs(a[i+2]! - b[i+2]!)) / (255 * 3); return total / (a.length / 4); }

/** Structural wrappers own the whole canvas by design and never count as content. */
const structuralKeys = new Set([
  'scene-background',
  'scene-content-root',
  'block-lifecycle-support-layer',
]);

function matchesPalette(fill: string, palette: QualityVisualBible['palette']) {
  const value = parseHexColor(fill);
  if (!value) return true; // Non-hex or translucent literals are not judged here.
  return Object.values(palette).some(entry => {
    const candidate = parseHexColor(entry);
    return candidate ? candidate.every((channel, index) => Math.abs(channel - value[index]!) <= visualQualityThresholds.paletteChannelTolerance) : false;
  });
}

/** Where a declared composition archetype expects its dominant mass to sit. */
function focusZoneViolated(layout: BeatCompositionContract['layout'], point: {x: number; y: number}, width: number, height: number) {
  const dx = Math.abs(point.x - width / 2) / width;
  const dy = Math.abs(point.y - height / 2) / height;
  switch (layout) {
    case 'center-focus': return dx > 0.25 || dy > 0.25;
    case 'left-right-split': return dx < 0.08 || dy > 0.3;
    case 'top-bottom-stack': return dy < 0.08 || dx > 0.3;
    case 'grid': return dx > 0.35 || dy > 0.35;
    case 'full-bleed': return dx > 0.4 || dy > 0.4;
    default: return false;
  }
}

/** Samples happen after the short enter window, in the middle, and immediately
 * before the short exit window. Reported seconds are scene-local while frame
 * numbers are global across the Motion Canvas project. */
export function visualQualitySamples(scenes: MotionCanvasSourceScene[], fps: number): QualitySample[] {
  const samples: QualitySample[] = [];
  let projectStart = 0;
  for (const scene of scenes) { let sceneStart = 0; for (const event of scene.timingEvents ?? []) { const d = event.plannedDurationSeconds; const inset = Math.min(Math.max(0.12, d * .12), Math.max(.12, d / 3)); const times: Array<[QualitySample['phase'], number]> = [['stable-start', Math.min(d - .01, inset)], ['middle', d * .5], ['pre-exit', Math.max(inset, d - inset)]]; for (const [phase, offset] of times) { const local = sceneStart + Math.max(0, offset); samples.push({sampleId:`${scene.id}:${event.beatId}:${phase}`,sceneId: scene.id, beatId: event.beatId, phase, timeSeconds: local, frame: Math.max(0, Math.round((projectStart + local) * fps))}); } sceneStart += d; } projectStart += sceneStart; }
  return samples;
}

export async function validateRenderedMotionCanvas(options: {scenes: MotionCanvasSourceScene[]; lifecycle: Map<string, BeatQualityContract>; frame: {width: number; height: number; fps: number}; backgroundColor?: string | null; visualBible?: QualityVisualBible | null; sceneHandoff?: Map<string, {incoming: string | null; outgoing: string | null}>; renderer: MotionCanvasFrameRenderer; workspaceDirectory?: string; projectFile?: string; now?: string;}): Promise<VisualQualitySummary> {
  const samples = visualQualitySamples(options.scenes, options.frame.fps);
  const issues: VisualQualityIssue[] = [];
  const issueCountsByScene = new Map<string, number>();
  const push = (issue: VisualQualityIssue) => {
    const sceneCount = issueCountsByScene.get(issue.sceneId) ?? 0;
    if (
      issues.length >= visualQualityThresholds.maximumIssues ||
      sceneCount >= visualQualityThresholds.maximumIssuesPerScene
    ) return;
    issues.push(issue);
    issueCountsByScene.set(issue.sceneId, sceneCount + 1);
  };
  const bible = options.visualBible ?? null;
  let rendered: Map<string, QualityRenderedFrame>;
  try { rendered = await options.renderer.render({scenes: options.scenes, samples, frame: options.frame, workspaceDirectory: options.workspaceDirectory, projectFile: options.projectFile, managedKeysByBeat: new Map([...options.lifecycle].map(([id,value])=>[id,value.stay]))}); } catch (error) { const scene = options.scenes[0]!; const summary = {version: VISUAL_QUALITY_GATE_VERSION, status: 'failed' as const, validatedAt: options.now ?? new Date().toISOString(), sourceHash: motionCanvasSceneSourceHash(options.scenes), scenes: [], issues: [{code: 'renderer-error' as const, sceneId: scene.id, beatId: null, timeSeconds: 0, semanticKey: null, bounds: null, reason: error instanceof Error ? error.message.slice(0,600) : 'Renderer failed.'}]}; throw new MotionCanvasVisualQualityError(VisualQualitySummarySchema.parse(summary), 'Motion Canvas frame renderer failed.'); }
  const sceneEntries: VisualQualitySummary['scenes'] = []; const middleByScene = new Map<string, QualityRenderedFrame[]>();
  /** Anchor position of each beat's primary block, in beat order, per scene. */
  const anchorsByScene = new Map<string, Array<{beatId: string; key: string; point: {x: number; y: number}; timeSeconds: number; role?: BeatCompositionContract['semanticRole']}>>();
  const managedBlocksByScene = new Map(options.scenes.map(scene => [scene.id, new Set(samples.filter(sample => sample.sceneId === scene.id).flatMap(sample => options.lifecycle.get(sample.beatId)?.stay ?? []).filter(key => key.startsWith('block-')))]));
  for (const scene of options.scenes) { const sampleRows: VisualQualitySummary['scenes'][number]['samples'] = []; for (const sample of samples.filter(x=>x.sceneId===scene.id)) { const render = rendered.get(keyOf(sample)); const lifecycle = options.lifecycle.get(sample.beatId); if (!render || !lifecycle) { push({code:'renderer-error', sceneId:scene.id, beatId:sample.beatId, timeSeconds:sample.timeSeconds, semanticKey:null, bounds:null, reason:!render?'Renderer did not return requested frame.':'Missing beat lifecycle.'}); continue; } const metrics = analyzeRgbaFrame({frame:sample.frame,timeSeconds:sample.timeSeconds,sceneId:scene.id,width:render.width,height:render.height,rgba:render.rgba,backgroundColor:options.backgroundColor}); if (metrics.verdict !== 'viable') push({code:'empty-frame',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`RGBA verdict is ${metrics.verdict}.`}); const managedBlocks = managedBlocksByScene.get(scene.id)!; const activeBlocks = render.nodes.filter(node=>node.key.startsWith('block-') && managedBlocks.has(node.key) && isVisible(node)); const expected = new Set(lifecycle.stay.filter(key=>key.startsWith('block-'))); for (const node of activeBlocks) if (!expected.has(node.key)) push({code:'unexpected-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Visible lifecycle-managed block is not in this beat lifecycle.stay.'}); for (const key of expected) if (!activeBlocks.some(n=>n.key===key)) push({code:'missing-active-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:key,bounds:null,reason:'Expected active block is not visibly rendered.'}); const safe={x:render.width*visualQualityThresholds.safeMarginXRatio,y:render.height*visualQualityThresholds.safeMarginYRatio,width:render.width*(1-2*visualQualityThresholds.safeMarginXRatio),height:render.height*(1-2*visualQualityThresholds.safeMarginYRatio)}; for (const node of activeBlocks) { const visible=node.visibleBounds??node.bounds; if (area(visible)<area(node.bounds)*visualQualityThresholds.minimumVisibleRatio) push({code:'clipped-block',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Runtime visible area is clipped.'}); if (node.bounds.x<safe.x || node.bounds.y<safe.y || node.bounds.x+node.bounds.width>safe.x+safe.width || node.bounds.y+node.bounds.height>safe.y+safe.height) push({code:'outside-safe-area',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Active block exceeds quantified safe area.'}); } for(let i=0;i<activeBlocks.length;i++) for(let j=i+1;j<activeBlocks.length;j++){const a=activeBlocks[i]!,b=activeBlocks[j]!;if(nested(a,b))continue;const shared=intersection(a.bounds,b.bounds); if(shared/Math.max(1,Math.min(area(a.bounds),area(b.bounds)))>visualQualityThresholds.maximumBlockOverlapRatio) push({code:'block-overlap',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:`${a.key},${b.key}`,bounds:a.bounds,reason:'Independent active blocks overlap above threshold.'}); else if(shared===0 && separation(a.bounds,b.bounds)<Math.min(render.width,render.height)*visualQualityThresholds.minimumBlockGapRatio) push({code:'insufficient-spacing',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:`${a.key},${b.key}`,bounds:a.bounds,reason:'Adjacent active blocks are closer than the minimum breathing room.'});}
    const textNodes = render.nodes.filter(node=>node.kind==='text'&&isVisible(node));
    for(const node of textNodes){const visible=node.visibleBounds??node.bounds;if(area(visible)<area(node.bounds)*visualQualityThresholds.minimumVisibleRatio) push({code:'text-clipped',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Text visible area is clipped.'});if(node.fontSize!==undefined&&node.fontSize<visualQualityThresholds.minimumTextPixels) push({code:'text-too-small',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:'Text font size is below deterministic minimum.'});const ratio=wcagContrastRatio(node.fill,node.localBackground??options.backgroundColor);if(ratio!==null&&ratio<visualQualityThresholds.minimumTextContrast)push({code:'text-low-contrast',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Text contrast ${ratio.toFixed(2)} is below ${visualQualityThresholds.minimumTextContrast}.`});if(typeof node.text==='string'&&node.text.length>visualQualityThresholds.maximumTextCharacters) push({code:'caption-too-long',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Text node has ${node.text.length} characters, above the ${visualQualityThresholds.maximumTextCharacters} limit.`});
      // Container overflow is about the owning block, not the canvas edge.
      const container = node.blockAncestor ? render.nodes.find(candidate => candidate.key === node.blockAncestor) : undefined;
      if (container) { const padX = container.bounds.width * visualQualityThresholds.textOverflowToleranceRatio + 1; const padY = container.bounds.height * visualQualityThresholds.textOverflowToleranceRatio + 1;
        if (node.bounds.x < container.bounds.x - padX || node.bounds.y < container.bounds.y - padY || node.bounds.x + node.bounds.width > container.bounds.x + container.bounds.width + padX || node.bounds.y + node.bounds.height > container.bounds.y + container.bounds.height + padY) push({code:'text-overflow',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Text exceeds the bounds of its container ${container.key}.`}); }
    }
    // Frame density: only the outermost visible content nodes are summed, so a
    // block and its children never inflate the same occupied area twice.
    const contentNodes = render.nodes.filter(node => isVisible(node) && !structuralKeys.has(node.key));
    const contentKeys = new Set(contentNodes.map(node => node.key));
    const outermost = contentNodes.filter(node => !(node.ancestorKeys ?? []).some(key => contentKeys.has(key)));
    const occupiedArea = outermost.reduce((total, node) => total + area(clipTo(node.visibleBounds ?? node.bounds, render.width, render.height)), 0);
    const occupancy = occupiedArea / Math.max(1, render.width * render.height);
    // What fraction of the occupied screen real estate is drawn glyphs versus
    // shapes/diagrams; visual storytelling should dominate over text.
    const textArea = textNodes.reduce((total, node) => total + area(clipTo(node.visibleBounds ?? node.bounds, render.width, render.height)), 0);
    const textShare = occupiedArea > 0 ? textArea / occupiedArea : 0;
    if (textShare > visualQualityThresholds.maximumTextAreaShareRatio) push({code:'text-overrepresented',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`Text glyph area covers ${(textShare*100).toFixed(1)}% of the occupied visual content, above ${(visualQualityThresholds.maximumTextAreaShareRatio*100).toFixed(1)}%.`});
    if (occupancy < visualQualityThresholds.minimumFrameOccupancyRatio) push({code:'frame-too-sparse',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`Visible content covers ${(occupancy*100).toFixed(1)}% of the frame, below ${(visualQualityThresholds.minimumFrameOccupancyRatio*100).toFixed(1)}%.`});
    if (occupancy > visualQualityThresholds.maximumFrameOccupancyRatio) push({code:'frame-too-dense',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`Visible content covers ${(occupancy*100).toFixed(1)}% of the frame, above ${(visualQualityThresholds.maximumFrameOccupancyRatio*100).toFixed(1)}%.`});
    else if (contentNodes.length > visualQualityThresholds.maximumVisibleSemanticNodes) push({code:'frame-too-dense',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`${contentNodes.length} semantic nodes are visible at once, above ${visualQualityThresholds.maximumVisibleSemanticNodes}.`});
    // Prominence and focus zone of the beat's declared dominant block.
    const primaryNode = lifecycle.primaryBlock ? activeBlocks.find(node => node.key === lifecycle.primaryBlock) : undefined;
    if (primaryNode) {
      const peers = activeBlocks.filter(node => node.key !== primaryNode.key && !nested(node, primaryNode));
      if (peers.some(peer => area(peer.bounds) > area(primaryNode.bounds))) push({code:'primary-block-not-prominent',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:primaryNode.key,bounds:primaryNode.bounds,reason:'Primary block is smaller than another concurrently active block.'});
      const layout = lifecycle.compositionContract?.layout;
      if (layout && focusZoneViolated(layout, center(primaryNode.bounds), render.width, render.height)) push({code:'primary-block-off-center',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:primaryNode.key,bounds:primaryNode.bounds,reason:`Primary block centroid is outside the focus zone declared by layout ${layout}.`});
      if (sample.phase === 'middle') { const anchors = anchorsByScene.get(scene.id) ?? []; anchors.push({beatId: sample.beatId, key: primaryNode.key, point: center(primaryNode.bounds), timeSeconds: sample.timeSeconds, role: lifecycle.compositionContract?.semanticRole}); anchorsByScene.set(scene.id, anchors); }
    }
    if (bible) {
      if (!(bible.typographyScale.title > bible.typographyScale.label && bible.typographyScale.label > bible.typographyScale.body)) push({code:'text-hierarchy-violation',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:'visualBible typographyScale does not order title > label > body.'});
      const sized = textNodes.filter(node => typeof node.fontSize === 'number' && node.fontSize > 0);
      const largest = Math.max(0, ...sized.map(node => node.fontSize!));
      if (largest > 0) {
        const allowed = [1, bible.typographyScale.label / bible.typographyScale.title, bible.typographyScale.body / bible.typographyScale.title];
        let titleSized = 0;
        for (const node of sized) {
          const ratio = node.fontSize! / largest;
          if (Math.abs(ratio - 1) <= visualQualityThresholds.typographyRatioTolerance) titleSized += 1;
          if (allowed.every(value => Math.abs(ratio - value) > visualQualityThresholds.typographyRatioTolerance)) push({code:'typography-drift',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Font size ${node.fontSize!.toFixed(1)} does not match any visualBible typography step.`});
        }
        if (titleSized > 1) push({code:'text-hierarchy-violation',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:null,bounds:null,reason:`${titleSized} text nodes compete at the title size; only one may dominate a frame.`});
      }
      for (const node of contentNodes) { if ((node.kind !== 'block' && node.kind !== 'text') || !node.fill) continue; if (!matchesPalette(node.fill, bible.palette)) push({code:'palette-drift',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:node.key,bounds:node.bounds,reason:`Fill ${node.fill} is not a visualBible palette colour.`}); }
    }
    // Occlusion: anything drawn later and unrelated that buries important content.
    const important = [...(primaryNode ? [primaryNode] : []), ...textNodes];
    for (const target of important) { const targetIndex = render.nodes.indexOf(target); for (let index = targetIndex + 1; index < render.nodes.length; index += 1) { const front = render.nodes[index]!; if (front.key === target.key || !isVisible(front) || structuralKeys.has(front.key) || nested(front, target)) continue; if ((front.effectiveOpacity ?? front.opacity ?? 1) < 0.5) continue; if (intersection(front.bounds, target.bounds) / Math.max(1, area(target.bounds)) > visualQualityThresholds.occlusionCoverageRatio) { push({code:'content-occluded',sceneId:scene.id,beatId:sample.beatId,timeSeconds:sample.timeSeconds,semanticKey:`${front.key}>${target.key}`,bounds:target.bounds,reason:`Node ${front.key} is drawn over and covers most of ${target.key}.`}); break; } } }
    if(sample.phase==='middle') {const values=middleByScene.get(scene.id)??[];values.push(render);middleByScene.set(scene.id,values);} sampleRows.push({beatId:sample.beatId,phase:sample.phase,timeSeconds:sample.timeSeconds,frame:sample.frame,metrics:{verdict:metrics.verdict,contentRatio:metrics.contentRatio,dominantColorRatio:metrics.dominantColorRatio},activeBlocks:activeBlocks.map(n=>n.key),imageDeltaFromPreviousBeat:null}); }
    const middles=middleByScene.get(scene.id)??[]; for(let index=1;index<middles.length;index++){const delta=pixelDelta(middles[index-1]!.rgba,middles[index]!.rgba); const row=sampleRows.filter(x=>x.phase==='middle')[index]!;row.imageDeltaFromPreviousBeat=delta;if(delta<visualQualityThresholds.minimumBeatImageDelta)push({code:'static-beats',sceneId:scene.id,beatId:row.beatId,timeSeconds:row.timeSeconds,semanticKey:null,bounds:null,reason:`Middle-frame delta ${delta.toFixed(5)} is below threshold.`});} sceneEntries.push({sceneId:scene.id,samples:sampleRows}); }
  // Cross-beat and cross-scene anchor continuity. A shared anchor key that
  // teleports is a layout jump unless the later beat declares a transition.
  const maximumJump = Math.hypot(options.frame.width, options.frame.height) * visualQualityThresholds.maximumLayoutJumpRatio;
  const reportJump = (sceneId: string, previous: {key: string; point: {x: number; y: number}}, next: {beatId: string; key: string; point: {x: number; y: number}; timeSeconds: number; role?: BeatCompositionContract['semanticRole']}, boundary: string) => {
    if (previous.key !== next.key || next.role === 'transition') return;
    const distance = Math.hypot(next.point.x - previous.point.x, next.point.y - previous.point.y);
    if (distance <= maximumJump) return;
    push({code:'layout-jump-excessive',sceneId,beatId:next.beatId,timeSeconds:next.timeSeconds,semanticKey:next.key,bounds:null,reason:`Anchor ${next.key} moved ${distance.toFixed(0)}px across ${boundary}, above ${maximumJump.toFixed(0)}px, without a transition role.`});
  };
  for (const scene of options.scenes) { const anchors = anchorsByScene.get(scene.id) ?? []; for (let index = 1; index < anchors.length; index += 1) reportJump(scene.id, anchors[index - 1]!, anchors[index]!, 'consecutive beats'); }
  for (let index = 1; index < options.scenes.length; index += 1) {
    const previousScene = options.scenes[index - 1]!, nextScene = options.scenes[index]!;
    if (!options.sceneHandoff?.get(previousScene.id)?.outgoing || !options.sceneHandoff.get(nextScene.id)?.incoming) continue;
    const previous = (anchorsByScene.get(previousScene.id) ?? []).at(-1); const next = (anchorsByScene.get(nextScene.id) ?? [])[0];
    if (previous && next) reportJump(nextScene.id, previous, next, 'the scene handoff boundary');
  }
  if (sceneEntries.some(scene => scene.samples.length !== samples.filter(sample=>sample.sceneId===scene.sceneId).length)) push({code:'renderer-error',sceneId:options.scenes[0]!.id,beatId:null,timeSeconds:0,semanticKey:null,bounds:null,reason:'One or more required beat samples are missing.'});
  const summary=VisualQualitySummarySchema.parse({version:VISUAL_QUALITY_GATE_VERSION,status:issues.length?'failed':'passed',validatedAt:options.now??new Date().toISOString(),sourceHash:motionCanvasSceneSourceHash(options.scenes),scenes:sceneEntries,issues}); if(summary.status==='failed') throw new MotionCanvasVisualQualityError(summary); return summary;
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
