import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ASPECT_RATIOS = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };
const GUIDANCE_FIELDS = [
  "visualPrinciples", "typography", "composition", "motion", "audio", "reviewCriteria", "antiPatterns"
];

export class ProductionPolicyCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionPolicyCatalogError";
  }
}

function fail(message) {
  throw new ProductionPolicyCatalogError(message);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function exactFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function id(value, label) {
  const normalized = text(value, label);
  if (!ID_PATTERN.test(normalized)) fail(`${label} has an invalid identifier format.`);
  return normalized;
}

function numeric(value, label, { minimum = -Infinity, maximum = Infinity, integer = false } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    fail(`${label} has an invalid numeric value.`);
  }
  return value;
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array.`);
  const items = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(items).size !== items.length) fail(`${label} must not contain duplicates.`);
  return items;
}

function insets(value, label) {
  object(value, label);
  exactFields(value, ["top", "right", "bottom", "left"], label);
  return Object.fromEntries(["top", "right", "bottom", "left"].map((edge) => [
    edge, numeric(value[edge], `${label}.${edge}`, { minimum: 0, maximum: 0.49 })
  ]));
}

function outputProfile(raw, index) {
  const label = `output profile[${index}]`;
  object(raw, label);
  exactFields(raw, [
    "id", "version", "name", "description", "aspectRatio", "width", "height", "fps", "container",
    "videoCodec", "pixelFormat", "audioCodec", "sampleRate", "channels", "integratedLufs",
    "maximumTruePeakDbtp", "maximumTailSilenceSeconds", "visualPolicy"
  ], label);
  const aspectRatio = text(raw.aspectRatio, `${label}.aspectRatio`);
  if (!(aspectRatio in ASPECT_RATIOS)) fail(`${label}.aspectRatio is not supported: ${aspectRatio}.`);
  const width = numeric(raw.width, `${label}.width`, { minimum: 1, integer: true });
  const height = numeric(raw.height, `${label}.height`, { minimum: 1, integer: true });
  if (Math.abs(width / height - ASPECT_RATIOS[aspectRatio]) > 0.001) fail(`${label} dimensions do not match ${aspectRatio}.`);
  const loudness = object(raw.integratedLufs, `${label}.integratedLufs`);
  exactFields(loudness, ["minimum", "maximum"], `${label}.integratedLufs`);
  const minimumLufs = numeric(loudness.minimum, `${label}.integratedLufs.minimum`);
  const maximumLufs = numeric(loudness.maximum, `${label}.integratedLufs.maximum`);
  if (minimumLufs > maximumLufs) fail(`${label}.integratedLufs minimum must not exceed maximum.`);
  const policy = object(raw.visualPolicy, `${label}.visualPolicy`);
  exactFields(policy, ["titleSafeInsets", "actionSafeInsets", "caption"], `${label}.visualPolicy`);
  const caption = object(policy.caption, `${label}.visualPolicy.caption`);
  exactFields(caption, ["minimumFontHeightRatio", "maximumLines", "maximumGraphemesPerSecond", "minimumContrastRatio"], `${label}.visualPolicy.caption`);
  return {
    id: id(raw.id, `${label}.id`), version: text(raw.version, `${label}.version`),
    name: text(raw.name, `${label}.name`), description: text(raw.description, `${label}.description`),
    aspectRatio, width, height,
    fps: numeric(raw.fps, `${label}.fps`, { minimum: 1, maximum: 240 }),
    container: text(raw.container, `${label}.container`), videoCodec: text(raw.videoCodec, `${label}.videoCodec`),
    pixelFormat: text(raw.pixelFormat, `${label}.pixelFormat`), audioCodec: text(raw.audioCodec, `${label}.audioCodec`),
    sampleRate: numeric(raw.sampleRate, `${label}.sampleRate`, { minimum: 8000, integer: true }),
    channels: numeric(raw.channels, `${label}.channels`, { minimum: 1, maximum: 16, integer: true }),
    integratedLufs: { minimum: minimumLufs, maximum: maximumLufs },
    maximumTruePeakDbtp: numeric(raw.maximumTruePeakDbtp, `${label}.maximumTruePeakDbtp`),
    maximumTailSilenceSeconds: numeric(raw.maximumTailSilenceSeconds, `${label}.maximumTailSilenceSeconds`, { minimum: 0 }),
    visualPolicy: {
      titleSafeInsets: insets(policy.titleSafeInsets, `${label}.visualPolicy.titleSafeInsets`),
      actionSafeInsets: insets(policy.actionSafeInsets, `${label}.visualPolicy.actionSafeInsets`),
      caption: {
        minimumFontHeightRatio: numeric(caption.minimumFontHeightRatio, `${label}.visualPolicy.caption.minimumFontHeightRatio`, { minimum: 0.001, maximum: 0.25 }),
        maximumLines: numeric(caption.maximumLines, `${label}.visualPolicy.caption.maximumLines`, { minimum: 1, maximum: 8, integer: true }),
        maximumGraphemesPerSecond: numeric(caption.maximumGraphemesPerSecond, `${label}.visualPolicy.caption.maximumGraphemesPerSecond`, { minimum: 1 }),
        minimumContrastRatio: numeric(caption.minimumContrastRatio, `${label}.visualPolicy.caption.minimumContrastRatio`, { minimum: 1, maximum: 21 })
      }
    }
  };
}

function stylePlaybook(raw, index) {
  const label = `style playbook[${index}]`;
  object(raw, label);
  exactFields(raw, ["id", "version", "name", "description", "bestFor", "profileHints", "guidance"], label);
  const guidance = object(raw.guidance, `${label}.guidance`);
  exactFields(guidance, GUIDANCE_FIELDS, `${label}.guidance`);
  return {
    id: id(raw.id, `${label}.id`), version: text(raw.version, `${label}.version`),
    name: text(raw.name, `${label}.name`), description: text(raw.description, `${label}.description`),
    bestFor: stringList(raw.bestFor, `${label}.bestFor`), profileHints: stringList(raw.profileHints, `${label}.profileHints`),
    guidance: Object.fromEntries(GUIDANCE_FIELDS.map((field) => [field, stringList(guidance[field], `${label}.guidance.${field}`)]))
  };
}

function catalog(value, { kind, field, normalize }) {
  object(value, `${kind} catalog`);
  exactFields(value, kind === "style playbook" ? ["version", "selectionMode", field] : ["version", field], `${kind} catalog`);
  if (!Array.isArray(value[field]) || value[field].length === 0) fail(`${kind} catalog.${field} must be a non-empty array.`);
  const entries = value[field].map(normalize);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) fail(`${kind} catalog contains duplicate IDs.`);
  return { version: text(value.version, `${kind} catalog.version`), ...(kind === "style playbook" ? { selectionMode: text(value.selectionMode, `${kind} catalog.selectionMode`) } : {}), [field]: entries };
}

function readDefault(name) {
  return JSON.parse(readFileSync(path.join(MODULE_ROOT, "production-catalogs", name), "utf8"));
}

export class ProductionPolicyCatalog {
  #outputCatalog;
  #playbookCatalog;

  constructor(options = {}) {
    object(options, "production policy catalog options");
    exactFields(options, ["outputProfiles", "stylePlaybooks"], "production policy catalog options");
    const outputProfiles = options.outputProfiles === undefined ? readDefault("output-profiles.v1.json") : options.outputProfiles;
    const stylePlaybooks = options.stylePlaybooks === undefined ? readDefault("style-playbooks.v1.json") : options.stylePlaybooks;
    this.#outputCatalog = catalog(clone(outputProfiles), { kind: "output profile", field: "profiles", normalize: outputProfile });
    this.#playbookCatalog = catalog(clone(stylePlaybooks), { kind: "style playbook", field: "playbooks", normalize: stylePlaybook });
    if (this.#playbookCatalog.selectionMode !== "optional-explicit") fail("Style playbooks must remain optional and explicitly selected.");
    const profileIds = new Set(this.#outputCatalog.profiles.map((profile) => profile.id));
    for (const playbook of this.#playbookCatalog.playbooks) {
      const unknown = playbook.profileHints.filter((profileId) => !profileIds.has(profileId));
      if (unknown.length) fail(`Style playbook ${playbook.id} references unknown output profiles: ${unknown.join(", ")}.`);
    }
    deepFreeze(this.#outputCatalog);
    deepFreeze(this.#playbookCatalog);
  }

  listOutputProfiles() {
    return this.#outputCatalog.profiles.map(({ id, version, name, description, aspectRatio, width, height, fps }) => ({ id, version, name, description, aspectRatio, width, height, fps }));
  }

  readOutputProfile(profileId) {
    profileId = id(profileId, "output profile id");
    const value = this.#outputCatalog.profiles.find((candidate) => candidate.id === profileId);
    if (!value) fail(`Unknown output profile: ${profileId}.`);
    return clone(value);
  }

  listStylePlaybooks() {
    return this.#playbookCatalog.playbooks.map(({ id, version, name, description, bestFor, profileHints }) => ({ id, version, name, description, bestFor: clone(bestFor), profileHints: clone(profileHints), optional: true }));
  }

  readStylePlaybook(playbookId) {
    playbookId = id(playbookId, "style playbook id");
    const value = this.#playbookCatalog.playbooks.find((candidate) => candidate.id === playbookId);
    if (!value) fail(`Unknown style playbook: ${playbookId}.`);
    return { ...clone(value), optional: true };
  }

  versions() {
    return { outputProfiles: this.#outputCatalog.version, stylePlaybooks: this.#playbookCatalog.version };
  }

  resolve(selection) {
    object(selection, "production policy selection");
    exactFields(selection, ["profileId", "playbookId"], "production policy selection");
    const profileId = id(selection.profileId, "production policy selection.profileId");
    const playbookId = selection.playbookId === undefined || selection.playbookId === null
      ? null
      : id(selection.playbookId, "production policy selection.playbookId");
    return {
      catalogVersions: this.versions(),
      outputProfile: this.readOutputProfile(profileId),
      stylePlaybook: playbookId === null ? null : this.readStylePlaybook(playbookId),
      selection: { profileId, playbookId, playbookSelectedExplicitly: playbookId !== null }
    };
  }
}

export const defaultProductionPolicyCatalog = new ProductionPolicyCatalog();
export const OUTPUT_PROFILES = deepFreeze(Object.fromEntries(
  defaultProductionPolicyCatalog.listOutputProfiles().map(({ id }) => [id, defaultProductionPolicyCatalog.readOutputProfile(id)])
));
