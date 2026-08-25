import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

/**
 * Root cause of the "no recognizable shape" complaint: earlier Scene Spec
 * versions asked the model to hand-author SVG bezier silhouettes (a leaf, a
 * patient, a car) as raw path data. LLMs cannot reliably draw recognizable
 * objects through freehand numeric path authoring, so every "designed"
 * illustration degenerated into the same generic blob. This module resolves
 * `icon` scene parts against two large, single-colour, MIT-licensed, modern
 * outline icon sets (Phosphor regular weight, Tabler) bundled offline via
 * @iconify-json, so the model only has to *choose* a real, professionally
 * drawn glyph instead of inventing one. Both sets share the same ~2px
 * stroke-outline visual weight, so mixed usage across parts/entities stays
 * stylistically consistent (unlike the earlier MDI-filled + Phosphor-outline
 * mix, which read as dated and inconsistent).
 */

export const MOTION_CANVAS_ICON_PREFIXES = ['ph', 'tabler'] as const;
export type MotionCanvasIconPrefix = typeof MOTION_CANVAS_ICON_PREFIXES[number];

interface IconifyIconEntry {
  body: string;
  width?: number;
  height?: number;
}

interface IconifyIconSet {
  prefix: string;
  width?: number;
  height?: number;
  icons: Record<string, IconifyIconEntry>;
}

export interface ResolvedMotionCanvasIcon {
  /** Combined SVG path `d` data, in the icon's native viewBox units. */
  d: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
}

const ICON_SET_MODULE_SPECIFIERS: Record<MotionCanvasIconPrefix, string> = {
  ph: '@iconify-json/ph/icons.json',
  tabler: '@iconify-json/tabler/icons.json',
};

/** Non-regular-weight Phosphor variants (thin/light/bold/fill/duotone) and
 * Tabler's filled variants share the same base concept name as their
 * regular/outline counterpart under a suffix, so excluding them by name
 * keeps the vocabulary to one consistent stroke-outline style per concept
 * instead of the model having to guess which weight it meant. Verified
 * directly against the installed packages: Phosphor's regular weight is the
 * unsuffixed base name; Tabler's filled variants are suffixed "-filled".  */
const ICON_STYLE_VARIANT_EXCLUDE_PATTERN: Record<MotionCanvasIconPrefix, RegExp | null> = {
  ph: /-(?:thin|light|bold|fill|duotone)$/u,
  tabler: /-filled$/u,
};

const iconSetCache = new Map<MotionCanvasIconPrefix, IconifyIconSet>();
const resolvedIconCache = new Map<string, ResolvedMotionCanvasIcon | null>();

function loadIconSet(prefix: MotionCanvasIconPrefix): IconifyIconSet {
  const cached = iconSetCache.get(prefix);
  if (cached) return cached;
  const url = import.meta.resolve(ICON_SET_MODULE_SPECIFIERS[prefix]);
  const raw = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as IconifyIconSet;
  const excludePattern = ICON_STYLE_VARIANT_EXCLUDE_PATTERN[prefix];
  const set = excludePattern
    ? {...raw, icons: Object.fromEntries(Object.entries(raw.icons).filter(([name]) => !excludePattern.test(name)))}
    : raw;
  iconSetCache.set(prefix, set);
  return set;
}

const PATH_TAG_PATTERN = /<path\b[^>]*\sd="([^"]*)"[^>]*\/?>/giu;
const NON_PATH_TAG_PATTERN = /<(?!\/?path\b)[a-zA-Z][^>]*>/u;
/** Tabler bundles a multi-path icon's shared fill/stroke/stroke-width once
 * on a wrapping `<g>` rather than repeating them on every `<path>` (Phosphor
 * and single-path Tabler icons have no wrapper). Since this module always
 * re-draws the merged path data with one fill/stroke chosen by the caller
 * anyway, the wrapper's own attributes are irrelevant — only its grouping
 * needs to be seen through so the inner `<path>` elements are reachable. */
const GROUP_WRAPPER_PATTERN = /^<g\b[^>]*>([\s\S]*)<\/g>\s*$/u;

function unwrapGroupWrapper(body: string): string {
  const match = GROUP_WRAPPER_PATTERN.exec(body.trim());
  return match ? match[1]! : body;
}

/** Only glyphs expressible as one or more plain `<path d="...">` (optionally
 * wrapped in a single `<g>`) are safe to re-embed as a single Motion Canvas
 * `<Path data="...">`. A body containing any other element (e.g. `<circle>`,
 * `<rect>`, `<defs>`, a duotone overlay) is rejected rather than silently
 * dropping part of the icon. */
function pathDataFromIconBody(body: string): string | null {
  const inner = unwrapGroupWrapper(body);
  if (NON_PATH_TAG_PATTERN.test(inner)) return null;
  const segments = [...inner.matchAll(PATH_TAG_PATTERN)].map(match => match[1]!.trim()).filter(Boolean);
  return segments.length > 0 ? segments.join(' ') : null;
}

function parseIconId(iconId: string): {prefix: MotionCanvasIconPrefix; name: string} | null {
  const [prefix, ...rest] = iconId.split(':');
  const name = rest.join(':');
  if (!name || !(MOTION_CANVAS_ICON_PREFIXES as readonly string[]).includes(prefix ?? '')) return null;
  return {prefix: prefix as MotionCanvasIconPrefix, name};
}

