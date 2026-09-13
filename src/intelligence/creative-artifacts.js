import {
  IntelligenceValidationError,
  assertOnlyFields,
  isPlainObject,
  requireId,
  requireObject,
  requireText,
} from "./contracts.js";

export const PROJECT_BRIEF_TYPE = "project.brief";
export const CREATIVE_PROPOSAL_TYPE = "creative.proposal";
export const CREATIVE_DIRECTION_TYPE = "creative.direction";
export const CREATIVE_ARTIFACT_TYPES = new Set([
  PROJECT_BRIEF_TYPE,
  CREATIVE_PROPOSAL_TYPE,
  CREATIVE_DIRECTION_TYPE,
]);

const CONTRACT_VERSION = "1.0";

function boundedText(value, label, maximum) {
  const text = requireText(value, label);
  if (text.length > maximum) {
    throw new IntelligenceValidationError(`${label} must be at most ${maximum} characters.`);
  }
  return text;
}

function textList(value, label, { required = false, maximumItems = 50, maximumLength = 1_000 } = {}) {
  if (!Array.isArray(value)) throw new IntelligenceValidationError(`${label} must be an array.`);
  if (required && value.length === 0) throw new IntelligenceValidationError(`${label} must not be empty.`);
  if (value.length > maximumItems) {
    throw new IntelligenceValidationError(`${label} must contain at most ${maximumItems} items.`);
  }
  const result = value.map((entry, index) => boundedText(entry, `${label}[${index}]`, maximumLength));
  if (new Set(result).size !== result.length) {
    throw new IntelligenceValidationError(`${label} must not contain duplicates.`);
  }
  return result;
}

function normalizeSample(value, label) {
  if (value === null) return null;
  const sample = requireObject(value, label);
  assertOnlyFields(sample, ["purpose", "durationSeconds", "successCriteria"], label);
  if (!Number.isFinite(sample.durationSeconds) || sample.durationSeconds < 1 || sample.durationSeconds > 600) {
    throw new IntelligenceValidationError(`${label}.durationSeconds must be between 1 and 600.`);
  }
  return {
    purpose: boundedText(sample.purpose, `${label}.purpose`, 2_000),
    durationSeconds: sample.durationSeconds,
    successCriteria: textList(sample.successCriteria, `${label}.successCriteria`, { required: true, maximumItems: 20 }),
  };
}

function requireVersion(value, label) {
  if (value.version !== CONTRACT_VERSION) {
    throw new IntelligenceValidationError(`${label}.version must be ${CONTRACT_VERSION}.`);
  }
}

function normalizeBrief(value) {
  const brief = requireObject(value, "project.brief.data");
  assertOnlyFields(brief, [
    "version", "purpose", "audience", "desiredOutcome", "constraints",
    "knownFacts", "assumptions", "openQuestions",
  ], "project.brief.data");
  requireVersion(brief, "project.brief.data");
  return {
    version: CONTRACT_VERSION,
    purpose: boundedText(brief.purpose, "project.brief.data.purpose", 2_000),
    audience: boundedText(brief.audience, "project.brief.data.audience", 1_000),
    desiredOutcome: boundedText(brief.desiredOutcome, "project.brief.data.desiredOutcome", 2_000),
    constraints: textList(brief.constraints, "project.brief.data.constraints"),
    knownFacts: textList(brief.knownFacts, "project.brief.data.knownFacts", { maximumItems: 100 }),
    assumptions: textList(brief.assumptions, "project.brief.data.assumptions"),
    openQuestions: textList(brief.openQuestions, "project.brief.data.openQuestions"),
  };
}

function normalizeProposalOption(value, index) {
  const label = `creative.proposal.data.options[${index}]`;
  const option = requireObject(value, label);
  assertOnlyFields(option, [
    "id", "name", "premise", "hook", "narrativeApproach", "audienceExperience",
    "visualPrinciples", "audioPrinciples", "advantages", "tradeoffs", "risks", "sample",
  ], label);
  return {
    id: requireId(option.id, `${label}.id`),
    name: boundedText(option.name, `${label}.name`, 200),
    premise: boundedText(option.premise, `${label}.premise`, 2_000),
    hook: boundedText(option.hook, `${label}.hook`, 1_000),
    narrativeApproach: boundedText(option.narrativeApproach, `${label}.narrativeApproach`, 2_000),
    audienceExperience: boundedText(option.audienceExperience, `${label}.audienceExperience`, 1_000),
    visualPrinciples: textList(option.visualPrinciples, `${label}.visualPrinciples`, { required: true, maximumItems: 20 }),
    audioPrinciples: textList(option.audioPrinciples, `${label}.audioPrinciples`, { maximumItems: 20 }),
    advantages: textList(option.advantages, `${label}.advantages`, { required: true, maximumItems: 20 }),
    tradeoffs: textList(option.tradeoffs, `${label}.tradeoffs`, { required: true, maximumItems: 20 }),
    risks: textList(option.risks, `${label}.risks`, { maximumItems: 20 }),
    sample: normalizeSample(option.sample, `${label}.sample`),
  };
}

