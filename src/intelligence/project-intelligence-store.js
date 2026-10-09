import { segmentMediaSources } from "../production/sequence-composition.js";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../project/atomic-files.js";
import { projectDirectory } from "../project/project-paths.js";
import { withFileLock } from "../project/file-lock.js";
import {
  IntelligenceValidationError,
  assertOnlyFields,
  isPlainObject,
  normalizeReferences,
  normalizeReviewCriteria,
  normalizeStringList,
  normalizeWorkItems,
  requireId,
  requireObject,
  requireText
} from "./contracts.js";

import { SEQUENCE_TYPE, normalizeSequence, sequenceReferences } from "../production/video-sequence.js";
import {
  SOURCE_ARTIFACT_TYPES,
  normalizeSourceArtifactData,
  validateSourceArtifactAgainstProject
} from "./source-artifacts.js";
import {
  CREATIVE_ARTIFACT_TYPES,
  normalizeCreativeArtifactData,
  validateCreativeArtifactReferences,
} from "./creative-artifacts.js";
import { normalizeHumanAttestation } from "./human-attestation.js";
import { requireHumanConfirmation, validHumanConfirmation } from "../project/human-confirmation.js";
import {
  ANIMATION_COMPOSITION_TYPE,
  normalizeAnimationComposition,
  validateAnimationCompositionAgainstProject,
} from "../animation/animation-composition.js";
import {
  ANIMATION_CHOREOGRAPHY_TYPE,
  normalizeVisualChoreography,
} from "../animation/visual-choreography.js";

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

function referenceKey(reference) {
  return `${reference.kind}:${reference.id}`;
}

function sameReferences(left, right) {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(referenceKey));
  return left.every((reference) => rightKeys.has(referenceKey(reference)));
}

