import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * Root cause of the "no recognizable shape" complaint: earlier Scene Spec
 * versions asked the model to hand-author SVG bezier silhouettes (a leaf, a
 * patient, a car) as raw path data. LLMs cannot reliably draw recognizable
 * objects through freehand numeric path authoring, so every "designed"
 * illustration degenerated into the same generic blob. This module resolves
 * `icon` scene parts against two large, single-colour, MIT/Apache-licensed
 * icon sets (Material Design Icons, Phosphor) bundled offline via
 * @iconify-json, so the model only has to *choose* a real, professionally
 * drawn glyph instead of inventing one.
 */

export const MOTION_CANVAS_ICON_PREFIXES = ['mdi', 'ph'] as const;
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
  mdi: '@iconify-json/mdi/icons.json',
  ph: '@iconify-json/ph/icons.json',
};

const iconSetCache = new Map<MotionCanvasIconPrefix, IconifyIconSet>();
const resolvedIconCache = new Map<string, ResolvedMotionCanvasIcon | null>();

function loadIconSet(prefix: MotionCanvasIconPrefix): IconifyIconSet {
  const cached = iconSetCache.get(prefix);
  if (cached) return cached;
  const url = import.meta.resolve(ICON_SET_MODULE_SPECIFIERS[prefix]);
  const set = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as IconifyIconSet;
  iconSetCache.set(prefix, set);
  return set;
}

const PATH_TAG_PATTERN = /<path\b[^>]*\sd="([^"]*)"[^>]*\/?>/giu;
const NON_PATH_TAG_PATTERN = /<(?!\/?path\b)[a-zA-Z][^>]*>/u;

/** Only glyphs expressible as one or more plain `<path d="...">` are safe to
 * re-embed as a single Motion Canvas `<Path data="...">`. A body containing
 * any other element (e.g. `<circle>`, `<g>`, a duotone overlay) is rejected
 * rather than silently dropping part of the icon. */
function pathDataFromIconBody(body: string): string | null {
  if (NON_PATH_TAG_PATTERN.test(body)) return null;
  const segments = [...body.matchAll(PATH_TAG_PATTERN)].map(match => match[1]!.trim()).filter(Boolean);
  return segments.length > 0 ? segments.join(' ') : null;
}

function parseIconId(iconId: string): {prefix: MotionCanvasIconPrefix; name: string} | null {
  const [prefix, ...rest] = iconId.split(':');
  const name = rest.join(':');
  if (!name || !(MOTION_CANVAS_ICON_PREFIXES as readonly string[]).includes(prefix ?? '')) return null;
  return {prefix: prefix as MotionCanvasIconPrefix, name};
}

/** Resolves `prefix:name` (e.g. `mdi:leaf`) to real vector path data, or
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
