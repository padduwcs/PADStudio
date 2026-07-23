import {
  Renderer,
  RendererResult,
  Vector2,
} from '@motion-canvas/core';
import {
  applySceneOverrides,
  serializeSignalValue,
} from '../layout-editor/modifier-model.js';
import {
  createRenderDiagnosticTracker,
  diagnosticMessage,
  rendererRangeFromFrames,
} from './diagnostics.js';

const EXPORTER_ID = 'pad-studio/ffmpeg-stream';

function safeSceneFile(name) {
  const value = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `src/scenes/${value || 'scene'}.tsx`;
}

function signalSnapshot(node, key) {
  if (typeof node?.[key] !== 'function') return null;
  try {
    return serializeSignalValue(node[key]());
  } catch {
    return null;
  }
}

function nodeGeometry(node) {
  try {
    const corners = node
      .cacheBBox()
      .transformCorners(node.localToWorld())
      .map(point => ({x: point.x, y: point.y}));
    if (
      corners.length < 4 ||
      corners.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      return null;
    }
    return {corners};
  } catch {
    return null;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function interpolatePoint(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function drawTextDecorations(context, scene, document, sceneId) {
  const overrides = (document.overrides ?? []).filter(
    override =>
      override.sceneId === sceneId &&
      (override.patch?.underline || override.patch?.strikethrough),
  );
  if (overrides.length === 0) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.setLineDash([]);
  for (const override of overrides) {
    const node = scene.getNode?.(override.nodeKey);
    if (!node || override.patch.hidden) continue;
    const geometry = nodeGeometry(node);
    if (!geometry?.corners || geometry.corners.length < 4) continue;
    const [topLeft, topRight, bottomRight, bottomLeft] = geometry.corners;
    const height =
      (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
    const fill = signalSnapshot(node, 'fill');
    const stroke = signalSnapshot(node, 'stroke');
    context.strokeStyle =
      typeof fill === 'string'
        ? fill
        : typeof stroke === 'string'
          ? stroke
          : '#ffffff';
    context.lineWidth = Math.min(14, Math.max(2, height * 0.035));
    context.lineCap = 'round';
    context.globalAlpha =
      typeof node.absoluteOpacity === 'function'
        ? Math.min(1, Math.max(0, Number(node.absoluteOpacity())))
        : 1;
    const drawLine = amount => {
      const start = interpolatePoint(topLeft, bottomLeft, amount);
      const end = interpolatePoint(topRight, bottomRight, amount);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    };
    if (override.patch.strikethrough) drawLine(0.52);
    if (override.patch.underline) drawLine(0.88);
  }
  context.restore();
}

function watermarkOrigin(watermark, canvasWidth, canvasHeight, width, height) {
  return {
    left: canvasWidth * (watermark.xPercent / 100) - width / 2,
    top: canvasHeight * (watermark.yPercent / 100) - height / 2,
  };
}

function drawWatermark(context, watermark, bitmap) {
  if (!watermark || watermark.type === 'none') return;
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = watermark.opacity;
  if (watermark.type === 'image' && bitmap) {
    const drawWidth = width * (watermark.widthPercent / 100);
    const drawHeight = drawWidth * (bitmap.height / bitmap.width);
    const origin = watermarkOrigin(
      watermark,
      width,
      height,
      drawWidth,
      drawHeight,
    );
    context.drawImage(bitmap, origin.left, origin.top, drawWidth, drawHeight);
  } else if (watermark.type === 'text') {
    context.font = `700 ${watermark.fontSize}px Inter, Arial, sans-serif`;
    context.textBaseline = 'top';
    const lines = String(watermark.text).split(/\r?\n/);
    const measuredWidth = Math.max(
      0,
      ...lines.map(line => context.measureText(line).width),
    );
    const lineHeight = watermark.fontSize * 1.12;
    const measuredHeight = lineHeight * lines.length;
    const origin = watermarkOrigin(
      watermark,
      width,
      height,
      measuredWidth,
      measuredHeight,
    );
    context.fillStyle = watermark.color;
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = Math.max(3, watermark.fontSize * 0.08);
    lines.forEach((line, index) => {
      context.fillText(line, origin.left, origin.top + index * lineHeight);
    });
  }
  context.restore();
}

async function postJson(url, value) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`Render bridge trả về HTTP ${response.status}.`);
  }
}

class PadStreamingExporter {
  static id = EXPORTER_ID;
  static displayName = 'PAD Studio FFmpeg stream';

  static async create(_project, settings) {
    return new PadStreamingExporter(
      settings.exporter.options.token,
      settings.exporter.options.diagnostics,
    );
  }

  constructor(token, diagnostics) {
    this.token = token;
    this.diagnostics = diagnostics;
  }

  async handleFrame(canvas, frame, sceneFrame, sceneName, signal) {
    if (signal.aborted) return;
    this.diagnostics.markFrame(frame, sceneFrame, sceneName);
    let blob = null;
    for (let attempt = 1; attempt <= 3 && !blob; attempt += 1) {
      blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob && attempt < 3 && !signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, attempt * 25));
      }
    }
    if (signal.aborted) return;
    if (!blob) {
      throw new Error('Không thể mã hóa frame PNG sau 3 lần thử.');
    }
    const response = await fetch(
      `/__pad-render/frame?token=${encodeURIComponent(this.token)}&frame=${frame}`,
      {method: 'POST', headers: {'content-type': 'image/png'}, body: blob, signal},
    );
    if (!response.ok) {
      throw new Error(`FFmpeg từ chối frame ${frame} (HTTP ${response.status}).`);
    }
  }
}