/** Resolves `prefix:name` (e.g. `ph:leaf`) to real vector path data, or
 * `null` when the id is unknown or its glyph cannot be re-embedded safely. */
export function resolveMotionCanvasIcon(iconId: string): ResolvedMotionCanvasIcon | null {
  if (resolvedIconCache.has(iconId)) return resolvedIconCache.get(iconId)!;
  const resolved = (() => {
    const parsed = parseIconId(iconId);
    if (!parsed) return null;
    const set = loadIconSet(parsed.prefix);
    const entry = set.icons[parsed.name];
    if (!entry) return null;
    const d = pathDataFromIconBody(entry.body);
    if (!d) return null;
    return {
      d,
      viewBoxWidth: entry.width ?? set.width ?? 24,
      viewBoxHeight: entry.height ?? set.height ?? 24,
    };
  })();
  resolvedIconCache.set(iconId, resolved);
  return resolved;
}

export function isKnownMotionCanvasIconId(iconId: string): boolean {
  return resolveMotionCanvasIcon(iconId) !== null;
}

/** Cheap substring suggestions surfaced in repair diagnostics so a rejected
 * icon id can be corrected without an extra lookup round-trip. */
export function suggestMotionCanvasIconIds(query: string, limit = 5): string[] {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];
  const suggestions: string[] = [];
  for (const prefix of MOTION_CANVAS_ICON_PREFIXES) {
    const set = loadIconSet(prefix);
    for (const name of Object.keys(set.icons)) {
      if (name.includes(needle) || needle.includes(name)) {
        suggestions.push(`${prefix}:${name}`);
        if (suggestions.length >= limit) return suggestions;
      }
    }
  }
  return suggestions;
}

/**
 * Now that Codex authors Motion Canvas TSX directly instead of a declarative
 * spec, it can no longer rely on a backend compiler to resolve `iconId`
 * values into real path data. Every generated scene therefore imports a
 * small `Icon` component (see `generateMotionCanvasIconAtlasSource`) from
 * this fixed relative path and references icons by id through JSX, e.g.
 * `<Icon id="ph:leaf" ... />`. Scenes live at `src/scenes/NN-slug.tsx`, so
 * `../iconAtlas` resolves to the generated `src/iconAtlas.tsx`.
 */
export const MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER = '../iconAtlas';

/**
 * Walks a generated scene's TSX for every `<Icon id="..." />` reference so
 * callers can validate each id against the real icon library before writing
 * the scene, and so the workspace layer knows exactly which icons to bake
 * into the generated atlas file (see `generateMotionCanvasIconAtlasSource`).
 * Mirrors the JSX-walking pattern used by
 * `motionCanvasGenerator.ts`'s `validateSemanticLayoutKey`/
 * `staticJsxAttributeString`.
 */
export function extractReferencedMotionCanvasIconIds(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const iconIds = new Set<string>();

  function staticStringValue(initializer: ts.JsxAttribute['initializer']): string | null {
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isStringLiteral(initializer.expression)
    ) {
      return initializer.expression.text;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'Icon'
    ) {
      const idAttribute = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'id',
      );
      const value = idAttribute ? staticStringValue(idAttribute.initializer) : null;
      if (value) iconIds.add(value);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return [...iconIds];
}

/**
 * Emits the complete `.tsx` source for the generated per-workspace icon
 * atlas: one `Icon` component that resolves an id (e.g. `ph:leaf`) against a
 * baked table of real vector path data and renders it as a Motion Canvas
 * `<Path>`, reproducing the exact scaling math the old Scene Spec compiler's
 * icon primitive used (`motionCanvasSceneSpecV3.ts`'s `partSource`).
 */
export function generateMotionCanvasIconAtlasSource(iconIds: readonly string[]): string {
  const resolvedEntries = [...new Set(iconIds)]
    .sort()
    .map(id => ({id, icon: resolveMotionCanvasIcon(id)}))
    .filter((entry): entry is {id: string; icon: ResolvedMotionCanvasIcon} => entry.icon !== null);

  const rawIconEntries = resolvedEntries
    .map(({id, icon}) => `  ${JSON.stringify(id)}: {d: ${JSON.stringify(icon.d)}, viewBoxWidth: ${icon.viewBoxWidth}, viewBoxHeight: ${icon.viewBoxHeight}},`)
    .join('\n');

  return `import {Path} from '@motion-canvas/2d';

const rawIcons: Record<string, {d: string; viewBoxWidth: number; viewBoxHeight: number}> = {
${rawIconEntries}
};

export interface IconProps {
  id: string;
  key?: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  rotation?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export function Icon(props: IconProps) {
  const icon = rawIcons[props.id];
  if (!icon) {
    throw new Error(\`Unknown icon id "\${props.id}".\`);
  }
  const lineWidth = (props.strokeWidth ?? 0) * icon.viewBoxWidth / Math.max(props.width, props.height);
  return (
    <Path
      key={props.key}
      data={icon.d}
      x={props.x}
      y={props.y}
      scale={[props.width / icon.viewBoxWidth, props.height / icon.viewBoxHeight]}
      rotation={props.rotation}
      fill={props.fill}
      stroke={props.stroke}
      lineWidth={lineWidth}
      opacity={props.opacity}
    />
  );
}
`;
}
