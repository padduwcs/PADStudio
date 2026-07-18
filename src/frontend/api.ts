import type {
  CodexConnectionStatus,
  CodexLoginStart,
} from '../shared/codex.ts';
import type {
  ElevenLabsCatalog,
  ElevenLabsConnectionStatus,
  ElevenLabsSharedVoiceSearch,
} from '../shared/elevenLabs.ts';
import type {
  ApiErrorPayload,
  AnimationSyncBundle,
  CreateTopicProject,
  GenerateAnimationSync,
  GenerateMotionCanvas,
  GenerateTeachingOutline,
  GenerateVoice,
  GenerateVoiceVisualPlan,
  ProjectListIssue,
  MotionCanvasBundle,
  TeachingOutlineContent,
  TopicProject,
  UpdateProject,
  VoiceVisualPlanContent,
} from '../shared/topic.ts';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code = 'REQUEST_ERROR',
    readonly status = 0,
    readonly fields?: Record<string, string[]>,
    readonly currentProject?: TopicProject,
  ) {
    super(message);
  }
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