function normalizedCriterion(value) {
  return value.trim().toLocaleLowerCase("en-US");
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

function normalizeVideoInspection(value) {
  const inspection = requireObject(value, "review.inspection");
  assertOnlyFields(inspection, ["version", "visual", "audio", "limitations"], "review.inspection");
  if (inspection.version !== "1.0") throw new IntelligenceValidationError("review.inspection.version must be 1.0.");
  const visual = requireObject(inspection.visual, "review.inspection.visual");
  const audio = requireObject(inspection.audio, "review.inspection.audio");
  assertOnlyFields(visual, ["method", "evidence"], "review.inspection.visual");
  assertOnlyFields(audio, ["method", "evidence"], "review.inspection.audio");
  if (!["not_reviewed", "sampled_frames", "motion_samples", "continuous_playback"].includes(visual.method)) {
    throw new IntelligenceValidationError("review.inspection.visual.method is not supported.");
  }
  if (!["not_reviewed", "analysis_only", "sampled_listening", "continuous_listening", "not_applicable"].includes(audio.method)) {
    throw new IntelligenceValidationError("review.inspection.audio.method is not supported.");
  }
  return {
    version: "1.0",
    visual: { method: visual.method, evidence: requireText(visual.evidence, "review.inspection.visual.evidence") },
    audio: { method: audio.method, evidence: requireText(audio.evidence, "review.inspection.audio.evidence") },
    limitations: normalizeStringList(inspection.limitations, "review.inspection.limitations")
  };
}

function assertVideoInspectionVerdict(inspection, verdict) {
  if (!["passed", "passed_with_notes"].includes(verdict)) return;
  if (!["motion_samples", "continuous_playback"].includes(inspection.visual.method) ||
      !["sampled_listening", "continuous_listening", "not_applicable"].includes(inspection.audio.method)) {
    throw new IntelligenceValidationError("A positive creative video review requires motion evidence and listening to available audio.");
  }
  const limited = inspection.visual.method !== "continuous_playback" ||
    !["continuous_listening", "not_applicable"].includes(inspection.audio.method);
  if (limited && verdict === "passed") {
    throw new IntelligenceValidationError("A sampled video review cannot have an unqualified passed verdict.");
  }
  if (limited && inspection.limitations.length === 0) {
    throw new IntelligenceValidationError("A sampled video review must describe its inspection limits.");
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
      ["key", "type", "name", "summary", "status", "data", "references", "createdBy", "expectedRevision"],
      "artifact"
    );
    const key = requireId(value.key, "artifact.key");
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "artifacts",
      action: async () => {
        const type = requireId(value.type, "artifact.type");
        const name = requireText(value.name, "artifact.name");
        const summary = requireText(value.summary, "artifact.summary");
        const status = value.status ?? "active";
        if (!["draft", "active", "retired"].includes(status)) {
          throw new IntelligenceValidationError(`artifact.status is not supported: ${status}.`);
        }
        if (!isPlainObject(value.data)) throw new IntelligenceValidationError("artifact.data must be an object.");
        const sourceData = normalizeSourceArtifactData(type, value.data);
        const creativeData = normalizeCreativeArtifactData(type, value.data, {
          allowLegacy: status === "retired",
        });
        const data = type === SEQUENCE_TYPE
          ? normalizeSequence(value.data)
          : type === ANIMATION_COMPOSITION_TYPE
            ? normalizeAnimationComposition(value.data)
            : type === ANIMATION_CHOREOGRAPHY_TYPE
              ? normalizeVisualChoreography(value.data)
            : sourceData ?? creativeData ?? structuredClone(value.data);
        const references = normalizeReferences(value.references);
        if (type === SEQUENCE_TYPE) {
          // Keep local dependencies inside their segment, not in the global reference list.
          // Otherwise revising one segment would invalidate the cache of every other segment.
          await this.#assertReferences(projectId, sequenceReferences(data));
          if (status !== "retired") {
            for (const segment of data.segments) {
              for (const source of segmentMediaSources(segment)) {
                await this.projectStore.resolveMediaSource(projectId, source);
              }
            }
          }
        }
        if (type === SEQUENCE_TYPE && status !== "retired") {
          for (const track of data.music ?? []) await this.projectStore.resolveMediaSource(projectId, track.source);
        }
        if (SOURCE_ARTIFACT_TYPES.has(type)) {
          await validateSourceArtifactAgainstProject({
            projectStore: this.projectStore,
            projectId,
            type,
            data,
            references,
            status
          });
        }
        if (type === ANIMATION_COMPOSITION_TYPE) {
          await validateAnimationCompositionAgainstProject({
            projectStore: this.projectStore,
            projectId,
            data,
            references,
            status,
          });
        }
        await this.#assertReferences(projectId, references);
        if (CREATIVE_ARTIFACT_TYPES.has(type) && !(status === "retired" && value.data.version === undefined)) {
          await validateCreativeArtifactReferences({
            type,
            data,
            references,
            artifacts: await this.readArtifacts(projectId),
          });
        }
        const previous = (await this.readArtifacts(projectId))
          .filter((artifact) => artifact.key === key)
          .sort((a, b) => a.revision - b.revision)
          .at(-1);
        if (
          (previous && (
            type === SEQUENCE_TYPE ||
            type === ANIMATION_COMPOSITION_TYPE ||
            type === ANIMATION_CHOREOGRAPHY_TYPE ||
            SOURCE_ARTIFACT_TYPES.has(type) ||
            CREATIVE_ARTIFACT_TYPES.has(type)
          )) ||
          value.expectedRevision !== undefined
        ) {
          if (!Number.isInteger(value.expectedRevision) || value.expectedRevision !== (previous?.revision ?? 0)) {
            throw new IntelligenceValidationError("Artifact revision conflict: reread the latest revision before writing.");
          }
        }
        if (previous && previous.type !== type) {
          throw new IntelligenceValidationError(`Artifact ${key} cannot change type from ${previous.type} to ${type}.`);
        }
        if (type === SEQUENCE_TYPE && status === "active") {
          const otherCurrent = (await this.readActiveArtifacts(projectId)).find((artifact) =>
            artifact.type === SEQUENCE_TYPE && artifact.key !== key
          );
          if (otherCurrent) {
            throw new IntelligenceValidationError(
              `Video sequence ${otherCurrent.key} is already current; retire it or save ${key} as a draft candidate before activating another sequence.`
            );
          }
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
          data,
          references,
          createdBy: value.createdBy ?? "agent",
          createdAt: timestamp(),
        };
        if (!["agent", "user", "system"].includes(artifact.createdBy)) {
          throw new IntelligenceValidationError(`artifact.createdBy is not supported: ${artifact.createdBy}.`);
        }
        await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "artifacts", `${artifact.id}.json`), artifact);
        return artifact;
      },
    });
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
      ["id", "name", "purpose", "status", "changeReason", "items", "metadata", "expectedRevision"],
      "workflow"
    );
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "workflows",
      action: async () => {
        const all = await this.readWorkflows(projectId);
        const workflowId = value.id ? requireId(value.id, "workflow.id") : recordId("workflow");
        const previous = all
          .filter((workflow) => workflow.id === workflowId)
          .sort((a, b) => a.revision - b.revision)
          .at(-1);
        if (value.id && !previous) throw new IntelligenceValidationError(`Unknown workflow: ${workflowId}.`);
        if (previous && (!Number.isInteger(value.expectedRevision) || value.expectedRevision !== previous.revision)) {
          throw new IntelligenceValidationError("Workflow revision conflict: reread the latest revision before writing.");
        }
        if (!previous && value.expectedRevision !== undefined && value.expectedRevision !== 0) {
          throw new IntelligenceValidationError("Workflow revision conflict: a new workflow expects revision 0.");
        }
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
      },
    });
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

  async recordReview(projectId, value, { humanConfirmation = null } = {}) {
    await this.projectStore.readProject(projectId);
    requireObject(value, "review");
    assertOnlyFields(
      value,
      ["target", "perspective", "verdict", "summary", "criteria", "reviewer", "attestation", "inspection"],
      "review"
    );
    const target = this.#normalizeReviewTarget(value.target);
    return withFileLock({
      projectDirectory: projectDirectory(this.rootDir, projectId),
      name: "reviews",
      action: async () => {
        const targetState = await this.#assertReviewTarget(projectId, target);
        const perspective = value.perspective ?? "combined";
        if (!["creative", "technical", "combined", "human"].includes(perspective)) {
          throw new IntelligenceValidationError(`review.perspective is not supported: ${perspective}.`);
        }
        const verdict = requireText(value.verdict, "review.verdict");
        if (!["passed", "passed_with_notes", "revise", "blocked"].includes(verdict)) {
          throw new IntelligenceValidationError(`review.verdict is not supported: ${verdict}.`);
        }
        const criteria = normalizeReviewCriteria(value.criteria);
        assertReviewVerdict(verdict, criteria);
        const reviewer = value.reviewer ?? "agent";
        const attestation = value.attestation === undefined ? null : normalizeHumanAttestation(value.attestation);
        if (perspective === "human" && value.inspection !== undefined) {
          throw new IntelligenceValidationError("Human review uses direct confirmation, not agent inspection metadata.");
        }
        const inspection = value.inspection === undefined ? null : normalizeVideoInspection(value.inspection);
        const creativeVideoReview = target.kind === "result" && targetState.result.type === "video.sequence-render" &&
          reviewer === "agent" && ["creative", "combined"].includes(perspective);
        if (creativeVideoReview && !inspection) {
          throw new IntelligenceValidationError("Agent creative review of an exact video requires review.inspection.");
        }
        if (target.kind === "result" && targetState.result.type === "video.sequence-render" &&
            inspection?.audio.method === "not_applicable" && targetState.result.data?.hasAudio !== false) {
          throw new IntelligenceValidationError("review.inspection.audio cannot be not_applicable when the render has audio.");
        }
        if (creativeVideoReview) assertVideoInspectionVerdict(inspection, verdict);
        if (perspective === "human" && (target.kind !== "result" || reviewer !== "user" || !attestation)) {
          throw new IntelligenceValidationError("Human review requires a user attestation on an exact Result.");
        }
        if (perspective !== "human" && attestation) throw new IntelligenceValidationError("Attestation is only valid for a human review.");
        const confirmation = perspective === "human"
          ? requireHumanConfirmation(humanConfirmation, "review_video", target.id)
          : null;
        if (attestation && (targetState.result.type !== "video.sequence-render" || typeof targetState.result.data?.sequence?.artifactId !== "string" || !Number.isInteger(targetState.result.data?.sequence?.revision))) {
          throw new IntelligenceValidationError("Human attestation requires an exact video.sequence-render with artifact revision.");
        }
        let binding = null;
        if (target.kind === "work_item") {
          const { workflow, item } = targetState;
          if (workflow.status !== "active" || item.status !== "awaiting_review") {
            throw new IntelligenceValidationError(
              `Work item ${item.id} must be awaiting_review before it can be reviewed.`
            );
          }
          if (item.outputReferences.length === 0) {
            throw new IntelligenceValidationError(
              `Work item ${item.id} requires an output reference before review.`
            );
          }
          if (perspective !== item.review.perspective) {
            throw new IntelligenceValidationError(
              `Review perspective must be ${item.review.perspective} for work item ${item.id}.`
            );
          }
          const reviewedCriteria = new Set(
            criteria.map((criterion) => normalizedCriterion(criterion.criterion))
          );
          const missingCriteria = item.review.criteria.filter(
            (criterion) => !reviewedCriteria.has(normalizedCriterion(criterion))
          );
          if (missingCriteria.length) {
            throw new IntelligenceValidationError(
              `Review does not cover required criteria: ${missingCriteria.join(", ")}.`
            );
          }
          binding = {
            workflowRevision: workflow.revision,
            outputReferences: structuredClone(item.outputReferences),
            requiredCriteria: [...item.review.criteria],
            perspective,
          };
        }
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
          reviewer,
          ...(inspection ? { inspection } : {}),
          ...(confirmation ? { confirmation } : {}),
          ...(attestation ? { attestation, exactResult: {
            sha256: (await this.projectStore.verifyResultFile(projectId, target.id, "primary")).sha256,
            artifactId: targetState.result.data?.sequence?.artifactId ?? null,
            artifactRevision: targetState.result.data?.sequence?.revision ?? null
          } } : {}),
          ...(binding ? { binding } : {}),
          createdAt: timestamp(),
        };
        if (!["agent", "user", "system"].includes(review.reviewer)) {
          throw new IntelligenceValidationError(`review.reviewer is not supported: ${review.reviewer}.`);
        }
        await writeJsonAtomic(join(projectDirectory(this.rootDir, projectId), "reviews", `${review.id}.json`), review);
        return review;
      },
    });
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
      item.approval === "required" &&
      item.status === "awaiting_approval" &&
      !this.#hasApproval(projectDecisions, reviews, activeWorkflow.id, item),
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
    if (value.type === SEQUENCE_TYPE) normalizeSequence(value.data);
    if (value.type === ANIMATION_COMPOSITION_TYPE) normalizeAnimationComposition(value.data, { allowLegacy: true });
    if (value.type === ANIMATION_CHOREOGRAPHY_TYPE) normalizeVisualChoreography(value.data);
    if (SOURCE_ARTIFACT_TYPES.has(value.type)) normalizeSourceArtifactData(value.type, value.data);
    if (CREATIVE_ARTIFACT_TYPES.has(value.type)) {
      normalizeCreativeArtifactData(value.type, value.data, { allowLegacy: true });
    }
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
      ["version", "id", "projectId", "target", "round", "perspective", "verdict", "summary", "criteria", "reviewer", "binding", "attestation", "exactResult", "confirmation", "inspection", "createdAt"],
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
      !["creative", "technical", "combined", "human"].includes(value.perspective) ||
      !["passed", "passed_with_notes", "revise", "blocked"].includes(value.verdict) ||
      !["agent", "user", "system"].includes(value.reviewer)
    ) {
      throw new IntelligenceValidationError("Stored review payload is invalid.");
    }
    assertReviewVerdict(value.verdict, criteria);
    if (value.inspection !== undefined) {
      const inspection = normalizeVideoInspection(value.inspection);
      if (value.perspective === "human") throw new IntelligenceValidationError("Stored human review cannot contain agent inspection metadata.");
      if (["creative", "combined"].includes(value.perspective)) assertVideoInspectionVerdict(inspection, value.verdict);
    }
    if (value.perspective === "human") {
      const { version: attestationVersion, ...storedAttestation } = value.attestation ?? {};
      if (attestationVersion !== VERSION) {
        throw new IntelligenceValidationError("Stored human attestation version is invalid.");
      }
      normalizeHumanAttestation(storedAttestation);
      if (value.reviewer !== "user" || value.target.kind !== "result" || !/^[a-f0-9]{64}$/.test(value.exactResult?.sha256) ||
          typeof value.exactResult?.artifactId !== "string" || !Number.isInteger(value.exactResult?.artifactRevision)) {
        throw new IntelligenceValidationError("Stored human review is not bound to an exact render revision.");
      }
      if (value.confirmation !== undefined && !validHumanConfirmation(value.confirmation, "review_video", value.target.id)) {
        throw new IntelligenceValidationError("Stored human review confirmation is invalid.");
      }
    } else if (value.attestation !== undefined || value.exactResult !== undefined) {
      throw new IntelligenceValidationError("Stored non-human review cannot contain attestation data.");
    }
    if (value.binding !== undefined) {
      this.#validateReviewBinding(value.binding);
    }
    return value;
  }

  #validateReviewBinding(value) {
    const binding = requireObject(value, "review.binding");
    assertOnlyFields(
      binding,
      ["workflowRevision", "outputReferences", "requiredCriteria", "perspective"],
      "review.binding"
    );
    if (!Number.isInteger(binding.workflowRevision) || binding.workflowRevision < 1) {
      throw new IntelligenceValidationError(
        "review.binding.workflowRevision must be a positive integer."
      );
    }
    if (normalizeReferences(binding.outputReferences, "review.binding.outputReferences").length === 0) {
      throw new IntelligenceValidationError("review.binding.outputReferences must not be empty.");
    }
    normalizeStringList(binding.requiredCriteria, "review.binding.requiredCriteria");
    if (!["creative", "technical", "combined"].includes(binding.perspective)) {
      throw new IntelligenceValidationError("review.binding.perspective is invalid.");
    }
    return binding;
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
    const [reviews, decisions, artifacts, results, resources, workflows] = await Promise.all([
      this.readReviews(projectId), this.projectStore.readDecisions(projectId), this.readArtifacts(projectId),
      this.projectStore.readResults(projectId), this.projectStore.readResources(projectId), this.readWorkflows(projectId),
    ]);
    const outputs = new Map([
      ...artifacts.map((r) => ["artifact:" + r.id, r]), ...results.map((r) => ["result:" + r.id, r]),
      ...resources.map((r) => ["resource:" + r.id, r]), ...reviews.map((r) => ["review:" + r.id, r]),
      ...decisions.map((r) => ["decision:" + r.id, r]), ...workflows.map((r) => ["workflow:" + r.id, r]),
    ]);
    for (const item of items) {
      if (["awaiting_review", "awaiting_approval", "completed"].includes(item.status)) {
        for (const expected of item.expectedOutputs) {
          if (!item.outputReferences.some((ref) => ref.kind === expected.kind &&
            outputs.has(ref.kind + ":" + ref.id) &&
            (!expected.type || outputs.get(ref.kind + ":" + ref.id).type === expected.type))) {
            throw new IntelligenceValidationError("Work item " + item.id + " is missing expected output " + expected.kind + (expected.type ? ":" + expected.type : "") + ".");
          }
        }
      }
    }
    for (const item of items) {
      if (["ready", "in_progress", "awaiting_review", "awaiting_approval", "completed"].includes(item.status)) {
        const pending = item.dependsOn.filter((id) => itemMap.get(id).status !== "completed");
        if (pending.length) throw new IntelligenceValidationError(`Work item ${item.id} cannot be ${item.status}; incomplete dependencies: ${pending.join(", ")}.`);
      }
      if (item.status === "completed" && item.review.required) {
        if (!this.#passingReviewForItem(reviews, workflowId, item)) {
          throw new IntelligenceValidationError(`Work item ${item.id} requires a passing review before completion.`);
        }
      }
      if (item.status === "awaiting_review" && item.outputReferences.length === 0) {
        throw new IntelligenceValidationError(
          `Work item ${item.id} requires an output reference before awaiting review.`
        );
      }
      if (item.status === "awaiting_approval") {
        if (item.outputReferences.length === 0) {
          throw new IntelligenceValidationError(
            `Work item ${item.id} requires an output reference before awaiting approval.`
          );
        }
        if (item.review.required) {
          if (!this.#passingReviewForItem(reviews, workflowId, item)) {
            throw new IntelligenceValidationError(
              `Work item ${item.id} requires a passing review before awaiting approval.`
            );
          }
        }
      }
      if (item.status === "completed" && item.outputReferences.length === 0) {
        throw new IntelligenceValidationError(`Work item ${item.id} requires at least one output reference before completion.`);
      }
      if (
        item.status === "completed" &&
        item.approval === "required" &&
        !this.#hasApproval(decisions, reviews, workflowId, item)
      ) {
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
        dependsOn: oldItem.dependsOn,
        skillIds: oldItem.skillIds,
        inputReferences: oldItem.inputReferences,
        expectedOutputs: oldItem.expectedOutputs,
        review: oldItem.review,
        approval: oldItem.approval,
        notes: oldItem.notes,
      };
      const stableAfter = {
        title: nextItem.title,
        purpose: nextItem.purpose,
        dependsOn: nextItem.dependsOn,
        skillIds: nextItem.skillIds,
        inputReferences: nextItem.inputReferences,
        expectedOutputs: nextItem.expectedOutputs,
        review: nextItem.review,
        approval: nextItem.approval,
        notes: nextItem.notes,
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

  #passingReviewForItem(reviews, workflowId, item) {
    const latest = reviews
      .filter((review) => targetKey(review.target) === `work_item:${workflowId}:${item.id}`)
      .sort((a, b) => a.round - b.round)
      .at(-1);
    if (!latest || !["passed", "passed_with_notes"].includes(latest.verdict)) return null;
    const binding = latest.binding;
    if (!binding || !sameReferences(binding.outputReferences, item.outputReferences)) return null;
    if (binding.perspective !== item.review.perspective) return null;
    if (
      binding.requiredCriteria.length !== item.review.criteria.length ||
      binding.requiredCriteria.some((criterion, index) => criterion !== item.review.criteria[index])
    ) return null;
    return latest;
  }

  #hasApproval(decisions, reviews, workflowId, item) {
    const passingReview = item.review.required
      ? this.#passingReviewForItem(reviews, workflowId, item)
      : null;
    const latest = decisions.filter((decision) =>
      decision.kind === "project_decision" &&
      decision.decidedBy === "user" &&
      decision.target?.kind === "work_item" &&
      decision.target.workflowId === workflowId &&
      decision.target.workItemId === item.id
    ).at(-1);
    return Boolean(
      latest?.outcome === "approved" &&
      latest.binding &&
      sameReferences(latest.binding.outputReferences, item.outputReferences) &&
      latest.binding.reviewId === (passingReview?.id ?? null)
    );
  }

  async createWorkItemDecisionBinding(projectId, workflowId, workItemId) {
    const workflow = await this.readActiveWorkflow(projectId);
    if (!workflow || workflow.id !== workflowId) {
      throw new IntelligenceValidationError("Approval must target the active workflow.");
    }
    const item = workflow.items.find((candidate) => candidate.id === workItemId);
    if (!item) throw new IntelligenceValidationError(`Unknown work item: ${workflowId}/${workItemId}.`);
    if (item.status !== "awaiting_approval") {
      throw new IntelligenceValidationError(
        `Work item ${item.id} must be awaiting_approval before a decision can be recorded.`
      );
    }
    if (item.outputReferences.length === 0) {
      throw new IntelligenceValidationError(`Work item ${item.id} has no output to approve.`);
    }
    const reviews = await this.readReviews(projectId);
    const passingReview = item.review.required
      ? this.#passingReviewForItem(reviews, workflow.id, item)
      : null;
    if (item.review.required && !passingReview) {
      throw new IntelligenceValidationError(
        `Work item ${item.id} requires a matching passing review before approval.`
      );
    }
    return {
      workflowRevision: workflow.revision,
      outputReferences: structuredClone(item.outputReferences),
      reviewId: passingReview?.id ?? null,
    };
  }

  async #assertReviewTarget(projectId, target) {
    if (target.kind === "artifact") {
      if (!(await this.readArtifacts(projectId)).some((artifact) => artifact.id === target.id)) throw new IntelligenceValidationError(`Unknown artifact: ${target.id}.`);
      return null;
    }
    if (target.kind === "result") {
      return { result: await this.projectStore.readResult(projectId, target.id) };
    }
    const workflow = (await this.readWorkflows(projectId)).filter((item) => item.id === target.workflowId).at(-1);
    const item = workflow?.items.find((candidate) => candidate.id === target.workItemId);
    if (!item) {
      throw new IntelligenceValidationError(`Unknown work item: ${target.workflowId}/${target.workItemId}.`);
    }
    return { workflow, item };
  }
}
