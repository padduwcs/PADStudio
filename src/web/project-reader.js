import { lstat, realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
  isPathInside,
  inputsDirectory,
  projectDirectory,
  ProjectPathError,
  resolveInputPath
} from "../project/project-paths.js";
import { mediaType } from "../resources/media-files.js";
import {
  ProjectStore,
  ProjectStoreError,
  StoredProjectNotFoundError
} from "../project/project-store.js";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { AnalysisReader } from "../analysis/analysis-reader.js";
import { projectGeneration } from "./project-generation.js";

export class ProjectNotFoundError extends Error {
  constructor(projectId) {
    super(`Không tìm thấy project: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectInputNotFoundError extends Error {
  constructor(message = "Không tìm thấy tư liệu trong project.") {
    super(message);
    this.name = "ProjectInputNotFoundError";
  }
}

export class ProjectResultFileNotFoundError extends Error {
  constructor(message = "Không tìm thấy file kết quả trong project.") {
    super(message);
    this.name = "ProjectResultFileNotFoundError";
  }
}

async function safeInputDirectory(projectDirectoryPath, rootDir, projectId) {
  const inputDirectory = inputsDirectory(rootDir, projectId);
  try {
    const info = await lstat(inputDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const [resolvedProjectDirectory, resolvedInputDirectory] = await Promise.all([
      realpath(projectDirectoryPath),
      realpath(inputDirectory)
    ]);
    if (!isPathInside(resolvedProjectDirectory, resolvedInputDirectory)) return null;
    return resolvedInputDirectory;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function compactArtifact(artifact) {
  const { id, key, revision, type, name, summary, status, createdAt } = artifact;
  return { id, key, revision, type, name, summary, status, createdAt };
}

function compactReview(review) {
  const { id, target, round, perspective, verdict, summary, reviewer, createdAt } = review;
  return { id, target, round, perspective, verdict, summary, reviewer, createdAt };
}

function observerSection(context, section, generation) {
  const base = { version: "1.0", view: `observer-${section}`, generation, project: context.project };
  if (section === "summary") {
    return { ...base, checkpoint: context.checkpoint, checkpointFreshness: context.checkpointFreshness,
      resumeView: context.resumeView,
      intelligence: {
        activeWorkflow: context.intelligence.activeWorkflow,
        activeArtifacts: context.intelligence.activeArtifacts.map(compactArtifact),
        latestReviews: context.intelligence.latestReviews.map(compactReview),
        currentWorkItems: context.intelligence.currentWorkItems,
        pendingApprovals: context.intelligence.pendingApprovals,
        relevantSkills: context.intelligence.relevantSkills,
      },
      counts: { resources: context.resources.length, results: context.results.length,
        runs: context.runs.length, artifacts: context.artifacts.length },
    };
  }
  if (section === "source") {
    return { ...base, resources: context.resources, results: context.results, analysis: context.analysis,
      intelligence: { activeArtifacts: context.intelligence.activeArtifacts.filter((artifact) =>
        artifact.type.startsWith("source.")) } };
  }
  if (section === "creative") {
    return { ...base,
      artifacts: context.artifacts.filter((artifact) =>
        ["project.brief", "creative.proposal", "creative.direction"].includes(artifact.type)),
      reviews: context.reviews, decisions: context.decisions, projectDecisions: context.projectDecisions,
      intelligence: { activeArtifacts: context.intelligence.activeArtifacts.map(compactArtifact),
        pendingApprovals: context.intelligence.pendingApprovals },
      production: { sequences: context.production.sequences, artifactStates: context.production.artifactStates },
    };
  }
  if (section === "production") {
    return { ...base, production: { sequences: context.production.sequences,
      affectedWorkItems: context.production.affectedWorkItems, note: context.production.note } };
  }
  if (section === "health") {
    return {
      ...base,
      health: context.health,
      runRecovery: context.runRecovery
    };
  }
  if (section === "delivery") {
    const bundles = context.results.filter((result) => result.type === "delivery.bundle");
    const sourceResultIds = new Set(bundles.map((result) => result.data?.sourceResultId).filter(Boolean));
    return {
      ...base,
      delivery: {
        bundles,
        sourceResults: context.results.filter((result) => sourceResultIds.has(result.id)),
        approvalDecisions: context.decisions.filter((decision) =>
          sourceResultIds.has(decision.resultId) && decision.outcome === "accepted")
      }
    };
  }
  if (section === "activity") {
    return { ...base, resources: context.resources, results: context.results, decisions: context.decisions,
      runs: context.runs, artifacts: context.artifacts, reviews: context.reviews,
      runRecovery: context.runRecovery };
  }
  throw new ProjectNotFoundError(`observer section ${section}`);
}

export class ProjectReader {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.store = new ProjectStore(rootDir);
    this.analysisReader = new AnalysisReader({ rootDir, projectStore: this.store });
    this.contextAssembler = new ProjectContextAssembler({
      projectStore: this.store,
      toolRegistry: createDefaultToolRegistry(),
      analysisReader: this.analysisReader
    });
    this.observerCache = new Map();
  }

  async list() {
    return this.store.listProjects();
  }

  async listObserverProjects() {
    const projects = await this.store.listProjects();
    return Promise.all(projects.map(async (project) => ({
      ...project,
      generation: await projectGeneration(this.rootDir, project.id),
    })));
  }

  async generation(projectId) {
    await this.store.readProject(projectId);
    return projectGeneration(this.rootDir, projectId);
  }

  async readObserverSection(projectId, section, generation = null) {
    let currentGeneration = generation ?? await this.generation(projectId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = this.observerCache.get(projectId);
      let promise;
      if (existing?.generation === currentGeneration) {
        promise = existing.promise;
      } else {
        promise = this.readProject(projectId);
        this.observerCache.set(projectId, { generation: currentGeneration, promise });
        promise.catch(() => {
          if (this.observerCache.get(projectId)?.promise === promise) this.observerCache.delete(projectId);
        });
      }
      const context = await promise;
      const afterGeneration = await this.generation(projectId);
      if (afterGeneration === currentGeneration) {
        return observerSection(context, section, currentGeneration);
      }
      if (this.observerCache.get(projectId)?.promise === promise) this.observerCache.delete(projectId);
      currentGeneration = afterGeneration;
    }
    throw new ProjectStoreError("Project thay đổi liên tục; chưa thể tạo observer snapshot nhất quán.");
  }

  async readProjectSnapshot(projectId, view = "full", generation = null) {
    let beforeGeneration = generation ?? await this.generation(projectId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = view === "summary"
        ? await this.readProjectSummary(projectId)
        : await this.readProject(projectId);
      const afterGeneration = await this.generation(projectId);
      if (afterGeneration === beforeGeneration) {
        return { generation: afterGeneration, context };
      }
      beforeGeneration = afterGeneration;
    }
    throw new ProjectStoreError("Project thay đổi liên tục; chưa thể tạo snapshot nhất quán.");
  }

  async readOverview(projectId) {
    try {
      const [project, overview] = await Promise.all([
        this.store.readProject(projectId),
        this.store.readOverview(projectId)
      ]);
      return { id: project.id, overview };
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readProject(projectId) {
    try {
      return await this.contextAssembler.build(projectId);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readProjectSummary(projectId) {
    try {
      return await this.contextAssembler.buildSummary(projectId);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readAnalysis(projectId, query = {}) {
    try {
      return await this.analysisReader.query(projectId, query);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  async readInputFile(projectId, inputPath) {
    let context;
    try {
      context = await this.store.readContext(projectId);
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      throw error;
    }

    const directory = projectDirectory(this.rootDir, projectId);
    const inputRoot = await safeInputDirectory(directory, this.rootDir, projectId);
    if (!inputRoot) throw new ProjectInputNotFoundError();

    const registeredPaths = new Set(
      context.resources.flatMap((resource) =>
        resource.items.map((item) => item.path.startsWith("inputs/") ? item.path.slice(7) : "")
      )
    );
    if (!registeredPaths.has(inputPath)) throw new ProjectInputNotFoundError();

    try {
      const requestedPath = resolveInputPath(inputRoot, inputPath);
      const resolvedFile = await realpath(requestedPath);
      if (!isPathInside(inputRoot, resolvedFile)) throw new ProjectInputNotFoundError();
      const info = await lstat(resolvedFile);
      if (!info.isFile()) throw new ProjectInputNotFoundError();
      return {
        filePath: resolvedFile,
        name: basename(resolvedFile),
        size: info.size,
        mediaType: mediaType(resolvedFile)
      };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof ProjectPathError) {
        throw new ProjectInputNotFoundError();
      }
      throw error;
    }
  }

  async readResultFile(projectId, resultId, fileId) {
    try {
      const file = await this.store.verifyResultFile(
        projectId, resultId, fileId, { requireChecksum: false }
      );
      return {
        filePath: file.filePath,
        name: file.name,
        size: file.size,
        mediaType: file.mediaType
      };
    } catch (error) {
      if (error instanceof StoredProjectNotFoundError) throw new ProjectNotFoundError(projectId);
      if (error instanceof ProjectStoreError || error instanceof ProjectPathError) {
        throw new ProjectResultFileNotFoundError();
      }
      throw error;
    }
  }
}
