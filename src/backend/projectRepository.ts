import {randomUUID} from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  TopicProjectSchema,
  type TopicInput,
  type TopicProject,
  type UpdateTopicProject,
} from '../shared/topic.ts';

function toSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);
}

function createProjectId(topic: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = randomUUID().slice(0, 8);
  return `${toSlug(topic) || 'du-an'}-${date}-${suffix}`;
}

export interface ProjectRepository {
  createTopicProject(input: TopicInput): Promise<TopicProject>;
  listProjects(): Promise<TopicProject[]>;
  getProject(projectId: string): Promise<TopicProject | null>;
  updateProject(
    projectId: string,
    update: UpdateTopicProject,
  ): Promise<TopicProject | null>;
  deleteProject(projectId: string): Promise<boolean>;
}

function isValidProjectId(projectId: string) {
  return /^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId);
}

function assertProjectId(projectId: string) {
  if (!isValidProjectId(projectId)) {
    throw new Error('Project ID không hợp lệ.');
  }
}

export function createFileProjectRepository(
  projectsDirectory: string,
): ProjectRepository {
  function getProjectPaths(projectId: string) {
    assertProjectId(projectId);
    const projectDirectory = path.join(projectsDirectory, projectId);

    return {
      projectDirectory,
      projectFile: path.join(projectDirectory, 'project.json'),
      temporaryFile: path.join(projectDirectory, 'project.json.tmp'),
    };
  }

  async function writeProject(project: TopicProject) {
    const {projectDirectory, projectFile, temporaryFile} = getProjectPaths(
      project.id,
    );

    await mkdir(projectDirectory, {recursive: true});
    await writeFile(
      temporaryFile,
      `${JSON.stringify(project, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryFile, projectFile);
  }

  async function readProject(projectId: string) {
    const {projectFile} = getProjectPaths(projectId);

    try {
      const project = JSON.parse(await readFile(projectFile, 'utf8'));
      return TopicProjectSchema.parse(project);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }

      throw error;
    }
  }

  return {
    async createTopicProject(input) {
      const now = new Date().toISOString();
      const project: TopicProject = {
        id: createProjectId(input.topic),
        version: 1,
        status: 'draft',
        currentStep: 'topic',
        topicInput: input,
        createdAt: now,
        updatedAt: now,
      };

      await writeProject(project);
      return project;
    },

    async listProjects() {
      await mkdir(projectsDirectory, {recursive: true});
      const entries = await readdir(projectsDirectory, {withFileTypes: true});
      const projectResults = await Promise.allSettled(
        entries
          .filter(
            (entry) => entry.isDirectory() && isValidProjectId(entry.name),
          )
          .map((entry) => readProject(entry.name)),
      );

      return projectResults
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<TopicProject | null> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value)
        .filter((project): project is TopicProject => project !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    getProject: readProject,

    async updateProject(projectId, update) {
      const currentProject = await readProject(projectId);
      if (!currentProject) return null;

      const project: TopicProject = {
        ...currentProject,
        ...(update.topicInput ? {topicInput: update.topicInput} : {}),
        ...(update.currentStep ? {currentStep: update.currentStep} : {}),
        updatedAt: new Date().toISOString(),
      };

      await writeProject(project);
      return project;
    },

    async deleteProject(projectId) {
      const project = await readProject(projectId);
      if (!project) return false;

      const {projectDirectory} = getProjectPaths(projectId);
      await rm(projectDirectory, {recursive: true, force: false});
      return true;
    },
  };
}
