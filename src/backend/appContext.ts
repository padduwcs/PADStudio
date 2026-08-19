
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {
  finalRenderPrerequisitesAreReady
} from '../shared/projectPipeline.ts';
import {
  type FinalRenderBundle,
  type MotionCanvasBundle,
  type TeachingOutline,
  type VoiceBundle,
  type VoiceVisualPlan
} from '../shared/topic.ts';
import {
  createAnimationSyncPreviewService,
  type AnimationSyncPreviewService
} from './animationSyncPreviewService.ts';
import {
  createAnimationSyncWorkspace,
  type AnimationSyncWorkspace,
  type PreparedAnimationSyncWorkspace
} from './animationSyncWorkspace.ts';
import {
  createCodexConnectionService,
  StdioCodexAppServerClient,
  type CodexAppServerClient,
  type CodexConnectionService
} from './codexConnection.ts';
import {
  createDefaultCredentialStore,
  type CredentialStore,
} from './credentialStore.ts';
import {
  createElevenLabsConnectionService,
  type ElevenLabsConnectionService,
} from './elevenLabsConnection.ts';
import {
  createElevenLabsVoiceService,
  type ElevenLabsSectionGeneration,
  type ElevenLabsVoiceService
} from './elevenLabsVoiceService.ts';
import {
  createFinalRenderService,
  type FinalRenderService
} from './finalRenderService.ts';
import {
  createInMemoryGenerationRegistry,
  GenerationIdReuseError,
  type GenerationRegistry,
} from './generationRegistry.ts';
import {
  createLayoutPreviewService,
  type LayoutPreviewService
} from './layoutPreviewService.ts';
import {
  createLayoutWorkspace,
  type LayoutWorkspace
} from './layoutWorkspace.ts';
import {
  createCodexMotionCanvasGenerator,
  type MotionCanvasGenerationResult,
  type MotionCanvasGenerator
} from './motionCanvasGenerator.ts';
import {
  createFileMotionCanvasHistoryStore,
  type MotionCanvasHistoryStore
} from './motionCanvasHistoryStore.ts';
import {
  createCodexMotionCanvasRevisionReviewService,
  type MotionCanvasRevisionReviewResult,
  type MotionCanvasRevisionReviewService
} from './motionCanvasRevisionReview.ts';
import {
  createMotionCanvasWorkspace,
  type MotionCanvasWorkspace,
  type PreparedMotionCanvasWorkspace
} from './motionCanvasWorkspace.ts';
import {
  createCodexNarrationDraftGenerator,
  type NarrationDraftGenerationResult,
  type NarrationDraftGenerator
} from './narrationDraftGenerator.ts';
import {
  createCodexNarrationVisualPlanner,
  type NarrationVisualPlannerService
} from './narrationVisualPlanner.ts';
import {
  createFileProjectRepository,
  ProjectConflictError,
  type ProjectRepository
} from './projectRepository.ts';
import {
  createCodexPronunciationAuditService,
  type PronunciationAuditResult,
  type PronunciationAuditService,
} from './pronunciationAudit.ts';
import {
  createPronunciationRuleStore,
  type PronunciationRuleStore,
} from './pronunciationRuleStore.ts';
import {
  createRuntimeDiagnosticsService,
  type RuntimeDiagnosticsService,
} from './runtimeDiagnostics.ts';
import {
  createVoiceWorkspace,
  type PreparedVoiceWorkspace,
  type VoiceWorkspace
} from './voiceWorkspace.ts';
import {
  createWatermarkAssetStore,
  type WatermarkAssetStore
} from './watermarkAssetStore.ts';

import {RequestBodyError} from './appErrors.ts';

export interface AppOptions {
  projectsDirectory?: string;
  frontendDirectory?: string;
  repository?: ProjectRepository;
  codexConnection?: CodexConnectionService;
  elevenLabsConnection?: ElevenLabsConnectionService;
  elevenLabsVoiceService?: ElevenLabsVoiceService;
  credentialStore?: CredentialStore;
  elevenLabsConnectionFactory?: (
    apiKey: string,
  ) => ElevenLabsConnectionService;
  narrationDraftGenerator?: NarrationDraftGenerator;
  narrationVisualPlanner?: NarrationVisualPlannerService;
  motionCanvasGenerator?: MotionCanvasGenerator;
  motionCanvasWorkspace?: MotionCanvasWorkspace;
  motionCanvasHistoryStore?: MotionCanvasHistoryStore;
  motionCanvasRevisionReviewService?: MotionCanvasRevisionReviewService;
  voiceWorkspace?: VoiceWorkspace;
  animationSyncWorkspace?: AnimationSyncWorkspace;
  animationSyncPreviewService?: AnimationSyncPreviewService;
  layoutWorkspace?: LayoutWorkspace;
  layoutPreviewService?: LayoutPreviewService;
  finalRenderService?: FinalRenderService;
  runtimeDiagnostics?: RuntimeDiagnosticsService;
  watermarkAssetStore?: WatermarkAssetStore;
  pronunciationRuleStore?: PronunciationRuleStore;
  pronunciationAuditService?: PronunciationAuditService;
  logger?: Pick<Console, 'error' | 'info'>;
}

