import type {
  CodexConnectionStatus,
  CodexLoginStart,
  CodexModelSummary,
} from '../shared/codex.ts';
import type {RuntimeDiagnostics} from '../shared/runtimeDiagnostics.ts';
import type {MotionCanvasGenerationProgress} from '../shared/motionCanvasGenerationProgress.ts';
import type {
  ElevenLabsCatalog,
  ElevenLabsConnectionStatus,
  ElevenLabsCredentialStatus,
} from '../shared/elevenLabs.ts';
import type {
  ApiErrorPayload,
  CreateTopicProject,
  GenerateNarrationDraft,
  NarrationDraftGenerationResponse,
  GenerateAnimationSync,
  GenerateMotionCanvas,
  GenerateVoice,
  ProjectListIssue,
  MotionCanvasBundle,
  NarrationDocument,
  TopicProject,
  UpdateProject,
} from '../shared/topic.ts';
import type {
  FinalRenderJobStatus,
  GenerateFinalRender,
  WatermarkAssetSummary,
} from '../shared/render.ts';
import type {
  ApproveLayout,
  CommitLayout,
} from '../shared/layout.ts';
import type {
  CreateMotionCanvasCandidate,
  MotionCanvasCandidateRecord,
  MotionCanvasHistoryResponse,
  MotionCanvasVersionRecord,
} from '../shared/motionCanvasHistory.ts';
import type {
  PronunciationRule,
} from '../shared/pronunciation.ts';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[]>;
  readonly currentProject?: TopicProject;

  constructor(
    message: string,
    code = 'REQUEST_ERROR',
    status = 0,
    fields?: Record<string, string[]>,
    currentProject?: TopicProject,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.currentProject = currentProject;
  }
}

export interface MotionCanvasFailureSummary {
  generationId: string;
  failedAt: string;
  stage: 'compile' | 'render-quality' | 'generation';
  code: string;
  message: string;
  firstIssueReason: string | null;
  recoveryGuidance: string | null;
}

