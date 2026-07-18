import {createHash, randomUUID} from 'node:crypto';
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
  currentProjectVersion,
  parseTopicProject,
  type CreateTopicProject,
  type ProjectListIssue,
  type ProjectListIssueCode,
  type TopicProject,
  type UpdateProject,
} from '../shared/topic.ts';
import {buildNarrationSource} from './narrationSource.ts';

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
  createTopicProject(request: CreateTopicProject): Promise<TopicProject>;
  listProjects(): Promise<{
    projects: TopicProject[];
    issues: ProjectListIssue[];
  }>;
  getProject(projectId: string): Promise<TopicProject | null>;
  updateProject(
    projectId: string,
    update: UpdateProject,
    expectedRevision: number,
  ): Promise<TopicProject | null>;
  deleteProject(projectId: string, expectedRevision: number): Promise<boolean>;
}

function isValidProjectId(projectId: string) {
  return /^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId);
}

function assertProjectId(projectId: string) {
  if (!isValidProjectId(projectId)) {
    throw new Error('Project ID không hợp lệ.');
  }
}

export class ProjectConflictError extends Error {
  readonly currentProject: TopicProject;

  constructor(currentProject: TopicProject) {
    super('Project đã được thay đổi bởi một thao tác khác.');
    this.currentProject = currentProject;
  }
}

export class ProjectDataError extends Error {
  readonly projectId: string;
  readonly code: ProjectListIssueCode;

  constructor(
    projectId: string,
    code: ProjectListIssueCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.projectId = projectId;
    this.code = code;
  }
}

function voiceSourceMatchesPlan(
  bundle: TopicProject['voiceBundle'],
  plan: TopicProject['voiceVisualPlan'],
) {
  if (!bundle || !plan || bundle.sections.length !== plan.sections.length) {
    return false;
  }
  const narration = buildNarrationSource(plan);
  if (
    bundle.sourceNarrationRevision !== plan.narrationRevision ||
    bundle.track.sourceTextHash !==
      createHash('sha256').update(narration.text).digest('hex')
  ) {
    return false;
  }
  return bundle.sections.every((section, index) => {
    const planSection = plan.sections[index];
    const sourceSection = narration.sections[index];
    return (
      planSection !== undefined &&
      sourceSection !== undefined &&
      section.outlineSectionId === planSection.outlineSectionId &&
      section.sourceTextHash ===
        createHash('sha256')
          .update(
            Array.from(narration.text)
              .slice(
                sourceSection.textStartIndex,
                sourceSection.textEndIndex,
              )
              .join(''),
          )
          .digest('hex') &&
      section.beats.length === planSection.beats.length &&
      section.beats.every(
        (beat, beatIndex) =>
          beat.beatId === planSection.beats[beatIndex]?.id,
      )
    );
  });
}

function animationSyncMatchesSources(
  sync: NonNullable<TopicProject['animationSyncBundle']>,
  motion: TopicProject['motionCanvasBundle'],
  voice: TopicProject['voiceBundle'],
) {
  return Boolean(
    motion &&
      voice &&
      motion.status === 'approved' &&
      voice.status === 'approved' &&
      motion.timingContractVersion === 1 &&
      sync.sourceMotionCanvasContentRevision === motion.contentRevision &&
      sync.sourceVoiceContentRevision === voice.contentRevision &&
      sync.sections.length === motion.scenes.length &&
      sync.sections.length === voice.sections.length &&
      sync.sections.every((section, sectionIndex) => {
        const scene = motion.scenes[sectionIndex];
        const voiceSection = voice.sections[sectionIndex];
        const timingEvents = scene?.timingEvents;
        return Boolean(
          scene &&
            voiceSection &&
            timingEvents &&
            section.sceneId === scene.id &&
            section.filePath === scene.filePath &&
            section.outlineSectionId === scene.outlineSectionId &&
            section.outlineSectionId === voiceSection.outlineSectionId &&
            section.beats.length === timingEvents.length &&
            section.beats.length === voiceSection.beats.length &&
            section.beats.every((beat, beatIndex) => {
              const timing = timingEvents[beatIndex];
              const voiceBeat = voiceSection.beats[beatIndex];
              return (
                timing &&
                voiceBeat &&
                beat.beatId === timing.beatId &&
                beat.beatId === voiceBeat.beatId &&
                beat.startEvent === timing.startEvent &&
                beat.endEvent === timing.endEvent &&
                Math.abs(
                  beat.voiceStartSeconds - voiceBeat.startSeconds,
                ) < 0.001 &&
                Math.abs(beat.voiceEndSeconds - voiceBeat.endSeconds) <
                  0.001
              );
            }),
        );
      }),
  );
}