function normalizeProposal(value) {
  const proposal = requireObject(value, "creative.proposal.data");
  assertOnlyFields(proposal, ["version", "comparisonCriteria", "options", "recommendedOptionId", "recommendationReason"], "creative.proposal.data");
  requireVersion(proposal, "creative.proposal.data");
  if (!Array.isArray(proposal.options) || proposal.options.length < 2 || proposal.options.length > 5) {
    throw new IntelligenceValidationError("creative.proposal.data.options must contain between 2 and 5 options.");
  }
  const options = proposal.options.map(normalizeProposalOption);
  const ids = options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) {
    throw new IntelligenceValidationError("creative.proposal.data.options must have unique IDs.");
  }
  const recommendedOptionId = requireId(proposal.recommendedOptionId, "creative.proposal.data.recommendedOptionId");
  if (!ids.includes(recommendedOptionId)) {
    throw new IntelligenceValidationError("creative.proposal.data.recommendedOptionId must identify an option.");
  }
  return {
    version: CONTRACT_VERSION,
    comparisonCriteria: textList(proposal.comparisonCriteria, "creative.proposal.data.comparisonCriteria", { required: true, maximumItems: 20 }),
    options,
    recommendedOptionId,
    recommendationReason: boundedText(proposal.recommendationReason, "creative.proposal.data.recommendationReason", 2_000),
  };
}

function normalizeDirectionBasis(value) {
  const basis = requireObject(value, "creative.direction.data.basis");
  const kind = requireText(basis.kind, "creative.direction.data.basis.kind");
  if (kind === "direct") {
    assertOnlyFields(basis, ["kind", "briefArtifactId"], "creative.direction.data.basis");
    return { kind, briefArtifactId: requireId(basis.briefArtifactId, "creative.direction.data.basis.briefArtifactId") };
  }
  if (kind === "proposal") {
    assertOnlyFields(basis, ["kind", "proposalArtifactId", "optionId"], "creative.direction.data.basis");
    return {
      kind,
      proposalArtifactId: requireId(basis.proposalArtifactId, "creative.direction.data.basis.proposalArtifactId"),
      optionId: requireId(basis.optionId, "creative.direction.data.basis.optionId"),
    };
  }
  throw new IntelligenceValidationError(`creative.direction.data.basis.kind is not supported: ${kind}.`);
}

const ACCEPTANCE_EVIDENCE = new Set(["technical", "visual", "auditory", "content", "user_use"]);

function normalizeDeliveryPromise(value) {
  if (value === undefined || value === null) return null;
  const label = "creative.direction.data.deliveryPromise";
  const promise = requireObject(value, label);
  assertOnlyFields(promise, ["summary", "requirements", "allowedFallbacks", "prohibitedFallbacks"], label);
  if (!Array.isArray(promise.requirements) || promise.requirements.length === 0 || promise.requirements.length > 30) {
    throw new IntelligenceValidationError(label + ".requirements must contain between 1 and 30 items.");
  }
  const requirements = promise.requirements.map((value, index) => {
    const requirementLabel = label + ".requirements[" + index + "]";
    const requirement = requireObject(value, requirementLabel);
    assertOnlyFields(requirement, ["id", "criterion", "evidence", "blocking"], requirementLabel);
    if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
      throw new IntelligenceValidationError(requirementLabel + ".evidence must not be empty.");
    }
    const evidence = requirement.evidence.map((entry, evidenceIndex) => {
      const mode = requireText(entry, requirementLabel + ".evidence[" + evidenceIndex + "]");
      if (!ACCEPTANCE_EVIDENCE.has(mode)) {
        throw new IntelligenceValidationError(requirementLabel + ".evidence is not supported: " + mode + ".");
      }
      return mode;
    });
    if (new Set(evidence).size !== evidence.length) {
      throw new IntelligenceValidationError(requirementLabel + ".evidence must not contain duplicates.");
    }
    if (typeof requirement.blocking !== "boolean") {
      throw new IntelligenceValidationError(requirementLabel + ".blocking must be a boolean.");
    }
    return {
      id: requireId(requirement.id, requirementLabel + ".id"),
      criterion: boundedText(requirement.criterion, requirementLabel + ".criterion", 1_000),
      evidence,
      blocking: requirement.blocking,
    };
  });
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) {
    throw new IntelligenceValidationError(label + ".requirements must have unique IDs.");
  }
  return {
    summary: boundedText(promise.summary, label + ".summary", 2_000),
    requirements,
    allowedFallbacks: textList(promise.allowedFallbacks ?? [], label + ".allowedFallbacks", { maximumItems: 20 }),
    prohibitedFallbacks: textList(promise.prohibitedFallbacks ?? [], label + ".prohibitedFallbacks", { maximumItems: 20 }),
  };
}

