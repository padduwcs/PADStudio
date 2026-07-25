const MAX_TRANSLATE = 100_000;
const MAX_SCALE = 20;
const MAX_ROTATION = 3_600;
const MAX_Z_INDEX = 1_000;
const MAX_STROKE_WIDTH = 200;
const FONT_FAMILIES = new Set([
  'Arial, sans-serif',
  'Segoe UI, Arial, sans-serif',
  'Verdana, Arial, sans-serif',
  'Tahoma, Arial, sans-serif',
  'Trebuchet MS, Arial, sans-serif',
  'Georgia, Times New Roman, serif',
  'Times New Roman, Times, serif',
  'Courier New, Consolas, monospace',
  'Cascadia Code, Consolas, monospace',
  'Consolas, Courier New, monospace',
  'Impact, Arial Black, sans-serif',
  'Arial Black, Arial, sans-serif',
]);
const FONT_WEIGHTS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);
const FONT_STYLES = new Set(['normal', 'italic']);

const HEX_COLOR = /^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/;
const USER_TEXT_NODE_KEY = /^user-text:[0-9a-f-]{36}$/i;
const VISIBILITY_TIME_EPSILON = 1 / 240;

function finite(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalColor(value) {
  if (value === null) return null;
  return typeof value === 'string' && HEX_COLOR.test(value)
    ? value.toUpperCase()
    : undefined;
}

export function normalizePatch(value = {}) {
  const result = {};
  if (value.x !== undefined) {
    result.x = finite(value.x, 0, -MAX_TRANSLATE, MAX_TRANSLATE);
  }
  if (value.y !== undefined) {
    result.y = finite(value.y, 0, -MAX_TRANSLATE, MAX_TRANSLATE);
  }
  if (value.scale !== undefined) {
    result.scale = finite(value.scale, 1, 0.05, MAX_SCALE);
  }
  if (value.rotation !== undefined) {
    result.rotation = finite(value.rotation, 0, -MAX_ROTATION, MAX_ROTATION);
  }
  if (value.opacity !== undefined) {
    result.opacity = finite(value.opacity, 1, 0, 1);
  }
  if (value.hidden !== undefined) result.hidden = value.hidden === true;
  const fill = optionalColor(value.fill);
  if (fill !== undefined) result.fill = fill;
  const stroke = optionalColor(value.stroke);
  if (stroke !== undefined) result.stroke = stroke;
  if (value.strokeWidth !== undefined) {
    result.strokeWidth = finite(
      value.strokeWidth,
      0,
      0,
      MAX_STROKE_WIDTH,
    );
  }
  if (value.zIndexDelta !== undefined) {
    result.zIndexDelta = Math.round(
      finite(value.zIndexDelta, 0, -MAX_Z_INDEX, MAX_Z_INDEX),
    );
  }
  if (typeof value.text === 'string') {
    result.text = value.text;
  }
  if (FONT_FAMILIES.has(value.fontFamily)) {
    result.fontFamily = value.fontFamily;
  }
  if (value.fontSize !== undefined) {
    result.fontSize = finite(value.fontSize, 48, 8, 500);
  }
  if (FONT_WEIGHTS.has(value.fontWeight)) {
    result.fontWeight = value.fontWeight;
  }
  if (FONT_STYLES.has(value.fontStyle)) {
    result.fontStyle = value.fontStyle;
  }
  if (value.underline !== undefined) {
    result.underline = value.underline === true;
  }
  if (value.strikethrough !== undefined) {
    result.strikethrough = value.strikethrough === true;
  }
  if (value.editorLocked !== undefined) {
    result.editorLocked = value.editorLocked === true;
  }
  return removeIdentityValues(result);
}

function removeIdentityValues(patch) {
  const result = {...patch};
  if (result.x === 0) delete result.x;
  if (result.y === 0) delete result.y;
  if (result.scale === 1) delete result.scale;
  if (result.rotation === 0) delete result.rotation;
  if (result.opacity === 1) delete result.opacity;
  if (result.hidden === false) delete result.hidden;
  if (result.zIndexDelta === 0) delete result.zIndexDelta;
  if (result.underline === false) delete result.underline;
  if (result.strikethrough === false) delete result.strikethrough;
  if (result.editorLocked === false) delete result.editorLocked;
  return result;
}

function normalizeOverride(value) {
  if (!value || typeof value !== 'object') return null;
  const sceneId = typeof value.sceneId === 'string' ? value.sceneId : '';
  const nodeKey =
    typeof value.nodeKey === 'string'
      ? value.nodeKey
      : typeof value.nodeId === 'string'
        ? value.nodeId
        : '';
  const nodeFingerprint =
    typeof value.nodeFingerprint === 'string'
      ? value.nodeFingerprint
      : typeof value.fingerprint === 'string'
        ? value.fingerprint
        : '';
  if (!sceneId || !nodeKey) return null;
  const patch = normalizePatch(value.patch ?? value);
  const visibility = normalizeVisibilityTrack(value.visibility);
  if (Object.keys(patch).length === 0 && visibility.length === 0) return null;
  return {
    sceneId,
    nodeKey,
    nodeFingerprint,
    patch,
    ...(visibility.length > 0 ? {visibility} : {}),
  };
}

export function isUserTextNodeKey(nodeKey) {
  return typeof nodeKey === 'string' && USER_TEXT_NODE_KEY.test(nodeKey);
}

export function normalizeVisibilityTrack(value) {
  if (!Array.isArray(value)) return [];
  const sorted = value
    .filter(
      keyframe =>
        keyframe &&
        typeof keyframe === 'object' &&
        Number.isFinite(keyframe.timeSeconds) &&
        keyframe.timeSeconds >= 0 &&
        typeof keyframe.hidden === 'boolean',
    )
    .map(keyframe => ({
      timeSeconds: Math.min(
        86_400,
        Math.round(keyframe.timeSeconds * 1_000) / 1_000,
      ),
      hidden: keyframe.hidden,
    }))
    .sort((left, right) => left.timeSeconds - right.timeSeconds);
  const unique = [];
  for (const keyframe of sorted) {
    const previous = unique.at(-1);
    if (
      previous &&
      Math.abs(previous.timeSeconds - keyframe.timeSeconds) <=
        VISIBILITY_TIME_EPSILON
    ) {
      unique[unique.length - 1] = keyframe;
    } else {
      unique.push(keyframe);
    }
  }
  return unique.slice(0, 500);
}

export function visibilityAtTime(visibility, timeSeconds) {
  if (!Array.isArray(visibility) || visibility.length === 0) return null;
  const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  let state = null;
  for (const keyframe of visibility) {
    if (keyframe.timeSeconds > time + VISIBILITY_TIME_EPSILON) break;
    state = keyframe.hidden;
  }
  return state;
}

export function normalizeDocument(value, source = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const flatInput = Array.isArray(input.overrides)
    ? input.overrides
    : Array.isArray(input.scenes)
      ? input.scenes.flatMap(scene =>
          (scene.nodes ?? []).map(node => ({
            ...node,
            sceneId: scene.sceneId,
          })),
        )
      : [];
  return {
    version: 1,
    sourceAnimationSyncGenerationId:
      typeof input.sourceAnimationSyncGenerationId === 'string'
        ? input.sourceAnimationSyncGenerationId
        : source.generationId ?? '',
    sourceAnimationSyncContentRevision:
      Number.isInteger(input.sourceAnimationSyncContentRevision) &&
      input.sourceAnimationSyncContentRevision > 0
        ? input.sourceAnimationSyncContentRevision
        : source.contentRevision ?? 0,
    sourceAnimationSyncSourceHash:
      typeof input.sourceAnimationSyncSourceHash === 'string'
        ? input.sourceAnimationSyncSourceHash
        : source.sourceHash ?? '',
    overrides: flatInput.map(normalizeOverride).filter(Boolean),
  };
}

export function buildModifierIndex(document) {
  const index = new Map();
  for (const override of document.overrides ?? []) {
    index.set(`${override.sceneId}\u0000${override.nodeKey}`, override);
  }
  return index;
}

export function getOverride(index, sceneId, nodeKey) {
  return index.get(`${sceneId}\u0000${nodeKey}`) ?? null;
}

export function patchDocument(
  document,
  sceneId,
  nodeKey,
  nodeFingerprint,
  patch,
) {
  const normalized = normalizeDocument(document);
  const index = buildModifierIndex(normalized);
  const current = getOverride(index, sceneId, nodeKey);
  const mergedInput = {...(current?.patch ?? {}), ...(patch ?? {})};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null && key !== 'fill' && key !== 'stroke') {
      delete mergedInput[key];
    }
  }
  const nextPatch = normalizePatch(mergedInput);
  const targetIndex = normalized.overrides.findIndex(
    item => item.sceneId === sceneId && item.nodeKey === nodeKey,
  );
  const overrides = [...normalized.overrides];
  if (Object.keys(nextPatch).length > 0) {
    const nextOverride = {
      sceneId,
      nodeKey,
      nodeFingerprint: nodeFingerprint || current?.nodeFingerprint || '',
      patch: nextPatch,
      ...(current?.visibility?.length
        ? {visibility: current.visibility}
        : {}),
    };
    if (targetIndex >= 0) overrides[targetIndex] = nextOverride;
    else overrides.push(nextOverride);
  } else if (targetIndex >= 0) {
    overrides.splice(targetIndex, 1);
  }
  return {...normalized, overrides};
}

