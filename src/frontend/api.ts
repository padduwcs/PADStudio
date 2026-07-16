import type {
  ApiErrorPayload,
  TopicInput,
  TopicProject,
  UpdateTopicProject,
} from '../shared/topic.ts';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly fields?: Record<string, string[]>,
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
      apiError?.fields,
    );
  }
}

function getProjectPayload(
  payload: {project: TopicProject} | ApiErrorPayload | null,
) {
  if (!payload || !('project' in payload)) {
    throw new ApiRequestError('Phản hồi từ máy chủ không hợp lệ.');
  }

  return payload.project;
}

export async function createTopicProject(input: TopicInput) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(input),
  });
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function listProjects() {
  const response = await fetch('/api/projects');
  const payload = await readPayload<{projects: TopicProject[]}>(response);

  assertSuccessful(response, payload);
  if (!payload || !('projects' in payload)) {
    throw new ApiRequestError('Phản hồi danh sách project không hợp lệ.');
  }

  return payload.projects;
}

export async function getProject(projectId: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function updateTopicProject(
  projectId: string,
  update: UpdateTopicProject,
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(update),
  });
  const payload = await readPayload<{project: TopicProject}>(response);

  assertSuccessful(response, payload);
  return getProjectPayload(payload);
}

export async function deleteProject(projectId: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const payload = await readPayload<never>(response);
    assertSuccessful(response, payload);
  }
}
