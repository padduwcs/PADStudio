import {Player, Stage} from '@motion-canvas/core';
import {
  applySceneOverrides,
  buildModifierIndex,
  editableProperties,
  getOverride,
  nodeFingerprintSource,
  normalizeDocument,
  patchDocument,
  resetDocumentNode,
  serializeSignalValue,
  sha256,
} from './modifier-model.js';
import {
  createProtocol,
  fetchOptionalJson,
  readEditorContext,
} from './protocol.js';
import {
  canonicalizeEditorNodes,
  isGeneratedEditorNodeKey,
  mergeEditorNodePolicy,
  migrateInternalNodeOverrides,
  resolveLiveEditorNodeTarget,
} from './editor-targets.js';

const NODE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,159}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_NODES = 500;
const SNAP_STEP = 10;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label, title = label) {
  const button = element('button', '', label);
  button.type = 'button';
  button.title = title;
  return button;
}

function toggleButton(label, pressed, title = label) {
  const button = actionButton(label, title);
  button.setAttribute('aria-pressed', String(pressed));
  return button;
}

function formatTime(frame, fps) {
  const totalSeconds = Math.max(0, frame / Math.max(1, fps));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds % 1) * 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createUi(projectName) {
  const shell = element('section', 'layout-shell');
  const toolbar = element('header', 'layout-toolbar');
  const toolbarLeft = element('div', 'layout-toolbar-group');
  const toolbarRight = element('div', 'layout-toolbar-group');
  const brand = element('div', 'layout-brand');
  brand.append(
    element('span', '', 'PAD Studio · Layout'),
    element('strong', '', projectName || 'Motion Canvas'),
  );

  const sceneSelect = element('select', 'layout-scene-select');
  sceneSelect.setAttribute('aria-label', 'Chọn scene');
  const undo = actionButton('Hoàn tác', 'Hoàn tác (Ctrl+Z)');
  const redo = actionButton('Làm lại', 'Làm lại (Ctrl+Shift+Z)');
  const reset = actionButton('Reset', 'Khôi phục đối tượng đang chọn');
  const remove = actionButton('Ẩn', 'Ẩn đối tượng (Delete)');
  toolbarLeft.append(brand, sceneSelect, undo, redo, reset, remove);

  const original = toggleButton(
    'So sánh gốc',
    false,
    'Giữ để xem source chưa chỉnh',
  );
  const clean = toggleButton('Preview sạch', false, 'Ẩn mọi guide và khung chọn');
  const grid = toggleButton('Lưới', false);
  const safeZone = toggleButton('Safe-zone', true);
  const snap = toggleButton('Snap 10px', true);
  const fullscreen = actionButton('Toàn màn hình');
  const status = element('span', 'layout-status is-loading', 'Đang dựng scene…');
  toolbarRight.append(
    original,
    clean,
    grid,
    safeZone,
    snap,
    fullscreen,
    status,
  );
  toolbar.append(toolbarLeft, toolbarRight);

  const viewport = element('div', 'layout-viewport');
  const stageHost = element('div', 'layout-stage');
  const canvasStack = element('div', 'layout-canvas-stack');
  const loading = element('div', 'layout-loading');
  loading.append(
    element('span', 'layout-spinner'),
    element('strong', '', 'Đang tải animation và narration…'),
  );
  const originalBadge = element('span', 'layout-original-badge', 'Bản gốc');
  originalBadge.hidden = true;
  const cleanBadge = element('span', 'layout-clean-badge', 'Preview sạch');
  cleanBadge.hidden = true;
  const selectionPill = element('span', 'layout-selection-pill');
  selectionPill.hidden = true;
  viewport.append(
    stageHost,
    loading,
    originalBadge,
    cleanBadge,
    selectionPill,
  );

  const transport = element('footer', 'layout-transport');
  const rewind = actionButton('−5s', 'Lùi 5 giây (J)');
  rewind.className = 'layout-skip';
  const play = actionButton('Phát', 'Phát hoặc tạm dừng (Space)');
  play.className = 'layout-play';
  const forward = actionButton('+5s', 'Tiến 5 giây (L)');
  forward.className = 'layout-skip';
  const currentTime = element('time', 'layout-time', '0:00.0');
  const timeline = element('div', 'layout-timeline');
  const seek = element('input', 'layout-seek');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1';
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Vị trí phát');
  const sceneMarkers = element('div', 'layout-scene-markers');
  timeline.append(sceneMarkers, seek);
  const durationTime = element('time', 'layout-time', '0:00.0');
  const mute = actionButton('Âm thanh');
  transport.append(
    rewind,
    play,
    forward,
    currentTime,
    timeline,
    durationTime,
    mute,
  );

  const errorPanel = element('section', 'layout-error');
  errorPanel.hidden = true;
  shell.append(toolbar, viewport, transport, errorPanel);
  return {
    shell,
    toolbar,
    sceneSelect,
    undo,
    redo,
    reset,
    remove,
    original,
    clean,
    grid,
    safeZone,
    snap,
    fullscreen,
    status,
    viewport,
    stageHost,
    canvasStack,
    loading,
    originalBadge,
    cleanBadge,
    selectionPill,
    rewind,
    play,
    forward,
    currentTime,
    seek,
    sceneMarkers,
    durationTime,
    mute,
    errorPanel,
  };
}

function sceneNodeLabel(node) {
  const tail = String(node.key ?? '').split('/').at(-1);
  const type = node.constructor?.name || 'Node';
  if (typeof node.text === 'function') {
    try {
      const text = String(node.text() ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return `${type}: ${text}`.slice(0, 120);
    } catch {
      // Fall back to the stable node key.
    }
  }
  return (tail || type).slice(0, 120);
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
    const matrix = node.localToWorld();
    const corners = node
      .cacheBBox()
      .transformCorners(matrix)
      .map(point => ({x: point.x, y: point.y}));
    if (
      corners.length < 4 ||
      corners.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      return null;
    }
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    const center = {
      x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
      y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
    };
    return {bounds, center, corners};
  } catch {
    return null;
  }
}