function sceneContext(scene, config) {
  const manifestScenes = config.editorManifest.scenes ?? [];
  const manifestScene =
    manifestScenes.find(
      item =>
        item.filePath === safeSceneFile(scene?.name) ||
        item.sceneId === scene?.name,
    ) ?? null;
  const fingerprints = new Map(
    (manifestScene?.nodes ?? []).map(node => [node.key, node.fingerprint]),
  );
  const sceneId = manifestScene?.sceneId ?? scene?.name ?? '';
  return {
    sceneId,
    document: {
      ...config.overrides,
      overrides: (config.overrides.overrides ?? []).filter(
        override =>
          override.sceneId !== sceneId ||
          fingerprints.get(override.nodeKey) === override.nodeFingerprint,
      ),
    },
  };
}

async function start(project) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  if (!token) throw new Error('Thiếu render token.');
  const response = await fetch(
    `/__pad-render/config?token=${encodeURIComponent(token)}`,
    {cache: 'no-store'},
  );
  if (!response.ok) throw new Error('Không thể đọc cấu hình final render.');
  const config = await response.json();
  const diagnostics = createRenderDiagnosticTracker(config.fps);
  const disposeLogger = project.logger.onLogged.subscribe(payload => {
    diagnostics.record(payload);
  });
  let disposeFrame = () => {};
  try {
    let watermarkBitmap = null;
    if (config.watermark?.type === 'image') {
      const imageResponse = await fetch(
        `/__pad-render/watermark?token=${encodeURIComponent(token)}`,
        {cache: 'no-store'},
      );
      if (!imageResponse.ok) throw new Error('Không thể đọc ảnh watermark đã chọn.');
      watermarkBitmap = await createImageBitmap(await imageResponse.blob());
    }

    project.meta.rendering.exporter.exporters.push(PadStreamingExporter);
    const renderer = new Renderer(project);
    disposeFrame = renderer.onFrameChanged.subscribe(frame => {
      const scene = renderer.playback?.currentScene;
      diagnostics.markFrame(
        frame,
        scene && Number.isFinite(scene.firstFrame)
          ? frame - scene.firstFrame
          : null,
        scene?.name,
      );
    });
    const baseRender = renderer.stage.render.bind(renderer.stage);
    renderer.stage.render = async (currentScene, previousScene) => {
    let restoreCurrent = () => {};
    let restorePrevious = () => {};
    try {
      if (previousScene) {
        const previous = sceneContext(previousScene, config);
        restorePrevious = applySceneOverrides(previousScene, previous.document, {
          sceneId: previous.sceneId,
        });
      }
      const current = sceneContext(currentScene, config);
      restoreCurrent = applySceneOverrides(currentScene, current.document, {
        sceneId: current.sceneId,
      });
      await baseRender(currentScene, previousScene);
      const context = renderer.stage.finalBuffer.getContext('2d');
      if (context) {
        drawTextDecorations(context, currentScene, current.document, current.sceneId);
        drawWatermark(context, config.watermark, watermarkBitmap);
      }
    } finally {
      restoreCurrent();
      restorePrevious();
    }
    };

    let result = RendererResult.Error;
    const disposeFinished = renderer.onFinished.subscribe(value => {
      result = value;
    });
    try {
      const rangeFrames = Array.isArray(config.rangeFrames)
        ? config.rangeFrames
        : [0, Math.ceil(config.durationSeconds * config.fps)];
      const range = rendererRangeFromFrames(rangeFrames, config.fps);
      await renderer.render({
      name: config.name,
      range,
      fps: config.fps,
      size: new Vector2(config.width, config.height),
      resolutionScale: 1,
      background: null,
      colorSpace: 'srgb',
      audioOffset: 0,
      exporter: {name: EXPORTER_ID, options: {token, diagnostics}},
      });
    } finally {
      disposeFinished();
    }
    if (result !== RendererResult.Success) {
      const diagnostic = diagnostics.build(null, 'motion-canvas');
      const error = new Error(
        diagnosticMessage(
          diagnostic,
          result === RendererResult.Aborted
            ? 'Motion Canvas đã dừng trước khi hoàn tất.'
            : 'Motion Canvas không thể dựng frame hiện tại.',
        ),
      );
      error.renderDiagnostic = diagnostic;
      throw error;
    }
    await postJson(`/__pad-render/status?token=${encodeURIComponent(token)}`, {
      state: 'completed',
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.renderDiagnostic) {
      throw error;
    }
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.renderDiagnostic = diagnostics.build(wrapped, 'motion-canvas');
    throw wrapped;
  } finally {
    disposeFrame();
    disposeLogger();
  }
}

export function editor(project) {
  void start(project).catch(async error => {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = error?.renderDiagnostic ?? null;
    const detail = document.querySelector('#render-detail');
    if (detail) detail.textContent = message;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (token) {
      await postJson(`/__pad-render/status?token=${encodeURIComponent(token)}`, {
        state: 'failed',
        message,
        diagnostic,
      }).catch(() => undefined);
    }
  });
}

export function index() {
  const detail = document.querySelector('#render-detail');
  if (detail) detail.textContent = 'Không tìm thấy Motion Canvas project.';
}
