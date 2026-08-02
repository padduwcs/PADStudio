const GENERATED_NODE_KEY = /\/[A-Za-z][A-Za-z0-9]*\[\d+\]$/;
const INTERNAL_TEXT_LEAF_KEY = /\/TxtLeaf\[\d+\]$/;

export function isGeneratedEditorNodeKey(key) {
  return GENERATED_NODE_KEY.test(String(key ?? ''));
}

export function inferEditorNodeRole(node, hasChildren = false) {
  const key = String(node?.key ?? '');
  if (key === 'scene-background') return 'background';
  if (key === 'scene-content-root') return 'content';
  if (
    key.startsWith('block-') ||
    key.endsWith('-block') ||
    (hasChildren &&
      (key.endsWith('-group') || key.endsWith('-panel')))
  ) {
    return 'block';
  }
  return 'element';
}

export function blockAncestor(nodes, nodeKey) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  let current = byKey.get(nodeKey);
  const visited = new Set();
  while (current && !visited.has(current.key)) {
    visited.add(current.key);
    if (current.role === 'block' || current.role === 'content') return current;
    current = current.parentKey ? byKey.get(current.parentKey) : null;
  }
  return null;
}

export function isInternalEditorNode(node) {
  if (!node) return false;
  return (
    node.nodeType === 'TxtLeaf' ||
    node.constructor?.name === 'TxtLeaf' ||
    INTERNAL_TEXT_LEAF_KEY.test(String(node.key ?? ''))
  );
}

export function resolveLiveEditorNodeTarget(requested) {
  if (!requested) return null;
  let current = requested;
  const visited = new Set();
  while (
    current &&
    isInternalEditorNode(current) &&
    !visited.has(current.key)
  ) {
    visited.add(current.key);
    const parent = current.parent?.();
    if (!parent) break;
    current = parent;
  }
  return current ?? requested;
}

export function isEditorNodeTimelineVisible(node, epsilon = 0.0001) {
  if (!node) return false;
  try {
    const opacity =
      typeof node.absoluteOpacity === 'function'
        ? Number(node.absoluteOpacity())
        : typeof node.opacity === 'function'
          ? Number(node.opacity())
          : null;
    if (opacity === null || !Number.isFinite(opacity)) return true;
    return opacity > epsilon;
  } catch {
    // If a custom node cannot expose its live opacity, keep it available
    // instead of incorrectly locking the user out of the editor.
    return true;
  }
}