function transformPoint(matrix, point) {
  const result = new DOMPoint(point.x, point.y).matrixTransform(matrix);
  return {x: result.x, y: result.y};
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rotationHandle(geometry, offset = 34) {
  if (!geometry?.corners?.length) return null;
  const topA = geometry.corners[0];
  const topB = geometry.corners[1] ?? geometry.corners[0];
  const midpoint = {x: (topA.x + topB.x) / 2, y: (topA.y + topB.y) / 2};
  const vector = {
    x: midpoint.x - geometry.center.x,
    y: midpoint.y - geometry.center.y,
  };
  const length = Math.hypot(vector.x, vector.y) || 1;
  return {
    x: midpoint.x + (vector.x / length) * offset,
    y: midpoint.y + (vector.y / length) * offset,
  };
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

function drawOverlay(context, canvas, geometry, view) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (view.clean) return;
  context.save();
  if (view.grid) {
    const step = Math.max(20, SNAP_STEP * 4);
    context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = step; x < canvas.width; x += step) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, canvas.height);
    }
    for (let y = step; y < canvas.height; y += step) {
      context.moveTo(0, y + 0.5);
      context.lineTo(canvas.width, y + 0.5);
    }
    context.stroke();
  }
  if (view.safeZone) {
    const marginX = canvas.width * 0.05;
    const marginY = canvas.height * 0.05;
    const titleX = canvas.width * 0.1;
    const titleY = canvas.height * 0.1;
    context.setLineDash([8, 6]);
    context.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    context.strokeRect(
      marginX,
      marginY,
      canvas.width - marginX * 2,
      canvas.height - marginY * 2,
    );
    context.strokeStyle = 'rgba(237, 143, 103, 0.38)';
    context.strokeRect(
      titleX,
      titleY,
      canvas.width - titleX * 2,
      canvas.height - titleY * 2,
    );
    context.setLineDash([]);
  }
  if (!geometry) {
    context.restore();
    return;
  }
  context.strokeStyle = '#ed8f67';
  context.fillStyle = '#17372f';
  context.lineWidth = 2;
  context.beginPath();
  geometry.corners.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.stroke();
  for (const point of geometry.corners) {
    context.beginPath();
    context.rect(point.x - 5, point.y - 5, 10, 10);
    context.fill();
    context.stroke();
  }
  const handle = rotationHandle(geometry);
  if (handle) {
    const topA = geometry.corners[0];
    const topB = geometry.corners[1] ?? topA;
    const midpoint = {x: (topA.x + topB.x) / 2, y: (topA.y + topB.y) / 2};
    context.beginPath();
    context.moveTo(midpoint.x, midpoint.y);
    context.lineTo(handle.x, handle.y);
    context.stroke();
    context.beginPath();
    context.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
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

async function stableSceneId(name) {
  const hash = await sha256(`pad-studio-layout-scene:${name}`);
  const chars = hash.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16], 16) % 4];
  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-');
}

function safeSceneFile(name) {
  const value = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `src/scenes/${value || 'scene'}.tsx`;
}

function flattenSceneNodes(scene) {
  if (typeof scene?.getView !== 'function') return [];
  const registered =
    scene.registeredNodes instanceof Map
      ? Array.from(scene.registeredNodes.values()).filter(
          node => node !== scene.getView(),
        )
      : null;
  if (registered) {
    const keys = new Set(
      registered
        .map(node => String(node.key ?? ''))
        .filter(key => NODE_KEY.test(key)),
    );
    return registered
      .filter(node => keys.has(String(node.key ?? '')))
      .slice(0, MAX_MANIFEST_NODES)
      .map(node => {
        const parentKey = String(node.parent?.()?.key ?? '');
        return {
          node,
          parentKey: keys.has(parentKey) ? parentKey : null,
        };
      });
  }
  const result = [];
  const queue = scene.getView().children().map(node => ({
    node,
    parentKey: null,
  }));
  while (queue.length > 0 && result.length < MAX_MANIFEST_NODES) {
    const current = queue.shift();
    const key = String(current.node.key ?? '');
    const validKey = NODE_KEY.test(key);
    if (validKey) result.push(current);
    const nextParent = validKey ? key : current.parentKey;
    for (const child of current.node.children?.() ?? []) {
      queue.push({node: child, parentKey: nextParent});
    }
  }
  return result;
}

async function inspectManifestNodes(scene) {
  const entries = flattenSceneNodes(scene);
  return Promise.all(
    entries.map(async ({node, parentKey}) => {
      const editable = editableProperties(node);
      return {
        key: node.key,
        fingerprint: await sha256(nodeFingerprintSource(node)),
        label: sceneNodeLabel(node),
        nodeType: (node.constructor?.name || 'Node').slice(0, 80),
        parentKey,
        identity: isGeneratedEditorNodeKey(node.key)
          ? 'legacy'
          : 'semantic',
        editableProperties: editable,
        lockedProperties: [],
        lockReason: null,
      };
    }),
  );
}

function validManifestSource(manifest) {
  return Boolean(
    manifest &&
      UUID.test(manifest.sourceAnimationSyncGenerationId) &&
      Number.isInteger(manifest.sourceAnimationSyncContentRevision) &&
      manifest.sourceAnimationSyncContentRevision > 0 &&
      SHA256.test(manifest.sourceAnimationSyncSourceHash),
  );
}

