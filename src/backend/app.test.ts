import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, {type TestContext} from 'node:test';
import type {
  CreateTopicProject,
  TopicProject,
} from '../shared/topic.ts';
import {createPadStudioServer} from './app.ts';
import type {CodexConnectionService} from './codexConnection.ts';
import type {OutlineGenerator} from './outlineGenerator.ts';

const topicInput = {
  topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
  learningGoal: 'Hiểu trực giác chia đôi không gian tìm kiếm.',
  audience: 'beginner' as const,
  duration: 'standard' as const,
};

function createRequest(
  overrides: Partial<CreateTopicProject> = {},
): CreateTopicProject {
  return {
    creationId: randomUUID(),
    topicInput,
    currentStep: 'outline',
    ...overrides,
  };
}

async function startTestApp(
  context: TestContext,
  options: {
    codexConnection?: CodexConnectionService;
    outlineGenerator?: OutlineGenerator;
  } = {},
) {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-test-'),
  );
  const server = createPadStudioServer({
    projectsDirectory,
    codexConnection: options.codexConnection,
    outlineGenerator: options.outlineGenerator,
    logger: {info() {}, error() {}},
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(projectsDirectory, {recursive: true, force: true});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    projectsDirectory,
  };
}

async function createProject(
  baseUrl: string,
  request = createRequest(),
) {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as {project: TopicProject};

  assert.equal(response.status, 201);
  return {project: body.project, request};
}

function updateProject(
  baseUrl: string,
  projectId: string,
  revision: number,
  body: object,
) {
  return fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': `"${revision}"`,
    },
    body: JSON.stringify(body),
  });
}

test('API Codex trả trạng thái xác minh thật và URL đăng nhập', async (context) => {
  let verifyCalls = 0;
  const codexConnection: CodexConnectionService = {
    async verifyConnection() {
      verifyCalls += 1;
      return {
        state: 'connected',
        account: {
          type: 'chatgpt',
          email: 'user@example.com',
          planType: 'plus',
        },
        verifiedAt: new Date().toISOString(),
      };
    },
    async startChatGptLogin() {
      return {
        loginId: 'login-123',
        authUrl: 'https://auth.openai.com/codex',
      };
    },
    close() {},
  };
  const {baseUrl} = await startTestApp(context, {codexConnection});

  const statusResponse = await fetch(
    `${baseUrl}/api/integrations/codex/status`,
  );
  const statusBody = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(statusBody.status.state, 'connected');
  assert.equal(verifyCalls, 1);

  const loginResponse = await fetch(
    `${baseUrl}/api/integrations/codex/login`,
    {method: 'POST'},
  );
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.login.loginId, 'login-123');
});

