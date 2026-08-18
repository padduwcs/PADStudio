import {randomUUID} from 'node:crypto';
import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  CreateMotionCanvasCandidateSchema,
  CreateMotionCanvasCheckpointSchema,
  type MotionCanvasCandidateRecord,
} from '../shared/motionCanvasHistory.ts';
import {
  motionCanvasMatchesOutline,
  sameValue
} from '../shared/projectPipeline.ts';
import {
  type MotionCanvasBundle
} from '../shared/topic.ts';
import {
  MOTION_CANVAS_PROMPT_VERSION,
  MotionCanvasGenerationError
} from './motionCanvasGenerator.ts';
import {
  hashJson,
  hashMotionCanvasBundle
} from './motionCanvasHistoryStore.ts';
import {
  MOTION_CANVAS_COHERENCE_PROMPT_VERSION,
  MotionCanvasRevisionReviewError,
  type MotionCanvasRevisionReviewResult
} from './motionCanvasRevisionReview.ts';
import {
  MotionCanvasWorkspaceError,
  type PreparedMotionCanvasWorkspace
} from './motionCanvasWorkspace.ts';
import {
  ProjectConflictError
} from './projectRepository.ts';
import {
  getProjectMotionCanvasHistoryRoute
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {RequestBodyError, sendApiError} from './appErrors.ts';
import {motionCanvasContextHash, projectVideoFrame, workspaceVideoFrame} from './appRouteSupport.ts';
import {readExpectedRevision, readJsonBody, requestParentOrigin, sendJson, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type MotionCanvasHistoryRouteContext = Pick<AppContext, 'repository' | 'motionCanvasHistoryStore' | 'motionCanvasWorkspace' | 'layoutPreviewService' | 'motionCanvasCandidateGenerations' | 'motionCanvasGenerator' | 'motionCanvasRevisionReviewService' | 'generateOnce' | 'logger'>;

export function createMotionCanvasHistoryRouteHandler(context: MotionCanvasHistoryRouteContext): ApiRouteHandler {
  const {repository, motionCanvasHistoryStore, motionCanvasWorkspace, layoutPreviewService, motionCanvasCandidateGenerations, motionCanvasGenerator, motionCanvasRevisionReviewService, generateOnce, logger} = context;
  async function handleMotionCanvasHistoryRoute(
    route: NonNullable<ReturnType<typeof getProjectMotionCanvasHistoryRoute>>,
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ) {
    const currentProject = await repository.getProject(route.projectId);
    if (!currentProject) {
      sendApiError(response, 404, {
        code: 'PROJECT_NOT_FOUND',
        message: 'Không tìm thấy project.',
      });
      return true;
    }
    const outline = currentProject.outline;
    const voiceVisualPlan = currentProject.voiceVisualPlan;
    const bundle = currentProject.motionCanvasBundle;
    if (!bundle) {
      throw new RequestBodyError(
        409,
        'MOTION_CANVAS_NOT_READY',
        'Project chưa có scene Motion Canvas để quản lý phiên bản.',
      );
    }
    if (
      !outline ||
      outline.status !== 'approved' ||
      !voiceVisualPlan ||
      voiceVisualPlan.status !== 'approved' ||
      !sameValue(outline.sourceInput, currentProject.topicInput) ||
      voiceVisualPlan.sourceOutlineContentRevision !== outline.contentRevision ||
      bundle.sourceVoiceVisualContentRevision !==
      voiceVisualPlan.contentRevision ||
      !motionCanvasMatchesOutline(bundle, outline)
    ) {
      throw new RequestBodyError(
        409,
        'MOTION_CANVAS_OUTDATED',
        'Workspace Motion Canvas không còn khớp đầu vào đã chốt.',
      );
    }
    await motionCanvasWorkspace.verify(currentProject.id, bundle);
    const currentContentHash = hashMotionCanvasBundle(bundle);
    const currentContextHash = motionCanvasContextHash(currentProject, bundle);

    if (
      route.resource === 'history' &&
      !route.recordId &&
      request.method === 'GET'
    ) {
      await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Bản hiện tại',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      const [versions, candidates] = await Promise.all([
        motionCanvasHistoryStore.listVersions(currentProject.id),
        motionCanvasHistoryStore.listCandidates(currentProject.id),
      ]);
      const requestedLimit = Number(requestUrl.searchParams.get('limit') ?? '50');
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 50;
      sendJson(response, 200, {
        versions: versions.slice(0, limit),
        candidates: candidates.slice(0, limit),
        currentContentHash,
        currentContextHash,
      });
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'files' &&
      request.method === 'GET'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const files = await motionCanvasWorkspace.readFiles(
        currentProject.id,
        candidate.bundle,
      );
      sendJson(response, 200, {bundle: candidate.bundle, files});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'preview' &&
      request.method === 'GET'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const preview = await layoutPreviewService.startMotion(
        currentProject.id,
        candidate.bundle,
        {parentOrigin: requestParentOrigin(request), initialOverrides: []},
      );
      sendJson(response, 200, {
        preview: {
          ...preview,
          sourceMotionCanvasGenerationId: preview.sourceSyncGenerationId,
        },
      });
      return true;
    }

    const expectedRevision = readExpectedRevision(request);
    if (currentProject.revision !== expectedRevision) {
      throw new ProjectConflictError(currentProject);
    }

    if (
      route.resource === 'versions' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsed = CreateMotionCanvasCheckpointSchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Thông tin phiên bản Motion Canvas chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const versions = await motionCanvasHistoryStore.listVersions(
        currentProject.id,
      );
      const parent = versions.find(
        version => version.contentHash === currentContentHash,
      );
      const version = await motionCanvasHistoryStore.ensureVersion(
        {
          projectId: currentProject.id,
          origin: 'manual_checkpoint',
          label: parsed.data.label ?? 'Phiên bản scene đã lưu',
          parentVersionId: parent?.versionId ?? null,
          restoredFromVersionId: null,
          candidateId: null,
          projectRevision: currentProject.revision,
          contentHash: currentContentHash,
          artifact: bundle,
        },
        {force: true},
      );
      sendJson(response, 201, {version});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      !route.recordId &&
      request.method === 'POST'
    ) {
      const body = await readJsonBody(request);
      const parsed = CreateMotionCanvasCandidateSchema.safeParse(body);
      if (!parsed.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu chỉnh scene Motion Canvas chưa hợp lệ.',
          fields: validationFields(parsed.error.issues),
        });
        return true;
      }
      const generationId = parsed.data.generationId.toLowerCase();
      let baseBundle = bundle;
      let baseVersion = await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước chỉnh sửa AI',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      let parentCandidate: MotionCanvasCandidateRecord | null = null;
      if (parsed.data.baseCandidateId) {
        parentCandidate = await motionCanvasHistoryStore.getCandidate(
          currentProject.id,
          parsed.data.baseCandidateId,
        );
        if (!parentCandidate) {
          throw new RequestBodyError(
            404,
            'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate dùng làm nền chỉnh tiếp.',
          );
        }
        if (parentCandidate.decision !== 'pending') {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_CANDIDATE_ALREADY_DECIDED',
            'Chỉ có thể chỉnh tiếp candidate đang chờ review.',
          );
        }
        if (parentCandidate.rootBaseContextHash !== currentContextHash) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_CONTEXT_CHANGED',
            'Đầu vào hoặc workspace nền đã thay đổi. Hãy tạo candidate mới.',
          );
        }
        const storedBaseVersion = await motionCanvasHistoryStore.getVersion(
          currentProject.id,
          parentCandidate.baseVersionId,
        );
        if (!storedBaseVersion) {
          throw new RequestBodyError(
            409,
            'MOTION_CANVAS_BASE_VERSION_MISSING',
            'Phiên bản nền của candidate không còn khả dụng.',
          );
        }
        baseVersion = storedBaseVersion;
        baseBundle = parentCandidate.bundle;
        await motionCanvasWorkspace.verify(currentProject.id, baseBundle);
      }
      const sceneIds = new Set(baseBundle.scenes.map(scene => scene.id));
      if (parsed.data.scope.sceneIds.some(sceneId => !sceneIds.has(sceneId))) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_SCOPE_STALE',
          'Phạm vi scene không còn khớp workspace nền.',
        );
      }
      const baseContentHash = hashMotionCanvasBundle(baseBundle);
      const baseContextHash = motionCanvasContextHash(
        currentProject,
        baseBundle,
      );
      const requestFingerprint = hashJson({
        projectId: currentProject.id,
        baseContentHash,
        baseContextHash,
        request: parsed.data,
      });
      const existingCandidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        generationId,
      );
      if (existingCandidate) {
        if (existingCandidate.requestFingerprint !== requestFingerprint) {
          throw new RequestBodyError(
            409,
            'GENERATION_ID_REUSED',
            'Generation ID đã được dùng với nội dung khác.',
          );
        }
        sendJson(response, 200, {candidate: existingCandidate});
        return true;
      }

      const generation = await generateOnce(
        motionCanvasCandidateGenerations,
        `${currentProject.id}:${generationId}`,
        requestFingerprint,
        async () => {
          const baseSources = await motionCanvasWorkspace.readSceneSources(
            currentProject.id,
            baseBundle,
          );
          const selectedSceneIds = new Set(parsed.data.scope.sceneIds);
          const sectionIndexes = baseBundle.scenes
            .map((scene, index) => selectedSceneIds.has(scene.id) ? index : -1)
            .filter(index => index >= 0);
          const generationRequest = {
            projectId: currentProject.id,
            generationId,
            model: parsed.data.model,
            reasoningEffort: parsed.data.reasoningEffort,
            topicInput: currentProject.topicInput,
            videoFrame: projectVideoFrame(currentProject),
            outline,
            voiceVisualPlan,
            sectionIndexes,
            guidance: parsed.data.guidance,
            currentScenes: baseSources,
          };
          let generated = await motionCanvasGenerator.generate(
            generationRequest,
          );
          const mergeScenes = () => {
            const generatedBySection = new Map(
              generated.scenes.map(scene => [scene.outlineSectionId, scene]),
            );
            return baseSources.map(baseScene => {
              if (!selectedSceneIds.has(baseScene.id)) return baseScene;
              const replacement = generatedBySection.get(
                baseScene.outlineSectionId,
              );
              if (!replacement) {
                throw new MotionCanvasGenerationError(
                  'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
                  'Codex không trả đủ các scene đã chọn.',
                );
              }
              return {
                ...replacement,
                id: baseScene.id,
                filePath: baseScene.filePath,
                outlineSectionId: baseScene.outlineSectionId,
              };
            });
          };
          let mergedSources = mergeScenes();
          let prepared: PreparedMotionCanvasWorkspace | null = null;
          let repairAttempts = 0;
          let fallbackAttempted = false;
          while (!prepared) {
            try {
              prepared = await motionCanvasWorkspace.prepare(
                currentProject.id,
                generationId,
                mergedSources,
                projectVideoFrame(currentProject),
              );
            } catch (error) {
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.repair &&
                repairAttempts < 1
              ) {
                repairAttempts += 1;
                try {
                  generated = await motionCanvasGenerator.repair(
                    generationRequest,
                    generated,
                    error.details,
                  );
                } catch (repairError) {
                  if (!motionCanvasGenerator.recover || fallbackAttempted) {
                    throw repairError;
                  }
                  fallbackAttempted = true;
                  generated = motionCanvasGenerator.recover(
                    generationRequest,
                    generated,
                    `${error.details}\n\nRepair failed: ${repairError instanceof Error
                      ? repairError.message
                      : String(repairError)
                    }`,
                  );
                }
                mergedSources = mergeScenes();
                continue;
              }
              if (
                error instanceof MotionCanvasWorkspaceError &&
                error.code === 'MOTION_CANVAS_VALIDATION_FAILED' &&
                error.details &&
                motionCanvasGenerator.recover &&
                !fallbackAttempted
              ) {
                fallbackAttempted = true;
                generated = motionCanvasGenerator.recover(
                  generationRequest,
                  generated,
                  error.details,
                );
                mergedSources = mergeScenes();
                continue;
              }
              throw error;
            }
          }
          let review: MotionCanvasRevisionReviewResult;
          try {
            review = await motionCanvasRevisionReviewService.review({
              topicInput: currentProject.topicInput,
              outline,
              voiceVisualPlan,
              scope: parsed.data.scope,
              guidance: parsed.data.guidance,
              scenes: mergedSources.map(scene => {
                const changed = selectedSceneIds.has(scene.id);
                return {
                  sceneId: scene.id,
                  outlineSectionId: scene.outlineSectionId,
                  name: scene.name,
                  changed,
                  sourceExcerpt:
                    changed ? scene.source.slice(0, 24_000) : '',
                };
              }),
              model: parsed.data.model,
              reasoningEffort: parsed.data.reasoningEffort,
            });
          } catch (error) {
            if (!(error instanceof MotionCanvasRevisionReviewError)) {
              throw error;
            }
            logger.info(
              `Motion candidate ${generationId} đã compile nhưng reviewer không hoàn tất: ${error.code}`,
            );
            review = {
              coherence: {
                verdict: 'warning',
                summary:
                  'Các scene đã sinh qua kiểm tra TypeScript và timing; lượt review mạch lạc tự động chưa hoàn tất.',
                issues: [{
                  severity: 'warning',
                  category: 'scope',
                  message:
                    'Reviewer Codex tạm thời không phản hồi, nhưng workspace hợp lệ vẫn được giữ để tránh mất kết quả đã sinh.',
                  suggestedFix:
                    'Mở preview candidate và chạy lại review nếu bạn cần kiểm tra thêm trước khi áp dụng.',
                  affectedSceneIds: parsed.data.scope.sceneIds,
                  requiresScopeExpansion: false,
                }],
              },
              model: generated.model || 'unavailable',
              usage: null,
            };
          }
          return {generated, prepared, review};
        },
      );
      const prepared = generation.result.prepared;
      const candidateBundle: MotionCanvasBundle = {
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
        workspacePath: prepared.workspacePath,
        projectFile: prepared.projectFile,
        width: projectVideoFrame(currentProject).width,
        height: projectVideoFrame(currentProject).height,
        fps: projectVideoFrame(currentProject).fps,
        ...(prepared.scenes.every(scene => scene.timingEvents?.length)
          ? {timingContractVersion: 1 as const}
          : {}),
        scenes: prepared.scenes,
        validation: prepared.validation,
        generation: {
          generationId,
          provider: 'codex',
          model: generation.result.generated.model,
          requestedModel: parsed.data.model,
          reasoningEffort: parsed.data.reasoningEffort,
          promptVersion: MOTION_CANVAS_PROMPT_VERSION,
          generatedAt: generation.generatedAt,
          usage: generation.result.generated.usage,
        },
      };
      const coherence = generation.result.review.coherence;
      const status =
        coherence.verdict === 'needs_scope_expansion' ||
          coherence.issues.some(issue => issue.requiresScopeExpansion)
          ? 'scope_expansion_required'
          : coherence.issues.some(issue => issue.severity === 'error')
            ? 'coherence_blocked'
            : coherence.verdict === 'warning' || coherence.issues.length > 0
              ? 'coherence_warning'
              : 'ready';
      const candidate = await motionCanvasHistoryStore.saveCandidate({
        candidateId: generationId,
        projectId: currentProject.id,
        createdAt: generation.generatedAt,
        status,
        decision: 'pending',
        decidedAt: null,
        appliedVersionId: null,
        baseVersionId: baseVersion.versionId,
        parentCandidateId: parentCandidate?.candidateId ?? null,
        rootBaseContentHash:
          parentCandidate?.rootBaseContentHash ?? currentContentHash,
        baseContentHash,
        rootBaseContextHash:
          parentCandidate?.rootBaseContextHash ?? currentContextHash,
        baseContextHash,
        baseProjectRevision: currentProject.revision,
        candidateContentHash: hashMotionCanvasBundle(candidateBundle),
        requestFingerprint,
        guidance: parsed.data.guidance,
        scope: parsed.data.scope,
        bundle: candidateBundle,
        coherence,
        generation: {
          provider: 'codex',
          model: generation.result.generated.model,
          requestedModel: parsed.data.model ?? null,
          reasoningEffort: parsed.data.reasoningEffort ?? null,
          promptVersion: `${MOTION_CANVAS_PROMPT_VERSION}+${MOTION_CANVAS_COHERENCE_PROMPT_VERSION}`.slice(0, 40),
          generatedAt: generation.generatedAt,
          generationUsage: generation.result.generated.usage,
          reviewerUsage: generation.result.review.usage,
        },
      });
      motionCanvasGenerator.discardGeneration?.(
        currentProject.id,
        generationId,
      );
      sendJson(response, 201, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'reject' &&
      request.method === 'POST'
    ) {
      const candidate = await motionCanvasHistoryStore.setCandidateDecision(
        currentProject.id,
        route.recordId,
        'rejected',
      );
      sendJson(response, 200, {candidate});
      return true;
    }

    if (
      route.resource === 'candidates' &&
      route.recordId &&
      route.action === 'apply' &&
      request.method === 'POST'
    ) {
      const candidate = await motionCanvasHistoryStore.getCandidate(
        currentProject.id,
        route.recordId,
      );
      if (!candidate) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
          'Không tìm thấy candidate scene.',
        );
      }
      if (candidate.decision === 'rejected') {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_REJECTED',
          'Candidate này đã bị từ chối và chỉ còn trong lịch sử.',
        );
      }
      if (
        candidate.decision === 'accepted' &&
        currentContentHash === candidate.candidateContentHash
      ) {
        sendProject(response, 200, currentProject);
        return true;
      }
      if (candidate.decision === 'accepted') {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CANDIDATE_ALREADY_ACCEPTED',
          'Candidate này đã được áp dụng trước đó.',
        );
      }
      if (
        candidate.status === 'scope_expansion_required' ||
        candidate.status === 'coherence_blocked'
      ) {
        throw new RequestBodyError(
          409,
          candidate.status === 'scope_expansion_required'
            ? 'MOTION_CANVAS_SCOPE_EXPANSION_REQUIRED'
            : 'MOTION_CANVAS_COHERENCE_BLOCKED',
          candidate.status === 'scope_expansion_required'
            ? 'Candidate cần mở rộng phạm vi trước khi áp dụng.'
            : 'Candidate còn lỗi mạch lạc nghiêm trọng.',
        );
      }
      if (candidate.rootBaseContextHash !== currentContextHash) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_CONTEXT_CHANGED',
          'Đầu vào hoặc workspace nền đã thay đổi kể từ lúc tạo candidate.',
        );
      }
      await motionCanvasWorkspace.verify(currentProject.id, candidate.bundle);
      const nextBundle: MotionCanvasBundle = {
        ...candidate.bundle,
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {motionCanvasBundle: nextBundle, currentStep: 'scenes'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await motionCanvasHistoryStore
        .ensureVersion(
          {
            projectId: updatedProject.id,
            origin: 'ai_candidate',
            label: `Chỉnh ${candidate.scope.sceneIds.length} scene`,
            parentVersionId: candidate.baseVersionId,
            restoredFromVersionId: null,
            candidateId: candidate.candidateId,
            projectRevision: updatedProject.revision,
            contentHash: hashMotionCanvasBundle(nextBundle),
            artifact: nextBundle,
          },
          {force: true},
        )
        .catch(error => {
          logger.error(error);
          return null;
        });
      await motionCanvasHistoryStore
        .setCandidateDecision(
          updatedProject.id,
          candidate.candidateId,
          'accepted',
          version?.versionId ?? null,
        )
        .catch(error => logger.error(error));
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }

    if (
      route.resource === 'versions' &&
      route.recordId &&
      route.action === 'restore' &&
      request.method === 'POST'
    ) {
      const sourceVersion = await motionCanvasHistoryStore.getVersion(
        currentProject.id,
        route.recordId,
      );
      if (!sourceVersion) {
        throw new RequestBodyError(
          404,
          'MOTION_CANVAS_VERSION_NOT_FOUND',
          'Không tìm thấy phiên bản scene cần khôi phục.',
        );
      }
      if (
        sourceVersion.artifact.sourceVoiceVisualContentRevision !==
        voiceVisualPlan.contentRevision
      ) {
        throw new RequestBodyError(
          409,
          'MOTION_CANVAS_VERSION_OUTDATED',
          'Phiên bản scene này thuộc kế hoạch voice–visual cũ.',
        );
      }
      await motionCanvasWorkspace.verify(
        currentProject.id,
        sourceVersion.artifact,
      );
      const currentVersion = await motionCanvasHistoryStore.ensureVersion({
        projectId: currentProject.id,
        origin: 'baseline',
        label: 'Trước khi khôi phục',
        parentVersionId: null,
        restoredFromVersionId: null,
        candidateId: null,
        projectRevision: currentProject.revision,
        contentHash: currentContentHash,
        artifact: bundle,
      });
      const restoreGenerationId = randomUUID();
      const sources = await motionCanvasWorkspace.readSceneSources(
        currentProject.id,
        sourceVersion.artifact,
      );
      const prepared = await motionCanvasWorkspace.prepare(
        currentProject.id,
        restoreGenerationId,
        sources,
        workspaceVideoFrame(
          sourceVersion.artifact.width,
          sourceVersion.artifact.height,
          sourceVersion.artifact.fps,
        ),
      );
      const restoredBundle: MotionCanvasBundle = {
        ...sourceVersion.artifact,
        status: 'draft',
        contentRevision: bundle.contentRevision + 1,
        sourceVoiceVisualContentRevision: voiceVisualPlan.contentRevision,
        workspacePath: prepared.workspacePath,
        projectFile: prepared.projectFile,
        scenes: prepared.scenes,
        validation: prepared.validation,
        generation: {
          ...sourceVersion.artifact.generation,
          generationId: restoreGenerationId,
          generatedAt: new Date().toISOString(),
          usage: null,
        },
      };
      const updatedProject = await repository.updateProject(
        currentProject.id,
        {motionCanvasBundle: restoredBundle, currentStep: 'scenes'},
        expectedRevision,
      );
      if (!updatedProject) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }
      const version = await motionCanvasHistoryStore.ensureVersion(
        {
          projectId: updatedProject.id,
          origin: 'restore',
          label: `Khôi phục từ ${sourceVersion.label ?? 'phiên bản cũ'}`,
          parentVersionId: currentVersion.versionId,
          restoredFromVersionId: sourceVersion.versionId,
          candidateId: null,
          projectRevision: updatedProject.revision,
          contentHash: hashMotionCanvasBundle(restoredBundle),
          artifact: restoredBundle,
        },
        {force: true},
      );
      sendJson(
        response,
        200,
        {project: updatedProject, version},
        {ETag: `"${updatedProject.revision}"`},
      );
      return true;
    }
    return false;
  }


  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    const route = getProjectMotionCanvasHistoryRoute(requestUrl.pathname);
    if (!route) return false;
    return handleMotionCanvasHistoryRoute(route, request, response, requestUrl);
  };
}

