import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { projectDirectory } from "../project/project-paths.js";
import {
  IntelligenceValidationError,
  assertOnlyFields,
  isPlainObject,
  normalizeReferences,
  normalizeReviewCriteria,
  normalizeWorkItems,
  optionalText,
  requireId,
  requireObject,
  requireText,
} from "./contracts.js";

const VERSION = "1.0";

function timestamp() {
  return new Date().toISOString();
}

function recordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function readRecords(directory) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    names.filter((name) => name.endsWith(".json")).sort().map((name) => readJson(join(directory, name))),
  );
}

function targetKey(target) {
  return target.kind === "work_item"
    ? `work_item:${target.workflowId}:${target.workItemId}`
    : `${target.kind}:${target.id}`;
}

function assertTimestamp(value, label) {
  requireText(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new IntelligenceValidationError(`${label} must be a valid timestamp.`);
  }
}

function assertReviewVerdict(verdict, criteria) {
  if (verdict === "passed" && criteria.some((criterion) => criterion.status !== "passed")) {
    throw new IntelligenceValidationError("A passed review cannot contain warnings or failures.");
  }
  if (verdict === "passed_with_notes" && criteria.some((criterion) => criterion.status === "failed")) {
    throw new IntelligenceValidationError("A passed_with_notes review cannot contain failures.");
  }
  if (["revise", "blocked"].includes(verdict) && !criteria.some((criterion) => criterion.status === "failed")) {
    throw new IntelligenceValidationError(`${verdict} review must contain at least one failed criterion.`);
  }
}

export class ProjectIntelligenceStore {
  constructor({ rootDir, projectStore, skillCatalog = null }) {
    this.rootDir = rootDir;
    this.projectStore = projectStore;
    this.skillCatalog = skillCatalog;
  }