test('API tạo, cập nhật và xóa project với revision', async (context) => {
  const {baseUrl, projectsDirectory} = await startTestApp(context);
  const {project} = await createProject(baseUrl);

  assert.equal(project.currentStep, 'outline');
  assert.equal(project.version, 3);
  assert.equal(project.revision, 1);

  const savedProject = JSON.parse(
    await readFile(
      path.join(projectsDirectory, project.id, 'project.json'),
      'utf8',
    ),
  );
  assert.equal(savedProject.creationId, project.creationId);

  const listResponse = await fetch(`${baseUrl}/api/projects`);
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.projects.length, 1);
  assert.deepEqual(listBody.issues, []);

  const update = {
    topicInput: {...project.topicInput, duration: 'deep'},
  };
  const updateResponse = await updateProject(
    baseUrl,
    project.id,
    project.revision,
    update,
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.topicInput.duration, 'deep');
  assert.equal(updateBody.project.revision, 2);

  const repeatedResponse = await updateProject(
    baseUrl,
    project.id,
    project.revision,
    update,
  );
  const repeatedBody = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeatedBody.project.revision, 2);

  const deleteResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}`,
    {
      method: 'DELETE',
      headers: {'If-Match': '"2"'},
    },
  );
  assert.equal(deleteResponse.status, 204);

  const repeatedDeleteResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}`,
    {
      method: 'DELETE',
      headers: {'If-Match': '"2"'},
    },
  );
  assert.equal(repeatedDeleteResponse.status, 204);

  const missingResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}`,
  );
  assert.equal(missingResponse.status, 404);
});

test('API tạo, chỉnh sửa và chốt mạch giảng an toàn', async (context) => {
  let generationCalls = 0;
  const outlineGenerator: OutlineGenerator = {
    async generate() {
      generationCalls += 1;
      return {
        content: {
          brief: {
            summary:
              'Video ngắn giải thích trực giác chia đôi cho người mới học.',
            assumptions: ['Dữ liệu đầu vào đã được sắp xếp.'],
          },
          centralMessage:
            'Mỗi lần so sánh giúp loại bỏ một nửa vùng cần tìm.',
          sections: [
            {
              id: randomUUID(),
              title: 'Đặt vấn đề',
              goal: 'Nhận ra hạn chế của việc tìm kiếm lần lượt.',
              content:
                'Bắt đầu với nhu cầu tìm một giá trị trong một dãy dài.',
              estimatedSeconds: 30,
            },
            {
              id: randomUUID(),
              title: 'Trực giác chia đôi',
              goal: 'Hiểu vì sao có thể bỏ một nửa dữ liệu.',
              content:
                'So sánh với phần tử giữa và chỉ giữ nửa có thể chứa mục tiêu.',
              estimatedSeconds: 60,
            },
          ],
        },
        model: 'test-model',
        usage: {
          inputTokens: 120,
          cachedInputTokens: 0,
          outputTokens: 80,
          reasoningOutputTokens: 20,
          totalTokens: 220,
        },
      };
    },
  };
  const {baseUrl} = await startTestApp(context, {outlineGenerator});
  const {project} = await createProject(baseUrl);
  const generationId = randomUUID();

  const generateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${project.revision}"`,
      },
      body: JSON.stringify({generationId}),
    },
  );
  const generateBody = await generateResponse.json();

  assert.equal(generateResponse.status, 200);
  assert.equal(generateBody.project.revision, 2);
  assert.equal(generateBody.project.outline.status, 'draft');
  assert.equal(generateBody.project.outline.generation.model, 'test-model');
  assert.equal(
    generateBody.project.outline.generation.usage.totalTokens,
    220,
  );

  const repeatedResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${project.revision}"`,
      },
      body: JSON.stringify({generationId}),
    },
  );
  const repeatedBody = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeatedBody.project.revision, 2);
  assert.equal(generationCalls, 1);

  const generatedOutline = generateBody.project.outline;
  const updateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"2"',
      },
      body: JSON.stringify({
        brief: generatedOutline.brief,
        centralMessage:
          'Mỗi bước tìm kiếm loại bỏ chính xác một nửa vùng còn lại.',
        sections: generatedOutline.sections,
      }),
    },
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.revision, 3);
  assert.equal(updateBody.project.outline.contentRevision, 2);

  const approveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"3"'},
    },
  );
  const approveBody = await approveResponse.json();
  assert.equal(approveResponse.status, 200);
  assert.equal(approveBody.project.revision, 4);
  assert.equal(approveBody.project.outline.status, 'approved');

  const topicUpdateResponse = await updateProject(
    baseUrl,
    project.id,
    4,
    {
      topicInput: {
        ...project.topicInput,
        videoDirection: 'Video dọc 60 giây, nhịp nhanh.',
      },
    },
  );
  const topicUpdateBody = await topicUpdateResponse.json();
  assert.equal(topicUpdateResponse.status, 200);
  assert.equal(topicUpdateBody.project.outline.status, 'draft');

  const outdatedApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"5"'},
    },
  );
  const outdatedApproveBody = await outdatedApproveResponse.json();
  assert.equal(outdatedApproveResponse.status, 409);
  assert.equal(outdatedApproveBody.error.code, 'OUTLINE_OUTDATED');
});

test('POST /api/projects trả lỗi đúng field khi input không hợp lệ', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(
      createRequest({
        topicInput: {
          topic: 'BFS',
          audience: 'beginner',
          duration: 'standard',
        },
      }),
    ),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.ok(body.error.fields.topic.length > 0);
});

test('PUT yêu cầu revision hiện tại qua If-Match', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const {project} = await createProject(baseUrl);
  const response = await fetch(
    `${baseUrl}/api/projects/${project.id}`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({currentStep: 'topic'}),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 428);
  assert.equal(body.error.code, 'PRECONDITION_REQUIRED');
});