function normalizeDirection(value) {
  const direction = requireObject(value, "creative.direction.data");
  assertOnlyFields(direction, ["version", "basis", "selectionReason", "principles", "avoidances", "reviewCriteria", "sample", "deliveryPromise"], "creative.direction.data");
  requireVersion(direction, "creative.direction.data");
  return {
    version: CONTRACT_VERSION,
    basis: normalizeDirectionBasis(direction.basis),
    selectionReason: boundedText(direction.selectionReason, "creative.direction.data.selectionReason", 2_000),
    principles: textList(direction.principles, "creative.direction.data.principles", { required: true, maximumItems: 30 }),
    avoidances: textList(direction.avoidances, "creative.direction.data.avoidances", { maximumItems: 30 }),
    reviewCriteria: textList(direction.reviewCriteria, "creative.direction.data.reviewCriteria", { required: true, maximumItems: 30 }),
    sample: normalizeSample(direction.sample, "creative.direction.data.sample"),
    deliveryPromise: normalizeDeliveryPromise(direction.deliveryPromise),
  };
}

export function normalizeCreativeArtifactData(type, value, { allowLegacy = false } = {}) {
  if (!CREATIVE_ARTIFACT_TYPES.has(type)) return null;
  if (allowLegacy && isPlainObject(value) && value.version === undefined) return structuredClone(value);
  if (type === PROJECT_BRIEF_TYPE) return normalizeBrief(value);
  if (type === CREATIVE_PROPOSAL_TYPE) return normalizeProposal(value);
  return normalizeDirection(value);
}

export function validateCreativeArtifactReferences({ type, data, references, artifacts }) {
  if (!CREATIVE_ARTIFACT_TYPES.has(type) || type === PROJECT_BRIEF_TYPE) return;
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const referenceIds = new Set(
    references.filter((reference) => reference.kind === "artifact").map((reference) => reference.id),
  );
  if (type === CREATIVE_PROPOSAL_TYPE) {
    if (![...referenceIds].some((id) => byId.get(id)?.type === PROJECT_BRIEF_TYPE)) {
      throw new IntelligenceValidationError("creative.proposal must reference a project.brief artifact.");
    }
    return;
  }
  const basisId = data.basis.kind === "proposal"
    ? data.basis.proposalArtifactId
    : data.basis.briefArtifactId;
  if (!referenceIds.has(basisId)) {
    throw new IntelligenceValidationError("creative.direction must reference the artifact declared by data.basis.");
  }
  const basisArtifact = byId.get(basisId);
  const expectedType = data.basis.kind === "proposal" ? CREATIVE_PROPOSAL_TYPE : PROJECT_BRIEF_TYPE;
  if (basisArtifact?.type !== expectedType) {
    throw new IntelligenceValidationError(`creative.direction basis must identify a ${expectedType} artifact.`);
  }
  if (data.basis.kind === "proposal") {
    const proposal = normalizeCreativeArtifactData(CREATIVE_PROPOSAL_TYPE, basisArtifact.data);
    if (!proposal.options.some((option) => option.id === data.basis.optionId)) {
      throw new IntelligenceValidationError("creative.direction basis.optionId must identify an option in the proposal.");
    }
  }
}