export function editorGeometryContainsPoint(geometry, point) {
  const corners = geometry?.corners;
  if (
    !Array.isArray(corners) ||
    corners.length < 3 ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = corners.length - 1; index < corners.length; previous = index++) {
    const currentPoint = corners[index];
    const previousPoint = corners[previous];
    if (
      !Number.isFinite(currentPoint?.x) ||
      !Number.isFinite(currentPoint?.y) ||
      !Number.isFinite(previousPoint?.x) ||
      !Number.isFinite(previousPoint?.y)
    ) {
      return false;
    }
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function editorGeometryArea(geometry) {
  const corners = geometry?.corners;
  if (!Array.isArray(corners) || corners.length < 3) return Infinity;
  let twiceArea = 0;
  for (let index = 0; index < corners.length; index++) {
    const current = corners[index];
    const next = corners[(index + 1) % corners.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  const area = Math.abs(twiceArea) / 2;
  return Number.isFinite(area) && area > 0 ? area : Infinity;
}

export function chooseEditorNodeHitTarget(candidates, point) {
  return (
    candidates
      .map((candidate, index) => ({
        candidate,
        index,
        area: editorGeometryArea(candidate.geometry),
        textPriority: /^Txt(?:Leaf)?$/.test(String(candidate.nodeType ?? ''))
          ? 0
          : 1,
      }))
      .filter(item =>
        editorGeometryContainsPoint(item.candidate.geometry, point),
      )
      .sort(
        (left, right) =>
          left.textPriority - right.textPriority ||
          left.area - right.area ||
          right.index - left.index,
      )[0]?.candidate ?? null
  );
}

export function resolveCanonicalEditorNodeKey(nodes, nodeKey) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const original = byKey.get(nodeKey);
  if (!original) return nodeKey;
  let current = original;
  const visited = new Set();
  while (
    current &&
    isInternalEditorNode(current) &&
    current.parentKey &&
    !visited.has(current.key)
  ) {
    visited.add(current.key);
    const parent = byKey.get(current.parentKey);
    if (!parent) break;
    current = parent;
  }
  return current && !isInternalEditorNode(current) ? current.key : nodeKey;
}

export function canonicalizeEditorNodes(nodes) {
  const aliases = new Map();
  for (const node of nodes) {
    const canonicalKey = resolveCanonicalEditorNodeKey(nodes, node.key);
    if (canonicalKey !== node.key) aliases.set(node.key, canonicalKey);
  }
  const canonicalNodes = nodes
    .filter(node => !aliases.has(node.key))
    .map(node => {
      if (!node.parentKey) return node;
      const parentKey = aliases.get(node.parentKey) ?? node.parentKey;
      return parentKey === node.parentKey ? node : {...node, parentKey};
    });
  return {nodes: canonicalNodes, aliases};
}

export function mergeEditorNodePolicy(discovered, previous) {
  if (!previous) return discovered;
  const editableProperties = [
    ...new Set([
      ...(discovered.editableProperties ?? []),
      ...(previous.editableProperties ?? []),
    ]),
  ];
  const editable = new Set(editableProperties);
  const lockedProperties = [
    ...new Set([
      ...(discovered.lockedProperties ?? []),
      ...(previous.lockedProperties ?? []),
    ]),
  ].filter(property => editable.has(property));
  return {
    ...discovered,
    editableProperties,
    lockedProperties,
    lockReason:
      lockedProperties.length > 0
        ? discovered.lockReason ?? previous.lockReason
        : null,
  };
}

export function migrateInternalNodeOverrides(
  document,
  sceneId,
  aliases,
  canonicalNodes,
) {
  if (!document?.overrides?.length || aliases.size === 0) return document;
  const canonicalByKey = new Map(
    canonicalNodes.map(node => [node.key, node]),
  );
  const mergedIndices = new Map();
  const overrides = [];
  let changed = false;

  for (const override of document.overrides) {
    const alias =
      override.sceneId === sceneId
        ? aliases.get(override.nodeKey)
        : undefined;
    const target = alias ? canonicalByKey.get(alias) : null;
    const editable = target
      ? new Set(target.editableProperties ?? [])
      : null;
    const locked = target
      ? new Set(target.lockedProperties ?? [])
      : null;
    const patch = target
      ? Object.fromEntries(
          Object.entries(override.patch).filter(
            ([property]) =>
              property === 'editorLocked' ||
              (editable.has(property) && !locked.has(property)),
          ),
        )
      : override.patch;
    const next = target
      ? {
          ...override,
          nodeKey: target.key,
          nodeFingerprint: target.fingerprint,
          patch,
        }
      : override;
    if (next !== override) changed = true;
    if (Object.keys(next.patch).length === 0) {
      changed = true;
      continue;
    }

    const mergeKey = `${next.sceneId}\u0000${next.nodeKey}`;
    const existingIndex = mergedIndices.get(mergeKey);
    if (existingIndex === undefined) {
      mergedIndices.set(mergeKey, overrides.length);
      overrides.push(next);
      continue;
    }
    const existing = overrides[existingIndex];
    const animations = new Map(
      [
        ...(existing.animations ?? []),
        ...(next.animations ?? []),
      ].map(track => [track.property, track]),
    );
    overrides[existingIndex] = {
      ...existing,
      nodeFingerprint: next.nodeFingerprint,
      patch: {...existing.patch, ...next.patch},
      ...(next.visibility?.length
        ? {visibility: next.visibility}
        : {}),
      ...(animations.size > 0
        ? {animations: [...animations.values()]}
        : {}),
    };
    changed = true;
  }

  return changed ? {...document, overrides} : document;
}