test('creationId giúp retry mà không tạo project trùng', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const request = createRequest();
  const first = await createProject(baseUrl, request);
  const repeated = await createProject(baseUrl, request);

  assert.equal(repeated.project.id, first.project.id);
  assert.equal(repeated.project.revision, first.project.revision);

  const changedRequest: CreateTopicProject = {
    ...request,
    topicInput: {
      ...request.topicInput,
      learningGoal: 'Mục tiêu được bổ sung sau khi retry.',
    },
  };
  const changedResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(changedRequest),
  });
  const changedBody = await changedResponse.json();
  assert.equal(changedResponse.status, 409);
  assert.equal(changedBody.error.currentProject.id, first.project.id);

  const listBody = await (await fetch(`${baseUrl}/api/projects`)).json();
  assert.equal(listBody.projects.length, 1);
});

test('hai update cùng revision không thể ghi đè âm thầm', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const {project} = await createProject(baseUrl);

  const responses = await Promise.all([
    updateProject(baseUrl, project.id, 1, {
      topicInput: {...project.topicInput, duration: 'concise'},
    }),
    updateProject(baseUrl, project.id, 1, {
      topicInput: {...project.topicInput, duration: 'deep'},
    }),
  ]);
  const statuses = responses.map((response) => response.status).sort();

  assert.deepEqual(statuses, [200, 409]);

  const conflictResponse = responses.find(
    (response) => response.status === 409,
  )!;
  const conflictBody = await conflictResponse.json();
  assert.equal(conflictBody.error.code, 'PROJECT_CONFLICT');
  assert.equal(conflictBody.error.currentProject.revision, 2);

  const currentBody = await (
    await fetch(`${baseUrl}/api/projects/${project.id}`)
  ).json();
  assert.equal(currentBody.project.revision, 2);
});

test('xóa và update đồng thời luôn kết thúc ở trạng thái nhất quán', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const {project} = await createProject(baseUrl);

  const [deleteResponse, updateResponse] = await Promise.all([
    fetch(`${baseUrl}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: {'If-Match': `"${project.revision}"`},
    }),
    updateProject(baseUrl, project.id, project.revision, {
      topicInput: {...project.topicInput, duration: 'deep'},
    }),
  ]);
  const getResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}`,
  );

  if (deleteResponse.status === 204) {
    assert.equal(updateResponse.status, 404);
    assert.equal(getResponse.status, 404);
  } else {
    assert.equal(deleteResponse.status, 409);
    assert.equal(updateResponse.status, 200);
    assert.equal(getResponse.status, 200);
    const getBody = await getResponse.json();
    assert.equal(getBody.project.revision, 2);
  }
});

test('project v1 được migrate và project hỏng được báo rõ', async (context) => {
  const {baseUrl, projectsDirectory} = await startTestApp(context);
  const legacyId = 'legacy-project';
  const invalidId = 'invalid-project';
  const futureId = 'future-project';
  const now = new Date().toISOString();
  const legacyProject = {
    id: legacyId,
    version: 1,
    status: 'draft',
    currentStep: 'topic',
    topicInput,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    mkdir(path.join(projectsDirectory, legacyId), {recursive: true}),
    mkdir(path.join(projectsDirectory, invalidId), {recursive: true}),
    mkdir(path.join(projectsDirectory, futureId), {recursive: true}),
  ]);
  await Promise.all([
    writeFile(
      path.join(projectsDirectory, legacyId, 'project.json'),
      JSON.stringify(legacyProject),
      'utf8',
    ),
    writeFile(
      path.join(projectsDirectory, invalidId, 'project.json'),
      '{invalid json',
      'utf8',
    ),
    writeFile(
      path.join(projectsDirectory, futureId, 'project.json'),
      JSON.stringify({...legacyProject, id: futureId, version: 99}),
      'utf8',
    ),
  ]);

  const listResponse = await fetch(`${baseUrl}/api/projects`);
  const listBody = await listResponse.json();

  assert.equal(listBody.projects.length, 1);
  assert.equal(listBody.projects[0].version, 3);
  assert.equal(listBody.projects[0].revision, 1);
  assert.equal(listBody.issues.length, 2);
  assert.deepEqual(
    listBody.issues.map((issue: {code: string}) => issue.code).sort(),
    ['INVALID_PROJECT_DATA', 'UNSUPPORTED_PROJECT_VERSION'],
  );

  const updateResponse = await updateProject(
    baseUrl,
    legacyId,
    1,
    {currentStep: 'outline'},
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.version, 3);
  assert.equal(updateBody.project.revision, 2);

  const migratedOnDisk = JSON.parse(
    await readFile(
      path.join(projectsDirectory, legacyId, 'project.json'),
      'utf8',
    ),
  );
  assert.equal(migratedOnDisk.version, 3);
  assert.equal(migratedOnDisk.revision, 2);
});