export function createAppContext(options: AppOptions = {}) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectsDirectory =
    options.projectsDirectory ?? path.resolve(moduleDirectory, '../../projects');
  const frontendDirectory =
    options.frontendDirectory ??
    path.resolve(moduleDirectory, '../../dist/frontend');
  const repository =
    options.repository ?? createFileProjectRepository(projectsDirectory);
  const credentialStore =
    options.credentialStore ??
    createDefaultCredentialStore(path.resolve(projectsDirectory, '..'));
  async function storedElevenLabsApiKey() {
    const stored = await credentialStore.get('elevenlabs');
    return stored ?? process.env.ELEVENLABS_API_KEY?.trim() ?? null;
  }
  const sharedCodexClient: CodexAppServerClient | null =
    !options.codexConnection ||
      !options.narrationDraftGenerator ||
      !options.narrationVisualPlanner ||
      !options.motionCanvasGenerator ||
      !options.motionCanvasRevisionReviewService ||
      !options.pronunciationAuditService
      ? new StdioCodexAppServerClient()
      : null;
  const codexConnection =
    options.codexConnection ??
    createCodexConnectionService(sharedCodexClient!);
  const elevenLabsConnection =
    options.elevenLabsConnection ??
    createElevenLabsConnectionService({apiKeyProvider: storedElevenLabsApiKey});
  const elevenLabsVoiceService =
    options.elevenLabsVoiceService ??
    createElevenLabsVoiceService({apiKeyProvider: storedElevenLabsApiKey});
  const elevenLabsConnectionFactory =
    options.elevenLabsConnectionFactory ??
    ((apiKey: string) => createElevenLabsConnectionService({apiKey}));
  const narrationDraftGenerator =
    options.narrationDraftGenerator ??
    createCodexNarrationDraftGenerator(sharedCodexClient!);
  const narrationVisualPlanner =
    options.narrationVisualPlanner ??
    createCodexNarrationVisualPlanner(sharedCodexClient!);
  const motionCanvasGenerator =
    options.motionCanvasGenerator ??
    createCodexMotionCanvasGenerator(sharedCodexClient!, {
      ...(process.env.PAD_MOTION_CANVAS_MODEL?.trim()
        ? {model: process.env.PAD_MOTION_CANVAS_MODEL.trim()}
        : {}),
      ...(process.env.PAD_MOTION_CANVAS_REASONING_EFFORT?.trim()
        ? {
          reasoningEffort:
            process.env.PAD_MOTION_CANVAS_REASONING_EFFORT.trim(),
        }
        : {}),
      ...(process.env.PAD_MOTION_CANVAS_QUALITY_RETRY_LIMIT?.trim()
        ? {
          qualityRetryLimit: Number(
            process.env.PAD_MOTION_CANVAS_QUALITY_RETRY_LIMIT.trim(),
          ),
        }
        : {}),
    });
  const motionCanvasWorkspace =
    options.motionCanvasWorkspace ??
    createMotionCanvasWorkspace(projectsDirectory);
  const motionCanvasHistoryStore =
    options.motionCanvasHistoryStore ??
    createFileMotionCanvasHistoryStore(projectsDirectory);
  const motionCanvasRevisionReviewService =
    options.motionCanvasRevisionReviewService ??
    createCodexMotionCanvasRevisionReviewService(sharedCodexClient!);
  const voiceWorkspace =
    options.voiceWorkspace ?? createVoiceWorkspace(projectsDirectory);
  const animationSyncWorkspace =
    options.animationSyncWorkspace ??
    createAnimationSyncWorkspace(projectsDirectory);
  const animationSyncPreviewService =
    options.animationSyncPreviewService ??
    createAnimationSyncPreviewService(projectsDirectory);
  const layoutWorkspace =
    options.layoutWorkspace ?? createLayoutWorkspace(projectsDirectory);
  const layoutPreviewService =
    options.layoutPreviewService ??
    createLayoutPreviewService(projectsDirectory);
  const watermarkAssetStore =
    options.watermarkAssetStore ??
    createWatermarkAssetStore(projectsDirectory);
  const pronunciationRuleStore =
    options.pronunciationRuleStore ??
    createPronunciationRuleStore(projectsDirectory);
  const pronunciationAuditService =
    options.pronunciationAuditService ??
    createCodexPronunciationAuditService(sharedCodexClient!);
  const finalRenderService =
    options.finalRenderService ??
    createFinalRenderService(projectsDirectory, {
      layoutWorkspace,
      watermarkAssetStore,
      logger: options.logger,
    });
  const runtimeDiagnostics =
    options.runtimeDiagnostics ??
    createRuntimeDiagnosticsService({
      codexConnection,
      elevenLabsConnection,
    });
  const logger = options.logger ?? console;
  const narrationDraftGenerations = createInMemoryGenerationRegistry<NarrationDraftGenerationResult>();
  const narrationPlanGenerations = createInMemoryGenerationRegistry<{
    outline: TeachingOutline;
    voiceVisualPlan: VoiceVisualPlan;
  }>();
  const motionCanvasGenerations = createInMemoryGenerationRegistry<{
    generated: MotionCanvasGenerationResult;
    prepared: PreparedMotionCanvasWorkspace;
    generationDiagnostics: NonNullable<MotionCanvasBundle['generationDiagnostics']>;
  }>();
  const motionCanvasCandidateGenerations = createInMemoryGenerationRegistry<{
    generated: MotionCanvasGenerationResult;
    prepared: PreparedMotionCanvasWorkspace;
    review: MotionCanvasRevisionReviewResult;
  }>();
  const voiceGenerations = createInMemoryGenerationRegistry<{
    configuration: VoiceBundle['configuration'];
    prepared: PreparedVoiceWorkspace;
  }>();
  const voiceSectionGenerations = createInMemoryGenerationRegistry<ElevenLabsSectionGeneration>(
    pipelineSafetyLimits.maximumVoiceChunks * 2,
  );
  const animationSyncGenerations = createInMemoryGenerationRegistry<PreparedAnimationSyncWorkspace>();
  const pronunciationAuditGenerations = createInMemoryGenerationRegistry<PronunciationAuditResult>();
  const finalRenderCommits = new Set<Promise<void>>();

  async function commitFinalRenderBundle(
    projectId: string,
    generationId: string,
    renderBundle: FinalRenderBundle,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latestProject = await repository.getProject(projectId);
      if (!latestProject) return false;
      if (
        latestProject.renderBundle?.generation.generationId === generationId
      ) {
        return true;
      }
      const latestLayout = latestProject.layoutBundle;
      if (
        !latestLayout ||
        !finalRenderPrerequisitesAreReady(latestProject) ||
        latestLayout.contentRevision !==
        renderBundle.sourceLayoutContentRevision ||
        latestLayout.generation.generationId !==
        renderBundle.sourceLayoutGenerationId ||
        latestLayout.validation.sourceHash !==
        renderBundle.sourceLayoutSourceHash
      ) {
        return false;
      }
      try {
        await repository.updateProject(
          latestProject.id,
          {renderBundle},
          latestProject.revision,
        );
        return true;
      } catch (error) {
        if (error instanceof ProjectConflictError && attempt < 2) continue;
        throw error;
      }
    }
    return false;
  }

  function trackFinalRenderCommit(operation: Promise<void>) {
    finalRenderCommits.add(operation);
    void operation
      .finally(() => finalRenderCommits.delete(operation))
      .catch(() => undefined);
  }

  function generateOnce<Result>(
    generations: GenerationRegistry<Result>,
    key: string,
    fingerprint: string,
    operation: () => Promise<Result>,
    retainFailure: (error: unknown) => boolean = () => false,
    _maximumEntries = 50,
  ) {
    try {
      return generations.run(key, fingerprint, operation, {retainFailure});
    } catch (error) {
      if (error instanceof GenerationIdReuseError) {
        throw new RequestBodyError(
          409,
          'GENERATION_ID_REUSED',
          'Generation ID đã được dùng với nội dung khác.',
        );
      }
      throw error;
    }
  }

  return {options, storedElevenLabsApiKey, projectsDirectory, frontendDirectory, repository, credentialStore, sharedCodexClient, codexConnection, elevenLabsConnection, elevenLabsVoiceService, elevenLabsConnectionFactory, narrationDraftGenerator, narrationVisualPlanner, motionCanvasGenerator, motionCanvasWorkspace, motionCanvasHistoryStore, motionCanvasRevisionReviewService, voiceWorkspace, animationSyncWorkspace, animationSyncPreviewService, layoutWorkspace, layoutPreviewService, watermarkAssetStore, pronunciationRuleStore, pronunciationAuditService, finalRenderService, runtimeDiagnostics, logger, narrationDraftGenerations, narrationPlanGenerations, motionCanvasGenerations, motionCanvasCandidateGenerations, voiceGenerations, voiceSectionGenerations, animationSyncGenerations, pronunciationAuditGenerations, finalRenderCommits, commitFinalRenderBundle, trackFinalRenderCommit, generateOnce};
}

export type AppContext = ReturnType<typeof createAppContext>;

