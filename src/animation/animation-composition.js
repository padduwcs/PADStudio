import {
  IntelligenceValidationError,
  assertOnlyFields,
  normalizeStringList,
  requireId,
  requireObject,
  requireText,
} from "../intelligence/contracts.js";
import { ANIMATION_CHOREOGRAPHY_TYPE, normalizeVisualChoreography } from "./visual-choreography.js";

export const ANIMATION_COMPOSITION_TYPE = "animation.composition";
export const ANIMATION_RUNTIMES = Object.freeze(["manim", "remotion", "hyperframes"]);

function finite(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new IntelligenceValidationError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function relativeFile(value, label) {
  const path = requireText(value, label).replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.length > 300 ||
    /[\u0000-\u001f:*?"<>|]/u.test(path)
  ) {
    throw new IntelligenceValidationError(`${label} must be a safe relative file path.`);
  }
  return path;
}

export function normalizeAnimationComposition(value, { allowLegacy = false } = {}) {
  requireObject(value, "animation.composition data");
  const version = value.version;
  if (!["1.0", "1.1"].includes(version)) {
    throw new IntelligenceValidationError("animation.composition version must be 1.0 or 1.1.");
  }
  assertOnlyFields(value, [
    "version", "changeReason", "intent", "runtime", "sourceResultId", "entry",
    "format", "durationSeconds", "timing", "assets", "propsResultId", "style", "reviewCriteria", "executionPolicy",
    ...(version === "1.1" ? ["choreographyArtifactId"] : []),
  ], "animation.composition data");
  const runtime = requireText(value.runtime, "animation.composition.runtime");
  if (!ANIMATION_RUNTIMES.includes(runtime)) {
    throw new IntelligenceValidationError(`animation.composition.runtime is not supported: ${runtime}.`);
  }
  const entry = requireObject(value.entry, "animation.composition.entry");
  assertOnlyFields(entry, ["file", "symbol"], "animation.composition.entry");
  const entrySymbol = requireText(entry.symbol, "animation.composition.entry.symbol");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(entrySymbol)) {
    throw new IntelligenceValidationError("Animation entry symbol must be a safe runtime identifier.");
  }
  const format = requireObject(value.format, "animation.composition.format");
  assertOnlyFields(format, ["width", "height", "fps", "background", "transparent"], "animation.composition.format");
  const width = finite(format.width, "animation.composition.format.width", 64, 3840);
  const height = finite(format.height, "animation.composition.format.height", 64, 3840);
  const fps = finite(format.fps, "animation.composition.format.fps", 1, 60);
  if (![width, height, fps].every(Number.isInteger) || width % 2 || height % 2) {
    throw new IntelligenceValidationError("Animation width/height must be even integers and fps must be an integer.");
  }
  const durationSeconds = finite(value.durationSeconds, "animation.composition.durationSeconds", 0.1, 600);
  if (Math.abs(durationSeconds * fps - Math.round(durationSeconds * fps)) > 1e-6) {
    throw new IntelligenceValidationError("Animation durationSeconds must align to an output frame.");
  }
  const timing = value.timing ?? { mode: runtime === "manim" ? "measured" : "exact" };
  requireObject(timing, "animation.composition.timing");
  assertOnlyFields(timing, ["mode"], "animation.composition.timing");
  const timingMode = requireText(timing.mode, "animation.composition.timing.mode");
  if (!["exact", "measured"].includes(timingMode)) {
    throw new IntelligenceValidationError("animation.composition.timing.mode must be exact or measured.");
  }
  if (runtime === "remotion" && timingMode !== "exact") {
    throw new IntelligenceValidationError("Remotion compositions must use exact timing because PADStudio renders an exact frame range.");
  }
  const executionPolicy = requireObject(value.executionPolicy, "animation.composition.executionPolicy");
  assertOnlyFields(executionPolicy, ["codeTrust", "networkAccess"], "animation.composition.executionPolicy");
  const legacyCodeTrust = executionPolicy.codeTrust === "exact-user-approval";
  if (executionPolicy.codeTrust !== "agent-managed-execution" && !(allowLegacy && legacyCodeTrust)) {
    throw new IntelligenceValidationError("Animation executable code must use agent-managed-execution.");
  }
  if (executionPolicy.networkAccess !== "not-required") {
    throw new IntelligenceValidationError("Animation render must declare that network access is not required.");
  }
  const style = value.style ?? {};
  requireObject(style, "animation.composition.style");
  assertOnlyFields(style, ["designRead", "palette", "motionPrinciples", "antiPatterns"], "animation.composition.style");
  const palette = normalizeStringList(style.palette, "animation.composition.style.palette");
  if (palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new IntelligenceValidationError("Animation palette entries must be #RRGGBB colors.");
  }
  const background = format.background === undefined
    ? "#000000"
    : requireText(format.background, "animation.composition.format.background");
  if (!/^#[0-9a-f]{6}$/i.test(background)) {
    throw new IntelligenceValidationError("Animation background must be a #RRGGBB color.");
  }
  if (format.transparent === true) {
    throw new IntelligenceValidationError("animation.composition 1.0 produces opaque MP4; transparent output is not supported.");
  }
  const assets = value.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 100) {
    throw new IntelligenceValidationError("animation.composition.assets must be an array with at most 100 entries.");
  }
  const normalizedAssets = assets.map((value, index) => {
    const label = `animation.composition.assets[${index}]`;
    requireObject(value, label);
    assertOnlyFields(value, ["id", "source", "target"], label);
    const source = requireObject(value.source, `${label}.source`);
    const allowed = source.kind === "resource" ? ["kind", "id", "itemPath"] : ["kind", "id", "file"];
    assertOnlyFields(source, allowed, `${label}.source`);
    if (!["resource", "result"].includes(source.kind)) {
      throw new IntelligenceValidationError(`${label}.source.kind must be resource or result.`);
    }
    const target = relativeFile(value.target, `${label}.target`);
    if (!target.startsWith("assets/")) {
      throw new IntelligenceValidationError(`${label}.target must be inside assets/.`);
    }
    return {
      id: requireId(value.id, `${label}.id`),
      source: {
        kind: source.kind,
        id: requireId(source.id, `${label}.source.id`),
        ...(source.kind === "resource"
          ? { itemPath: source.itemPath == null ? null : relativeFile(source.itemPath, `${label}.source.itemPath`) }
          : { file: source.file === undefined ? "primary" : requireId(source.file, `${label}.source.file`) }),
      },
      target,
    };
  });
  if (new Set(normalizedAssets.map((asset) => asset.id)).size !== normalizedAssets.length ||
      new Set(normalizedAssets.map((asset) => asset.target.toLowerCase())).size !== normalizedAssets.length) {
    throw new IntelligenceValidationError("Animation asset IDs and targets must be unique.");
  }
  return {
    version,
    changeReason: requireText(value.changeReason, "animation.composition.changeReason"),
    intent: requireText(value.intent, "animation.composition.intent"),
    runtime,
    sourceResultId: requireId(value.sourceResultId, "animation.composition.sourceResultId"),
    entry: {
      file: relativeFile(entry.file, "animation.composition.entry.file"),
      symbol: entrySymbol,
    },
    format: { width, height, fps, background, transparent: false },
    durationSeconds,
    timing: { mode: timingMode },
    assets: normalizedAssets,
    propsResultId: value.propsResultId == null ? null : requireId(value.propsResultId, "animation.composition.propsResultId"),
    ...(version === "1.1" ? {
      choreographyArtifactId: requireId(value.choreographyArtifactId, "animation.composition.choreographyArtifactId"),
    } : {}),
    style: {
      designRead: style.designRead == null ? null : requireText(style.designRead, "animation.composition.style.designRead"),
      palette,
      motionPrinciples: normalizeStringList(style.motionPrinciples, "animation.composition.style.motionPrinciples"),
      antiPatterns: normalizeStringList(style.antiPatterns, "animation.composition.style.antiPatterns"),
    },
    reviewCriteria: normalizeStringList(value.reviewCriteria, "animation.composition.reviewCriteria", { allowEmpty: allowLegacy }),
    // Legacy project reads may contain the retired value; always expose the
    // current non-interactive execution contract after normalization.
    executionPolicy: { codeTrust: "agent-managed-execution", networkAccess: "not-required" },
  };
}