export function patchVisibilityDocument(
  document,
  sceneId,
  nodeKey,
  nodeFingerprint,
  timeSeconds,
  hidden,
) {
  const normalized = normalizeDocument(document);
  const index = buildModifierIndex(normalized);
  const current = getOverride(index, sceneId, nodeKey);
  const nextTime = Math.max(
    0,
    Math.round((Number(timeSeconds) || 0) * 1_000) / 1_000,
  );
  const nextVisibility = normalizeVisibilityTrack([
    ...(current?.visibility ?? []).filter(
      keyframe =>
        Math.abs(keyframe.timeSeconds - nextTime) >
        VISIBILITY_TIME_EPSILON,
    ),
    {timeSeconds: nextTime, hidden: hidden === true},
  ]);
  const compactVisibility = nextVisibility.filter(
    (keyframe, index, keyframes) =>
      index === 0 || keyframes[index - 1]?.hidden !== keyframe.hidden,
  );
  const targetIndex = normalized.overrides.findIndex(
    item => item.sceneId === sceneId && item.nodeKey === nodeKey,
  );
  const overrides = [...normalized.overrides];
  const nextOverride = {
    sceneId,
    nodeKey,
    nodeFingerprint: nodeFingerprint || current?.nodeFingerprint || '',
    patch: current?.patch ?? {},
    visibility: compactVisibility,
  };
  if (targetIndex >= 0) overrides[targetIndex] = nextOverride;
  else overrides.push(nextOverride);
  return {...normalized, overrides};
}

