import type {
  CodexConnectionStatus,
  CodexLoginStart,
  CodexModelSummary,
} from '../shared/codex.ts';
import type {
  ElevenLabsCatalog,
  ElevenLabsConnectionStatus,
  ElevenLabsCredentialStatus,
  ElevenLabsSharedVoiceSearch,
} from '../shared/elevenLabs.ts';
import type {
  ApiErrorPayload,
  AnimationSyncBundle,
  CreateTopicProject,
  GenerateTopicGuidance,
  GenerateAnimationSync,
  GenerateMotionCanvas,
  GenerateTeachingOutline,
  GenerateVoice,
  GenerateVoiceVisualPlan,
  ProjectListIssue,
  MotionCanvasBundle,
  NarrationDocument,
  TeachingOutlineContent,
  TopicProject,
  TopicGuidanceGenerationResponse,
  UpdateProject,
  VoiceVisualPlanContent,
} from '../shared/topic.ts';
import type {
  FinalRenderJobStatus,
  GenerateFinalRender,
  WatermarkAssetSummary,
} from '../shared/render.ts';
import type {
  ApproveLayout,
  CommitLayout,
  CommitVisualDesign,
  LayoutBundle,
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';
import type {
  CreateOutlineCandidate,
  OutlineCandidateRecord,
  OutlineHistoryResponse,
  OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import type {
  CreateVoiceVisualCandidate,
  CreateVoiceVisualReview,
  VoiceVisualCandidateRecord,
  VoiceVisualHistoryResponse,
  VoiceVisualReviewRecord,
  VoiceVisualVersionRecord,
} from '../shared/voiceVisualHistory.ts';
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

export async function generateTopicGuidance(
  request: GenerateTopicGuidance,
) {
  const response = await fetch('/api/topic-guidance/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  const payload = await readPayload<TopicGuidanceGenerationResponse>(response);
  assertSuccessful(response, payload);
  if (!payload || !('suggestion' in payload) || !('generation' in payload)) {
    throw new ApiRequestError(
      'Phản hồi đề xuất định hướng không hợp lệ.',
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

export async function saveProjectNarration(
  projectId: string,
  request: Pick<NarrationDocument, 'sourceText' | 'projectRules'>,
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

export async function generateTeachingOutline(
  projectId: string,
  request: GenerateTeachingOutline,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/generate`,
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

export async function updateTeachingOutline(
  projectId: string,
  content: TeachingOutlineContent,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(content),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function approveTeachingOutline(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/approve`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function getOutlineHistory(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/history`,
  );
  const payload = await readPayload<OutlineHistoryResponse>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('versions' in payload) ||
    !('candidates' in payload) ||
    !('currentContentHash' in payload)
  ) {
    throw new ApiRequestError(
      'Phản hồi lịch sử mạch giảng không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function createOutlineCheckpoint(
  projectId: string,
  expectedRevision: number,
  label?: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(label?.trim() ? {label: label.trim()} : {}),
    },
  );
  const payload = await readPayload<{version: OutlineVersionRecord}>(response);
  assertSuccessful(response, payload);
  if (!payload || !('version' in payload)) {
    throw new ApiRequestError(
      'Phản hồi lưu phiên bản không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.version;
}

export async function createOutlineCandidate(
  projectId: string,
  request: CreateOutlineCandidate,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{candidate: OutlineCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi đề xuất chỉnh sửa không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function applyOutlineCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/candidates/${encodeURIComponent(candidateId)}/apply`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function rejectOutlineCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/candidates/${encodeURIComponent(candidateId)}/reject`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{candidate: OutlineCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi từ chối candidate không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function restoreOutlineVersion(
  projectId: string,
  versionId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/outline/versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function generateVoiceVisualPlan(
  projectId: string,
  request: GenerateVoiceVisualPlan,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/generate`,
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

export async function getVoiceVisualHistory(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/history`,
  );
  const payload = await readPayload<VoiceVisualHistoryResponse>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('versions' in payload) ||
    !('candidates' in payload) ||
    !('currentContentHash' in payload) ||
    !('currentContextHash' in payload)
  ) {
    throw new ApiRequestError(
      'Phản hồi lịch sử voice–visual không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function createVoiceVisualCheckpoint(
  projectId: string,
  label: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify({label: label.trim() || undefined}),
    },
  );
  const payload = await readPayload<{version: VoiceVisualVersionRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('version' in payload)) {
    throw new ApiRequestError(
      'Phản hồi lưu phiên bản voice–visual không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.version;
}

export async function createVoiceVisualCandidate(
  projectId: string,
  request: CreateVoiceVisualCandidate,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{candidate: VoiceVisualCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi đề xuất voice–visual không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function reviewVoiceVisualPlan(
  projectId: string,
  request: CreateVoiceVisualReview,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/reviews`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = await readPayload<{review: VoiceVisualReviewRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('review' in payload)) {
    throw new ApiRequestError(
      'Phản hồi review voice–visual không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.review;
}

export async function applyVoiceVisualCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/candidates/${encodeURIComponent(candidateId)}/apply`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function rejectVoiceVisualCandidate(
  projectId: string,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/candidates/${encodeURIComponent(candidateId)}/reject`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{candidate: VoiceVisualCandidateRecord}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('candidate' in payload)) {
    throw new ApiRequestError(
      'Phản hồi từ chối candidate voice–visual không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.candidate;
}

export async function restoreVoiceVisualVersion(
  projectId: string,
  versionId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/versions/${encodeURIComponent(versionId)}/restore`,
    {method: 'POST', headers: {'If-Match': `"${expectedRevision}"`}},
  );
  const payload = await readPayload<{project: TopicProject}>(response);
  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function updateVoiceVisualPlan(
  projectId: string,
  content: VoiceVisualPlanContent,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify(content),
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function approveVoiceVisualPlan(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice-visual/approve`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
    },
  );
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function generateMotionCanvas(
  projectId: string,
  request: GenerateMotionCanvas,
  expectedRevision: number,
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
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
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

export async function commitVisualDesign(
  projectId: string,
  request: CommitVisualDesign,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/design`,
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

export async function approveMotionCanvas(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/motion-canvas/approve`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
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

export async function searchElevenLabsSharedVoices(search = '') {
  const query = new URLSearchParams({search: search.trim()});
  const response = await fetch(
    `/api/integrations/elevenlabs/shared-voices?${query.toString()}`,
  );
  const payload = await readPayload<{result: ElevenLabsSharedVoiceSearch}>(
    response,
  );
  assertSuccessful(response, payload);
  if (!payload || !('result' in payload)) {
    throw new ApiRequestError(
      'Phản hồi Voice Library không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.result;
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

export async function approveVoice(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/voice/approve`,
    {
      method: 'POST',
      headers: {'If-Match': `"${expectedRevision}"`},
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

export async function getAnimationSyncFiles(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sync/files`,
  );
  const payload = await readPayload<{
    bundle: AnimationSyncBundle;
    files: Array<{path: string; source: string}>;
    serveCommand: string;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('files' in payload)) {
    throw new ApiRequestError(
      'Phản hồi workspace đồng bộ không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function getAnimationSyncPreview(
  projectId: string,
  generationId: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sync/preview?generation=${encodeURIComponent(generationId)}`,
  );
  const payload = await readPayload<{
    preview: {generationId: string; url: string};
  }>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('preview' in payload) ||
    typeof payload.preview?.url !== 'string'
  ) {
    throw new ApiRequestError(
      'Phản hồi bản nháp đồng bộ không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.preview;
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

export function animationSyncAudioUrl(
  projectId: string,
  generationId: string,
) {
  return `/api/projects/${encodeURIComponent(projectId)}/sync/audio?generation=${encodeURIComponent(generationId)}`;
}

export interface LayoutStatePayload {
  bundle: LayoutBundle | null;
  overrides: LayoutOverridesDocument;
  manifest: LayoutEditorManifest | null;
}

export async function getLayoutState(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout`,
  );
  const payload = await readPayload<LayoutStatePayload>(response);
  assertSuccessful(response, payload);
  if (
    !payload ||
    !('overrides' in payload) ||
    !('bundle' in payload) ||
    !('manifest' in payload)
  ) {
    throw new ApiRequestError(
      'Phản hồi dữ liệu Layout Editor không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
}

export async function getLayoutPreview(
  projectId: string,
  generationId: string,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/preview?generation=${encodeURIComponent(generationId)}`,
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
    typeof payload.preview?.url !== 'string' ||
    typeof payload.preview?.sessionNonce !== 'string'
  ) {
    throw new ApiRequestError(
      'Phản hồi preview Layout Editor không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload.preview;
}

export async function commitLayout(
  projectId: string,
  request: CommitLayout,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/commit`,
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

export async function getLayoutFiles(projectId: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/layout/files`,
  );
  const payload = await readPayload<{
    bundle: LayoutBundle;
    files: Array<{path: string; source: string}>;
  }>(response);
  assertSuccessful(response, payload);
  if (!payload || !('files' in payload) || !('bundle' in payload)) {
    throw new ApiRequestError(
      'Phản hồi workspace Layout Editor không hợp lệ.',
      'INVALID_RESPONSE',
    );
  }
  return payload;
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
