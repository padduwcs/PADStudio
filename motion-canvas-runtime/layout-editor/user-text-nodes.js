import {Txt} from '@motion-canvas/2d';
import {isUserTextNodeKey} from './modifier-model.js';

const DEFAULT_FONT_FAMILY = 'Times New Roman, Times, serif';
const sceneRegistries = new WeakMap();

function registryFor(scene) {
  let registry = sceneRegistries.get(scene);
  if (!registry) {
    registry = new Map();
    sceneRegistries.set(scene, registry);
  }
  return registry;
}

function createTextNode(scene, override) {
  const create = () =>
    new Txt({
      key: override.nodeKey,
      text: '',
      position: [0, 0],
      scale: 1,
      rotation: 0,
      opacity: 1,
      fill: '#FFFFFF',
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: 64,
      fontWeight: 400,
      zIndex: 0,
    });
  const node =
    typeof scene.execute === 'function' ? scene.execute(create) : create();
  scene.getView().add(node);
  return node;
}

/**
 * Keep editor-owned text nodes attached to a Motion Canvas scene.
 *
 * The source scene stays immutable: these nodes are reconstructed from the
 * override document after every scene reset and are removed as soon as their
 * document entry is deleted.
 */
export function reconcileUserTextNodes(scene, document, options = {}) {
  if (!scene || typeof scene.getView !== 'function') return [];
  const sceneId = options.sceneId ?? scene.name;
  const desired = new Map(
    (document?.overrides ?? [])
      .filter(
        override =>
          override.sceneId === sceneId &&
          isUserTextNodeKey(override.nodeKey),
      )
      .map(override => [override.nodeKey, override]),
  );
  const registry = registryFor(scene);

  for (const [nodeKey, node] of registry) {
    const liveNode =
      typeof scene.getNode === 'function' ? scene.getNode(nodeKey) : null;
    if (desired.has(nodeKey) && liveNode === node) continue;
    try {
      node.remove?.();
      node.dispose?.();
    } catch {
      // A scene reset may already have disposed this instance.
    }
    registry.delete(nodeKey);
  }

  const result = [];
  for (const [nodeKey, override] of desired) {
    let node =
      typeof scene.getNode === 'function' ? scene.getNode(nodeKey) : null;
    if (!node) node = createTextNode(scene, override);
    registry.set(nodeKey, node);
    result.push(node);
  }
  return result;
}