export function clearVisibilityDocument(document, sceneId, nodeKey) {
  const normalized = normalizeDocument(document);
  const overrides = normalized.overrides.flatMap(override => {
    if (override.sceneId !== sceneId || override.nodeKey !== nodeKey) {
      return [override];
    }
    if (Object.keys(override.patch ?? {}).length === 0) return [];
    const {visibility: _visibility, ...withoutVisibility} = override;
    return [withoutVisibility];
  });
  return {...normalized, overrides};
}

export function resetDocumentNode(document, sceneId, nodeKey) {
  const normalized = normalizeDocument(document);
  return {
    ...normalized,
    overrides: normalized.overrides.filter(
      item => item.sceneId !== sceneId || item.nodeKey !== nodeKey,
    ),
  };
}

function rawOf(signal) {
  return signal?.context && typeof signal.context.raw === 'function'
    ? signal.context.raw()
    : signal();
}

function setSignal(node, key, value, restorers) {
  const signal = node?.[key];
  if (typeof signal !== 'function') return false;
  const raw = rawOf(signal);
  signal(value);
  restorers.push(() => signal(raw));
  return true;
}

function vectorComponents(value) {
  if (Array.isArray(value)) return {x: value[0] ?? 0, y: value[1] ?? 0};
  return {x: value?.x ?? 0, y: value?.y ?? 0};
}

function installLayoutPositionOffset(node, x, y, restorers) {
  // Flex descendants ignore their raw position signal and instead render from
  // Layout.computedPosition(). Offset the resolved local matrix so the node can
  // move independently without removing it from the flex flow or reflowing its
  // siblings.
  if (
    typeof node?.isLayoutRoot !== 'function' ||
    node.isLayoutRoot() !== false ||
    typeof node.localToParent !== 'function'
  ) {
    return false;
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    node,
    'localToParent',
  );
  const originalLocalToParent = node.localToParent;
  try {
    Object.defineProperty(node, 'localToParent', {
      configurable: true,
      writable: true,
      value(...args) {
        const matrix = originalLocalToParent.apply(this, args);
        const translated = new matrix.constructor(matrix);
        translated.e = Number(matrix.e) + x;
        translated.f = Number(matrix.f) + y;
        return translated;
      },
    });
    // Computed transforms cache localToWorld all the way down the subtree.
    // Explicit invalidation makes the temporary matrix visible to geometry,
    // hit-testing, and rendering even when no visual signal changed.
    originalLocalToParent.context?.markDirty?.();
  } catch {
    return false;
  }
  restorers.push(() => {
    if (originalDescriptor) {
      Object.defineProperty(node, 'localToParent', originalDescriptor);
    } else {
      delete node.localToParent;
    }
    originalLocalToParent.context?.markDirty?.();
  });
  return true;
}