export function createFileProjectRepository(
  projectsDirectory: string,
): ProjectRepository {
  const operationQueues = new Map<string, Promise<void>>();

  function runSerialized<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previousOperation =
      operationQueues.get(key) ?? Promise.resolve();
    const result = previousOperation.then(operation);
    const settledResult = result.then(
      () => undefined,
      () => undefined,
    );

    operationQueues.set(key, settledResult);

    return result.finally(() => {
      if (operationQueues.get(key) === settledResult) {
        operationQueues.delete(key);
      }
    });
  }

  function getProjectPaths(projectId: string) {
    assertProjectId(projectId);
    const projectDirectory = path.join(projectsDirectory, projectId);

    return {
      projectDirectory,
      projectFile: path.join(projectDirectory, 'project.json'),
    };
  }

  async function writeProject(project: TopicProject) {
    const {projectDirectory, projectFile} = getProjectPaths(project.id);
    const temporaryFile = path.join(
      projectDirectory,
      `project.json.${randomUUID()}.tmp`,
    );

    await mkdir(projectDirectory, {recursive: true});

    try {
      await writeFile(
        temporaryFile,
        `${JSON.stringify(project, null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryFile, projectFile);
    } finally {
      await rm(temporaryFile, {force: true}).catch(() => undefined);
    }
  }

  async function readProject(projectId: string) {
    const {projectFile} = getProjectPaths(projectId);
    let fileContents: string;

    try {
      fileContents = await readFile(projectFile, 'utf8');
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }

      throw new ProjectDataError(
        projectId,
        'PROJECT_READ_ERROR',
        `Không thể đọc dữ liệu của project “${projectId}”.`,
        {cause: error},
      );
    }

    let storedProject: unknown;

    try {
      storedProject = JSON.parse(fileContents);
    } catch (error) {
      throw new ProjectDataError(
        projectId,
        'INVALID_PROJECT_DATA',
        `Dữ liệu của project “${projectId}” không phải JSON hợp lệ.`,
        {cause: error},
      );
    }

    try {
      return parseTopicProject(storedProject);
    } catch (error) {
      const storedVersion =
        storedProject &&
        typeof storedProject === 'object' &&
        'version' in storedProject
          ? storedProject.version
          : undefined;
      const unsupportedVersion =
        typeof storedVersion === 'number' &&
        storedVersion > currentProjectVersion;

      throw new ProjectDataError(
        projectId,
        unsupportedVersion
          ? 'UNSUPPORTED_PROJECT_VERSION'
          : 'INVALID_PROJECT_DATA',
        unsupportedVersion
          ? `Project “${projectId}” dùng phiên bản dữ liệu mới hơn ứng dụng hiện tại.`
          : `Dữ liệu của project “${projectId}” không đúng cấu trúc hỗ trợ.`,
        {cause: error},
      );
    }
  }

  async function listProjectRecords() {
    await mkdir(projectsDirectory, {recursive: true});
    const entries = await readdir(projectsDirectory, {withFileTypes: true});
    const projectEntries = entries.filter(
      (entry) => entry.isDirectory() && isValidProjectId(entry.name),
    );
    const results = await Promise.all(
      projectEntries.map(async (entry) => {
        try {
          return {
            project: await readProject(entry.name),
            issue: null,
          };
        } catch (error) {
          const issue: ProjectListIssue =
            error instanceof ProjectDataError
              ? {
                  projectId: error.projectId,
                  code: error.code,
                  message: error.message,
                }
              : {
                  projectId: entry.name,
                  code: 'PROJECT_READ_ERROR',
                  message: `Không thể đọc dữ liệu của project “${entry.name}”.`,
                };

          return {project: null, issue};
        }
      }),
    );

    return {
      projects: results
        .map((result) => result.project)
        .filter((project): project is TopicProject => project !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      issues: results
        .map((result) => result.issue)
        .filter((issue): issue is ProjectListIssue => issue !== null),
    };
  }

  function updateAlreadyApplied(
    project: TopicProject,
    update: UpdateProject,
  ) {
    return (
      (update.topicInput === undefined ||
        JSON.stringify(update.topicInput) ===
          JSON.stringify(project.topicInput)) &&
      (update.currentStep === undefined ||
        update.currentStep === project.currentStep) &&
      (update.outline === undefined ||
        JSON.stringify(update.outline) === JSON.stringify(project.outline)) &&
      (update.voiceVisualPlan === undefined ||
        JSON.stringify(update.voiceVisualPlan) ===
          JSON.stringify(project.voiceVisualPlan)) &&
      (update.motionCanvasBundle === undefined ||
        JSON.stringify(update.motionCanvasBundle) ===
          JSON.stringify(project.motionCanvasBundle)) &&
      (update.voiceBundle === undefined ||
        JSON.stringify(update.voiceBundle) ===
          JSON.stringify(project.voiceBundle)) &&
      (update.animationSyncBundle === undefined ||
        JSON.stringify(update.animationSyncBundle) ===
          JSON.stringify(project.animationSyncBundle))
    );
  }

  async function applyUpdate(
    currentProject: TopicProject,
    update: UpdateProject,
  ) {
    if (updateAlreadyApplied(currentProject, update)) {
      return currentProject;
    }

    const topicChanged =
      update.topicInput !== undefined &&
      JSON.stringify(update.topicInput) !==
        JSON.stringify(currentProject.topicInput);
    const nextOutline =
      update.outline ??
      (topicChanged && currentProject.outline
        ? {...currentProject.outline, status: 'draft' as const}
        : currentProject.outline);
    const outlineChanged =
      JSON.stringify(nextOutline) !== JSON.stringify(currentProject.outline);
    const nextVoiceVisualPlan =
      update.voiceVisualPlan ??
      ((topicChanged || outlineChanged) && currentProject.voiceVisualPlan
        ? {...currentProject.voiceVisualPlan, status: 'draft' as const}
        : currentProject.voiceVisualPlan);
    const voiceVisualContentChanged =
      nextVoiceVisualPlan?.contentRevision !==
      currentProject.voiceVisualPlan?.contentRevision;
    const nextMotionCanvasBundle =
      update.motionCanvasBundle ??
      ((topicChanged || outlineChanged || voiceVisualContentChanged) &&
      currentProject.motionCanvasBundle
        ? {...currentProject.motionCanvasBundle, status: 'draft' as const}
        : currentProject.motionCanvasBundle);
    const motionCanvasChanged =
      JSON.stringify(nextMotionCanvasBundle) !==
      JSON.stringify(currentProject.motionCanvasBundle);
    const voiceSourceChanged = Boolean(
      currentProject.voiceBundle &&
        !voiceSourceMatchesPlan(
          currentProject.voiceBundle,
          nextVoiceVisualPlan,
        ),
    );
    const nextVoiceBundle =
      update.voiceBundle ??
      ((topicChanged || outlineChanged || voiceSourceChanged) &&
      currentProject.voiceBundle
        ? {...currentProject.voiceBundle, status: 'draft' as const}
        : currentProject.voiceBundle);
    const voiceChanged =
      JSON.stringify(nextVoiceBundle) !==
      JSON.stringify(currentProject.voiceBundle);
    const syncSourcesChanged = Boolean(
      currentProject.animationSyncBundle &&
        !animationSyncMatchesSources(
          currentProject.animationSyncBundle,
          nextMotionCanvasBundle,
          nextVoiceBundle,
        ),
    );
    const nextAnimationSyncBundle =
      update.animationSyncBundle ??
      (syncSourcesChanged && currentProject.animationSyncBundle
        ? {
            ...currentProject.animationSyncBundle,
            status: 'draft' as const,
          }
        : currentProject.animationSyncBundle);
    const animationSyncChanged =
      JSON.stringify(nextAnimationSyncBundle) !==
      JSON.stringify(currentProject.animationSyncBundle);
    const nextCurrentStep =
      update.currentStep ??
      (topicChanged
        ? 'topic'
        : outlineChanged
          ? 'outline'
            : voiceVisualContentChanged
              ? 'voiceVisual'
              : motionCanvasChanged
                ? 'motionCanvas'
                : voiceChanged
                  ? 'voice'
                  : animationSyncChanged
                    ? 'sync'
                    : currentProject.currentStep);
    const project: TopicProject = {
      ...currentProject,
      ...(update.topicInput ? {topicInput: update.topicInput} : {}),
      currentStep: nextCurrentStep,
      outline: nextOutline,
      voiceVisualPlan: nextVoiceVisualPlan,
      motionCanvasBundle: nextMotionCanvasBundle,
      voiceBundle: nextVoiceBundle,
      animationSyncBundle: nextAnimationSyncBundle,
      revision: currentProject.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    await writeProject(project);
    return project;
  }

  return {
    async createTopicProject(request) {
      return runSerialized(`creation:${request.creationId}`, async () => {
        const {projects} = await listProjectRecords();
        const existingProject = projects.find(
          (project) => project.creationId === request.creationId,
        );

        if (existingProject) {
          return runSerialized(existingProject.id, async () => {
            const currentProject = await readProject(existingProject.id);
            if (!currentProject) {
              throw new Error('Project vừa được tạo không còn tồn tại.');
            }

            const requestedState = {
              topicInput: request.topicInput,
              currentStep: request.currentStep,
            };

            if (updateAlreadyApplied(currentProject, requestedState)) {
              return currentProject;
            }

            throw new ProjectConflictError(currentProject);
          });
        }

        const now = new Date().toISOString();
        const project: TopicProject = {
          id: createProjectId(request.topicInput.topic),
          version: currentProjectVersion,
          revision: 1,
          creationId: request.creationId,
          status: 'draft',
          currentStep: request.currentStep,
          topicInput: request.topicInput,
          outline: null,
          voiceVisualPlan: null,
          motionCanvasBundle: null,
          voiceBundle: null,
          animationSyncBundle: null,
          createdAt: now,
          updatedAt: now,
        };

        await runSerialized(project.id, () => writeProject(project));
        return project;
      });
    },

    async listProjects() {
      return listProjectRecords();
    },

    getProject: readProject,

    async updateProject(projectId, update, expectedRevision) {
      return runSerialized(projectId, async () => {
        const currentProject = await readProject(projectId);
        if (!currentProject) return null;

        if (currentProject.revision !== expectedRevision) {
          if (
            expectedRevision < currentProject.revision &&
            updateAlreadyApplied(currentProject, update)
          ) {
            return currentProject;
          }

          throw new ProjectConflictError(currentProject);
        }

        return applyUpdate(currentProject, update);
      });
    },

    async deleteProject(projectId, expectedRevision) {
      return runSerialized(projectId, async () => {
        const project = await readProject(projectId);
        if (!project) return false;

        if (project.revision !== expectedRevision) {
          throw new ProjectConflictError(project);
        }

        const {projectDirectory} = getProjectPaths(projectId);
        await rm(projectDirectory, {recursive: true, force: false});
        return true;
      });
    },
  };
}
