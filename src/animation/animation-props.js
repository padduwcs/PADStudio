import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";

export const MAX_ANIMATION_PROPS_BYTES = 1024 * 1024;
export const MAX_ANIMATION_PROPS_DEPTH = 32;

function normalizeJson(value, depth = 0, seen = new Set()) {
  if (depth > MAX_ANIMATION_PROPS_DEPTH) throw new Error(`Animation props exceed maximum depth ${MAX_ANIMATION_PROPS_DEPTH}.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Animation props numbers must be finite.");
    return value;
  }
  if (!value || typeof value !== "object") throw new Error("Animation props must contain JSON values only.");
  if (seen.has(value)) throw new Error("Animation props must not contain circular references.");
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => normalizeJson(item, depth + 1, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Animation props objects must be plain JSON objects.");
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (!key || key.length > 200 || /[\u0000-\u001f]/u.test(key)) throw new Error("Animation props keys must be safe nonempty text.");
      normalized[key] = normalizeJson(value[key], depth + 1, seen);
    }
  }
  seen.delete(value);
  return normalized;
}

export function normalizeAnimationProps(value) {
  const normalized = normalizeJson(value);
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, "utf8") > MAX_ANIMATION_PROPS_BYTES) {
    throw new Error(`Animation props exceed ${MAX_ANIMATION_PROPS_BYTES} UTF-8 bytes.`);
  }
  return normalized;
}

export async function loadAnimationProps(store, projectId, resultId) {
  const result = await store.readResult(projectId, resultId);
  if (result.type !== "animation.props" || result.data?.version !== "1.0" || result.data?.props === undefined) {
    throw new Error("Expected an animation.props Result.");
  }
  const props = normalizeAnimationProps(result.data.props);
  const file = await store.verifyResultFile(projectId, result.id, "primary");
  let stored;
  try { stored = JSON.parse(await readFile(file.filePath, "utf8")); }
  catch { throw new Error("Animation props file is not valid JSON."); }
  if (!isDeepStrictEqual(stored, props)) throw new Error("Animation props file does not match Result metadata.");
  return { result, props, file };
}
