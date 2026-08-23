import {Renderer, RendererResult, Vector2} from '@motion-canvas/core';
import {rendererRangeFromFrames} from './diagnostics.js';

const EXPORTER_ID = 'pad-studio/quality-samples';
function finite(value) { return Number.isFinite(value) ? Number(value) : null; }
function signal(node, name) { try { return typeof node?.[name] === 'function' ? node[name]() : null; } catch { return null; } }
/** Motion Canvas resolves fills to Color objects; normalise them to #rrggbb so
 * the deterministic gate can compare them against the visual bible palette. */
function colorHex(value) {
  if (typeof value === 'string') return value;
  try { return value && typeof value.hex === 'function' ? value.hex() : null; } catch { return null; }
}
const SEMANTIC_KEY = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
function keyOf(node) {
  const direct = node?.key;
  if (typeof direct === 'string') return direct;
  const value = signal(node, 'key');
  return typeof value === 'string' ? value : null;
}
function bounds(node, own = false) {
  try {
    const box = own && typeof node.getCacheBBox === 'function'
      ? node.getCacheBBox()
      : node.cacheBBox();
    const points = box.transformCorners(node.localToWorld());
    const xs = points.map(point => finite(point.x)).filter(value => value !== null);
    const ys = points.map(point => finite(point.y)).filter(value => value !== null);
    if (xs.length !== 4 || ys.length !== 4) return null;
    const left = Math.min(...xs), top = Math.min(...ys);
    const right = Math.max(...xs), bottom = Math.max(...ys);
    return {x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
  } catch { return null; }
}
function unionBounds(values) {
  if (values.length === 0) return null;
  const left = Math.min(...values.map(value => value.x));
  const top = Math.min(...values.map(value => value.y));
  const right = Math.max(...values.map(value => value.x + value.width));
  const bottom = Math.max(...values.map(value => value.y + value.height));
  return {x: left, y: top, width: right - left, height: bottom - top};
}
function clipped(box, width, height) {
  const left = Math.max(0, box.x), top = Math.max(0, box.y);
  return {x: left, y: top, width: Math.max(0, Math.min(width, box.x + box.width) - left), height: Math.max(0, Math.min(height, box.y + box.height) - top)};
}
function semanticNodes(scene) {
  const result = [];
  const queue = [...(scene?.getView?.()?.children?.() ?? [])];
  const seen = new Set();
  while (queue.length > 0 && result.length < 2_000) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const key = keyOf(node);
    if (key && SEMANTIC_KEY.test(key)) result.push(node);
    for (const child of node.children?.() ?? []) queue.push(child);
  }
  return result;
}
function snapshot(scene, config, sample) {
  const managed = new Set(config.managedKeysByScene?.[sample.sceneId] ?? []);
  const entries = semanticNodes(scene).flatMap(node => {
    const key = keyOf(node);
    if (!key) return [];
    const box = bounds(node, true); if (!box) return [];
    let parent = signal(node, 'parent'); let parentKey = null, blockAncestor = null, localFill = null;
    const ancestorKeys = [];
    for (let depth = 0; parent && depth < 32; depth += 1) {
      const candidate = keyOf(parent);
      if (candidate && SEMANTIC_KEY.test(candidate)) {
        ancestorKeys.push(candidate);
        if (!parentKey) parentKey = candidate;
        if (!blockAncestor && candidate.startsWith('block-')) blockAncestor = candidate;
      }
      const parentFill = colorHex(signal(parent, 'fill'));
      if (!localFill && typeof parentFill === 'string') localFill = parentFill;
      parent = signal(parent, 'parent');
    }
    const name = node.constructor?.name ?? '';
    const fill = colorHex(signal(node, 'fill'));
    const isText = /Txt/i.test(name);
    const text = isText && typeof signal(node, 'text') === 'string' ? signal(node, 'text') : null;
    return [{node, name, key, parentKey, blockAncestor, ancestorKeys, managed: managed.has(key), effectiveOpacity: finite(signal(node, 'absoluteOpacity')) ?? 1, kind: key.startsWith('block-') ? 'block' : isText ? 'text' : 'other', bounds: box, visibleBounds: clipped(box, config.width, config.height), fontSize: finite(signal(node, 'fontSize')), fill: typeof fill === 'string' ? fill : null, localBackground: typeof localFill === 'string' ? localFill : null, text}];
  });
  return entries.map(entry => {
    let box = entry.bounds;
    if (entry.kind === 'block' && /Layout/i.test(entry.name)) {
      const visibleDescendants = entries.filter(candidate =>
        candidate.ancestorKeys.includes(entry.key) &&
        candidate.effectiveOpacity > 0.01 &&
        candidate.bounds.width * candidate.bounds.height > 1,
      );
      box = unionBounds(visibleDescendants.map(candidate => candidate.bounds)) ?? box;
    }
    const {node: _node, name: _name, ...result} = entry;
    return {...result, bounds: box, visibleBounds: clipped(box, config.width, config.height)};
  });
}
async function json(url, body) { const response = await fetch(url, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); if (!response.ok) throw new Error(`Quality bridge rejected ${url}.`); }
class QualityExporter {
  static id = EXPORTER_ID; static displayName = 'PAD Studio quality samples';
  static async create(_project, settings) { return new QualityExporter(settings.exporter.options); }
  constructor(options) { this.options = options; }
  async handleFrame(canvas, frame, _sceneFrame, sceneName, signal) {
    if (signal.aborted || frame !== this.options.sample.frame) return;
    const geometry = globalThis.__padQualityGeometryBySample?.get(
      this.options.sample.sampleId,
    ) ?? [];
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Cannot encode quality PNG.');
    await json(`/__pad-quality/geometry?token=${encodeURIComponent(this.options.token)}`, {sampleId:this.options.sample.sampleId, frame, sceneName, nodes: geometry});
    const response = await fetch(`/__pad-quality/frame?token=${encodeURIComponent(this.options.token)}&sampleId=${encodeURIComponent(this.options.sample.sampleId)}&frame=${frame}&sceneName=${encodeURIComponent(sceneName ?? '')}`, {method:'POST',headers:{'content-type':'image/png'},body:blob,signal});
    if (!response.ok) throw new Error(`Quality bridge rejected frame ${frame}.`);
  }
}
async function start(project) {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const response = await fetch(`/__pad-quality/config?token=${encodeURIComponent(token)}`); if (!response.ok) throw new Error('Cannot load quality configuration.');
  const config = await response.json();
  const samples = config.samples ?? [];
  const workerCount = Math.max(1, Math.min(
    Number(config.renderConcurrency) || 1,
    samples.length,
  ));
  let nextSampleIndex = 0;
  globalThis.__padQualityGeometryBySample = new Map();
  try {
    project.meta.rendering.exporter.exporters.push(QualityExporter);
    await Promise.all(Array.from({length: workerCount}, async () => {
      const renderer = new Renderer(project);
      let result = RendererResult.Error;
      let currentSample = null;
      const original = renderer.stage.render.bind(renderer.stage);
      renderer.stage.render = async (current, previous) => {
        await original(current, previous);
        if (currentSample) {
          globalThis.__padQualityGeometryBySample.set(
            currentSample.sampleId,
            snapshot(current, config, currentSample),
          );
        }
      };
      const dispose = renderer.onFinished.subscribe(value => {result=value;});
      try {
        while (true) {
          const sampleIndex = nextSampleIndex;
          nextSampleIndex += 1;
          if (sampleIndex >= samples.length) return;
          const sample = samples[sampleIndex];
          currentSample = sample;
          globalThis.__padQualityGeometryBySample.delete(sample.sampleId);
          result = RendererResult.Error;
          await renderer.render({name:'quality',range:rendererRangeFromFrames([sample.frame, sample.frame],config.fps),fps:config.fps,size:new Vector2(config.width,config.height),resolutionScale:1,background:null,colorSpace:'srgb',audioOffset:0,exporter:{name:EXPORTER_ID,options:{token,sample}}});
          if(result !== RendererResult.Success) throw new Error(`Motion Canvas quality render failed for ${sample.sampleId}.`);
        }
      } finally {
        currentSample = null;
        dispose();
      }
    }));
    await json(`/__pad-quality/status?token=${encodeURIComponent(token)}`,{state:'completed'});
  } finally {
    globalThis.__padQualityGeometryBySample = null;
  }
}
export function editor(project) {
  void start(project)
    .catch(error => json(`/__pad-quality/status?token=${encodeURIComponent(new URLSearchParams(location.search).get('token') ?? '')}`,{state:'failed',message:error instanceof Error?error.message:String(error)}).catch(()=>undefined))
    .finally(() => window.close());
}
export function index() {}