export async function validateAnimationCompositionAgainstProject({ projectStore, projectId, data, references, status }) {
  const result = await projectStore.readResult(projectId, data.sourceResultId);
  if (result.type !== "animation.source-package") {
    throw new IntelligenceValidationError("animation.composition sourceResultId must reference animation.source-package.");
  }
  if (result.data?.runtime !== data.runtime) {
    throw new IntelligenceValidationError("Animation composition runtime does not match its source package.");
  }
  if (result.data?.entryFile !== data.entry.file || result.data?.entrySymbol !== data.entry.symbol) {
    throw new IntelligenceValidationError("Animation composition entry does not match its source package manifest.");
  }
  if (!references.some((reference) => reference.kind === "result" && reference.id === data.sourceResultId)) {
    throw new IntelligenceValidationError("animation.composition must reference its source-package Result.");
  }
  for (const asset of data.assets) {
    if (!references.some((reference) => reference.kind === asset.source.kind && reference.id === asset.source.id)) {
      throw new IntelligenceValidationError(`animation.composition must reference asset source ${asset.source.kind}:${asset.source.id}.`);
    }
    if (status !== "retired") await projectStore.resolveMediaSource(projectId, asset.source);
  }
  if (data.propsResultId) {
    const props = await projectStore.readResult(projectId, data.propsResultId);
    if (props.type !== "animation.props") {
      throw new IntelligenceValidationError("animation.composition propsResultId must reference animation.props.");
    }
    if (!references.some((reference) => reference.kind === "result" && reference.id === data.propsResultId)) {
      throw new IntelligenceValidationError("animation.composition must reference its props Result.");
    }
    if (status !== "retired") await projectStore.verifyResultFile(projectId, props.id, "primary");
  }
  if (data.version === "1.1") {
    const choreography = (await projectStore.intelligence.readArtifacts(projectId))
      .find((artifact) => artifact.id === data.choreographyArtifactId);
    if (!choreography || choreography.type !== ANIMATION_CHOREOGRAPHY_TYPE) {
      throw new IntelligenceValidationError("animation.composition choreographyArtifactId must reference animation.choreography.");
    }
    if (!references.some((reference) => reference.kind === "artifact" && reference.id === choreography.id)) {
      throw new IntelligenceValidationError("animation.composition must reference its exact choreography Artifact.");
    }
    if (status === "active" && !(await projectStore.intelligence.readActiveArtifacts(projectId))
      .some((artifact) => artifact.id === choreography.id)) {
      throw new IntelligenceValidationError("An active animation.composition must bind the active choreography revision.");
    }
    const plan = normalizeVisualChoreography(choreography.data);
    if (plan.fps !== data.format.fps || plan.durationSeconds !== data.durationSeconds) {
      throw new IntelligenceValidationError("animation.composition format timing must match its choreography FPS and duration.");
    }
  }
  if (status !== "retired") {
    for (const file of result.files) await projectStore.verifyResultFile(projectId, result.id, file.id);
  }
}