async function startEditor(project) {
  const root = document.querySelector('#root');
  if (!root) throw new Error('Không tìm thấy Layout Editor root.');
  const context = readEditorContext();
  const protocol = createProtocol(context);
  const ui = createUi(
    project.name && project.name !== 'project'
      ? project.name
      : 'Animation đã đồng bộ',
  );
  root.replaceChildren(ui.shell);

  let sourceManifest = null;
  let sourceOverrides = null;
  try {
    [sourceManifest, sourceOverrides] = await Promise.all([
      fetchOptionalJson(context.manifestUrl),
      fetchOptionalJson(context.overridesUrl),
    ]);
  } catch (error) {
    protocol.post('error', {
      message: error instanceof Error ? error.message : String(error),
      phase: 'initial-data',
    });
  }

  const source = {
    generationId:
      sourceManifest?.sourceAnimationSyncGenerationId ||
      context.sourceSyncGenerationId,
    contentRevision:
      sourceManifest?.sourceAnimationSyncContentRevision ||
      context.sourceSyncContentRevision,
    sourceHash:
      sourceManifest?.sourceAnimationSyncSourceHash ||
      context.sourceSyncSourceHash,
  };
  let overridesDocument = normalizeDocument(sourceOverrides, source);
  let modifierIndex = buildModifierIndex(overridesDocument);
  let manifest = sourceManifest && typeof sourceManifest === 'object'
    ? deepClone(sourceManifest)
    : {
        version: 1,
        sourceAnimationSyncGenerationId: source.generationId,
        sourceAnimationSyncContentRevision: source.contentRevision,
        sourceAnimationSyncSourceHash: source.sourceHash,
        scenes: [],
      };
  let duration = 0;
  let currentFrame = 0;
  let ready = false;
  let readyPayload = null;
  let disposed = false;
  let dirtyRevision = 0;
  let reviewStartRevision = null;
  let reviewStartedNearBeginning = false;
  let reviewedRevision = -1;
  let selected = null;
  let pendingSelection = null;
  let selectedGeometry = null;
  let dragging = null;
  let scenes = [];
  let sceneInfoByRuntimeName = new Map();
  let manifestPostQueued = false;
  let manifestReady = false;
  const manifestDirtyScenes = new Set();
  const manifestInspectedScenes = new Set();
  const editorTargetsByScene = new Map();
  const subscribedScenes = new WeakSet();
  const history = [];
  const future = [];
  const disposers = [];
  const view = {
    original: false,
    clean: false,
    grid: false,
    safeZone: true,
    snap: true,
  };

  const settings = project.meta.getFullPreviewSettings();
  const stage = new Stage();
  stage.configure(settings);
  stage.finalBuffer.classList.add('layout-stage-canvas', 'is-selectable');
  const overlay = document.createElement('canvas');
  overlay.className = 'layout-overlay';
  const overlayContext = overlay.getContext('2d');
  if (!overlayContext) throw new Error('Không thể tạo canvas overlay.');
  ui.canvasStack.append(stage.finalBuffer, overlay);
  ui.stageHost.append(ui.canvasStack);

  const player = new Player(
    project,
    settings,
    {
      loop: false,
      muted: false,
      paused: true,
      speed: 1,
      volume: 1,
    },
    0,
  );
  for (const plugin of project.plugins) plugin.player?.(player);
  player.deactivate();

  function reportError(error, phase = 'runtime') {
    const message =
      error instanceof Error ? error.message : String(error || 'Lỗi không rõ.');
    ui.errorPanel.hidden = false;
    ui.errorPanel.replaceChildren(
      element('strong', '', 'Layout Editor gặp lỗi'),
      element('p', '', message),
    );
    ui.status.textContent = 'Có lỗi';
    ui.status.classList.remove('is-loading');
    ui.status.classList.add('is-error');
    protocol.post('error', {message, phase});
  }

  function sceneInfo(scene) {
    return (
      sceneInfoByRuntimeName.get(scene?.name) ?? {
        sceneId: scene?.name ?? '',
        filePath: safeSceneFile(scene?.name ?? 'scene'),
      }
    );
  }

  function currentSceneInfo() {
    return sceneInfo(player.playback.currentScene);
  }

  function currentManifestNode(nodeKey = selected?.nodeKey) {
    if (!nodeKey) return null;
    const info = currentSceneInfo();
    const scene = manifest.scenes?.find(item => item.sceneId === info.sceneId);
    return scene?.nodes?.find(node => node.key === nodeKey) ?? null;
  }

  function currentOverride(nodeKey = selected?.nodeKey) {
    if (!nodeKey) return null;
    const info = currentSceneInfo();
    return getOverride(modifierIndex, info.sceneId, nodeKey);
  }

  function selectionPayload() {
    if (!selected) return null;
    const scene = player.playback.currentScene;
    const info = currentSceneInfo();
    if (selected.sceneId !== info.sceneId || typeof scene.getNode !== 'function') {
      return null;
    }
    const node = scene.getNode(selected.nodeKey);
    if (!node) return null;
    const manifestNode = currentManifestNode(node.key);
    const override = currentOverride(node.key);
    const patch = override?.patch ?? {};
    const liveEditableProperties = editableProperties(node);
    const selectionEditableProperties = [
      ...new Set([
        ...(manifestNode?.editableProperties ?? []),
        ...liveEditableProperties,
      ]),
    ];
    return {
      sceneId: info.sceneId,
      nodeKey: node.key,
      nodeId: node.key,
      nodeFingerprint:
        manifestNode?.fingerprint ?? override?.nodeFingerprint ?? '',
      label: manifestNode?.label ?? sceneNodeLabel(node),
      nodeType: manifestNode?.nodeType ?? node.constructor?.name ?? 'Node',
      parentKey: manifestNode?.parentKey ?? node.parent?.()?.key ?? null,
      identity: manifestNode?.identity ?? 'legacy',
      editableProperties: selectionEditableProperties,
      lockedProperties: manifestNode?.lockedProperties ?? [],
      lockReason: manifestNode?.lockReason ?? null,
      editorLocked: patch.editorLocked === true,
      patch,
      base: {
        position: signalSnapshot(node, 'position'),
        scale: signalSnapshot(node, 'scale'),
        rotation: signalSnapshot(node, 'rotation'),
        opacity: signalSnapshot(node, 'opacity'),
        fill: signalSnapshot(node, 'fill'),
        stroke: signalSnapshot(node, 'stroke'),
        strokeWidth: signalSnapshot(node, 'lineWidth'),
        zIndex: signalSnapshot(node, 'zIndex'),
        text: signalSnapshot(node, 'text'),
        fontFamily: signalSnapshot(node, 'fontFamily'),
        fontSize: signalSnapshot(node, 'fontSize'),
        fontWeight: signalSnapshot(node, 'fontWeight'),
        fontStyle: signalSnapshot(node, 'fontStyle'),
      },
      geometry: selectedGeometry,
    };
  }

  function postSelection() {
    const payload = {selection: selectionPayload()};
    protocol.post('select', payload);
    protocol.post('selection', payload);
  }

  function postState(extra = {}) {
    const state = player.onStateChanged.current;
    protocol.post('state', {
      frame: currentFrame,
      duration,
      fps: player.status.fps,
      paused: state.paused,
      muted: state.muted,
      sceneId: currentSceneInfo().sceneId,
      sceneName: player.playback.currentScene?.name ?? '',
      dirtyRevision,
      reviewed: reviewedRevision === dirtyRevision,
      view: {...view},
      history: {canUndo: history.length > 0, canRedo: future.length > 0},
      ...extra,
    });
  }

  function refreshButtons() {
    const payload = selectionPayload();
    const hiddenEditable = Boolean(
      payload &&
        !payload.editorLocked &&
        payload.editableProperties.includes('hidden') &&
        !payload.lockedProperties.includes('hidden'),
    );
    ui.undo.disabled = history.length === 0;
    ui.redo.disabled = future.length === 0;
    ui.reset.disabled = !payload || payload.editorLocked;
    ui.remove.disabled = !hiddenEditable;
    ui.original.setAttribute('aria-pressed', String(view.original));
    ui.clean.setAttribute('aria-pressed', String(view.clean));
    ui.grid.setAttribute('aria-pressed', String(view.grid));
    ui.safeZone.setAttribute('aria-pressed', String(view.safeZone));
    ui.snap.setAttribute('aria-pressed', String(view.snap));
    ui.originalBadge.hidden = !view.original;
    ui.cleanBadge.hidden = !view.clean;
    ui.selectionPill.hidden = !selected || view.clean;
    ui.selectionPill.textContent = selected
      ? payload?.label ?? selected.nodeKey
      : '';
  }

  function emitDocumentChanged(reason, transient = false) {
    const payload = {
      document: deepClone(overridesDocument),
      overrides: deepClone(overridesDocument.overrides),
      reason,
      transient,
      dirtyRevision,
      selection: selectionPayload(),
    };
    protocol.post('change', payload);
    protocol.post('documentChanged', payload);
  }

  function replaceDocument(next, options = {}) {
    const normalized = normalizeDocument(next, source);
    const changed =
      JSON.stringify(normalized) !== JSON.stringify(overridesDocument);
    if (!changed) {
      refreshButtons();
      player.requestRender();
      if (options.reason === 'load-document' && options.emit !== false) {
        emitDocumentChanged(options.reason, false);
      }
      return false;
    }
    if (options.record !== false) {
      history.push(deepClone(overridesDocument));
      if (history.length > 100) history.shift();
      future.length = 0;
    }
    overridesDocument = normalized;
    modifierIndex = buildModifierIndex(overridesDocument);
    if (options.dirty !== false) {
      dirtyRevision++;
      reviewedRevision = -1;
      reviewStartRevision = null;
    }
    refreshButtons();
    postState();
    player.requestRender();
    if (options.emit !== false) {
      emitDocumentChanged(options.reason ?? 'replace', options.transient === true);
    }
    return true;
  }

  function undo() {
    if (dragging) return;
    const previous = history.pop();
    if (!previous) return;
    future.push(deepClone(overridesDocument));
    replaceDocument(previous, {record: false, reason: 'undo'});
  }

  function redo() {
    if (dragging) return;
    const next = future.pop();
    if (!next) return;
    history.push(deepClone(overridesDocument));
    replaceDocument(next, {record: false, reason: 'redo'});
  }

  function selectedCanEdit(properties) {
    const payload = selectionPayload();
    if (!payload || payload.editorLocked) return false;
    const editable = new Set(payload.editableProperties);
    const locked = new Set(payload.lockedProperties);
    return properties.every(
      property => editable.has(property) && !locked.has(property),
    );
  }

  function patchSelection(patch, options = {}) {
    if (dragging) return false;
    if (!selected) return false;
    const payload = selectionPayload();
    if (!payload?.nodeFingerprint) {
      reportError(
        new Error('Node chưa có fingerprint đáng tin cậy. Hãy đợi scene tải xong.'),
        'patch',
      );
      return false;
    }
    const properties = Object.keys(patch).filter(
      key => key !== 'editorLocked',
    );
    if (
      properties.length > 0 &&
      !options.force &&
      !selectedCanEdit(properties)
    ) {
      return false;
    }
    const next = patchDocument(
      overridesDocument,
      selected.sceneId,
      selected.nodeKey,
      payload.nodeFingerprint,
      patch,
    );
    return replaceDocument(next, options);
  }

  function resetSelection(force = false) {
    if (dragging) return;
    if (!selected) return;
    const payload = selectionPayload();
    if (!payload || (payload.editorLocked && !force)) return;
    replaceDocument(
      resetDocumentNode(
        overridesDocument,
        selected.sceneId,
        selected.nodeKey,
      ),
      {reason: 'reset-selected'},
    );
  }

  function normalizeKnownInternalOverrides() {
    let nextDocument = overridesDocument;
    for (const [sceneId, targetModel] of editorTargetsByScene) {
      nextDocument = migrateInternalNodeOverrides(
        nextDocument,
        sceneId,
        targetModel.aliases,
        targetModel.nodes,
      );
    }
    if (nextDocument === overridesDocument) return false;
    return replaceDocument(nextDocument, {
      record: false,
      reason: 'normalize-internal-targets',
    });
  }

  function nudgeSelection(axis, amount) {
    if (!selected || !selectedCanEdit([axis])) return false;
    const patch = currentOverride()?.patch ?? {};
    const current = Number.isFinite(patch[axis]) ? patch[axis] : 0;
    return patchSelection(
      {[axis]: current + amount},
      {reason: 'keyboard-nudge'},
    );
  }

  function changeSelectionLayer(amount) {
    if (!selected || !selectedCanEdit(['zIndexDelta'])) return false;
    const patch = currentOverride()?.patch ?? {};
    const current = Number.isFinite(patch.zIndexDelta)
      ? patch.zIndexDelta
      : 0;
    return patchSelection(
      {zIndexDelta: current + amount},
      {reason: 'keyboard-layer'},
    );
  }

  function resolveLiveEditorNode(scene, nodeKey) {
    const requested =
      typeof scene?.getNode === 'function' ? scene.getNode(nodeKey) : null;
    if (!requested) return null;
    const target = resolveLiveEditorNodeTarget(requested);
    return target && NODE_KEY.test(String(target.key ?? ''))
      ? target
      : requested;
  }

  function selectNode(nodeKey, notify = true) {
    const scene = player.playback.currentScene;
    const info = currentSceneInfo();
    const node = resolveLiveEditorNode(scene, nodeKey);
    selected = node ? {sceneId: info.sceneId, nodeKey: node.key} : null;
    selectedGeometry = node ? nodeGeometry(node) : null;
    refreshButtons();
    player.requestRender();
    if (notify) postSelection();
    return Boolean(node);
  }

  function setViewPatch(patch) {
    Object.assign(view, patch);
    refreshButtons();
    player.requestRender();
    postState();
  }

  async function ensureSceneManifest(scene) {
    const info = sceneInfo(scene);
    if (!info.sceneId) return;
    // Signal getters in generated scenes may depend on Motion Canvas' active
    // scene context. Manifest discovery runs after recalculation, so explicitly
    // restore that context while taking the synchronous node snapshots.
    const discoveredNodes = await (
      typeof scene?.execute === 'function'
        ? scene.execute(() => inspectManifestNodes(scene))
        : inspectManifestNodes(scene)
    );
    const canonical = canonicalizeEditorNodes(discoveredNodes);
    const previousScene = manifest.scenes?.find(
      item => item.sceneId === info.sceneId,
    );
    const previousByKey = new Map(
      (previousScene?.nodes ?? []).map(node => [node.key, node]),
    );
    const nodes = canonical.nodes
      .map(node => {
        const previousNode = previousByKey.get(node.key);
        return mergeEditorNodePolicy(node, previousNode);
      })
      .sort((left, right) => left.key.localeCompare(right.key))
      .slice(0, MAX_MANIFEST_NODES);
    editorTargetsByScene.set(info.sceneId, {
      aliases: canonical.aliases,
      nodes,
    });
    const nextScene = {
      sceneId: info.sceneId,
      filePath: info.filePath,
      nodes,
    };
    const existing = manifest.scenes?.findIndex(
      item => item.sceneId === info.sceneId,
    );
    if (!Array.isArray(manifest.scenes)) manifest.scenes = [];
    if (existing >= 0) manifest.scenes[existing] = nextScene;
    else manifest.scenes.push(nextScene);
    manifestInspectedScenes.add(info.sceneId);
    manifestReady =
      scenes.length > 0 &&
      scenes.every(item =>
        manifestInspectedScenes.has(sceneInfo(item).sceneId),
      );
    if (selected?.sceneId === info.sceneId) {
      const canonicalKey = canonical.aliases.get(selected.nodeKey);
      if (canonicalKey) {
        const node = resolveLiveEditorNode(scene, canonicalKey);
        selected = node
          ? {sceneId: info.sceneId, nodeKey: node.key}
          : null;
        selectedGeometry = node ? nodeGeometry(node) : null;
      }
    }
    protocol.post('manifest', {
      status: 'discovered',
      sceneId: info.sceneId,
      nodeCount: nodes.length,
      complete: manifestReady,
      manifest: deepClone(manifest),
    });
    const migrated = normalizeKnownInternalOverrides();
    if (!migrated && selected?.sceneId === info.sceneId) postSelection();
    if (manifestReady) queueManifestPost();
    player.requestRender();
  }

  async function postManifest() {
    manifestPostQueued = false;
    if (disposed || !manifestReady || !validManifestSource(manifest)) return;
    try {
      const response = await fetch('/__pad_layout_manifest', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({
          sessionNonce: context.sessionId,
          generationId: context.generationId,
          sourceSyncGenerationId:
            context.sourceSyncGenerationId ||
            manifest.sourceAnimationSyncGenerationId,
          manifest,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      protocol.post('manifest', {
        status: 'stored',
        complete: true,
        sceneCount: manifest.scenes.length,
        nodeCount: manifest.scenes.reduce(
          (sum, scene) => sum + scene.nodes.length,
          0,
        ),
        manifest: deepClone(manifest),
      });
    } catch (error) {
      protocol.post('manifest', {
        status: 'error',
        complete: manifestReady,
        message: error instanceof Error ? error.message : String(error),
        manifest: deepClone(manifest),
      });
    }
  }

  function queueManifestPost() {
    if (manifestPostQueued || !manifestReady) return;
    manifestPostQueued = true;
    window.setTimeout(() => void postManifest(), 100);
  }

  function markManifestDirty(scene) {
    if (!scene || manifestDirtyScenes.has(scene)) return;
    manifestDirtyScenes.add(scene);
    queueMicrotask(() => {
      if (disposed || !manifestDirtyScenes.delete(scene)) return;
      void ensureSceneManifest(scene).catch(error =>
        reportError(error, 'manifest-discovery'),
      );
    });
  }

  function applyForRender(scene, captureSelection = false) {
    const info = sceneInfo(scene);
    const manifestScene = manifest.scenes?.find(
      item => item.sceneId === info.sceneId,
    );
    const fingerprints = new Map(
      (manifestScene?.nodes ?? []).map(node => [node.key, node.fingerprint]),
    );
    const verifiedDocument = {
      ...overridesDocument,
      overrides: overridesDocument.overrides.filter(
        override =>
          override.sceneId !== info.sceneId ||
          fingerprints.get(override.nodeKey) === override.nodeFingerprint,
      ),
    };
    const restore = applySceneOverrides(scene, verifiedDocument, {
      sceneId: info.sceneId,
      original: view.original,
    });
    if (captureSelection && selected && !view.original) {
      const node = scene.getNode?.(selected.nodeKey);
      if (node) selectedGeometry = nodeGeometry(node);
    }
    return restore;
  }

  function withApplied(scene, callback) {
    const restore = applyForRender(scene, false);
    try {
      return callback();
    } finally {
      restore();
    }
  }

  function updateOverlay() {
    if (
      overlay.width !== stage.finalBuffer.width ||
      overlay.height !== stage.finalBuffer.height
    ) {
      overlay.width = stage.finalBuffer.width;
      overlay.height = stage.finalBuffer.height;
    }
    drawOverlay(overlayContext, overlay, selectedGeometry, view);
  }

  disposers.push(
    project.logger.onLogged.subscribe(payload => {
      if (payload?.level !== 'error') return;
      reportError(
        new Error(
          typeof payload.message === 'string'
            ? payload.message
            : 'Motion Canvas báo lỗi.',
        ),
        'motion-canvas',
      );
    }),
  );

  disposers.push(
    player.playback.onScenesRecalculated.subscribe(async recalculatedScenes => {
      scenes = recalculatedScenes;
      const manifestScenes = Array.isArray(manifest.scenes)
        ? manifest.scenes
        : [];
      sceneInfoByRuntimeName = new Map();
      for (let index = 0; index < scenes.length; index++) {
        const scene = scenes[index];
        const seeded =
          manifestScenes.find(
            item =>
              item.filePath === safeSceneFile(scene.name) ||
              item.sceneId === scene.name,
          ) ?? manifestScenes[index];
        const sceneId =
          seeded?.sceneId && UUID.test(seeded.sceneId)
            ? seeded.sceneId
            : await stableSceneId(scene.name);
        const info = {
          sceneId,
          filePath: seeded?.filePath ?? safeSceneFile(scene.name),
        };
        sceneInfoByRuntimeName.set(scene.name, info);
        if (!manifestScenes.some(item => item.sceneId === sceneId)) {
          manifestScenes.push({...info, nodes: []});
        }
        if (!subscribedScenes.has(scene)) {
          subscribedScenes.add(scene);
          disposers.push(
            scene.onReset.subscribe(() => {
              // A reset recreates node instances. Modifiers resolve keys on
              // every frame, while the authoritative source-locked manifest
              // stays immutable for the lifetime of this preview session.
              queueManifestPost();
            }),
          );
        }
      }
      manifest.scenes = manifestScenes.slice(0, scenes.length);
      ui.sceneSelect.replaceChildren();
      ui.sceneMarkers.replaceChildren();
      for (const scene of scenes) {
        const option = document.createElement('option');
        option.value = String(scene.firstFrame);
        option.textContent = scene.name;
        option.dataset.sceneId = sceneInfo(scene).sceneId;
        ui.sceneSelect.append(option);
        const marker = element('span', 'layout-scene-marker');
        marker.style.flexGrow = String(
          Math.max(1, scene.lastFrame - scene.firstFrame),
        );
        marker.title = scene.name;
        ui.sceneMarkers.append(marker);
      }
      postState({scenes: sceneSummaries()});
    }),
  );

  disposers.push(
    player.onRecalculated.subscribe(() => {
      void Promise.all(
        scenes.map(scene =>
          ensureSceneManifest(scene).catch(error =>
            reportError(error, 'manifest-discovery'),
          ),
        ),
      ).then(() => {
        protocol.post('manifest', {
          status: manifestReady ? 'discovered-all' : 'discovering',
          complete: manifestReady,
          sceneCount: manifest.scenes.length,
          nodeCount: manifest.scenes.reduce(
            (sum, scene) => sum + scene.nodes.length,
            0,
          ),
          manifest: deepClone(manifest),
        });
        if (manifestReady) queueManifestPost();
      });
    }),
  );

  disposers.push(
    player.onRender.subscribe(async () => {
      const currentScene = player.playback.currentScene;
      const previousScene = player.playback.previousScene;
      let restoreCurrent = () => {};
      let restorePrevious = () => {};
      selectedGeometry = null;
      try {
        restorePrevious = previousScene
          ? applyForRender(previousScene, false)
          : () => {};
        restoreCurrent = applyForRender(currentScene, true);
        await stage.render(currentScene, previousScene);
        if (!view.original) {
          const context2d = stage.finalBuffer.getContext('2d');
          if (context2d) {
            drawTextDecorations(
              context2d,
              currentScene,
              overridesDocument,
              sceneInfo(currentScene).sceneId,
            );
          }
        }
        if (selected && !selectedGeometry) {
          const node = currentScene.getNode?.(selected.nodeKey);
          if (node) selectedGeometry = nodeGeometry(node);
        }
      } finally {
        try {
          restoreCurrent();
        } finally {
          restorePrevious();
        }
      }
      updateOverlay();
      if (
        !manifestInspectedScenes.has(sceneInfo(currentScene).sceneId)
      ) {
        markManifestDirty(currentScene);
      }
      refreshButtons();
      if (!ready) {
        ready = true;
        ui.loading.hidden = true;
        ui.status.textContent = 'Sẵn sàng chỉnh';
        ui.status.classList.remove('is-loading');
        ui.shell.dataset.ready = 'true';
        readyPayload = {
          capabilities: {
            transform: ['x', 'y', 'scale', 'rotation'],
            appearance: [
              'opacity',
              'hidden',
              'fill',
              'stroke',
              'strokeWidth',
              'zIndexDelta',
            ],
            typography: [
              'text',
              'fontFamily',
              'fontSize',
              'fontWeight',
              'fontStyle',
              'underline',
              'strikethrough',
            ],
            history: true,
            cleanPreview: true,
            compareOriginal: true,
            grid: true,
            safeZone: true,
            snap: SNAP_STEP,
          },
          projectName: project.name,
          generationId: context.generationId,
          sourceAnimationSyncGenerationId:
            overridesDocument.sourceAnimationSyncGenerationId,
          duration,
          fps: player.status.fps,
          scenes: sceneSummaries(),
          document: deepClone(overridesDocument),
        };
        protocol.post('ready', readyPayload);
      }
    }),
  );

  function sceneSummaries() {
    return scenes.map(scene => ({
      sceneId: sceneInfo(scene).sceneId,
      name: scene.name,
      filePath: sceneInfo(scene).filePath,
      firstFrame: scene.firstFrame,
      lastFrame: scene.lastFrame,
      durationFrames: Math.max(0, scene.lastFrame - scene.firstFrame),
    }));
  }

  disposers.push(
    player.onDurationChanged.subscribe(value => {
      duration = Math.max(0, value);
      ui.seek.max = String(Math.max(1, duration));
      ui.durationTime.textContent = formatTime(duration, player.status.fps);
      postState();
    }),
  );
  disposers.push(
    player.onFrameChanged.subscribe(frame => {
      currentFrame = Math.max(0, frame);
      ui.seek.value = String(Math.min(duration, currentFrame));
      ui.currentTime.textContent = formatTime(currentFrame, player.status.fps);
      const info = currentSceneInfo();
      if (selected && selected.sceneId !== info.sceneId) {
        selected = null;
        selectedGeometry = null;
        postSelection();
      }
      if (
        pendingSelection &&
        pendingSelection.sceneId === info.sceneId
      ) {
        const found =
          pendingSelection.nodeKey === null ||
          selectNode(pendingSelection.nodeKey, false);
        if (found) {
          pendingSelection = null;
          postSelection();
        }
      }
      const sceneOption = Array.from(ui.sceneSelect.options).find(
        option => option.dataset.sceneId === info.sceneId,
      );
      if (sceneOption) ui.sceneSelect.value = sceneOption.value;
      if (
        reviewStartRevision === dirtyRevision &&
        reviewStartedNearBeginning &&
        duration > 0 &&
        currentFrame >= duration - 1 &&
        reviewedRevision !== dirtyRevision
      ) {
        reviewedRevision = dirtyRevision;
        protocol.post('reviewed', {
          dirtyRevision,
          duration,
          method: 'full-playback',
        });
      }
      postState();
    }),
  );
  disposers.push(
    player.onStateChanged.subscribe(state => {
      ui.play.textContent = state.paused ? 'Phát' : 'Tạm dừng';
      ui.mute.textContent = state.muted ? 'Bật tiếng' : 'Âm thanh';
      ui.mute.setAttribute('aria-pressed', String(state.muted));
      ui.status.textContent = state.paused
        ? ready
          ? 'Đang tạm dừng'
          : 'Đang dựng scene…'
        : 'Đang phát để review';
      if (!state.paused) {
        reviewStartRevision = dirtyRevision;
        reviewStartedNearBeginning = currentFrame <= player.status.fps;
        protocol.post('played', {frame: currentFrame, dirtyRevision});
      }
      postState();
    }),
  );

  function seekTo(frame) {
    selectedGeometry = null;
    player.requestSeek(Math.min(duration, Math.max(0, Number(frame) || 0)));
  }

  function seekBySeconds(seconds) {
    seekTo(currentFrame + seconds * player.status.fps);
  }

  ui.play.addEventListener('click', () => player.togglePlayback());
  ui.rewind.addEventListener('click', () => seekBySeconds(-5));
  ui.forward.addEventListener('click', () => seekBySeconds(5));
  ui.seek.addEventListener('input', () => {
    selectedGeometry = null;
    player.requestSeek(Number(ui.seek.value));
  });
  ui.mute.addEventListener('click', () => player.toggleAudio());
  ui.sceneSelect.addEventListener('change', () => {
    selected = null;
    selectedGeometry = null;
    player.requestSeek(Number(ui.sceneSelect.value));
    postSelection();
  });
  ui.undo.addEventListener('click', undo);
  ui.redo.addEventListener('click', redo);
  ui.reset.addEventListener('click', resetSelection);
  ui.remove.addEventListener('click', () => {
    if (currentOverride()?.patch.hidden) {
      patchSelection({hidden: null}, {reason: 'show-selected'});
    } else {
      patchSelection({hidden: true}, {reason: 'hide-selected'});
    }
  });
  ui.original.addEventListener('click', () =>
    setViewPatch({original: !view.original}),
  );
  ui.original.addEventListener('pointerdown', event => {
    if (event.altKey) setViewPatch({original: true});
  });
  ui.clean.addEventListener('click', () => setViewPatch({clean: !view.clean}));
  ui.grid.addEventListener('click', () => setViewPatch({grid: !view.grid}));
  ui.safeZone.addEventListener('click', () =>
    setViewPatch({safeZone: !view.safeZone}),
  );
  ui.snap.addEventListener('click', () => setViewPatch({snap: !view.snap}));
  ui.fullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ui.viewport.requestFullscreen();
  });

  function handleAt(point) {
    if (!selectedGeometry || view.clean || view.original) return null;
    const scaleRadius =
      12 *
      (stage.finalBuffer.width /
        Math.max(1, stage.finalBuffer.getBoundingClientRect().width));
    for (const corner of selectedGeometry.corners) {
      if (distance(point, corner) <= scaleRadius) return 'scale';
    }
    const rotate = rotationHandle(selectedGeometry);
    if (rotate && distance(point, rotate) <= scaleRadius) return 'rotation';
    return null;
  }

  stage.finalBuffer.addEventListener('pointerdown', event => {
    if (
      dragging ||
      event.button !== 0 ||
      view.clean ||
      view.original
    ) {
      return;
    }
    event.preventDefault();
    player.togglePlayback(false);
    const scene = player.playback.currentScene;
    const point = canvasPoint(event, stage.finalBuffer);
    let mode = handleAt(point);
    if (!mode) {
      const key = withApplied(scene, () =>
        scene.inspectPosition?.(point.x, point.y),
      );
      if (!key) {
        selectNode(null);
        return;
      }
      selectNode(key);
      mode = 'translate';
    }
    const payload = selectionPayload();
    if (
      !payload ||
      !SHA256.test(payload.nodeFingerprint) ||
      payload.editorLocked ||
      (mode === 'translate' && !selectedCanEdit(['x', 'y'])) ||
      (mode === 'scale' && !selectedCanEdit(['scale'])) ||
      (mode === 'rotation' && !selectedCanEdit(['rotation']))
    ) {
      return;
    }
    const dragSnapshot = withApplied(scene, () => {
      const node = scene.getNode(selected.nodeKey);
      if (!node) return null;
      return {
        parentMatrix:
          node.parent?.()?.worldToLocal?.() ?? new DOMMatrix(),
        geometry: nodeGeometry(node),
      };
    });
    if (!dragSnapshot?.geometry) return;
    const parentMatrix = dragSnapshot.parentMatrix;
    const localStart = transformPoint(parentMatrix, point);
    const current = currentOverride()?.patch ?? {};
    dragging = {
      mode,
      pointerId: event.pointerId,
      sceneId: selected.sceneId,
      nodeKey: selected.nodeKey,
      fingerprint: payload.nodeFingerprint,
      startPoint: point,
      localStart,
      parentMatrix,
      startGeometry: deepClone(dragSnapshot.geometry),
      startPatch: deepClone(current),
      startDocument: deepClone(overridesDocument),
      startDirtyRevision: dirtyRevision,
      changed: false,
    };
    stage.finalBuffer.setPointerCapture(event.pointerId);
    stage.finalBuffer.classList.add('is-dragging');
  });

  stage.finalBuffer.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const point = canvasPoint(event, stage.finalBuffer);
    const start = dragging.startPatch;
    let patch;
    if (dragging.mode === 'translate') {
      const local = transformPoint(dragging.parentMatrix, point);
      let x = (start.x ?? 0) + local.x - dragging.localStart.x;
      let y = (start.y ?? 0) + local.y - dragging.localStart.y;
      if (view.snap && !event.altKey) {
        x = Math.round(x / SNAP_STEP) * SNAP_STEP;
        y = Math.round(y / SNAP_STEP) * SNAP_STEP;
      }
      patch = {x, y};
    } else if (dragging.mode === 'scale') {
      const center = dragging.startGeometry.center;
      const startDistance = Math.max(
        1,
        distance(dragging.startPoint, center),
      );
      let scale =
        (start.scale ?? 1) * (distance(point, center) / startDistance);
      if (view.snap && !event.altKey) scale = Math.round(scale * 20) / 20;
      patch = {scale};
    } else {
      const center = dragging.startGeometry.center;
      const startAngle = Math.atan2(
        dragging.startPoint.y - center.y,
        dragging.startPoint.x - center.x,
      );
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      const angleDelta = Math.atan2(
        Math.sin(angle - startAngle),
        Math.cos(angle - startAngle),
      );
      let rotation =
        (start.rotation ?? 0) + (angleDelta * 180) / Math.PI;
      if (view.snap && !event.altKey) rotation = Math.round(rotation / 5) * 5;
      patch = {rotation};
    }
    const nextDocument = patchDocument(
      dragging.startDocument,
      dragging.sceneId,
      dragging.nodeKey,
      dragging.fingerprint,
      {...dragging.startPatch, ...patch},
    );
    const changed =
      JSON.stringify(nextDocument) !==
      JSON.stringify(dragging.startDocument);
    overridesDocument = nextDocument;
    modifierIndex = buildModifierIndex(overridesDocument);
    dirtyRevision = changed
      ? dragging.startDirtyRevision + 1
      : dragging.startDirtyRevision;
    dragging.changed = changed;
    reviewedRevision = -1;
    player.requestRender();
    emitDocumentChanged(`drag-${dragging.mode}`, true);
  });

  function finishDrag(cancel = false) {
    if (!dragging) return;
    const finished = dragging;
    dragging = null;
    stage.finalBuffer.classList.remove('is-dragging');
    if (stage.finalBuffer.hasPointerCapture?.(finished.pointerId)) {
      stage.finalBuffer.releasePointerCapture(finished.pointerId);
    }
    if (cancel) {
      overridesDocument = finished.startDocument;
      modifierIndex = buildModifierIndex(overridesDocument);
      dirtyRevision = finished.startDirtyRevision;
      player.requestRender();
      emitDocumentChanged('drag-cancelled', true);
      return;
    }
    if (finished.changed) {
      history.push(finished.startDocument);
      if (history.length > 100) history.shift();
      future.length = 0;
      refreshButtons();
      postState();
      emitDocumentChanged(`drag-${finished.mode}`, false);
    }
  }
  stage.finalBuffer.addEventListener('pointerup', event => {
    if (dragging?.pointerId === event.pointerId) finishDrag(false);
  });
  stage.finalBuffer.addEventListener('pointercancel', event => {
    if (dragging?.pointerId === event.pointerId) finishDrag(true);
  });
  stage.finalBuffer.addEventListener('lostpointercapture', event => {
    if (dragging?.pointerId === event.pointerId) finishDrag(true);
  });

  function handleParentCommand(event) {
    if (!protocol.accepts(event)) return;
    const {type, payload = {}} = event.data;
    if (type === 'requestReady') {
      if (readyPayload) {
        protocol.post('ready', deepClone(readyPayload));
      }
      return;
    }
    if (dragging) {
      if (type === 'dispose') {
        finishDrag(true);
        dispose();
      }
      return;
    }
    if (type === 'init' || type === 'loadDocument') {
      replaceDocument(payload.document ?? payload, {
        record: false,
        dirty: false,
        reason: 'load-document',
      });
      normalizeKnownInternalOverrides();
      if (payload.view) setViewPatch(payload.view);
    } else if (type === 'play') {
      player.togglePlayback(true);
    } else if (type === 'pause') {
      player.togglePlayback(false);
    } else if (type === 'toggle') {
      player.togglePlayback();
    } else if (type === 'seek') {
      seekTo(payload.frame ?? payload);
    } else if (type === 'seekBy') {
      if (Number.isFinite(Number(payload.frames))) {
        seekTo(currentFrame + Number(payload.frames));
      } else {
        seekBySeconds(Number(payload.seconds ?? payload));
      }
    } else if (type === 'mute') {
      const desired = Boolean(payload.muted);
      if (desired !== player.onStateChanged.current.muted) {
        player.toggleAudio();
      }
    } else if (type === 'select' || type === 'setSelected') {
      if (payload.sceneId && payload.sceneId !== currentSceneInfo().sceneId) {
        const scene = scenes.find(
          item => sceneInfo(item).sceneId === payload.sceneId,
        );
        if (scene) {
          pendingSelection = {
            sceneId: payload.sceneId,
            nodeKey: payload.nodeKey ?? payload.nodeId ?? null,
          };
          selected = null;
          selectedGeometry = null;
          postSelection();
          player.requestSeek(scene.firstFrame);
        }
      } else {
        selectNode(payload.nodeKey ?? payload.nodeId ?? null);
      }
    } else if (type === 'patch' || type === 'patchSelected') {
      patchSelection(payload.patch ?? payload, {
        reason: 'inspector',
        force:
          Object.keys(payload.patch ?? payload).every(
            key => key === 'editorLocked',
          ),
      });
    } else if (type === 'reset' || type === 'resetSelected') {
      if (payload.scope === 'all') {
        replaceDocument(
          {...overridesDocument, overrides: []},
          {reason: 'reset-all'},
        );
      } else if (payload.scope === 'scene') {
        replaceDocument(
          {
            ...overridesDocument,
            overrides: overridesDocument.overrides.filter(
              item => item.sceneId !== currentSceneInfo().sceneId,
            ),
          },
          {reason: 'reset-scene'},
        );
      } else {
        resetSelection();
      }
    } else if (type === 'undo') {
      undo();
    } else if (type === 'redo') {
      redo();
    } else if (
      type === 'set-view' ||
      type === 'setView' ||
      type === 'compareOriginal' ||
      type === 'cleanPreview'
    ) {
      if (type === 'compareOriginal') {
        setViewPatch({original: Boolean(payload.enabled ?? payload)});
      } else if (type === 'cleanPreview') {
        setViewPatch({clean: Boolean(payload.enabled ?? payload)});
      } else {
        setViewPatch(payload);
      }
    } else if (type === 'commit') {
      protocol.post('commit', {
        document: deepClone(overridesDocument),
        overrides: deepClone(overridesDocument.overrides),
        dirtyRevision,
      });
    } else if (type === 'mark-reviewed' || type === 'markReviewed') {
      reviewedRevision = dirtyRevision;
      protocol.post('reviewed', {
        dirtyRevision,
        duration,
        method: 'parent-confirmation',
      });
    } else if (type === 'requestState') {
      postState({scenes: sceneSummaries()});
      postSelection();
    } else if (type === 'dispose') {
      dispose();
    }
  }
  window.addEventListener('message', handleParentCommand);

  window.addEventListener('keydown', event => {
    if (dragging) {
      event.preventDefault();
      if (event.code === 'Escape') {
        finishDrag(true);
      }
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target?.isContentEditable
    ) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (command && event.code === 'KeyY') {
      event.preventDefault();
      redo();
    } else if (command && event.code === 'KeyC') {
      event.preventDefault();
      protocol.post('shortcut', {action: 'copy'});
    } else if (command && event.code === 'KeyV') {
      event.preventDefault();
      protocol.post('shortcut', {action: 'paste'});
    } else if (command && event.code === 'KeyS') {
      event.preventDefault();
      protocol.post('shortcut', {action: 'save'});
    } else if (!command && event.key === '?') {
      event.preventDefault();
      protocol.post('shortcut', {action: 'help'});
    } else if (!command && event.code === 'KeyJ') {
      event.preventDefault();
      seekBySeconds(-5);
    } else if (!command && event.code === 'KeyK') {
      event.preventDefault();
      player.togglePlayback();
    } else if (!command && event.code === 'KeyL') {
      event.preventDefault();
      seekBySeconds(5);
    } else if (!command && event.code === 'Comma') {
      event.preventDefault();
      player.requestPreviousFrame();
    } else if (!command && event.code === 'Period') {
      event.preventDefault();
      player.requestNextFrame();
    } else if (!command && event.code === 'Home') {
      event.preventDefault();
      seekTo(0);
    } else if (!command && event.code === 'End') {
      event.preventDefault();
      seekTo(duration);
    } else if (!command && event.altKey && event.code === 'ArrowLeft') {
      event.preventDefault();
      seekBySeconds(event.shiftKey ? -5 : -1);
    } else if (!command && event.altKey && event.code === 'ArrowRight') {
      event.preventDefault();
      seekBySeconds(event.shiftKey ? 5 : 1);
    } else if (event.code === 'Space') {
      event.preventDefault();
      player.togglePlayback();
    } else if (event.code === 'Delete' || event.code === 'Backspace') {
      event.preventDefault();
      patchSelection({hidden: true}, {reason: 'hide-selected'});
    } else if (event.code === 'Escape') {
      event.preventDefault();
      selectNode(null);
    } else if (!command && event.code === 'KeyH') {
      event.preventDefault();
      patchSelection(
        {hidden: !currentOverride()?.patch.hidden},
        {reason: 'toggle-hidden'},
      );
    } else if (!command && event.code === 'KeyR') {
      event.preventDefault();
      resetSelection();
    } else if (!command && event.code === 'BracketRight') {
      event.preventDefault();
      changeSelectionLayer(1);
    } else if (!command && event.code === 'BracketLeft') {
      event.preventDefault();
      changeSelectionLayer(-1);
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      if (!nudgeSelection('x', event.shiftKey ? -10 : -1)) {
        player.requestPreviousFrame();
      }
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      if (!nudgeSelection('x', event.shiftKey ? 10 : 1)) {
        player.requestNextFrame();
      }
    } else if (event.code === 'ArrowUp') {
      if (selected) {
        event.preventDefault();
        nudgeSelection('y', event.shiftKey ? -10 : -1);
      }
    } else if (event.code === 'ArrowDown') {
      if (selected) {
        event.preventDefault();
        nudgeSelection('y', event.shiftKey ? 10 : 1);
      }
    } else if (!command && /^Digit[1-9]$/.test(event.code)) {
      const scene = scenes[Number(event.code.at(-1)) - 1];
      if (scene) {
        event.preventDefault();
        selected = null;
        selectedGeometry = null;
        postSelection();
        player.requestSeek(scene.firstFrame);
      }
    }
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', handleParentCommand);
    for (const disposeValue of disposers) disposeValue();
    player.deactivate();
  }
  window.addEventListener('beforeunload', dispose, {once: true});

  refreshButtons();
  player.requestRender();
  try {
    await player.run();
    if (!disposed) player.activate();
  } catch (error) {
    reportError(error, 'player-run');
  }
}

export function editor(project) {
  void startEditor(project).catch(error => {
    const root = document.querySelector('#root');
    const panel = element('section', 'layout-bootstrap-error');
    panel.append(
      element('strong', '', 'Không thể mở Layout Editor'),
      element(
        'p',
        '',
        error instanceof Error ? error.message : String(error),
      ),
    );
    root?.replaceChildren(panel);
    const context = readEditorContext();
    createProtocol(context).post('error', {
      message: error instanceof Error ? error.message : String(error),
      phase: 'startup',
    });
  });
}

export function index() {
  const root = document.querySelector('#root');
  if (root) {
    root.textContent = 'Không tìm thấy Motion Canvas project để chỉnh layout.';
  }
}
