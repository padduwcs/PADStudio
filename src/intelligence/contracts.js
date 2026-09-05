const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export class IntelligenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntelligenceValidationError";
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireObject(value, label) {
  if (!isPlainObject(value)) throw new IntelligenceValidationError(`${label} must be an object.`);
  return value;
}

export function assertOnlyFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new IntelligenceValidationError(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
  }
}

export function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new IntelligenceValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalText(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, label);
}

export function requireId(value, label) {
  const id = requireText(value, label);
  if (!ID_PATTERN.test(id)) {
    throw new IntelligenceValidationError(`${label} has an invalid identifier format.`);
  }
  return id;
}

export function normalizeStringList(value, label, { allowEmpty = true } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new IntelligenceValidationError(`${label} must be an array.`);
  const result = value.map((item, index) => requireText(item, `${label}[${index}]`));
  if (!allowEmpty && result.length === 0) throw new IntelligenceValidationError(`${label} must not be empty.`);
  if (new Set(result).size !== result.length) throw new IntelligenceValidationError(`${label} must not contain duplicates.`);
  return result;
}

const REFERENCE_KINDS = new Set(["resource", "result", "artifact", "run", "decision", "review", "workflow"]);
const OUTPUT_KINDS = new Set(["artifact", "result", "review", "decision", "workflow", "resource"]);

export function normalizeReference(value, label) {
  const ref = requireObject(value, label);
  assertOnlyFields(ref, ["kind", "id"], label);
  const kind = requireText(ref.kind, `${label}.kind`);
  if (!REFERENCE_KINDS.has(kind)) throw new IntelligenceValidationError(`${label}.kind is not supported: ${kind}.`);
  return { kind, id: requireText(ref.id, `${label}.id`) };
}

export function normalizeReferences(value, label = "references") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new IntelligenceValidationError(`${label} must be an array.`);
  const refs = value.map((item, index) => normalizeReference(item, `${label}[${index}]`));
  const keys = refs.map((ref) => `${ref.kind}:${ref.id}`);
  if (new Set(keys).size !== keys.length) throw new IntelligenceValidationError(`${label} must not contain duplicates.`);
  return refs;
}

const ITEM_STATUSES = new Set(["planned", "ready", "in_progress", "awaiting_review", "awaiting_approval", "blocked", "completed", "cancelled"]);
const APPROVAL_MODES = new Set(["auto", "notify", "required"]);

function normalizeWorkItem(value, index) {
  const label = `items[${index}]`;
  const item = requireObject(value, label);
  assertOnlyFields(
    item,
    [
      "id", "title", "purpose", "status", "dependsOn", "skillIds",
      "inputReferences", "expectedOutputs", "outputReferences", "review",
      "approval", "notes"
    ],
    label
  );
  const status = value.status ?? "planned";
  if (!ITEM_STATUSES.has(status)) throw new IntelligenceValidationError(`${label}.status is not supported: ${status}.`);
  const approval = value.approval ?? "auto";
  if (!APPROVAL_MODES.has(approval)) throw new IntelligenceValidationError(`${label}.approval is not supported: ${approval}.`);
  const expectedOutputs = value.expectedOutputs ?? [];
  if (!Array.isArray(expectedOutputs) || expectedOutputs.length === 0) {
    throw new IntelligenceValidationError(`${label}.expectedOutputs must contain at least one outcome.`);
  }
  const review = requireObject(value.review ?? { required: false, criteria: [] }, `${label}.review`);
  assertOnlyFields(review, ["required", "perspective", "criteria"], `${label}.review`);
  if (typeof review.required !== "boolean") throw new IntelligenceValidationError(`${label}.review.required must be a boolean.`);
  const perspective = review.perspective ?? "combined";
  if (!["creative", "technical", "combined"].includes(perspective)) {
    throw new IntelligenceValidationError(`${label}.review.perspective is not supported: ${perspective}.`);
  }
  const reviewCriteria = normalizeStringList(review.criteria, `${label}.review.criteria`);
  if (review.required && reviewCriteria.length === 0) {
    throw new IntelligenceValidationError(`${label}.review.criteria must not be empty when review is required.`);
  }
  return {
    id: requireId(item.id, `${label}.id`),
    title: requireText(item.title, `${label}.title`),
    purpose: requireText(item.purpose, `${label}.purpose`),
    status,
    dependsOn: normalizeStringList(item.dependsOn, `${label}.dependsOn`),
    skillIds: normalizeStringList(item.skillIds, `${label}.skillIds`),
    inputReferences: normalizeReferences(item.inputReferences, `${label}.inputReferences`),
    expectedOutputs: expectedOutputs.map((entry, outputIndex) => {
      const output = requireObject(entry, `${label}.expectedOutputs[${outputIndex}]`);
      assertOnlyFields(output, ["kind", "type", "description"], `${label}.expectedOutputs[${outputIndex}]`);
      const kind = requireText(output.kind, `${label}.expectedOutputs[${outputIndex}].kind`);
      if (!OUTPUT_KINDS.has(kind)) {
        throw new IntelligenceValidationError(`${label}.expectedOutputs[${outputIndex}].kind is not supported: ${kind}.`);
      }
      return {
        kind,
        type: optionalText(output.type, `${label}.expectedOutputs[${outputIndex}].type`),
        description: requireText(output.description, `${label}.expectedOutputs[${outputIndex}].description`),
      };
    }),
    outputReferences: normalizeReferences(item.outputReferences, `${label}.outputReferences`),
    review: {
      required: review.required,
      perspective,
      criteria: reviewCriteria,
    },
    approval,
    notes: optionalText(item.notes, `${label}.notes`),
  };
}

export function normalizeWorkItems(value) {
  if (!Array.isArray(value) || value.length === 0) throw new IntelligenceValidationError("items must contain at least one work item.");
  const items = value.map(normalizeWorkItem);
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new IntelligenceValidationError("Work item IDs must be unique within a workflow.");
  const idSet = new Set(ids);
  for (const item of items) {
    for (const dependency of item.dependsOn) {
      if (!idSet.has(dependency)) throw new IntelligenceValidationError(`Work item ${item.id} depends on unknown work item ${dependency}.`);
      if (dependency === item.id) throw new IntelligenceValidationError(`Work item ${item.id} cannot depend on itself.`);
    }
  }
  assertAcyclic(items);
  return items;
}

function assertAcyclic(items) {
  const dependencies = new Map(items.map((item) => [item.id, item.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new IntelligenceValidationError(`Workflow contains a dependency cycle involving ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const item of items) visit(item.id);
}

export function normalizeReviewCriteria(value) {
  if (!Array.isArray(value) || value.length === 0) throw new IntelligenceValidationError("criteria must contain at least one review criterion.");
  return value.map((entry, index) => {
    const label = `criteria[${index}]`;
    requireObject(entry, label);
    assertOnlyFields(entry, ["id", "criterion", "status", "evidence", "proposedAction"], label);
    const status = requireText(entry.status, `${label}.status`);
    if (!["passed", "warning", "failed"].includes(status)) throw new IntelligenceValidationError(`${label}.status is not supported: ${status}.`);
    const proposedAction = optionalText(entry.proposedAction, `${label}.proposedAction`);
    if (status === "failed" && !proposedAction) throw new IntelligenceValidationError(`${label}.proposedAction is required when a check fails.`);
    return {
      id: requireId(entry.id, `${label}.id`),
      criterion: requireText(entry.criterion, `${label}.criterion`),
      status,
      evidence: requireText(entry.evidence, `${label}.evidence`),
      proposedAction,
    };
  });
}
