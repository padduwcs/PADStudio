import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

export class HoldoutCorpusError extends Error { constructor(message) { super(message); this.name = "HoldoutCorpusError"; } }
const text = (value, label) => { if (typeof value !== "string" || !value.trim()) throw new HoldoutCorpusError(`${label} is required.`); return value.trim(); };
const inside = (root, path) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;

async function lockedFile(baseReal, path, label) {
  const requested = resolve(baseReal, text(path, label)), actual = await realpath(requested), info = await lstat(requested);
  if (!inside(baseReal, actual) || !info.isFile() || info.isSymbolicLink()) throw new HoldoutCorpusError(`${label} must be a regular file inside the corpus root.`);
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(actual)) hash.update(bytes);
  const after = await lstat(actual);
  if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new HoldoutCorpusError(`${label} changed while it was locked.`);
  return { path: relative(baseReal, actual).replaceAll("\\", "/"), sizeBytes: info.size, sha256: hash.digest("hex") };
}

function characteristics(value) {
  const names = ["audioMinutes", "clipCount", "cleanVietnameseMinutes", "hardVietnameseMinutes", "noSpeechMinutes", "timingBoundaryCount", "sceneClipCount", "hardCutCount"];
  if (!value || names.some((name) => !Number.isFinite(value[name]))) throw new HoldoutCorpusError(`characteristics must include finite ${names.join(", ")}.`);
  if (value.splitBySpeakerAndSource !== true || value.humanVerifiedGold !== true) throw new HoldoutCorpusError("Holdout gold must be human verified and split by speaker/source.");
  return Object.fromEntries([...names, "splitBySpeakerAndSource", "humanVerifiedGold"].map((name) => [name, value[name]]));
}

export async function lockHoldoutCorpus(value, { baseDirectory = process.cwd(), now = () => new Date().toISOString() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.entries) || value.entries.length === 0) throw new HoldoutCorpusError("Holdout manifest must contain entries.");
  const root = await realpath(baseDirectory);
  if (!value.rights || value.rights.confirmed !== true) throw new HoldoutCorpusError("Holdout rights must be explicitly confirmed.");
  const rights = { confirmed: true, basis: text(value.rights.basis, "rights.basis"), verifiedBy: text(value.rights.verifiedBy, "rights.verifiedBy") };
  const entries = [];
  for (const [index, entry] of value.entries.entries()) {
    const media = await lockedFile(root, entry.path, `entries[${index}].path`);
    const gold = [];
    for (const [goldIndex, path] of (entry.goldFiles ?? []).entries()) gold.push(await lockedFile(root, path, `entries[${index}].goldFiles[${goldIndex}]`));
    if (gold.length === 0) throw new HoldoutCorpusError(`entries[${index}] requires at least one human gold file.`);
    entries.push({ id: text(entry.id, `entries[${index}].id`), kind: text(entry.kind, `entries[${index}].kind`), media, gold });
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new HoldoutCorpusError("Holdout entry IDs must be unique.");
  const lockedAt = now();
  const manifest = { version: "1.0", id: text(value.id, "id"), description: text(value.description, "description"), classification: "holdout", rights, characteristics: characteristics(value.characteristics), entries, lockedAt };
  const manifestSha256 = createHash("sha256").update(JSON.stringify(stable(manifest))).digest("hex");
  return { manifest, corpus: { id: manifest.id, classification: "holdout", knownDevelopment: false, lockedBeforeEvaluation: true,
    rightsConfirmed: true, manifestSha256, characteristics: manifest.characteristics },
    measurement: { gateId: "independent_gold_holdout", outcome: "passed", measuredAt: lockedAt,
      method: "PADStudio holdout locker verified rights declaration, regular-file boundaries, media/gold bytes and a canonical manifest checksum.",
      evidenceRefs: [`holdout-manifest:${manifestSha256}`], corpusId: manifest.id } };
}