export function applyOverride(node, override, options = {}) {
  if (!node || !override) return () => {};
  const patch = override.patch ?? override;
  const restorers = [];
  try {
    if (
      (patch.x !== undefined || patch.y !== undefined) &&
      typeof node.position === 'function'
    ) {
      const x = patch.x ?? 0;
      const y = patch.y ?? 0;
      const layoutManaged = installLayoutPositionOffset(
        node,
        x,
        y,
        restorers,
      );
      if (!layoutManaged) {
        const base = vectorComponents(node.position());
        setSignal(
          node,
          'position',
          [base.x + x, base.y + y],
          restorers,
        );
      }
    }
    if (patch.scale !== undefined && typeof node.scale === 'function') {
      const base = vectorComponents(node.scale());
      setSignal(
        node,
        'scale',
        [base.x * patch.scale, base.y * patch.scale],
        restorers,
      );
    }
    if (patch.rotation !== undefined && typeof node.rotation === 'function') {
      setSignal(
        node,
        'rotation',
        Number(node.rotation()) + patch.rotation,
        restorers,
      );
    }
    if (patch.zIndexDelta !== undefined && typeof node.zIndex === 'function') {
      setSignal(
        node,
        'zIndex',
        Number(node.zIndex()) + patch.zIndexDelta,
        restorers,
      );
    }
    if (patch.text !== undefined) {
      setSignal(node, 'text', patch.text, restorers);
    }
    if (patch.fontFamily !== undefined) {
      setSignal(node, 'fontFamily', patch.fontFamily, restorers);
    }
    if (patch.fontSize !== undefined) {
      setSignal(node, 'fontSize', patch.fontSize, restorers);
    }
    if (patch.fontWeight !== undefined) {
      setSignal(node, 'fontWeight', patch.fontWeight, restorers);
    }
    if (patch.fontStyle !== undefined) {
      setSignal(node, 'fontStyle', patch.fontStyle, restorers);
    }
    if (patch.fill !== undefined) {
      setSignal(node, 'fill', patch.fill, restorers);
    }
    if (patch.stroke !== undefined) {
      setSignal(node, 'stroke', patch.stroke, restorers);
    }
    if (patch.strokeWidth !== undefined) {
      setSignal(node, 'lineWidth', patch.strokeWidth, restorers);
    }
    const timedHidden = visibilityAtTime(
      override.visibility,
      options.timeSeconds,
    );
    if (patch.hidden || timedHidden === true) {
      setSignal(node, 'opacity', 0, restorers);
    } else if (
      patch.opacity !== undefined &&
      typeof node.opacity === 'function'
    ) {
      const opacity = Math.min(
        1,
        Math.max(0, Number(node.opacity()) * patch.opacity),
      );
      setSignal(node, 'opacity', opacity, restorers);
    }
    if (options.capture) options.capture(node);
  } catch (error) {
    for (let index = restorers.length - 1; index >= 0; index--) {
      try {
        restorers[index]();
      } catch {
        // Preserve the original modifier error.
      }
    }
    throw error;
  }
  return () => {
    let firstError;
    for (let index = restorers.length - 1; index >= 0; index--) {
      try {
        restorers[index]();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };
}

export function applySceneOverrides(scene, document, options = {}) {
  if (!scene || options.original) return () => {};
  const sceneId = options.sceneId ?? scene.name;
  const sceneOverrides = (document.overrides ?? []).filter(
    override => override.sceneId === sceneId,
  );
  if (sceneOverrides.length === 0) return () => {};
  const restorers = [];
  try {
    for (const override of sceneOverrides) {
      const node =
        typeof scene.getNode === 'function'
          ? scene.getNode(override.nodeKey)
          : null;
      if (!node) continue;
      restorers.push(applyOverride(node, override, options));
    }
  } catch (error) {
    for (let index = restorers.length - 1; index >= 0; index--) {
      try {
        restorers[index]();
      } catch {
        // Preserve the original apply error.
      }
    }
    throw error;
  }
  return () => {
    let firstError;
    for (let index = restorers.length - 1; index >= 0; index--) {
      try {
        restorers[index]();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };
}

export function serializeSignalValue(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value.serialize === 'function') {
    try {
      return value.serialize();
    } catch {
      return String(value);
    }
  }
  if (typeof value.x === 'number' && typeof value.y === 'number') {
    return {x: value.x, y: value.y};
  }
  return String(value);
}

export function nodeFingerprintSource(node) {
  return [
    node?.constructor?.name ?? 'Node',
    node?.key ?? '',
    node?.parent?.()?.key ?? '',
  ].join('|');
}

export async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function editableProperties(node) {
  const properties = [
    'x',
    'y',
    'scale',
    'rotation',
    'opacity',
    'hidden',
    'zIndexDelta',
  ];
  if (typeof node?.fill === 'function') properties.push('fill');
  if (typeof node?.stroke === 'function') properties.push('stroke');
  if (typeof node?.lineWidth === 'function') properties.push('strokeWidth');
  if (typeof node?.text === 'function') {
    properties.push(
      'text',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'underline',
      'strikethrough',
    );
  }
  return properties;
}