  async recordArtifact(projectId, value) {
    await this.projectStore.readProject(projectId);
    requireObject(value, "artifact");
    assertOnlyFields(
      value,
      ["key", "type", "name", "summary", "status", "data", "references", "createdBy"],
      "artifact"
    );
    const key = requireId(value.key, "artifact.key");
    const type = requireId(value.type, "artifact.type");
    const name = requireText(value.name, "artifact.name");
    const summary = requireText(value.summary, "artifact.summary");
    const status = value.status ?? "active";
    if (!["draft", "active", "retired"].includes(status)) {
      throw new IntelligenceValidationError(`artifact.status is not supported: ${status}.`);
    }
    if (!isPlainObject(value.data)) throw new IntelligenceValidationError("artifact.data must be an object.");
    const references = normalizeReferences(value.references);
    await this.#assertReferences(projectId, references);
    const previous = (await this.readArtifacts(projectId))
      .filter((artifact) => artifact.key === key)
      .sort((a, b) => a.revision - b.revision)
      .at(-1);
    if (previous && previous.type !== type) {
      throw new IntelligenceValidationError(`Artifact ${key} cannot change type from ${previous.type} to ${type}.`);
    }
    const artifact = {
      version: VERSION,
      id: recordId("artifact"),
      projectId,
      key,
      revision: (previous?.revision ?? 0) + 1,
      supersedes: previous?.id ?? null,
      type,
      name,
      summary,
      status,
      data: structuredClone(value.data),
      references,
      createdBy: value.createdBy ?? "agent",
      createdAt: timestamp(),
    };
    if (!["agent", "user", "system"].includes(artifact.createdBy)) {
      throw new IntelligenceValidationError(`artifact.createdBy is not supported: ${artifact.createdBy}.`);
    }
    await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "artifacts", `${artifact.id}.json`), artifact);
    return artifact;
  }

  async readArtifacts(projectId) {
    await this.projectStore.readProject(projectId);
    const records = await readRecords(join(projectDirectory(this.rootDir, projectId), "artifacts"));
    return records
      .map((value) => this.#validateArtifact(value, projectId))
      .sort((a, b) => a.key.localeCompare(b.key) || a.revision - b.revision);
  }

  async readActiveArtifacts(projectId) {
    const byKey = new Map();
    for (const artifact of await this.readArtifacts(projectId)) {
      const state = byKey.get(artifact.key) ?? { active: null };
      if (artifact.status === "active") state.active = artifact;
      if (artifact.status === "retired") state.active = null;
      byKey.set(artifact.key, state);
    }
    return [...byKey.values()].map((state) => state.active).filter(Boolean);
  }

  async writeWorkflow(projectId, value) {
    await this.projectStore.readProject(projectId);
    requireObject(value, "workflow");
    assertOnlyFields(
      value,
      ["id", "name", "purpose", "status", "changeReason", "items", "metadata"],
      "workflow"
    );
    const all = await this.readWorkflows(projectId);
    const workflowId = value.id ? requireId(value.id, "workflow.id") : recordId("workflow");
    const previous = all
      .filter((workflow) => workflow.id === workflowId)
      .sort((a, b) => a.revision - b.revision)
      .at(-1);
    if (value.id && !previous) throw new IntelligenceValidationError(`Unknown workflow: ${workflowId}.`);
    const status = value.status ?? "active";
    if (!["active", "completed", "abandoned"].includes(status)) {
      throw new IntelligenceValidationError(`workflow.status is not supported: ${status}.`);
    }
    const items = normalizeWorkItems(value.items);
    await this.#assertWorkflowSkills(projectId, items);
    await this.#assertReferences(projectId, items.flatMap((item) => [...item.inputReferences, ...item.outputReferences]));
    this.#assertWorkflowEvolution(previous, items);
    await this.#assertWorkflowState(projectId, workflowId, items);
    if (status === "completed" && items.some((item) => !["completed", "cancelled"].includes(item.status))) {
      throw new IntelligenceValidationError("A completed workflow cannot contain unfinished work items.");
    }
    if (status === "active") {
      const latestById = new Map();
      for (const workflow of all) {
        const latest = latestById.get(workflow.id);
        if (!latest || workflow.revision > latest.revision) latestById.set(workflow.id, workflow);
      }
      const other = [...latestById.values()].find((workflow) =>
        workflow.id !== workflowId && workflow.status === "active"
      );
      if (other) {
        throw new IntelligenceValidationError(
          `Workflow ${other.id} is already active; complete or abandon it before activating another workflow.`
        );
      }
    }
    const workflow = {
      version: VERSION,
      id: workflowId,
      revision: (previous?.revision ?? 0) + 1,
      projectId,
      name: requireText(value.name, "workflow.name"),
      purpose: requireText(value.purpose, "workflow.purpose"),
      status,
      changeReason: previous
        ? requireText(value.changeReason, "workflow.changeReason")
        : requireText(value.changeReason ?? "Initial workflow.", "workflow.changeReason"),
      supersedes: previous ? { workflowId, revision: previous.revision } : null,
      items,
      metadata: value.metadata === undefined ? {} : structuredClone(requireObject(value.metadata, "workflow.metadata")),
      createdAt: timestamp(),
    };
    await writeJsonAtomic(
      join(projectDirectory(this.rootDir, projectId), "workflows", `${workflow.id}-r${workflow.revision}.json`),
      workflow,
    );
    return workflow;
  }

  async readWorkflows(projectId) {
    await this.projectStore.readProject(projectId);
    const records = await readRecords(join(projectDirectory(this.rootDir, projectId), "workflows"));
    return records
      .map((value) => this.#validateWorkflow(value, projectId))
      .sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision);
  }

  async readActiveWorkflow(projectId) {
    const latest = new Map();
    for (const workflow of await this.readWorkflows(projectId)) {
      const current = latest.get(workflow.id);
      if (!current || workflow.revision > current.revision) latest.set(workflow.id, workflow);
    }
    const active = [...latest.values()].filter((workflow) => workflow.status === "active");
    if (active.length > 1) {
      throw new IntelligenceValidationError("Stored project contains more than one active workflow.");
    }
    return active[0] ?? null;
  }

  async recordReview(projectId, value) {
    await this.projectStore.readProject(projectId);
    requireObject(value, "review");
    assertOnlyFields(
      value,
      ["target", "perspective", "verdict", "summary", "criteria", "reviewer"],
      "review"
    );
    const target = this.#normalizeReviewTarget(value.target);
    await this.#assertReviewTarget(projectId, target);
    const perspective = value.perspective ?? "combined";
    if (!["creative", "technical", "combined"].includes(perspective)) {
      throw new IntelligenceValidationError(`review.perspective is not supported: ${perspective}.`);
    }
    const verdict = requireText(value.verdict, "review.verdict");
    if (!["passed", "passed_with_notes", "revise", "blocked"].includes(verdict)) {
      throw new IntelligenceValidationError(`review.verdict is not supported: ${verdict}.`);
    }
    const criteria = normalizeReviewCriteria(value.criteria);
    assertReviewVerdict(verdict, criteria);
    const previous = (await this.readReviews(projectId)).filter((review) => targetKey(review.target) === targetKey(target));
    const review = {
      version: VERSION,
      id: recordId("review"),
      projectId,
      target,
      round: Math.max(0, ...previous.map((review) => review.round)) + 1,
      perspective,
      verdict,
      summary: requireText(value.summary, "review.summary"),
      criteria,
      reviewer: value.reviewer ?? "agent",
      createdAt: timestamp(),
    };
    if (!["agent", "user", "system"].includes(review.reviewer)) {
      throw new IntelligenceValidationError(`review.reviewer is not supported: ${review.reviewer}.`);
    }
    await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "reviews", `${review.id}.json`), review);
    return review;
  }

  async readReviews(projectId) {
    await this.projectStore.readProject(projectId);
    const records = await readRecords(join(projectDirectory(this.rootDir, projectId), "reviews"));
    return records
      .map((value) => this.#validateReview(value, projectId))
      .sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)) || a.round - b.round);
  }

  async readIntelligence(projectId) {
    const [artifacts, activeArtifacts, workflows, activeWorkflow, reviews, decisions] = await Promise.all([
      this.readArtifacts(projectId),
      this.readActiveArtifacts(projectId),
      this.readWorkflows(projectId),
      this.readActiveWorkflow(projectId),
      this.readReviews(projectId),
      this.projectStore.readDecisions(projectId),
    ]);
    const latestReviews = new Map();
    for (const review of reviews) {
      const key = targetKey(review.target);
      if (!latestReviews.has(key) || review.round > latestReviews.get(key).round) latestReviews.set(key, review);
    }
    const projectDecisions = decisions.filter((decision) => decision.kind === "project_decision");
    const currentWorkItems = activeWorkflow?.items.filter((item) =>
      ["ready", "in_progress", "awaiting_review", "awaiting_approval", "blocked"].includes(item.status),
    ) ?? [];
    const pendingApprovals = activeWorkflow?.items.filter((item) =>
      item.approval === "required" && item.status === "awaiting_approval" && !this.#hasApproval(projectDecisions, activeWorkflow.id, item.id),
    ) ?? [];
    const skillIds = [...new Set(currentWorkItems.flatMap((item) => item.skillIds))];
    const catalog = await this.#catalog(projectId);
    const skills = catalog
      ? (await catalog.listPublic()).filter((skill) => skillIds.includes(skill.id))
      : [];
    return {
      artifacts,
      activeArtifacts,
      workflows,
      activeWorkflow,
      reviews,
      latestReviews: [...latestReviews.values()],
      projectDecisions,
      currentWorkItems,
      pendingApprovals,
      relevantSkills: skills,
    };
  }

  #validateArtifact(value, projectId) {
    requireObject(value, "stored artifact");
    assertOnlyFields(
      value,
      ["version", "id", "projectId", "key", "revision", "supersedes", "type", "name", "summary", "status", "data", "references", "createdBy", "createdAt"],
      "stored artifact"
    );
    if (value.projectId !== projectId || value.version !== VERSION || !Number.isInteger(value.revision) || value.revision < 1) {
      throw new IntelligenceValidationError("Stored artifact identity or revision is invalid.");
    }
    requireId(value.id, "artifact.id");
    requireId(value.key, "artifact.key");
    requireId(value.type, "artifact.type");
    requireText(value.name, "artifact.name");
    requireText(value.summary, "artifact.summary");
    assertTimestamp(value.createdAt, "artifact.createdAt");
    if (
      !["draft", "active", "retired"].includes(value.status) ||
      !["agent", "user", "system"].includes(value.createdBy) ||
      !(value.supersedes === null || typeof value.supersedes === "string") ||
      !isPlainObject(value.data) ||
      !Array.isArray(value.references)
    ) {
      throw new IntelligenceValidationError("Stored artifact payload is invalid.");
    }
    normalizeReferences(value.references);
    return value;
  }

  #validateWorkflow(value, projectId) {
    requireObject(value, "stored workflow");
    assertOnlyFields(
      value,
      ["version", "id", "revision", "projectId", "name", "purpose", "status", "changeReason", "supersedes", "items", "metadata", "createdAt"],
      "stored workflow"
    );
    if (value.projectId !== projectId || value.version !== VERSION || !Number.isInteger(value.revision) || value.revision < 1) {
      throw new IntelligenceValidationError("Stored workflow identity or revision is invalid.");
    }
    requireId(value.id, "workflow.id");
    requireText(value.name, "workflow.name");
    requireText(value.purpose, "workflow.purpose");
    requireText(value.changeReason, "workflow.changeReason");
    assertTimestamp(value.createdAt, "workflow.createdAt");
    const validSupersedes = value.revision === 1
      ? value.supersedes === null
      : isPlainObject(value.supersedes) &&
        value.supersedes.workflowId === value.id &&
        value.supersedes.revision === value.revision - 1;
    if (!["active", "completed", "abandoned"].includes(value.status) || !isPlainObject(value.metadata) || !validSupersedes) {
      throw new IntelligenceValidationError("Stored workflow payload is invalid.");
    }
    normalizeWorkItems(value.items);
    return value;
  }

  #validateReview(value, projectId) {
    requireObject(value, "stored review");
    assertOnlyFields(
      value,
      ["version", "id", "projectId", "target", "round", "perspective", "verdict", "summary", "criteria", "reviewer", "createdAt"],
      "stored review"
    );
    if (value.projectId !== projectId || value.version !== VERSION || !Number.isInteger(value.round) || value.round < 1) {
      throw new IntelligenceValidationError("Stored review identity or round is invalid.");
    }
    requireId(value.id, "review.id");
    this.#normalizeReviewTarget(value.target);
    const criteria = normalizeReviewCriteria(value.criteria);
    requireText(value.summary, "review.summary");
    assertTimestamp(value.createdAt, "review.createdAt");
    if (
      !["creative", "technical", "combined"].includes(value.perspective) ||
      !["passed", "passed_with_notes", "revise", "blocked"].includes(value.verdict) ||
      !["agent", "user", "system"].includes(value.reviewer)
    ) {
      throw new IntelligenceValidationError("Stored review payload is invalid.");
    }
    assertReviewVerdict(value.verdict, criteria);
    return value;
  }

  #normalizeReviewTarget(value) {
    const target = requireObject(value, "review.target");
    const kind = requireText(target.kind, "review.target.kind");
    if (["artifact", "result"].includes(kind)) {
      assertOnlyFields(target, ["kind", "id"], "review.target");
      return { kind, id: requireText(target.id, "review.target.id") };
    }
    if (kind === "work_item") {
      assertOnlyFields(target, ["kind", "workflowId", "workItemId"], "review.target");
      return {
        kind,
        workflowId: requireId(target.workflowId, "review.target.workflowId"),
        workItemId: requireId(target.workItemId, "review.target.workItemId"),
      };
    }
    throw new IntelligenceValidationError(`review.target.kind is not supported: ${kind}.`);
  }

  async #assertReferences(projectId, references) {
    if (references.length === 0) return;
    const [resources, results, artifacts, runs, decisions, reviews, workflows] = await Promise.all([
      this.projectStore.readResources(projectId),
      this.projectStore.readResults(projectId),
      this.readArtifacts(projectId),
      this.projectStore.readRuns(projectId),
      this.projectStore.readDecisions(projectId),
      this.readReviews(projectId),
      this.readWorkflows(projectId),
    ]);
    const known = {
      resource: new Set(resources.map((item) => item.id)),
      result: new Set(results.map((item) => item.id)),
      artifact: new Set(artifacts.map((item) => item.id)),
      run: new Set(runs.map((item) => item.id)),
      decision: new Set(decisions.map((item) => item.id)),
      review: new Set(reviews.map((item) => item.id)),
      workflow: new Set(workflows.map((item) => item.id)),
    };
    const missing = references.filter((ref) => !known[ref.kind].has(ref.id));
    if (missing.length) throw new IntelligenceValidationError(`Unknown references: ${missing.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}.`);
  }

  async #assertWorkflowSkills(projectId, items) {
    const catalog = await this.#catalog(projectId);
    if (!catalog) return;
    const known = new Set((await catalog.list()).map((skill) => skill.id));
    const missing = [...new Set(items.flatMap((item) => item.skillIds).filter((id) => !known.has(id)))];
    if (missing.length) throw new IntelligenceValidationError(`Unknown workflow skills: ${missing.join(", ")}.`);
  }

  async #catalog(projectId) {
    return typeof this.skillCatalog === 'function' ? this.skillCatalog(projectId) : this.skillCatalog;
  }

  async #assertWorkflowState(projectId, workflowId, items) {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const [reviews, decisions] = await Promise.all([this.readReviews(projectId), this.projectStore.readDecisions(projectId)]);
    for (const item of items) {
      if (["ready", "in_progress", "awaiting_review", "awaiting_approval", "completed"].includes(item.status)) {
        const pending = item.dependsOn.filter((id) => itemMap.get(id).status !== "completed");
        if (pending.length) throw new IntelligenceValidationError(`Work item ${item.id} cannot be ${item.status}; incomplete dependencies: ${pending.join(", ")}.`);
      }
      if (item.status === "completed" && item.review.required) {
        const latest = reviews
          .filter((review) => targetKey(review.target) === `work_item:${workflowId}:${item.id}`)
          .sort((a, b) => a.round - b.round)
          .at(-1);
        if (!latest || !["passed", "passed_with_notes"].includes(latest.verdict)) {
          throw new IntelligenceValidationError(`Work item ${item.id} requires a passing review before completion.`);
        }
      }
      if (item.status === "awaiting_approval") {
        if (item.outputReferences.length === 0) {
          throw new IntelligenceValidationError(
            `Work item ${item.id} requires an output reference before awaiting approval.`
          );
        }
        if (item.review.required) {
          const latest = reviews
            .filter((review) => targetKey(review.target) === `work_item:${workflowId}:${item.id}`)
            .sort((a, b) => a.round - b.round)
            .at(-1);
          if (!latest || !["passed", "passed_with_notes"].includes(latest.verdict)) {
            throw new IntelligenceValidationError(
              `Work item ${item.id} requires a passing review before awaiting approval.`
            );
          }
        }
      }
      if (item.status === "completed" && item.outputReferences.length === 0) {
        throw new IntelligenceValidationError(`Work item ${item.id} requires at least one output reference before completion.`);
      }
      if (item.status === "completed" && item.approval === "required" && !this.#hasApproval(decisions, workflowId, item.id)) {
        throw new IntelligenceValidationError(`Work item ${item.id} requires user approval before completion.`);
      }
    }
  }

  #assertWorkflowEvolution(previous, items) {
    if (!previous) return;
    const nextById = new Map(items.map((item) => [item.id, item]));
    for (const oldItem of previous.items) {
      const nextItem = nextById.get(oldItem.id);
      if (!nextItem) continue;
      if (["completed", "cancelled"].includes(oldItem.status) && nextItem.status !== oldItem.status) {
        throw new IntelligenceValidationError(
          `Work item ${oldItem.id} is terminal and cannot move from ${oldItem.status} to ${nextItem.status}.`
        );
      }
      if (!["awaiting_review", "awaiting_approval", "completed"].includes(oldItem.status)) continue;
      const stableBefore = {
        title: oldItem.title,
        purpose: oldItem.purpose,
        expectedOutputs: oldItem.expectedOutputs,
        review: oldItem.review,
        approval: oldItem.approval,
      };
      const stableAfter = {
        title: nextItem.title,
        purpose: nextItem.purpose,
        expectedOutputs: nextItem.expectedOutputs,
        review: nextItem.review,
        approval: nextItem.approval,
      };
      if (JSON.stringify(stableBefore) !== JSON.stringify(stableAfter)) {
        throw new IntelligenceValidationError(
          `Work item ${oldItem.id} has entered review/approval; change its identity instead of rewriting its meaning.`
        );
      }
      const nextOutputs = new Set(nextItem.outputReferences.map((ref) => `${ref.kind}:${ref.id}`));
      const removed = oldItem.outputReferences.filter((ref) => !nextOutputs.has(`${ref.kind}:${ref.id}`));
      if (removed.length) {
        throw new IntelligenceValidationError(`Work item ${oldItem.id} cannot discard outputs after review/approval begins.`);
      }
      if (
        oldItem.status === "awaiting_approval" &&
        nextItem.status === "completed" &&
        oldItem.outputReferences.length !== nextItem.outputReferences.length
      ) {
        throw new IntelligenceValidationError(
          `Work item ${oldItem.id} cannot change approved outputs while completing.`
        );
      }
    }
  }

  #hasApproval(decisions, workflowId, workItemId) {
    const latest = decisions.filter((decision) =>
      decision.kind === "project_decision" &&
      decision.decidedBy === "user" &&
      decision.target?.kind === "work_item" &&
      decision.target.workflowId === workflowId &&
      decision.target.workItemId === workItemId
    ).at(-1);
    return latest?.outcome === "approved";
  }

  async #assertReviewTarget(projectId, target) {
    if (target.kind === "artifact") {
      if (!(await this.readArtifacts(projectId)).some((artifact) => artifact.id === target.id)) throw new IntelligenceValidationError(`Unknown artifact: ${target.id}.`);
      return;
    }
    if (target.kind === "result") {
      await this.projectStore.readResult(projectId, target.id);
      return;
    }
    const workflow = (await this.readWorkflows(projectId)).filter((item) => item.id === target.workflowId).at(-1);
    if (!workflow?.items.some((item) => item.id === target.workItemId)) {
      throw new IntelligenceValidationError(`Unknown work item: ${target.workflowId}/${target.workItemId}.`);
    }
  }
}