export interface MotionCanvasGenerationPollingOptions {
  pollIntervalMs?: number;
  onProgress?: (progress: MotionCanvasGenerationProgress) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

function previewRequestOptions(): RequestInit | undefined {
  const parentOrigin =
    typeof window === 'undefined' ? '' : window.location.origin;
  return parentOrigin
    ? {headers: {'X-Pad-Parent-Origin': parentOrigin}}
    : undefined;
}

async function readPayload<ResponsePayload extends object>(response: Response) {
  return (await response.json().catch(() => null)) as
    | ResponsePayload
    | ApiErrorPayload
    | null;
}

function assertSuccessful<ResponsePayload extends object>(
  response: Response,
  payload: ResponsePayload | ApiErrorPayload | null,
) {
  if (!response.ok) {
    const apiError = payload && 'error' in payload ? payload.error : undefined;
    throw new ApiRequestError(
      apiError?.message ?? 'Không thể kết nối với PAD Studio.',
      apiError?.code,
      response.status,
      apiError?.fields,
      apiError?.currentProject,
    );
  }
}

function getProjectPayload(
  payload: {project: TopicProject} | ApiErrorPayload | null,
) {
  if (!payload || !('project' in payload)) {
    throw new ApiRequestError(
      'Phản hồi từ máy chủ không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }

  return payload.project;
}

export async function createTopicProject(request: CreateTopicProject) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function generateNarrationDraft(
  request: GenerateNarrationDraft,
) {
  const response = await fetch('/api/narration-drafts/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  const payload = await readPayload<NarrationDraftGenerationResponse>(response);
  assertSuccessful(response, payload);
  if (!payload || !('draft' in payload) || !('generation' in payload)) {
    throw new ApiRequestError(
      'Phản hồi tạo lời thoại không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function listProjects() {
  const response = await fetch('/api/projects');
  const payload = await readPayload<{
    projects: TopicProject[];
    issues: ProjectListIssue[];
  }>(response);

  assertSuccessful(response, payload);
  if (!payload || !('projects' in payload)) {
    throw new ApiRequestError(
      'Phản hồi danh sách project không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }

  return {
    projects: payload.projects,
    issues: 'issues' in payload ? payload.issues : [],
  };
}

export async function getProject(projectId: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function updateTopicProject(
  projectId: string,
  update: UpdateProject,
  expectedRevision: number,
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': `"${expectedRevision}"`,
    },
    body: JSON.stringify(update),
  });
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getRuntimeDiagnostics() {
  const response = await fetch('/api/runtime/diagnostics');
  const payload = await readPayload<{diagnostics: RuntimeDiagnostics}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('diagnostics' in payload)) {
    throw new ApiRequestError(
      'Phản hồi kiểm tra môi trường không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.diagnostics;
}

export async function saveProjectNarration(
  projectId: string,
  request: Pick<NarrationDocument, 'sourceText' | 'projectRules'> & {
    normalizedText?: string;
  },
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/narration`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getProjectNarration(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/narration`,
  );
  const payload = await readPayload<{
    narration: NarrationDocument | null;
    libraryRules: PronunciationRule[];
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('narration' in payload) || !('libraryRules' in payload)) {
    throw new ApiRequestError('Phản hồi lời thoại không hợp lệ.', 'INVALID_RESPONSE');
  }
  return payload;
}

export async function auditProjectNarration(
  projectId: string,
  request: {generationId: string; model?: string; reasoningEffort?: string},
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/narration/audit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function approveProjectNarration(
  projectId: string,
  request: {sourceHash: string; rulesHash: string},
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/narration/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function prepareNarrationProduction(
  projectId: string,
  request: {
    generationId: string;
    plannerModel?: string;
    plannerReasoningEffort?: string;
    forceVisualReplan?: boolean;
  },
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/production/prepare`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

type LibraryPronunciationRuleInput = Omit<PronunciationRule, 'id' | 'scope'>;

export async function saveLibraryPronunciationRule(
  input: LibraryPronunciationRuleInput,
  ruleId?: string,
) {
  const response = await fetch(
    ruleId
      ? `/api/pronunciation/rules/${encodeURIComponent(ruleId)}`
      : '/api/pronunciation/rules',
    {
      method: ruleId ? 'PUT' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    },
  );
  const payload = await readPayload<{rule: PronunciationRule}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('rule' in payload)) {
    throw new ApiRequestError('Phản hồi từ điển không hợp lệ.', 'INVALID_RESPONSE');
  }
  return payload.rule;
}

export async function deleteLibraryPronunciationRule(ruleId: string) {
  const response = await fetch(
    `/api/pronunciation/rules/${encodeURIComponent(ruleId)}`,
    {method: 'DELETE'},
  );
  const payload = await readPayload<object>(response);
  assertSuccessful(response, payload);
}

export async function generateMotionCanvas(
  projectId: string,
  request: GenerateMotionCanvas,
  expectedRevision: number,
  options: MotionCanvasGenerationPollingOptions = {},
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{
    project: TopicProject;
    progress?: MotionCanvasGenerationProgress;
  }>(response);

  assertSuccessful(response, payload);
  if (response.status === 202) {
    if (!payload || !('progress' in payload) || !payload.progress) {
      throw new ApiRequestError(
        'Phản hồi bắt đầu sinh scene không hợp lệ.',
        'INVALID_RESPONSE',
      );
    }
    return waitForMotionCanvasGeneration(projectId, payload.progress, options);
  }
  return getProjectPayload(payload);
}

async function waitForMotionCanvasGeneration(
  projectId: string,
  initialProgress: MotionCanvasGenerationProgress,
  options: MotionCanvasGenerationPollingOptions,
) {
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1_000);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  }));
  let progress = initialProgress;
  const trackedGenerationId = initialProgress.generationId;
  while (true) {
    if (progress.generationId !== trackedGenerationId) {
      throw new ApiRequestError(
        'Lượt sinh scene đã được thay thế bởi generation khác.',
        'MOTION_CANVAS_GENERATION_REPLACED',
        409,
      );
    }
    options.onProgress?.(progress);
    if (progress.state === 'completed') {
      return getProject(projectId);
    }
    if (progress.state === 'failed' || progress.state === 'interrupted') {
      throw new ApiRequestError(
        progress.error || progress.message,
        progress.state === 'failed'
          ? 'MOTION_CANVAS_GENERATION_FAILED'
          : 'MOTION_CANVAS_GENERATION_INTERRUPTED',
        422,
      );
    }
    await sleep(pollIntervalMs);
    try {
      const nextProgress = await getMotionCanvasGenerationProgress(projectId);
      if (!nextProgress) {
        throw new ApiRequestError(
          'Phản hồi tiến độ sinh scene không có dữ liệu.',
          'INVALID_RESPONSE',
          500,
        );
      }
      if (nextProgress.generationId !== trackedGenerationId) {
        throw new ApiRequestError(
          'Lượt sinh scene đã được thay thế bởi generation khác.',
          'MOTION_CANVAS_GENERATION_REPLACED',
          409,
        );
      }
      progress = nextProgress;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 0) {
        throw error;
      }
      // A temporary transport failure must not start a second generation.
      // Keep polling the original generation until the server reports a
      // terminal state.
    }
  }
}

export async function getLatestMotionCanvasFailure(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/failure`,
  );
  const payload = await readPayload<{failure: MotionCanvasFailureSummary | null}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('failure' in payload)) {
    throw new ApiRequestError(
      'Phản hồi trạng thái sinh scene không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.failure;
}

export async function getMotionCanvasGenerationProgress(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/status`,
    {cache: 'no-store'},
  );
  const payload = await readPayload<{
    progress: MotionCanvasGenerationProgress | null;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('progress' in payload)) {
    throw new ApiRequestError(
      'Phản hồi tiến độ sinh scene không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.progress;
}

export async function getMotionCanvasHistory(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/history`,
  );
  const payload = await readPayload<MotionCanvasHistoryResponse>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('versions' in payload) ||
    !('candidates' in payload) ||
    !('currentContentHash' in payload) ||
    !('currentContextHash' in payload)
  ) {
    throw new ApiRequestError(
      'Phản hồi lịch sử Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function createMotionCanvasCheckpoint(
  projectId: string,
  label: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify({label: label.trim() || undefined}),
    },
  );
  const payload = await readPayload<{version: MotionCanvasVersionRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('version' in payload)) {
    throw new ApiRequestError(
      'Phản hồi lưu phiên bản Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.version;
}

export async function createMotionCanvasCandidate(
  projectId: string,
  request: CreateMotionCanvasCandidate,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{candidate: MotionCanvasCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi candidate Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function applyMotionCanvasCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/candidates/${encodeURIComponent(candidateId)}/apply`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getMotionCanvasCandidatePreview(
  projectId: string,
  candidateId: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/candidates/${encodeURIComponent(candidateId)}/preview`,
    previewRequestOptions(),
  );
  const payload = await readPayload<{
    preview: {
      url: string;
      sessionNonce: string;
      sourceMotionCanvasGenerationId: string;
    };
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('preview' in payload)) {
    throw new ApiRequestError(
      'Phản hồi preview candidate Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.preview;
}

export async function getMotionCanvasCandidateFiles(
  projectId: string,
  candidateId: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/candidates/${encodeURIComponent(candidateId)}/files`,
  );
  const payload = await readPayload<{
    bundle: MotionCanvasBundle;
    files: Array<{path: string; source: string}>;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('files' in payload)) {
    throw new ApiRequestError(
      'Phản hồi source candidate Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function rejectMotionCanvasCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/candidates/${encodeURIComponent(candidateId)}/reject`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{candidate: MotionCanvasCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi từ chối candidate Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function restoreMotionCanvasVersion(
  projectId: string,
  versionId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/versions/${encodeURIComponent(versionId)}/restore`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getMotionCanvasFiles(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/files`,
  );
  const payload = await readPayload<{
    bundle: MotionCanvasBundle;
    files: Array<{path: string; source: string}>;
    serveCommand: string;
  }>(response);

  assertSuccessful(response, payload);
  if (!payload || !('files' in payload)) {
    throw new ApiRequestError(
      'Phản hồi workspace Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function getMotionCanvasPreview(
  projectId: string,
  generationId: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/preview?generation=${encodeURIComponent(generationId)}`,
    previewRequestOptions(),
  );
  const payload = await readPayload<{
    preview: {
      generationId: string;
      sourceMotionCanvasGenerationId: string;
      sessionNonce: string;
      url: string;
    };
  }>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('preview' in payload) ||
    typeof payload.preview.url !== 'string' ||
    typeof payload.preview.sessionNonce !== 'string'
  ) {
    throw new ApiRequestError(
      'Phản hồi preview Motion Canvas không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.preview;
}

export async function approveMotionCanvas(
  projectId: string,
  expectedRevision: number,
  options: {acceptDegradedSemantic?: true} = {},
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/approve`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': `"${expectedRevision}"`},
      body: JSON.stringify(options),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getElevenLabsCatalog(search = '') {
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  const response = await fetch(
    `/api/integrations/elevenlabs/catalog?${query.toString()}`,
  );
  const payload = await readPayload<{catalog: ElevenLabsCatalog}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('catalog' in payload)) {
    throw new ApiRequestError(
      'Phản hồi danh mục ElevenLabs không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.catalog;
}

export async function generateVoice(
  projectId: string,
  request: GenerateVoice,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function generateAnimationSync(
  projectId: string,
  request: GenerateAnimationSync,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sync/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getLayoutPreview(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/preview`,
    previewRequestOptions(),
  );
  const payload = await readPayload<{
    preview: {
      generationId: string;
      sourceSyncGenerationId: string;
      sessionNonce: string;
      url: string;
    };
  }>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('preview' in payload) ||
    typeof payload.preview.url !== 'string' ||
    typeof payload.preview.sessionNonce !== 'string'
  ) {
    throw new ApiRequestError(
      'Phản hồi editor scene không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.preview;
}

export async function commitLayoutDesign(
  projectId: string,
  request: CommitLayout,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/design`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function approveLayout(
  projectId: string,
  request: ApproveLayout,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function approveAnimationSync(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sync/approve`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function generateFinalRender(
  projectId: string,
  request: GenerateFinalRender,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/render/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{status: FinalRenderJobStatus}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('status' in payload)) {
    throw new ApiRequestError(
      'Phản hồi khởi tạo final render không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.status;
}

export async function uploadWatermarkImage(projectId: string, file: File) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/render/watermark`,
      {
        method: 'POST',
        headers: {'Content-Type': file.type || 'application/octet-stream'},
        body: file,
        signal: controller.signal,
      },
    );
    const payload = await readPayload<{asset: WatermarkAssetSummary}>(response);
    assertSuccessful(response, payload);
    if (!payload || !('asset' in payload)) {
      throw new ApiRequestError(
        'Phản hồi tải ảnh watermark không hợp lệ.',
        'INVALID_RESPONSE',
      );
    }
    return payload.asset;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiRequestError(
        'Tải ảnh watermark quá 30 giây nên đã được dừng an toàn. Hãy thử lại.',
        'REQUEST_TIMEOUT',
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function watermarkAssetUrl(projectId: string, assetId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/render/watermark?asset=${encodeURIComponent(assetId)}`;
}

export async function getFinalRenderStatus(
  projectId: string,
  generationId?: string,
) {
  const query = generationId
    ? `?generationId=${encodeURIComponent(generationId)}`
    : '';
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/render/status${query}`,
    {cache: 'no-store'},
  );
  const payload = await readPayload<{
    status: FinalRenderJobStatus | null;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('status' in payload)) {
    throw new ApiRequestError(
      'Phản hồi trạng thái final render không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.status;
}

export function finalRenderVideoUrl(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/render/video`;
}

export function voiceAudioUrl(
  projectId: string,
  outlineSectionId: string,
  generationId: string,
) {
  return `/api/projects/${encodeURIComponent(projectId)}/voice/audio/${encodeURIComponent(outlineSectionId)}?generation=${encodeURIComponent(generationId)}`;
}

export async function deleteProject(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: {'If-Match': `"${expectedRevision}"`},
  });

  if (!response.ok) {
    const payload = await readPayload<never>(response);
    assertSuccessful(response, payload);
  }
}

export async function verifyCodexConnection() {
  const response = await fetch('/api/integrations/codex/status');
  const payload = await readPayload<{status: CodexConnectionStatus}>(response);

  assertSuccessful(response, payload);
  if (!payload || !('status' in payload)) {
    throw new ApiRequestError(
      'Phản hồi trạng thái Codex không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }

  return payload.status;
}

export async function startCodexLogin() {
  const response = await fetch('/api/integrations/codex/login', {
    method: 'POST',
  });
  const payload = await readPayload<{login: CodexLoginStart}>(response);

  assertSuccessful(response, payload);
  if (!payload || !('login' in payload)) {
    throw new ApiRequestError(
      'Phản hồi đăng nhập Codex không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }

  return payload.login;
}

export async function loginCodexWithApiKey(apiKey: string) {
  const response = await fetch('/api/integrations/codex/api-key', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apiKey}),
  });
  const payload = await readPayload<{status: CodexConnectionStatus}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('status' in payload)) {
    throw new ApiRequestError(
      'Phản hồi đăng nhập Codex bằng API key không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.status;
}

export async function logoutCodex() {
  const response = await fetch('/api/integrations/codex/logout', {
    method: 'POST',
  });
  const payload = await readPayload<{status: string}>(response);
  assertSuccessful(response, payload);
}

export async function getCodexModels() {
  const response = await fetch('/api/integrations/codex/models', {
    cache: 'no-store',
  });
  const payload = await readPayload<{models: CodexModelSummary[]}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('models' in payload) || !Array.isArray(payload.models)) {
    throw new ApiRequestError(
      'Phản hồi danh sách model Codex không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.models;
}

export async function verifyElevenLabsConnection() {
  const response = await fetch('/api/integrations/elevenlabs/status');
  const payload = await readPayload<{
    status: ElevenLabsConnectionStatus;
  }>(response);

  assertSuccessful(response, payload);
  if (!payload || !('status' in payload)) {
    throw new ApiRequestError(
      'Phản hồi trạng thái ElevenLabs không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }

  return payload.status;
}

export async function getElevenLabsCredentialStatus() {
  const response = await fetch('/api/integrations/elevenlabs/credential', {
    cache: 'no-store',
  });
  const payload = await readPayload<{
    credential: ElevenLabsCredentialStatus;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('credential' in payload)) {
    throw new ApiRequestError(
      'Phản hồi cấu hình ElevenLabs không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.credential;
}

export async function saveElevenLabsApiKey(apiKey: string) {
  const response = await fetch('/api/integrations/elevenlabs/credential', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apiKey}),
  });
  const payload = await readPayload<{
    status: ElevenLabsConnectionStatus;
    credential: ElevenLabsCredentialStatus;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('status' in payload) || !('credential' in payload)) {
    throw new ApiRequestError(
      'Phản hồi lưu ElevenLabs API key không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function removeElevenLabsApiKey() {
  const response = await fetch('/api/integrations/elevenlabs/credential', {
    method: 'DELETE',
  });
  const payload = await readPayload<{
    credential: ElevenLabsCredentialStatus;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('credential' in payload)) {
    throw new ApiRequestError(
      'Phản hồi xóa ElevenLabs API key không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.credential;
}
