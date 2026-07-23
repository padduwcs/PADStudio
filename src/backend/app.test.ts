import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
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
import {currentProjectVersion} from '../shared/topic.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {
  LayoutBundle,
  LayoutEditorManifest,
  LayoutOverridesDocument,
} from '../shared/layout.ts';
import type {AnimationSyncWorkspace} from './animationSyncWorkspace.ts';
import type {AnimationSyncPreviewService} from './animationSyncPreviewService.ts';
import {
  closePadStudioServerServices,
  createPadStudioServer,
} from './app.ts';
import type {CodexConnectionService} from './codexConnection.ts';
import type {ElevenLabsConnectionService} from './elevenLabsConnection.ts';
import type {ElevenLabsVoiceService} from './elevenLabsVoiceService.ts';
import type {OutlineGenerator} from './outlineGenerator.ts';
import type {TopicGuidanceGenerator} from './topicGuidanceGenerator.ts';
import type {OutlineRevisionService} from './outlineRevisionService.ts';
import type {MotionCanvasGenerator} from './motionCanvasGenerator.ts';
import {
  MotionCanvasWorkspaceError,
  type MotionCanvasWorkspace,
} from './motionCanvasWorkspace.ts';
import type {MotionCanvasRevisionReviewService} from './motionCanvasRevisionReview.ts';
import {
  LayoutPreviewError,
  type LayoutPreviewService,
} from './layoutPreviewService.ts';
import type {LayoutWorkspace} from './layoutWorkspace.ts';
import type {VoiceVisualGenerator} from './voiceVisualGenerator.ts';
import type {VoiceVisualRevisionService} from './voiceVisualRevisionService.ts';
import type {VoiceWorkspace} from './voiceWorkspace.ts';
import type {FinalRenderService} from './finalRenderService.ts';
import type {CredentialStore} from './credentialStore.ts';

const topicInput = {
  topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
  learningGoal: 'Hiểu trực giác chia đôi không gian tìm kiếm.',
  background: {mode: 'dark' as const, color: '#10231D'},
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
    elevenLabsConnection?: ElevenLabsConnectionService;
    elevenLabsVoiceService?: ElevenLabsVoiceService;
    credentialStore?: CredentialStore;
    elevenLabsConnectionFactory?: (
      apiKey: string,
    ) => ElevenLabsConnectionService;
    outlineGenerator?: OutlineGenerator;
    topicGuidanceGenerator?: TopicGuidanceGenerator;
    outlineRevisionService?: OutlineRevisionService;
    voiceVisualGenerator?: VoiceVisualGenerator;
    voiceVisualRevisionService?: VoiceVisualRevisionService;
    motionCanvasGenerator?: MotionCanvasGenerator;
    motionCanvasWorkspace?: MotionCanvasWorkspace;
    motionCanvasRevisionReviewService?: MotionCanvasRevisionReviewService;
    voiceWorkspace?: VoiceWorkspace;
    animationSyncWorkspace?: AnimationSyncWorkspace;
    animationSyncPreviewService?: AnimationSyncPreviewService;
    layoutWorkspace?: LayoutWorkspace;
    layoutPreviewService?: LayoutPreviewService;
    finalRenderService?: FinalRenderService;
  } = {},
) {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-test-'),
  );
  const server = createPadStudioServer({
    projectsDirectory,
    codexConnection: options.codexConnection,
    elevenLabsConnection: options.elevenLabsConnection,
    elevenLabsVoiceService: options.elevenLabsVoiceService,
    credentialStore: options.credentialStore,
    elevenLabsConnectionFactory: options.elevenLabsConnectionFactory,
    outlineGenerator: options.outlineGenerator,
    topicGuidanceGenerator: options.topicGuidanceGenerator,
    outlineRevisionService: options.outlineRevisionService,
    voiceVisualGenerator: options.voiceVisualGenerator,
    voiceVisualRevisionService: options.voiceVisualRevisionService,
    motionCanvasGenerator: options.motionCanvasGenerator,
    motionCanvasWorkspace: options.motionCanvasWorkspace,
    motionCanvasRevisionReviewService:
      options.motionCanvasRevisionReviewService,
    voiceWorkspace: options.voiceWorkspace,
    animationSyncWorkspace: options.animationSyncWorkspace,
    animationSyncPreviewService: options.animationSyncPreviewService,
    layoutWorkspace: options.layoutWorkspace,
    layoutPreviewService: options.layoutPreviewService,
    finalRenderService: options.finalRenderService,
    logger: {info() {}, error() {}},
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closePadStudioServerServices(server);
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

test('backend cleanup chờ final render dừng xong và có tính idempotent', async () => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-cleanup-test-'),
  );
  let closeStarted = false;
  let releaseClose!: () => void;
  const finalRenderService: FinalRenderService = {
    async render() {
      throw new Error('Không dùng trong test cleanup.');
    },
    async getStatus() {
      return null;
    },
    async getCompletedBundle() {
      return null;
    },
    async resolveVideo() {
      throw new Error('Không dùng trong test cleanup.');
    },
    async close() {
      closeStarted = true;
      await new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
    },
  };
  const server = createPadStudioServer({
    projectsDirectory,
    finalRenderService,
    logger: {info() {}, error() {}},
  });

  const firstCleanup = closePadStudioServerServices(server);
  const secondCleanup = closePadStudioServerServices(server);
  assert.strictEqual(firstCleanup, secondCleanup);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeStarted, true);

  let cleanupFinished = false;
  void firstCleanup.then(() => {
    cleanupFinished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupFinished, false);

  releaseClose();
  await firstCleanup;
  assert.equal(cleanupFinished, true);
  await rm(projectsDirectory, {recursive: true, force: true});
});

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
        quota: null,
        verifiedAt: new Date().toISOString(),
      };
    },
    async startChatGptLogin() {
      return {
        loginId: 'login-123',
        authUrl: 'https://auth.openai.com/codex',
      };
    },
    async loginWithApiKey(apiKey) {
      assert.equal(apiKey, 'sk-test');
    },
    async logout() {},
    async listModels() {
      return [
        {
          id: 'model-id',
          model: 'model-name',
          displayName: 'Model Name',
          description: '',
          isDefault: true,
          supportedReasoningEfforts: ['medium', 'high'],
          defaultReasoningEffort: 'medium',
        },
      ];
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

  const apiKeyResponse = await fetch(
    `${baseUrl}/api/integrations/codex/api-key`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey: 'sk-test'}),
    },
  );
  assert.equal(apiKeyResponse.status, 200);

  const modelsResponse = await fetch(
    `${baseUrl}/api/integrations/codex/models`,
  );
  const modelsBody = await modelsResponse.json();
  assert.equal(modelsResponse.status, 200);
  assert.equal(modelsBody.models[0].model, 'model-name');

  const logoutResponse = await fetch(
    `${baseUrl}/api/integrations/codex/logout`,
    {method: 'POST'},
  );
  assert.equal(logoutResponse.status, 200);
});

test('API đề xuất định hướng chủ đề idempotent và không tự ghi vào project', async context => {
  let generationCalls = 0;
  const topicGuidanceGenerator: TopicGuidanceGenerator = {
    async generate(request) {
      generationCalls += 1;
      assert.equal(request.topicInput.topic, topicInput.topic);
      return {
        suggestion: {
          learningGoal: 'Hiểu trực giác vì sao mỗi bước loại được một nửa dữ liệu.',
          videoDirection:
            'Mở bằng đối chiếu tìm tuần tự, dùng hình ảnh vùng tìm kiếm thu hẹp dần và kết bằng điều kiện áp dụng.',
          suggestedAngles: [
            'So sánh số lần kiểm tra',
            'Điều kiện dữ liệu đã sắp xếp',
          ],
        },
        model: 'gpt-test',
        usage: null,
      };
    },
  };
  const {baseUrl} = await startTestApp(context, {topicGuidanceGenerator});
  const generationId = randomUUID();
  const request = {
    generationId,
    topicInput,
    model: 'gpt-test',
    reasoningEffort: 'medium',
  };

  const first = await fetch(`${baseUrl}/api/topic-guidance/generate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.suggestion.learningGoal.includes('một nửa'), true);

  const retry = await fetch(`${baseUrl}/api/topic-guidance/generate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
  });
  assert.equal(retry.status, 200);
  assert.equal(generationCalls, 1);

  const reused = await fetch(`${baseUrl}/api/topic-guidance/generate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      ...request,
      topicInput: {...topicInput, topic: `${topicInput.topic} Bổ sung`},
    }),
  });
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).error.code, 'GENERATION_ID_REUSED');
});

test('API ElevenLabs trả trạng thái từ phép xác minh live', async (context) => {
  let verifyCalls = 0;
  const elevenLabsConnection: ElevenLabsConnectionService = {
    async verifyConnection() {
      verifyCalls += 1;
      return {
        state: 'connected',
        subscription: {
          tier: 'free',
          status: 'free',
          characterCount: 120,
          characterLimit: 10_000,
          nextResetAt: '2026-08-01T00:00:00.000Z',
        },
        capabilities: {
          textToSpeechModels: 3,
          supportsVietnamese: true,
        },
        verifiedAt: new Date().toISOString(),
      };
    },
  };
  const {baseUrl} = await startTestApp(context, {
    elevenLabsConnection,
  });

  const response = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/status`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status.state, 'connected');
  assert.equal(body.status.subscription.tier, 'free');
  assert.equal(body.status.capabilities.supportsVietnamese, true);
  assert.equal(verifyCalls, 1);
});

test('API ElevenLabs chỉ lưu key sau xác minh live và không bao giờ trả lại key', async (context) => {
  let saved: string | null = null;
  const credentialStore: CredentialStore = {
    persistence: 'os-protected',
    async get() {
      return saved;
    },
    async set(_name, value) {
      saved = value;
    },
    async delete() {
      saved = null;
    },
  };
  const connected = {
    state: 'connected' as const,
    subscription: {
      tier: 'free',
      status: 'free',
      characterCount: 10_000,
      characterLimit: 10_000,
      nextResetAt: null,
    },
    capabilities: {textToSpeechModels: 2, supportsVietnamese: true},
    verifiedAt: new Date().toISOString(),
  };
  const {baseUrl} = await startTestApp(context, {
    credentialStore,
    elevenLabsConnectionFactory(apiKey) {
      return {
        async verifyConnection() {
          return apiKey === 'valid-key' || apiKey === 'replacement-key'
            ? connected
            : {
                state: 'disconnected' as const,
                message: 'Key bị từ chối.',
                checkedAt: new Date().toISOString(),
              };
        },
      };
    },
  });

  const rejected = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/credential`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey: 'bad-key'}),
    },
  );
  assert.equal(rejected.status, 422);
  assert.equal(saved, null);

  const accepted = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/credential`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey: 'valid-key'}),
    },
  );
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200);
  assert.equal(saved, 'valid-key');
  assert.doesNotMatch(acceptedText, /valid-key/);
  assert.match(acceptedText, /secure-store/);

  const rejectedReplacement = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/credential`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey: 'bad-replacement'}),
    },
  );
  assert.equal(rejectedReplacement.status, 422);
  assert.equal(saved, 'valid-key');

  const acceptedReplacement = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/credential`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey: 'replacement-key'}),
    },
  );
  assert.equal(acceptedReplacement.status, 200);
  assert.equal(saved, 'replacement-key');
  assert.doesNotMatch(await acceptedReplacement.text(), /replacement-key/);

  const removed = await fetch(
    `${baseUrl}/api/integrations/elevenlabs/credential`,
    {method: 'DELETE'},
  );
  assert.equal(removed.status, 200);
  assert.equal(saved, null);
});

test('API tạo, cập nhật và xóa project với revision', async (context) => {
  const {baseUrl, projectsDirectory} = await startTestApp(context);
  const {project} = await createProject(baseUrl);

  assert.equal(project.currentStep, 'outline');
  assert.equal(project.version, currentProjectVersion);
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

test('generic project PUT không thể ghi artifact hoặc vượt review gate', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const {project} = await createProject(baseUrl);
  const sectionIds = [randomUUID(), randomUUID()];
  const attemptedOutline: NonNullable<TopicProject['outline']> = {
    brief: {
      summary:
        'Một mạch giảng hợp lệ được dùng để thử đi vòng qua API chuyên biệt.',
      assumptions: ['Dữ liệu đầu vào đã được sắp xếp.'],
    },
    centralMessage:
      'Mỗi lần so sánh giúp loại bỏ một nửa vùng tìm kiếm còn lại.',
    sections: sectionIds.map((id, index) => ({
      id,
      title: `Phần kiến thức ${index + 1}`,
      goal: 'Giải thích rõ một bước quan trọng của thuật toán.',
      content:
        'Minh họa trực quan cách thuật toán thu hẹp phạm vi cần tìm kiếm.',
      estimatedSeconds: 30,
    })),
    status: 'approved',
    contentRevision: 1,
    sourceInput: project.topicInput,
    generation: {
      generationId: randomUUID(),
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'test-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const attemptedMotionBundle: NonNullable<
    TopicProject['motionCanvasBundle']
  > = {
    status: 'approved',
    contentRevision: 1,
    sourceVoiceVisualContentRevision: 1,
    workspacePath: `motion-canvas/generations/${randomUUID()}`,
    projectFile: 'src/project.ts',
    width: 1920,
    height: 1080,
    fps: 30,
    timingContractVersion: 1,
    scenes: sectionIds.map((outlineSectionId, index) => ({
      id: randomUUID(),
      outlineSectionId,
      name: `Scene ${index + 1}`,
      filePath: `src/scenes/scene-${index + 1}.tsx`,
      durationSeconds: 30,
    })),
    validation: {
      validatedAt: new Date().toISOString(),
      sourceHash: 'a'.repeat(64),
      motionCanvasVersion: '3.17.2',
    },
    generation: {
      generationId: randomUUID(),
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'test-v1',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const forbiddenUpdates = [
    {label: 'project status', body: {status: 'draft'}},
    {label: 'outline', body: {outline: attemptedOutline}},
    {
      label: 'Motion Canvas bundle',
      body: {motionCanvasBundle: attemptedMotionBundle},
    },
    {label: 'downstream currentStep', body: {currentStep: 'sync'}},
    {label: 'voice–visual artifact', body: {voiceVisualPlan: {}}},
    {label: 'voice artifact', body: {voiceBundle: {}}},
    {label: 'sync artifact', body: {animationSyncBundle: {}}},
  ];

  for (const attempt of forbiddenUpdates) {
    const response = await updateProject(
      baseUrl,
      project.id,
      project.revision,
      attempt.body,
    );
    const body = await response.json();

    assert.equal(response.status, 422, attempt.label);
    assert.equal(body.error.code, 'VALIDATION_ERROR', attempt.label);
  }

  const currentBody = await (
    await fetch(`${baseUrl}/api/projects/${project.id}`)
  ).json();
  assert.equal(currentBody.project.revision, project.revision);
  assert.equal(currentBody.project.currentStep, 'outline');
  assert.equal(currentBody.project.outline, null);
  assert.equal(currentBody.project.motionCanvasBundle, null);
});

test('API tạo, chỉnh sửa và chốt mạch giảng an toàn', async (context) => {
  let generationCalls = 0;
  const outlineGenerator: OutlineGenerator = {
    async generate(request) {
      generationCalls += 1;
      assert.equal(request.model, 'model-name');
      assert.equal(request.reasoningEffort, 'high');
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
      body: JSON.stringify({
        generationId,
        model: 'model-name',
        reasoningEffort: 'high',
      }),
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
      body: JSON.stringify({
        generationId,
        model: 'model-name',
        reasoningEffort: 'high',
      }),
    },
  );
  const repeatedBody = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeatedBody.project.revision, 2);
  assert.equal(generationCalls, 1);

  const reusedWithDifferentReasoning = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${project.revision}"`,
      },
      body: JSON.stringify({
        generationId,
        model: 'model-name',
        reasoningEffort: 'low',
      }),
    },
  );
  const reusedBody = await reusedWithDifferentReasoning.json();
  assert.equal(reusedWithDifferentReasoning.status, 409);
  assert.equal(reusedBody.error.code, 'GENERATION_ID_REUSED');
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

test('API Outline candidate giữ bản hiện tại, áp dụng có kiểm soát và khôi phục copy-forward', async context => {
  const firstSectionId = '11111111-1111-4111-8111-111111111111';
  const secondSectionId = '22222222-2222-4222-8222-222222222222';
  const originalContent = {
    brief: {
      summary: 'Video giúp người mới hiểu trực giác chia đôi không gian tìm kiếm.',
      assumptions: ['Dữ liệu đầu vào đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi lần so sánh loại bỏ một nửa vùng tìm kiếm.',
    sections: [
      {
        id: firstSectionId,
        title: 'Đặt vấn đề',
        goal: 'Nhận ra giới hạn của tìm kiếm tuần tự.',
        content: 'Tìm một giá trị trong danh sách dài bằng cách xem lần lượt.',
        estimatedSeconds: 60,
      },
      {
        id: secondSectionId,
        title: 'Chia đôi',
        goal: 'Hiểu cách loại bỏ một nửa dữ liệu.',
        content: 'So sánh phần tử giữa rồi giữ lại nửa phù hợp.',
        estimatedSeconds: 90,
      },
    ],
  };
  const revisedContent = {
    ...originalContent,
    sections: [
      {
        ...originalContent.sections[0]!,
        content:
          'Hãy hình dung việc tìm một tên trong danh bạ hàng nghìn mục bằng cách xem lần lượt từ đầu.',
      },
      originalContent.sections[1]!,
    ],
  };
  const outlineGenerator: OutlineGenerator = {
    async generate() {
      return {content: originalContent, model: 'outline-model', usage: null};
    },
  };
  let revisionCalls = 0;
  const outlineRevisionService: OutlineRevisionService = {
    async revise(request) {
      revisionCalls += 1;
      assert.equal(request.baseContent.sections[0]?.id, firstSectionId);
      assert.deepEqual(request.scope, {
        globalFields: [],
        sections: [{sectionId: firstSectionId, fields: ['content']}],
      });
      const coherenceBlocked = request.guidance.includes('kiểm thử lỗi');
      return {
        patch: {
          editSummary: 'Làm ví dụ mở đầu trực quan hơn.',
          brief: {summary: null, assumptions: null},
          centralMessage: null,
          sections: [
            {
              sectionId: firstSectionId,
              title: null,
              goal: null,
              content: revisedContent.sections[0]!.content,
              estimatedSeconds: null,
            },
          ],
        },
        content: revisedContent,
        coherence: coherenceBlocked
          ? {
              verdict: 'warning',
              summary: 'Bản ghép còn một lỗi logic phải chỉnh tiếp.',
              issues: [
                {
                  severity: 'error',
                  category: 'logic',
                  message: 'Ví dụ mới chưa dẫn được tới nguyên lý ở phần sau.',
                  suggestedFix: 'Bổ sung một câu nối ngay trong section được chọn.',
                  affectedSectionIds: [firstSectionId],
                  requiresScopeExpansion: false,
                },
              ],
            }
          : {
              verdict: 'coherent',
              summary: 'Ví dụ mới vẫn dẫn tự nhiên sang nguyên lý chia đôi.',
              issues: [],
            },
        model: 'revision-model',
        editorUsage: null,
        reviewerUsage: null,
      };
    },
  };
  const {baseUrl} = await startTestApp(context, {
    outlineGenerator,
    outlineRevisionService,
  });
  const {project} = await createProject(baseUrl);
  const generatedResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  const generatedBody = await generatedResponse.json();
  assert.equal(generatedResponse.status, 200);
  assert.equal(generatedBody.project.revision, 2);

  const historyResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/history`,
  );
  const historyBody = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.equal(historyBody.versions.length, 1);
  const baselineVersionId = historyBody.versions[0].versionId;

  const candidateId = randomUUID();
  const candidateRequest = {
    generationId: candidateId,
    guidance: 'Làm ví dụ mở đầu trực quan hơn nhưng giữ nguyên phần sau.',
    scope: {
      globalFields: [],
      sections: [{sectionId: firstSectionId, fields: ['content']}],
    },
  };
  const candidateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"2"',
      },
      body: JSON.stringify(candidateRequest),
    },
  );
  const candidateBody = await candidateResponse.json();
  assert.equal(candidateResponse.status, 201);
  assert.equal(candidateBody.candidate.status, 'ready');
  assert.equal(candidateBody.candidate.baseVersionId, baselineVersionId);
  assert.equal(revisionCalls, 1);

  const repeatedCandidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"2"',
      },
      body: JSON.stringify(candidateRequest),
    },
  );
  assert.equal(repeatedCandidate.status, 200);
  assert.equal(revisionCalls, 1);

  const blockedCandidateId = randomUUID();
  const blockedCandidateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"2"',
      },
      body: JSON.stringify({
        ...candidateRequest,
        generationId: blockedCandidateId,
        guidance: 'Tạo candidate kiểm thử lỗi mạch lạc nghiêm trọng.',
      }),
    },
  );
  const blockedCandidateBody = await blockedCandidateResponse.json();
  assert.equal(blockedCandidateResponse.status, 201);
  assert.equal(blockedCandidateBody.candidate.status, 'coherence_blocked');
  assert.equal(revisionCalls, 2);
  const blockedApplyResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates/${blockedCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"2"'}},
  );
  const blockedApplyBody = await blockedApplyResponse.json();
  assert.equal(blockedApplyResponse.status, 409);
  assert.equal(blockedApplyBody.error.code, 'OUTLINE_COHERENCE_BLOCKED');
  const rejectResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates/${blockedCandidateId}/reject`,
    {method: 'POST', headers: {'If-Match': '"2"'}},
  );
  const rejectBody = await rejectResponse.json();
  assert.equal(rejectResponse.status, 200);
  assert.equal(rejectBody.candidate.decision, 'rejected');

  const unchangedProject = await (
    await fetch(`${baseUrl}/api/projects/${project.id}`)
  ).json();
  assert.equal(unchangedProject.project.revision, 2);
  assert.equal(
    unchangedProject.project.outline.sections[0].content,
    originalContent.sections[0]!.content,
  );

  const applyResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates/${candidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"2"'}},
  );
  const applyBody = await applyResponse.json();
  assert.equal(applyResponse.status, 200);
  assert.equal(applyBody.project.revision, 3);
  const acceptedCandidate = applyBody.version?.candidateId;
  assert.equal(acceptedCandidate, candidateId);
  assert.equal(
    applyBody.project.outline.sections[0].content,
    revisedContent.sections[0]!.content,
  );
  assert.deepEqual(
    applyBody.project.outline.sections[1],
    originalContent.sections[1],
  );

  const restoreResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/versions/${baselineVersionId}/restore`,
    {method: 'POST', headers: {'If-Match': '"3"'}},
  );
  const restoreBody = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200);
  assert.equal(restoreBody.project.revision, 4);
  assert.equal(restoreBody.project.outline.status, 'draft');
  assert.equal(
    restoreBody.project.outline.sections[0].content,
    originalContent.sections[0]!.content,
  );
  assert.equal(restoreBody.project.outline.contentRevision, 3);

  const finalHistory = await (
    await fetch(`${baseUrl}/api/projects/${project.id}/outline/history`)
  ).json();
  assert.ok(finalHistory.versions.length >= 3);
  assert.equal(finalHistory.candidates.length, 2);
  assert.equal(
    finalHistory.candidates.find(
      (item: {candidateId: string}) => item.candidateId === candidateId,
    ).decision,
    'accepted',
  );
  assert.equal(
    finalHistory.versions.some(
      (version: {origin: string; restoredFromVersionId: string | null}) =>
        version.origin === 'restore' &&
        version.restoredFromVersionId === baselineVersionId,
    ),
    true,
  );

  const staleContextCandidateId = randomUUID();
  const staleContextCandidateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"4"',
      },
      body: JSON.stringify({
        ...candidateRequest,
        generationId: staleContextCandidateId,
        guidance: 'Giữ cách sửa nhưng dùng để kiểm thử khóa context.',
      }),
    },
  );
  assert.equal(staleContextCandidateResponse.status, 201);
  const topicChangeResponse = await updateProject(baseUrl, project.id, 4, {
    topicInput: {
      ...project.topicInput,
      videoDirection: 'Context mới sau khi candidate đã được tạo.',
    },
  });
  assert.equal(topicChangeResponse.status, 200);
  const staleApplyResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/candidates/${staleContextCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"5"'}},
  );
  const staleApplyBody = await staleApplyResponse.json();
  assert.equal(staleApplyResponse.status, 409);
  assert.equal(staleApplyBody.error.code, 'OUTLINE_CONTEXT_CHANGED');
});

test('API Voice–visual candidate giữ beat ổn định, khóa context và restore copy-forward', async context => {
  const outlineSectionId = '11111111-1111-4111-8111-111111111111';
  const firstBeatId = '22222222-2222-4222-8222-222222222222';
  const secondBeatId = '33333333-3333-4333-8333-333333333333';
  const outlineGenerator: OutlineGenerator = {
    async generate() {
      return {
        content: {
          brief: {
            summary: 'Giải thích trực giác tìm kiếm nhị phân cho người mới.',
            assumptions: ['Danh sách đầu vào đã được sắp xếp.'],
          },
          centralMessage: 'Mỗi lần so sánh loại bỏ một nửa vùng tìm kiếm.',
          sections: [
            {
              id: outlineSectionId,
              title: 'Chia đôi vùng tìm kiếm',
              goal: 'Hiểu vì sao phần tử giữa giúp loại bỏ một nửa.',
              content: 'Dùng một danh sách số và theo dõi hai biên tìm kiếm.',
              estimatedSeconds: 90,
            },
          ],
        },
        model: 'outline-model',
        usage: null,
      };
    },
  };
  const baseVisual = 'Một dãy số nằm ngang với hai biên được đánh dấu.';
  const revisedVisual =
    'Một dãy số dài, phần tử giữa sáng lên và hai biên được đánh dấu rõ.';
  const revisedSecondVisual =
    'Nửa bị loại mờ xuống trong khi vùng còn lại giữ màu nhấn nhất quán.';
  const voiceVisualGenerator: VoiceVisualGenerator = {
    async generate() {
      return {
        content: {
          voiceDirection: 'Kể rõ ràng, gần gũi và nối ý tự nhiên.',
          visualDirection: 'Dùng dãy số và vùng tô sáng nhất quán.',
          timingCalibration: {
            source: 'default',
            whitespaceTokensPerMinute: 135,
            charactersPerSecond: 12,
            voiceId: null,
            modelId: null,
            voiceName: null,
            sampleCount: 0,
          },
          sections: [
            {
              outlineSectionId,
              beats: [
                {
                  id: firstBeatId,
                  voiceover:
                    'Ta bắt đầu với một danh sách dài đã được sắp xếp.',
                  visualDescription: baseVisual,
                  animationDescription:
                    'Hai biên xuất hiện rồi phần tử giữa sáng lên.',
                  visualHoldSeconds: 0,
                  durationSeconds: 8,
                },
                {
                  id: secondBeatId,
                  voiceover:
                    'Sau phép so sánh, ta bỏ đi ngay một nửa không phù hợp.',
                  visualDescription:
                    'Một nửa dãy số mờ đi, nửa còn lại giữ màu.',
                  animationDescription:
                    'Vùng tìm kiếm co lại quanh các phần tử còn lại.',
                  visualHoldSeconds: 0,
                  durationSeconds: 9,
                },
              ],
            },
          ],
        },
        model: 'voice-visual-model',
        usage: null,
      };
    },
  };
  let revisionCalls = 0;
  let standaloneReviewCalls = 0;
  const voiceVisualRevisionService: VoiceVisualRevisionService = {
    async revise(request) {
      revisionCalls += 1;
      const continuesCandidate =
        request.baseContent.sections[0]!.beats[0]!.visualDescription ===
        revisedVisual;
      if (continuesCandidate) {
        assert.deepEqual(request.scope, {
          globalFields: [],
          beats: [{beatId: secondBeatId, fields: ['visualDescription']}],
        });
        const content = structuredClone(request.baseContent);
        content.sections[0]!.beats[1]!.visualDescription = revisedSecondVisual;
        return {
          patch: {
            editSummary: 'Nối tiếp visual sang beat hai mà giữ nguyên beat đầu.',
            voiceDirection: null,
            visualDirection: null,
            beats: [
              {
                beatId: secondBeatId,
                voiceover: null,
                visualDescription: revisedSecondVisual,
                animationDescription: null,
                visualHoldSeconds: null,
              },
            ],
          },
          content,
          coherence: {
            verdict: 'coherent',
            summary: 'Hai beat đã nối mạch và phần chỉnh trước được giữ nguyên.',
            issues: [],
          },
          model: 'voice-visual-revision-model',
          editorUsage: null,
          reviewerUsage: null,
        };
      }
      assert.deepEqual(request.scope, {
        globalFields: [],
        beats: [{beatId: firstBeatId, fields: ['visualDescription']}],
      });
      const content = structuredClone(request.baseContent);
      content.sections[0]!.beats[0]!.visualDescription = revisedVisual;
      return {
        patch: {
          editSummary: 'Làm rõ phần tử giữa trong visual mở đầu.',
          voiceDirection: null,
          visualDirection: null,
          beats: [
            {
              beatId: firstBeatId,
              voiceover: null,
              visualDescription: revisedVisual,
              animationDescription: null,
              visualHoldSeconds: null,
            },
          ],
        },
        content,
        coherence: {
          verdict: 'needs_scope_expansion',
          summary:
            'AI đề nghị chỉnh thêm beat sau, nhưng người dùng vẫn có thể giữ chủ đích hiện tại.',
          issues: [
            {
              severity: 'warning',
              category: 'visual_consistency',
              message: 'Reviewer muốn làm rõ thêm chuyển tiếp sang beat sau.',
              suggestedFix: 'Có thể mở rộng phạm vi sang beat sau nếu người dùng đồng ý.',
              affectedBeatIds: [secondBeatId],
              requiresScopeExpansion: true,
            },
          ],
        },
        model: 'voice-visual-revision-model',
        editorUsage: null,
        reviewerUsage: null,
      };
    },
    async review(request) {
      standaloneReviewCalls += 1;
      return {
        coherence: {
          verdict: 'warning',
          summary:
            request.target === 'candidate'
              ? 'Candidate có thể nối visual rõ hơn sang beat hai.'
              : 'Bản hiện tại ổn, có thể làm rõ visual mở đầu.',
          issues: [
            {
              severity: 'warning',
              category: 'visual_consistency',
              message: 'Có thể làm ngôn ngữ hình ảnh nhất quán hơn.',
              suggestedFix: 'Chỉ chỉnh visual ở beat được chỉ ra.',
              affectedBeatIds: [
                request.target === 'candidate' ? secondBeatId : firstBeatId,
              ],
              requiresScopeExpansion: false,
            },
          ],
        },
        model: 'voice-visual-review-model',
        usage: null,
      };
    },
  };
  const {baseUrl} = await startTestApp(context, {
    outlineGenerator,
    voiceVisualGenerator,
    voiceVisualRevisionService,
  });
  const {project} = await createProject(baseUrl);
  const outlineGenerated = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"1"'},
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  assert.equal(outlineGenerated.status, 200);
  const outlineApproved = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/approve`,
    {method: 'POST', headers: {'If-Match': '"2"'}},
  );
  assert.equal(outlineApproved.status, 200);
  const generated = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/generate`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"3"'},
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  const generatedBody = await generated.json();
  assert.equal(generated.status, 200);
  assert.equal(generatedBody.project.revision, 4);
  assert.equal(generatedBody.project.voiceVisualPlan.narrationRevision, 1);

  const currentReviewId = randomUUID();
  const currentReview = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/reviews`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify({reviewId: currentReviewId}),
    },
  );
  const currentReviewBody = await currentReview.json();
  assert.equal(currentReview.status, 201);
  assert.equal(currentReviewBody.review.target, 'current');
  assert.equal(currentReviewBody.review.targetCandidateId, null);
  assert.equal(standaloneReviewCalls, 1);
  const retriedCurrentReview = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/reviews`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify({reviewId: currentReviewId}),
    },
  );
  assert.equal(retriedCurrentReview.status, 201);
  assert.equal(standaloneReviewCalls, 1);

  const overwriteAttempt = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/generate`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  const overwriteBody = await overwriteAttempt.json();
  assert.equal(overwriteAttempt.status, 409);
  assert.equal(overwriteBody.error.code, 'VOICE_VISUAL_CANDIDATE_REQUIRED');

  const history = await (
    await fetch(`${baseUrl}/api/projects/${project.id}/voice-visual/history`)
  ).json();
  assert.equal(history.versions.length, 1);
  const baselineVersionId = history.versions[0].versionId;
  const candidateId = randomUUID();
  const candidateRequest = {
    generationId: candidateId,
    guidance: 'Làm phần tử giữa nổi bật hơn, giữ nguyên lời kể.',
    scope: {
      globalFields: [],
      beats: [{beatId: firstBeatId, fields: ['visualDescription']}],
    },
  };
  const candidateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify(candidateRequest),
    },
  );
  const candidateBody = await candidateResponse.json();
  assert.equal(candidateResponse.status, 201);
  assert.equal(candidateBody.candidate.status, 'scope_expansion_required');
  assert.equal(revisionCalls, 1);
  const candidateReview = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/reviews`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify({
        reviewId: randomUUID(),
        candidateId,
      }),
    },
  );
  const candidateReviewBody = await candidateReview.json();
  assert.equal(candidateReview.status, 201);
  assert.equal(candidateReviewBody.review.target, 'candidate');
  assert.equal(candidateReviewBody.review.targetCandidateId, candidateId);
  assert.equal(standaloneReviewCalls, 2);

  const childCandidateId = randomUUID();
  const childCandidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"4"'},
      body: JSON.stringify({
        generationId: childCandidateId,
        baseCandidateId: candidateId,
        guidance: 'Chỉ nối tiếp visual ở beat hai, giữ nguyên beat đầu đã tốt.',
        scope: {
          globalFields: [],
          beats: [{beatId: secondBeatId, fields: ['visualDescription']}],
        },
      }),
    },
  );
  const childCandidateBody = await childCandidate.json();
  assert.equal(childCandidate.status, 201);
  assert.equal(childCandidateBody.candidate.parentCandidateId, candidateId);
  assert.equal(childCandidateBody.candidate.status, 'ready');
  assert.equal(revisionCalls, 2);
  assert.equal(
    childCandidateBody.candidate.content.sections[0].beats[0]
      .visualDescription,
    revisedVisual,
  );
  const unchanged = await (
    await fetch(`${baseUrl}/api/projects/${project.id}`)
  ).json();
  assert.equal(unchanged.project.revision, 4);
  assert.equal(
    unchanged.project.voiceVisualPlan.sections[0].beats[0].visualDescription,
    baseVisual,
  );

  const applied = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/candidates/${childCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"4"'}},
  );
  const appliedBody = await applied.json();
  assert.equal(applied.status, 200);
  assert.equal(appliedBody.project.revision, 5);
  assert.equal(appliedBody.project.voiceVisualPlan.narrationRevision, 1);
  assert.equal(
    appliedBody.project.voiceVisualPlan.sections[0].beats[0].id,
    firstBeatId,
  );
  assert.equal(
    appliedBody.project.voiceVisualPlan.sections[0].beats[0]
      .visualDescription,
    revisedVisual,
  );
  assert.equal(
    appliedBody.project.voiceVisualPlan.sections[0].beats[1]
      .visualDescription,
    revisedSecondVisual,
  );
  assert.equal(
    appliedBody.project.voiceVisualPlan.sections[0].beats[1].voiceover,
    generatedBody.project.voiceVisualPlan.sections[0].beats[1].voiceover,
  );

  const restored = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/versions/${baselineVersionId}/restore`,
    {method: 'POST', headers: {'If-Match': '"5"'}},
  );
  const restoredBody = await restored.json();
  assert.equal(restored.status, 200);
  assert.equal(restoredBody.project.revision, 6);
  assert.equal(restoredBody.project.voiceVisualPlan.status, 'draft');
  assert.equal(restoredBody.project.voiceVisualPlan.narrationRevision, 1);
  assert.equal(
    restoredBody.project.voiceVisualPlan.sections[0].beats[0].visualDescription,
    baseVisual,
  );

  const staleCandidateId = randomUUID();
  const staleCandidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"6"'},
      body: JSON.stringify({...candidateRequest, generationId: staleCandidateId}),
    },
  );
  assert.equal(staleCandidate.status, 201);
  const manuallyChangedContent = {
    voiceDirection: restoredBody.project.voiceVisualPlan.voiceDirection,
    visualDirection: 'Dùng nền tối nhưng vẫn giữ hệ màu nhấn nhất quán.',
    timingCalibration: restoredBody.project.voiceVisualPlan.timingCalibration,
    sections: restoredBody.project.voiceVisualPlan.sections,
  };
  const manualUpdate = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', 'If-Match': '"6"'},
      body: JSON.stringify(manuallyChangedContent),
    },
  );
  assert.equal(manualUpdate.status, 200);
  const staleApply = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/candidates/${staleCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"7"'}},
  );
  const staleApplyBody = await staleApply.json();
  assert.equal(staleApply.status, 409);
  assert.equal(staleApplyBody.error.code, 'VOICE_VISUAL_CONTEXT_CHANGED');
});

test('API Motion Canvas candidate chỉ thay scene được chọn và giữ workspace cũ để restore', async context => {
  const sectionIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const beatIds = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const sceneIds = [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ];
  const originalSources = [
    'export default function sceneOne() { return "scene one original"; }',
    'export default function sceneTwo() { return "scene two original"; }',
  ];
  const revisedSecondSource =
    'export default function sceneTwo() { return "scene two revised only"; }';
  const invalidSecondSource =
    'export default function sceneTwo() { return "scene two before repair"; } // INVALID_CANDIDATE';
  const outlineGenerator: OutlineGenerator = {
    async generate() {
      return {
        content: {
          brief: {
            summary: 'Giải thích tìm kiếm nhị phân bằng hai cảnh liên tục.',
            assumptions: ['Danh sách đã được sắp xếp.'],
          },
          centralMessage: 'Chia đôi giúp thu hẹp vùng tìm kiếm rất nhanh.',
          sections: sectionIds.map((id, index) => ({
            id,
            title: index === 0 ? 'Đặt vấn đề' : 'Chia đôi',
            goal:
              index === 0
                ? 'Nhận ra chi phí tìm tuần tự.'
                : 'Hiểu cách loại bỏ một nửa.',
            content:
              index === 0
                ? 'Quan sát một danh sách dài.'
                : 'So sánh phần tử giữa và thu hẹp vùng.',
            estimatedSeconds: 45,
          })),
        },
        model: 'outline-model',
        usage: null,
      };
    },
  };
  const voiceVisualGenerator: VoiceVisualGenerator = {
    async generate() {
      return {
        content: {
          voiceDirection: 'Kể rõ ràng và nối hai cảnh tự nhiên.',
          visualDirection: 'Giữ palette xanh và cam trên nền tối.',
          timingCalibration: {
            source: 'default',
            whitespaceTokensPerMinute: 135,
            charactersPerSecond: 12,
            voiceId: null,
            modelId: null,
            voiceName: null,
            sampleCount: 0,
          },
          sections: sectionIds.map((outlineSectionId, index) => ({
            outlineSectionId,
            beats: [
              {
                id: beatIds[index]!,
                voiceover:
                  index === 0
                    ? 'Danh sách dài khiến cách xem lần lượt trở nên chậm.'
                    : 'Phần tử giữa giúp ta loại ngay một nửa không phù hợp.',
                visualDescription:
                  index === 0
                    ? 'Một dãy số dài phủ kín khung hình.'
                    : 'Phần tử giữa sáng lên và nửa sai mờ đi.',
                animationDescription:
                  index === 0
                    ? 'Camera lướt dọc dãy số.'
                    : 'Vùng tìm kiếm co lại một nửa.',
                visualHoldSeconds: 0,
                durationSeconds: 8,
              },
            ],
          })),
        },
        model: 'voice-visual-model',
        usage: null,
      };
    },
  };
  let motionCalls = 0;
  let motionRepairCalls = 0;
  const motionCanvasGenerator: MotionCanvasGenerator = {
    async generate(request) {
      motionCalls += 1;
      const indexes =
        request.sectionIndexes ?? request.outline.sections.map((_item, index) => index);
      return {
        scenes: indexes.map(index => {
          const previous = request.currentScenes?.[index];
          return {
            id: previous?.id ?? sceneIds[index]!,
            outlineSectionId: sectionIds[index]!,
            name:
              request.sectionIndexes
                ? `Scene ${index + 1} revised`
                : `Scene ${index + 1} original`,
            filePath:
              previous?.filePath ??
              `src/scenes/0${index + 1}-scene-${index + 1}.tsx`,
            durationSeconds: 8,
            timingEvents: [
              {
                beatId: beatIds[index]!,
                startEvent: `beat:${beatIds[index]}:start`,
                endEvent: `beat:${beatIds[index]}:end`,
                plannedDurationSeconds: 8,
              },
            ],
            source:
              request.sectionIndexes
                ? invalidSecondSource
                : originalSources[index]!,
          };
        }),
        model: 'motion-model',
        usage: null,
      };
    },
    async repair(_request, generated) {
      motionRepairCalls += 1;
      return {
        ...generated,
        scenes: generated.scenes.map(scene => ({
          ...scene,
          source: revisedSecondSource,
        })),
      };
    },
  };
  const workspaceSources = new Map<
    string,
    Array<{
      id: string;
      outlineSectionId: string;
      name: string;
      filePath: string;
      durationSeconds: number;
      timingEvents?: Array<{
        beatId: string;
        startEvent: string;
        endEvent: string;
        plannedDurationSeconds: number;
      }>;
      source: string;
    }>
  >();
  const motionCanvasWorkspace: MotionCanvasWorkspace = {
    async prepare(_projectId, generationId, scenes) {
      const cloned = structuredClone(scenes);
      if (cloned.some(scene => scene.source.includes('INVALID_CANDIDATE'))) {
        throw new MotionCanvasWorkspaceError(
          'MOTION_CANVAS_VALIDATION_FAILED',
          'Candidate cần repair trước khi review.',
          {details: 'src/scenes/02-scene-2.tsx(1,1): simulated error'},
        );
      }
      workspaceSources.set(generationId, cloned);
      const sourceHash = createHash('sha256')
        .update(JSON.stringify(cloned))
        .digest('hex');
      return {
        workspacePath: `motion-canvas/generations/${generationId}`,
        projectFile: 'src/project.ts',
        scenes: cloned.map(({source: _source, ...scene}) => scene),
        validation: {
          validatedAt: new Date().toISOString(),
          sourceHash,
          motionCanvasVersion: '3.17.2',
        },
      };
    },
    async readSceneSources(_projectId, bundle) {
      return structuredClone(
        workspaceSources.get(bundle.generation.generationId) ?? [],
      );
    },
    async readFiles(_projectId, bundle) {
      const sources = workspaceSources.get(bundle.generation.generationId) ?? [];
      return [
        {path: 'src/project.ts', source: 'export default [];'},
        ...sources.map(scene => ({path: scene.filePath, source: scene.source})),
      ];
    },
    async verify(_projectId, bundle) {
      assert.ok(workspaceSources.has(bundle.generation.generationId));
      return {
        projectDirectory: 'C:/test/project',
        workspaceDirectory: 'C:/test/project/motion-canvas',
        projectFile: 'C:/test/project/motion-canvas/src/project.ts',
        sourceHash: bundle.validation.sourceHash,
      };
    },
  };
  let reviewCalls = 0;
  const motionCanvasRevisionReviewService: MotionCanvasRevisionReviewService = {
    async review(request) {
      reviewCalls += 1;
      assert.equal(request.scenes.length, 2);
      assert.equal(request.scenes.filter(scene => scene.changed).length, 1);
      assert.equal(
        request.scenes.find(scene => scene.changed)?.sourceExcerpt,
        revisedSecondSource,
      );
      if (request.guidance.toLowerCase().includes('kiểm thử mở rộng')) {
        return {
          coherence: {
            verdict: 'needs_scope_expansion',
            summary: 'Cần chỉnh scene liền kề để giữ chuyển tiếp tự nhiên.',
            issues: [
              {
                severity: 'warning',
                category: 'narrative_continuity',
                message: 'Chuyển tiếp cần thay đổi ở cả hai scene.',
                suggestedFix: 'Mở rộng phạm vi sang scene liền kề.',
                affectedSceneIds: request.scenes.map(scene => scene.sceneId),
                requiresScopeExpansion: true,
              },
            ],
          },
          model: 'review-model',
          usage: null,
        };
      }
      return {
        coherence: {
          verdict: 'coherent',
          summary: 'Scene sửa vẫn nối mạch và giữ đúng ngôn ngữ hình ảnh.',
          issues: [],
        },
        model: 'review-model',
        usage: null,
      };
    },
  };
  const layoutPreviewService: LayoutPreviewService = {
    async start() {
      throw new Error('Sync preview không thuộc test này.');
    },
    async startMotion(_projectId, motionBundle) {
      return {
        generationId: motionBundle.generation.generationId,
        sourceSyncGenerationId: motionBundle.generation.generationId,
        sessionNonce: randomUUID(),
        url: `http://127.0.0.1:9999/?generation=${motionBundle.generation.generationId}`,
      };
    },
    getManifest() {
      throw new Error('Manifest không thuộc test này.');
    },
    getSourceWorkspaceHash() {
      throw new Error('Source hash preview không thuộc test này.');
    },
    async close() {},
  };
  const {baseUrl} = await startTestApp(context, {
    outlineGenerator,
    voiceVisualGenerator,
    motionCanvasGenerator,
    motionCanvasWorkspace,
    motionCanvasRevisionReviewService,
    layoutPreviewService,
  });
  const {project} = await createProject(baseUrl);
  await fetch(`${baseUrl}/api/projects/${project.id}/outline/generate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'If-Match': '"1"'},
    body: JSON.stringify({generationId: randomUUID()}),
  });
  await fetch(`${baseUrl}/api/projects/${project.id}/outline/approve`, {
    method: 'POST',
    headers: {'If-Match': '"2"'},
  });
  await fetch(`${baseUrl}/api/projects/${project.id}/voice-visual/generate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'If-Match': '"3"'},
    body: JSON.stringify({generationId: randomUUID()}),
  });
  await fetch(`${baseUrl}/api/projects/${project.id}/voice-visual/approve`, {
    method: 'POST',
    headers: {'If-Match': '"4"'},
  });
  const generated = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/generate`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"5"'},
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  const generatedBody = await generated.json();
  assert.equal(generated.status, 200);
  assert.equal(generatedBody.project.revision, 6);

  const overwrite = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/generate`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"6"'},
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  const overwriteBody = await overwrite.json();
  assert.equal(overwrite.status, 409);
  assert.equal(overwriteBody.error.code, 'MOTION_CANVAS_CANDIDATE_REQUIRED');

  const history = await (
    await fetch(`${baseUrl}/api/projects/${project.id}/motion-canvas/history`)
  ).json();
  const baselineVersionId = history.versions[0].versionId;
  const expansionCandidateId = randomUUID();
  const expansionCandidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"6"'},
      body: JSON.stringify({
        generationId: expansionCandidateId,
        guidance: 'Kiểm thử mở rộng phạm vi sang scene liền kề.',
        scope: {sceneIds: [sceneIds[1]]},
      }),
    },
  );
  const expansionCandidateBody = await expansionCandidate.json();
  assert.equal(expansionCandidate.status, 201);
  assert.equal(
    expansionCandidateBody.candidate.status,
    'scope_expansion_required',
  );
  const blockedExpansionApply = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates/${expansionCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"6"'}},
  );
  const blockedExpansionApplyBody = await blockedExpansionApply.json();
  assert.equal(blockedExpansionApply.status, 409);
  assert.equal(
    blockedExpansionApplyBody.error.code,
    'MOTION_CANVAS_SCOPE_EXPANSION_REQUIRED',
  );

  const candidateId = randomUUID();
  const candidateRequest = {
    generationId: candidateId,
    guidance: 'Làm scene hai trực quan hơn nhưng giữ nguyên scene một.',
    scope: {sceneIds: [sceneIds[1]]},
  };
  const candidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"6"'},
      body: JSON.stringify(candidateRequest),
    },
  );
  const candidateBody = await candidate.json();
  assert.equal(candidate.status, 201);
  assert.equal(candidateBody.candidate.status, 'ready');
  assert.equal(motionCalls, 3);
  assert.equal(motionRepairCalls, 2);
  assert.equal(reviewCalls, 2);
  const unchanged = await (
    await fetch(`${baseUrl}/api/projects/${project.id}`)
  ).json();
  assert.equal(unchanged.project.revision, 6);
  const candidateFiles = await (
    await fetch(
      `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates/${candidateId}/files`,
    )
  ).json();
  assert.equal(candidateFiles.files[1].source, originalSources[0]);
  assert.equal(candidateFiles.files[2].source, revisedSecondSource);
  const candidatePreview = await (
    await fetch(
      `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates/${candidateId}/preview`,
    )
  ).json();
  assert.equal(
    candidatePreview.preview.sourceMotionCanvasGenerationId,
    candidateId,
  );

  const applied = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates/${candidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"6"'}},
  );
  const appliedBody = await applied.json();
  assert.equal(applied.status, 200);
  assert.equal(appliedBody.project.revision, 7);
  assert.deepEqual(
    appliedBody.project.motionCanvasBundle.scenes.map(
      (scene: {id: string}) => scene.id,
    ),
    sceneIds,
  );
  const appliedFiles = await (
    await fetch(`${baseUrl}/api/projects/${project.id}/motion-canvas/files`)
  ).json();
  assert.equal(appliedFiles.files[1].source, originalSources[0]);
  assert.equal(appliedFiles.files[2].source, revisedSecondSource);

  const restored = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/versions/${baselineVersionId}/restore`,
    {method: 'POST', headers: {'If-Match': '"7"'}},
  );
  const restoredBody = await restored.json();
  assert.equal(restored.status, 200);
  assert.equal(restoredBody.project.revision, 8);
  assert.notEqual(
    restoredBody.project.motionCanvasBundle.generation.generationId,
    generatedBody.project.motionCanvasBundle.generation.generationId,
  );
  const restoredFiles = await (
    await fetch(`${baseUrl}/api/projects/${project.id}/motion-canvas/files`)
  ).json();
  assert.equal(restoredFiles.files[1].source, originalSources[0]);
  assert.equal(restoredFiles.files[2].source, originalSources[1]);

  const staleCandidateId = randomUUID();
  const staleCandidate = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'If-Match': '"8"'},
      body: JSON.stringify({...candidateRequest, generationId: staleCandidateId}),
    },
  );
  assert.equal(staleCandidate.status, 201);
  const approvedCurrent = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/approve`,
    {method: 'POST', headers: {'If-Match': '"8"'}},
  );
  assert.equal(approvedCurrent.status, 200);
  const staleApply = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/candidates/${staleCandidateId}/apply`,
    {method: 'POST', headers: {'If-Match': '"9"'}},
  );
  const staleApplyBody = await staleApply.json();
  assert.equal(staleApply.status, 409);
  assert.equal(staleApplyBody.error.code, 'MOTION_CANVAS_CONTEXT_CHANGED');
});

test('API chạy pipeline voice–visual đến final render an toàn', async (context) => {
  const outlineGenerator: OutlineGenerator = {
    async generate() {
      return {
        content: {
          brief: {
            summary:
              'Video giải thích trực giác chia đôi bằng hình ảnh rõ ràng.',
            assumptions: ['Dữ liệu đầu vào đã được sắp xếp.'],
          },
          centralMessage:
            'Mỗi lần so sánh giúp loại bỏ một nửa vùng cần tìm.',
          sections: [
            {
              id: randomUUID(),
              title: 'Đặt vấn đề',
              goal: 'Nhận ra hạn chế của tìm kiếm lần lượt.',
              content:
                'So sánh số bước khi tìm tuần tự với cách loại một nửa.',
              estimatedSeconds: 30,
            },
            {
              id: randomUUID(),
              title: 'Trực giác chia đôi',
              goal: 'Hiểu vì sao có thể bỏ một nửa dữ liệu.',
              content:
                'Dùng phần tử giữa để quyết định nửa nào còn khả năng.',
              estimatedSeconds: 60,
            },
          ],
        },
        model: 'outline-test-model',
        usage: null,
      };
    },
  };
  let generationCalls = 0;
  const voiceVisualGenerator: VoiceVisualGenerator = {
    async generate(request) {
      generationCalls += 1;
      return {
        content: {
          voiceDirection: 'Rõ ràng, gần gũi và có nhịp nghỉ tự nhiên.',
          visualDirection:
            'Hình khối tối giản, mỗi chuyển động đều thể hiện một quyết định.',
          timingCalibration: {
            source: 'default',
            whitespaceTokensPerMinute: 195,
            charactersPerSecond: 14.5,
            voiceId: null,
            modelId: null,
            voiceName: null,
            sampleCount: 0,
          },
          sections: request.outline.sections.map((section) => ({
            outlineSectionId: section.id,
            beats: [
              {
                id: randomUUID(),
                voiceover:
                  'Ta bắt đầu bằng cách nhìn vào toàn bộ vùng có thể chứa đáp án.',
                visualDescription:
                  'Một dãy phần tử trải ngang, toàn bộ vùng đang được làm sáng.',
                animationDescription:
                  'Máy quay giữ yên, vùng tìm kiếm xuất hiện từ trái sang phải.',
                visualHoldSeconds: 0,
                durationSeconds: Math.min(section.estimatedSeconds, 45),
              },
            ],
          })),
        },
        model: 'voice-visual-test-model',
        usage: {
          inputTokens: 200,
          cachedInputTokens: 20,
          outputTokens: 100,
          reasoningOutputTokens: 30,
          totalTokens: 330,
        },
      };
    },
  };
  let motionGenerationCalls = 0;
  const motionCanvasGenerator: MotionCanvasGenerator = {
    async generate(request) {
      motionGenerationCalls += 1;
      return {
        scenes: request.outline.sections.map((section, index) => {
          const planSection = request.voiceVisualPlan.sections[index]!;
          const beat = planSection.beats[0]!;
          return {
            id: randomUUID(),
            outlineSectionId: section.id,
            name: `Scene ${index + 1}: ${section.title}`,
            filePath: `src/scenes/0${index + 1}-scene-${index + 1}.tsx`,
            durationSeconds: planSection.beats.reduce(
              (total, item) => total + item.durationSeconds,
              0,
            ),
            timingEvents: planSection.beats.map((item) => ({
              beatId: item.id,
              startEvent: `beat:${item.id}:start`,
              endEvent: `beat:${item.id}:end`,
              plannedDurationSeconds: item.durationSeconds,
            })),
            source: `import {makeScene2D, Rect} from '@motion-canvas/2d';
import {createRef, useDuration, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const card = createRef<Rect>();
  view.add(<Rect ref={card} width={120} height={120} radius={24} fill={'#dbe9e2'} />);
  yield* waitUntil('beat:${beat.id}:start');
  const beatDuration = useDuration('beat:${beat.id}:end');
  yield* card().width(720, beatDuration);
  yield* waitUntil('beat:${beat.id}:end');
});
`,
          };
        }),
        model: 'motion-canvas-test-model',
        usage: null,
      };
    },
  };
  let voiceGenerationCalls = 0;
  const elevenLabsVoiceService: ElevenLabsVoiceService = {
    async getCatalog() {
      return {
        voices: [],
        models: [],
        recentPresets: [],
        history: {available: false, message: null},
      };
    },
    async searchSharedVoices() {
      return {available: false, message: null, voices: []};
    },
    async resolveConfiguration(input) {
      return {
        model: {
          modelId: input.modelId,
          name: 'Multilingual v2',
          description: null,
          languages: ['vi'],
          maximumTextLengthPerRequest: 10_000,
          costMultiplier: 1,
          canUseStyle: true,
          canUseSpeakerBoost: true,
        },
        configuration: {
          voiceId: input.voiceId,
          voiceName: 'Giọng kiểm thử',
          voiceCategory: 'premade',
          modelId: input.modelId,
          modelName: 'Multilingual v2',
          languageCode: 'vi',
          outputFormat: input.outputFormat,
          settings: input.settings,
          seed: input.seed,
        },
      };
    },
    async generateSection(input) {
      voiceGenerationCalls += 1;
      const characters = Array.from(input.text);
      return {
        audio: Buffer.from(`audio-${voiceGenerationCalls}`),
        alignment: {
          characters,
          characterStartTimesSeconds: characters.map(
            (_character, index) => index * 0.05,
          ),
          characterEndTimesSeconds: characters.map(
            (_character, index) => (index + 1) * 0.05,
          ),
        },
        normalizedAlignment: null,
        requestId: `voice-request-${voiceGenerationCalls}`,
        characterCost: characters.length,
      };
    },
  };
  const voiceWorkspace: VoiceWorkspace = {
    async prepare(_projectId, generationId, narration) {
      const characterStartTimesSeconds: number[] = [];
      const characterEndTimesSeconds: number[] = [];
      let offsetSeconds = 0;
      let characterCost = 0;
      const requestIds: string[] = [];
      for (const chunk of narration.chunks) {
        characterStartTimesSeconds.push(
          ...chunk.generated.alignment.characterStartTimesSeconds.map(
            (value) => value + offsetSeconds,
          ),
        );
        characterEndTimesSeconds.push(
          ...chunk.generated.alignment.characterEndTimesSeconds.map(
            (value) => value + offsetSeconds,
          ),
        );
        offsetSeconds +=
          chunk.generated.alignment.characterEndTimesSeconds.at(-1) ?? 0;
        characterCost += chunk.generated.characterCost;
        if (chunk.generated.requestId) {
          requestIds.push(chunk.generated.requestId);
        }
      }
      const totalDurationSeconds = offsetSeconds;
      const sections = narration.sections.map((section, sectionIndex) => {
        const startSeconds =
          sectionIndex === 0
            ? 0
            : characterStartTimesSeconds[section.textStartIndex] ?? 0;
        const nextSection = narration.sections[sectionIndex + 1];
        const endSeconds = nextSection
          ? characterStartTimesSeconds[nextSection.textStartIndex] ?? 0
          : totalDurationSeconds;
        const durationSeconds = endSeconds - startSeconds;
        return {
          outlineSectionId: section.outlineSectionId,
          textStartIndex: section.textStartIndex,
          textEndIndex: section.textEndIndex,
          startSeconds,
          endSeconds,
          durationSeconds,
          sourceTextHash: createHash('sha256')
            .update(
              Array.from(narration.text)
                .slice(section.textStartIndex, section.textEndIndex)
                .join(''),
            )
            .digest('hex'),
          beats: section.beats.map((beat, beatIndex) => ({
            beatId: beat.beatId,
            textStartIndex: beat.textStartIndex,
            textEndIndex: beat.textEndIndex,
            startSeconds: Math.max(
              0,
              (characterStartTimesSeconds[beat.textStartIndex] ?? 0) -
                startSeconds,
            ),
            endSeconds:
              beatIndex === section.beats.length - 1
                ? durationSeconds
                : Math.max(
                    0,
                    (characterEndTimesSeconds[beat.textEndIndex - 1] ?? 0) -
                      startSeconds,
                  ),
          })),
        };
      });
      return {
        workspacePath: `voice/generations/${generationId}`,
        track: {
          audioPath: 'audio/narration.wav',
          alignmentPath: 'alignments/narration.json',
          sourceTextHash: createHash('sha256')
            .update(narration.text)
            .digest('hex'),
          durationSeconds: totalDurationSeconds,
          characterCost,
          strategy:
            narration.chunks.length === 1
              ? 'single-request'
              : 'continuity-groups',
          chunkCount: narration.chunks.length,
          calibration: {
            whitespaceTokenCount: narration.text.split(/\s+/u).length,
            characterCount: Array.from(narration.text).length,
            whitespaceTokensPerMinute:
              (narration.text.split(/\s+/u).length * 60) /
              totalDurationSeconds,
            charactersPerSecond:
              Array.from(narration.text).length / totalDurationSeconds,
          },
        },
        sections,
        totalDurationSeconds,
        characterCost,
        requestIds,
      };
    },
    async readAudio() {
      return {
        audio: Buffer.from('RIFF-master-audio'),
        contentType: 'audio/wav',
      };
    },
  };
  let animationSyncCalls = 0;
  let animationSyncPreviewCalls = 0;
  const animationSyncWorkspace: AnimationSyncWorkspace = {
    async prepare(
      _projectId,
      generationId,
      motionCanvasBundle,
      voiceBundle,
    ) {
      animationSyncCalls += 1;
      return {
        workspacePath: `sync/generations/${generationId}`,
        projectFile: 'src/project.ts',
        audioFile: 'audio/narration.wav',
        totalDurationSeconds: voiceBundle.totalDurationSeconds,
        sections: motionCanvasBundle.scenes.map((scene, sectionIndex) => {
          const voiceSection = voiceBundle.sections[sectionIndex]!;
          const timingEvents = scene.timingEvents!;
          const plannedDurationSeconds = timingEvents.reduce(
            (total, event) => total + event.plannedDurationSeconds,
            0,
          );
          return {
            outlineSectionId: scene.outlineSectionId,
            sceneId: scene.id,
            filePath: scene.filePath,
            plannedDurationSeconds,
            synchronizedDurationSeconds: voiceSection.durationSeconds,
            driftSeconds:
              voiceSection.durationSeconds - plannedDurationSeconds,
            beats: timingEvents.map((event, beatIndex) => {
              const voiceBeat = voiceSection.beats[beatIndex]!;
              return {
                beatId: event.beatId,
                startEvent: event.startEvent,
                endEvent: event.endEvent,
                plannedDurationSeconds: event.plannedDurationSeconds,
                voiceStartSeconds: voiceBeat.startSeconds,
                voiceEndSeconds: voiceBeat.endSeconds,
                synchronizedDurationSeconds:
                  voiceBeat.endSeconds - voiceBeat.startSeconds,
              };
            }),
          };
        }),
        validation: {
          validatedAt: new Date().toISOString(),
          sourceHash: 'c'.repeat(64),
          motionCanvasVersion: '3.17.2',
          audioDurationSeconds: voiceBundle.totalDurationSeconds,
        },
      };
    },
    async readFiles(_projectId, bundle) {
      return [
        {path: 'src/project.ts', source: 'makeProject({audio: narration})'},
        ...bundle.sections.map((section) => ({
          path: section.filePath,
          source: 'scene source',
        })),
      ];
    },
    async readAudio() {
      return Buffer.from('RIFF-test-audio');
    },
  };
  const animationSyncPreviewService: AnimationSyncPreviewService = {
    async start(_projectId, bundle) {
      animationSyncPreviewCalls += 1;
      return {
        generationId: bundle.generation.generationId,
        url: `http://127.0.0.1:9000/?generation=${bundle.generation.generationId}`,
      };
    },
    async close() {},
  };
  let layoutWorkspaceCalls = 0;
  let layoutExpectedSourceHash = '';
  let layoutPreviewCalls = 0;
  let layoutParentOrigin = '';
  const layoutSessionNonce = 'l'.repeat(43);
  let activeLayoutManifest: LayoutEditorManifest | null = null;
  let storedLayoutOverrides: LayoutOverridesDocument | null = null;
  const layoutWorkspace: LayoutWorkspace = {
    async prepare(
      _projectId,
      generationId,
      syncBundle,
      overrides,
      editorManifest,
      _baseGenerationId,
      expectedSourceWorkspaceHash,
    ) {
      layoutWorkspaceCalls += 1;
      layoutExpectedSourceHash = expectedSourceWorkspaceHash ?? '';
      activeLayoutManifest = structuredClone(editorManifest);
      storedLayoutOverrides = {
        version: 1,
        sourceAnimationSyncGenerationId:
          syncBundle.generation.generationId,
        sourceAnimationSyncContentRevision:
          syncBundle.contentRevision,
        sourceAnimationSyncSourceHash:
          syncBundle.validation.sourceHash,
        overrides: structuredClone(overrides),
      };
      const overrideCountByScene = new Map<string, number>();
      for (const override of overrides) {
        overrideCountByScene.set(
          override.sceneId,
          (overrideCountByScene.get(override.sceneId) ?? 0) + 1,
        );
      }
      return {
        workspacePath: `layout/generations/${generationId}`,
        sourceWorkspacePath:
          syncBundle.workspacePath as `sync/generations/${string}`,
        projectFile: 'src/project.ts',
        audioFile: 'audio/narration.wav',
        overridesFile: 'overrides.json',
        manifestFile: 'editor-manifest.json',
        overrideContractVersion: 1,
        totalDurationSeconds: syncBundle.totalDurationSeconds,
        scenes: editorManifest.scenes.map((scene) => ({
          sceneId: scene.sceneId,
          filePath: scene.filePath,
          editableNodeCount: scene.nodes.length,
          overrideCount:
            overrideCountByScene.get(scene.sceneId) ?? 0,
        })),
        validation: {
          validatedAt: new Date().toISOString(),
          sourceHash: 'd'.repeat(64),
          overridesHash: 'e'.repeat(64),
          manifestHash: 'f'.repeat(64),
          motionCanvasVersion:
            syncBundle.validation.motionCanvasVersion,
          audioDurationSeconds:
            syncBundle.validation.audioDurationSeconds,
        },
      };
    },
    async readFiles(_projectId, bundle) {
      return [
        {
          path: bundle.overridesFile,
          source: JSON.stringify(storedLayoutOverrides),
        },
        {
          path: bundle.manifestFile,
          source: JSON.stringify(activeLayoutManifest),
        },
        {
          path: 'pad-studio.manifest.json',
          source: JSON.stringify({
            generationId: bundle.generation.generationId,
          }),
        },
      ];
    },
    async readOverrides() {
      assert.ok(storedLayoutOverrides);
      return structuredClone(storedLayoutOverrides);
    },
    async readEditorManifest() {
      assert.ok(activeLayoutManifest);
      return structuredClone(activeLayoutManifest);
    },
    async verify(_projectId, syncBundle, bundle) {
      assert.ok(storedLayoutOverrides);
      return {
        projectDirectory: 'project',
        sourceWorkspaceDirectory: syncBundle.workspacePath,
        projectFile: syncBundle.projectFile,
        sourceWorkspaceHash: syncBundle.validation.sourceHash,
        layoutWorkspaceDirectory: bundle?.workspacePath ?? null,
        overrides: structuredClone(storedLayoutOverrides),
        editorManifest: activeLayoutManifest
          ? structuredClone(activeLayoutManifest)
          : null,
      };
    },
  };
  const layoutPreviewService: LayoutPreviewService = {
    async start(_projectId, syncBundle, layoutBundle, options) {
      layoutPreviewCalls += 1;
      layoutParentOrigin = options.parentOrigin;
      assert.match(options.parentOrigin, /^http:\/\/127\.0\.0\.1:/);
      activeLayoutManifest = {
        version: 1,
        sourceAnimationSyncGenerationId:
          syncBundle.generation.generationId,
        sourceAnimationSyncContentRevision:
          syncBundle.contentRevision,
        sourceAnimationSyncSourceHash:
          syncBundle.validation.sourceHash,
        scenes: syncBundle.sections.map((section, index) => ({
          sceneId: section.sceneId,
          filePath: section.filePath,
          nodes: [
            {
              key: `semantic-node-${index + 1}`,
              fingerprint: createHash('sha256')
                .update(section.sceneId)
                .digest('hex'),
              label: `Node ${index + 1}`,
              nodeType: 'Rect',
              parentKey: null,
              identity: 'semantic',
              editableProperties: [
                'x',
                'y',
                'scale',
                'opacity',
                'hidden',
                'fill',
              ],
              lockedProperties: [],
              lockReason: null,
            },
          ],
        })),
      };
      return {
        generationId:
          layoutBundle?.generation.generationId ??
          syncBundle.generation.generationId,
        sourceSyncGenerationId:
          syncBundle.generation.generationId,
        sessionNonce: layoutSessionNonce,
        url:
          `http://127.0.0.1:9001/?generation=` +
          (layoutBundle?.generation.generationId ??
            syncBundle.generation.generationId),
      };
    },
    async startMotion(_projectId, motionBundle, options) {
      layoutPreviewCalls += 1;
      layoutParentOrigin = options.parentOrigin;
      activeLayoutManifest = {
        version: 1,
        sourceAnimationSyncGenerationId:
          motionBundle.generation.generationId,
        sourceAnimationSyncContentRevision: motionBundle.contentRevision,
        sourceAnimationSyncSourceHash: motionBundle.validation.sourceHash,
        scenes: motionBundle.scenes.map((scene, index) => ({
          sceneId: scene.id,
          filePath: scene.filePath,
          nodes: [
            {
              key: `semantic-node-${index + 1}`,
              fingerprint: createHash('sha256')
                .update(scene.id)
                .digest('hex'),
              label: `Node ${index + 1}`,
              nodeType: 'Rect',
              parentKey: null,
              identity: 'semantic',
              editableProperties: ['x', 'y', 'scale', 'opacity', 'hidden', 'fill'],
              lockedProperties: [],
              lockReason: null,
            },
          ],
        })),
      };
      return {
        generationId: motionBundle.generation.generationId,
        sourceSyncGenerationId: motionBundle.generation.generationId,
        sessionNonce: layoutSessionNonce,
        url: `http://127.0.0.1:9001/?generation=${motionBundle.generation.generationId}`,
      };
    },
    getManifest(_projectId, sessionNonce, sourceSyncGenerationId) {
      if (
        sessionNonce !== layoutSessionNonce ||
        sourceSyncGenerationId !==
          activeLayoutManifest?.sourceAnimationSyncGenerationId
      ) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_SESSION_MISMATCH',
          'Preview session không hợp lệ.',
        );
      }
      if (!activeLayoutManifest) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
          'Manifest chưa sẵn sàng.',
        );
      }
      return structuredClone(activeLayoutManifest);
    },
    getSourceWorkspaceHash(
      _projectId,
      sessionNonce,
      sourceSyncGenerationId,
    ) {
      if (
        sessionNonce !== layoutSessionNonce ||
        sourceSyncGenerationId !==
          activeLayoutManifest?.sourceAnimationSyncGenerationId
      ) {
        throw new LayoutPreviewError(
          'LAYOUT_PREVIEW_SESSION_MISMATCH',
          'Preview session không hợp lệ.',
        );
      }
      return '9'.repeat(64);
    },
    async close() {},
  };
  const renderOutputDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-render-test-'),
  );
  const renderVideoPath = path.join(renderOutputDirectory, 'video.mp4');
  const renderVideo = Buffer.from('mock-final-video');
  await writeFile(renderVideoPath, renderVideo);
  context.after(() =>
    rm(renderOutputDirectory, {recursive: true, force: true}),
  );
  let finalRenderCalls = 0;
  let finalRenderStatus: Awaited<
    ReturnType<FinalRenderService['getStatus']>
  > = null;
  const finalRenderService: FinalRenderService = {
    async render(
      _projectId,
      generationId,
      contentRevision,
      _syncBundle,
      layoutBundle,
    ) {
      finalRenderCalls += 1;
      const now = new Date().toISOString();
      const totalFrames =
        Math.ceil(layoutBundle.totalDurationSeconds * 30) + 1;
      finalRenderStatus = {
        generationId,
        state: 'queued',
        progress: 0,
        renderedFrames: 0,
        totalFrames,
        startedAt: null,
        updatedAt: now,
        message: 'Đã xếp hàng render.',
        errorCode: null,
      };
      await new Promise(resolve => setImmediate(resolve));
      finalRenderStatus = {
        ...finalRenderStatus,
        state: 'completed',
        progress: 1,
        renderedFrames: totalFrames,
        startedAt: now,
        updatedAt: new Date().toISOString(),
        message: 'Video cuối đã sẵn sàng.',
      };
      return {
        status: 'completed',
        contentRevision,
        sourceLayoutContentRevision: layoutBundle.contentRevision,
        sourceLayoutGenerationId:
          layoutBundle.generation.generationId,
        sourceLayoutSourceHash: layoutBundle.validation.sourceHash,
        workspacePath: `renders/generations/${generationId}`,
        videoFile: 'video.mp4',
        width: 1080,
        height: 1920,
        fps: 30,
        watermark: layoutBundle.renderSettings.watermark,
        durationSeconds: layoutBundle.totalDurationSeconds,
        fileSizeBytes: renderVideo.length,
        encoding: {
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
          crf: 18,
          preset: 'medium',
        },
        validation: {
          validatedAt: now,
          sourceHash: '1'.repeat(64),
          videoHash: createHash('sha256').update(renderVideo).digest('hex'),
          renderedFrameCount: totalFrames,
          probedDurationSeconds: layoutBundle.totalDurationSeconds,
        },
        generation: {
          generationId,
          provider: 'local',
          tool: 'motion-canvas-ffmpeg',
          generatedAt: now,
        },
      };
    },
    async getStatus() {
      return finalRenderStatus;
    },
    async getCompletedBundle() {
      return null;
    },
    async resolveVideo() {
      return {filePath: renderVideoPath, size: renderVideo.length};
    },
    async close() {},
  };
  const {baseUrl} = await startTestApp(context, {
    outlineGenerator,
    voiceVisualGenerator,
    motionCanvasGenerator,
    elevenLabsVoiceService,
    voiceWorkspace,
    animationSyncWorkspace,
    animationSyncPreviewService,
    layoutWorkspace,
    layoutPreviewService,
    finalRenderService,
  });
  const {project} = await createProject(baseUrl);

  const outlineGenerationResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({generationId: randomUUID()}),
    },
  );
  assert.equal(outlineGenerationResponse.status, 200);

  const outlineApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"2"'},
    },
  );
  const outlineApproveBody = await outlineApproveResponse.json();
  assert.equal(outlineApproveResponse.status, 200);
  assert.equal(outlineApproveBody.project.currentStep, 'voiceVisual');

  const generationId = randomUUID();
  const generateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"3"',
      },
      body: JSON.stringify({generationId}),
    },
  );
  const generateBody = await generateResponse.json();
  assert.equal(generateResponse.status, 200);
  assert.equal(generateBody.project.revision, 4);
  assert.equal(generateBody.project.voiceVisualPlan.status, 'draft');
  assert.equal(
    generateBody.project.voiceVisualPlan.sections.length,
    generateBody.project.outline.sections.length,
  );
  assert.equal(
    generateBody.project.voiceVisualPlan.generation.usage.totalTokens,
    330,
  );

  const repeatedResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"3"',
      },
      body: JSON.stringify({generationId}),
    },
  );
  const repeatedBody = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeatedBody.project.revision, 4);
  assert.equal(generationCalls, 1);

  const generatedPlan = generateBody.project.voiceVisualPlan;
  const updateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"4"',
      },
      body: JSON.stringify({
        voiceDirection: generatedPlan.voiceDirection,
        visualDirection: generatedPlan.visualDirection,
        sections: generatedPlan.sections.map(
          (
            section: {
              outlineSectionId: string;
              beats: Array<Record<string, unknown>>;
            },
            index: number,
          ) => ({
            ...section,
            beats:
              index === 0
                ? section.beats.map((beat, beatIndex) =>
                    beatIndex === 0
                      ? {
                          ...beat,
                          voiceover:
                            'Ta bắt đầu bằng toàn bộ vùng có thể chứa đáp án rồi thu hẹp dần.',
                        }
                      : beat,
                  )
                : section.beats,
          }),
        ),
      }),
    },
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.revision, 5);
  assert.equal(updateBody.project.voiceVisualPlan.contentRevision, 2);

  const approveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"5"'},
    },
  );
  const approveBody = await approveResponse.json();
  assert.equal(approveResponse.status, 200);
  assert.equal(approveBody.project.revision, 6);
  assert.equal(approveBody.project.voiceVisualPlan.status, 'approved');
  assert.equal(approveBody.project.currentStep, 'motionCanvas');

  const motionGenerationId = randomUUID();
  const motionGenerateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"6"',
      },
      body: JSON.stringify({generationId: motionGenerationId}),
    },
  );
  const motionGenerateBody = await motionGenerateResponse.json();
  assert.equal(
    motionGenerateResponse.status,
    200,
    JSON.stringify(motionGenerateBody),
  );
  assert.equal(motionGenerateBody.project.revision, 7);
  assert.equal(
    motionGenerateBody.project.motionCanvasBundle.status,
    'draft',
  );
  assert.equal(
    motionGenerateBody.project.motionCanvasBundle.scenes.length,
    motionGenerateBody.project.outline.sections.length,
  );

  const repeatedMotionResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"6"',
      },
      body: JSON.stringify({generationId: motionGenerationId}),
    },
  );
  const repeatedMotionBody = await repeatedMotionResponse.json();
  assert.equal(repeatedMotionResponse.status, 200);
  assert.equal(repeatedMotionBody.project.revision, 7);
  assert.equal(motionGenerationCalls, 1);

  const motionFilesResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/files`,
  );
  const motionFilesBody = await motionFilesResponse.json();
  assert.equal(motionFilesResponse.status, 200);
  assert.equal(motionFilesBody.files.length, 3);
  assert.match(motionFilesBody.files[0].source, /makeProject/);

  const motionApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"7"'},
    },
  );
  const motionApproveBody = await motionApproveResponse.json();
  assert.equal(motionApproveResponse.status, 200);
  assert.equal(motionApproveBody.project.revision, 8);
  assert.equal(
    motionApproveBody.project.motionCanvasBundle.status,
    'approved',
  );
  assert.equal(motionApproveBody.project.currentStep, 'voice');

  const voiceGenerationId = randomUUID();
  const voiceGenerateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"8"',
      },
      body: JSON.stringify({
        generationId: voiceGenerationId,
        voiceId: 'voice-test',
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
        settings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: true,
          speed: 1,
        },
        seed: null,
      }),
    },
  );
  const voiceGenerateBody = await voiceGenerateResponse.json();
  assert.equal(voiceGenerateResponse.status, 200);
  assert.equal(voiceGenerateBody.project.revision, 9);
  assert.equal(voiceGenerateBody.project.voiceBundle.status, 'draft');
  assert.equal(
    voiceGenerateBody.project.voiceBundle.sections.length,
    voiceGenerateBody.project.outline.sections.length,
  );
  assert.equal(
    voiceGenerationCalls,
    1,
  );
  assert.equal(
    voiceGenerateBody.project.voiceBundle.track.strategy,
    'single-request',
  );

  const voiceAudioResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/audio/${voiceGenerateBody.project.outline.sections[0].id}`,
  );
  assert.equal(voiceAudioResponse.status, 200);
  assert.equal(voiceAudioResponse.headers.get('content-type'), 'audio/wav');
  assert.equal(voiceAudioResponse.headers.get('accept-ranges'), 'bytes');
  assert.match(
    Buffer.from(await voiceAudioResponse.arrayBuffer()).toString(),
    /^RIFF-master/,
  );

  const voiceAudioRangeResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/audio/${voiceGenerateBody.project.outline.sections[0].id}`,
    {headers: {Range: 'bytes=5-10'}},
  );
  assert.equal(voiceAudioRangeResponse.status, 206);
  assert.equal(
    voiceAudioRangeResponse.headers.get('content-range'),
    'bytes 5-10/17',
  );
  assert.equal(
    Buffer.from(await voiceAudioRangeResponse.arrayBuffer()).toString(),
    'master',
  );

  const invalidVoiceAudioRangeResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/audio/${voiceGenerateBody.project.outline.sections[0].id}`,
    {headers: {Range: 'bytes=99-120'}},
  );
  assert.equal(invalidVoiceAudioRangeResponse.status, 416);
  assert.equal(
    invalidVoiceAudioRangeResponse.headers.get('content-range'),
    'bytes */17',
  );

  const staleVoiceAudioResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/audio/${voiceGenerateBody.project.outline.sections[0].id}?generation=${randomUUID()}`,
  );
  const staleVoiceAudioBody = await staleVoiceAudioResponse.json();
  assert.equal(staleVoiceAudioResponse.status, 404);
  assert.equal(staleVoiceAudioBody.error.code, 'VOICE_GENERATION_NOT_FOUND');

  const repeatedVoiceResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"8"',
      },
      body: JSON.stringify({
        generationId: voiceGenerationId,
        voiceId: 'voice-test',
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
        settings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: true,
          speed: 1,
        },
        seed: null,
      }),
    },
  );
  assert.equal(repeatedVoiceResponse.status, 200);
  assert.equal((await repeatedVoiceResponse.json()).project.revision, 9);

  const voiceApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"9"'},
    },
  );
  const voiceApproveBody = await voiceApproveResponse.json();
  assert.equal(voiceApproveResponse.status, 200);
  assert.equal(voiceApproveBody.project.revision, 10);
  assert.equal(voiceApproveBody.project.voiceBundle.status, 'approved');
  assert.equal(voiceApproveBody.project.currentStep, 'sync');

  const syncGenerationId = randomUUID();
  const syncGenerateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"10"',
      },
      body: JSON.stringify({generationId: syncGenerationId}),
    },
  );
  const syncGenerateBody = await syncGenerateResponse.json();
  assert.equal(syncGenerateResponse.status, 200);
  assert.equal(syncGenerateBody.project.revision, 11);
  assert.equal(
    syncGenerateBody.project.animationSyncBundle.status,
    'draft',
  );
  assert.equal(
    syncGenerateBody.project.animationSyncBundle.sections.length,
    syncGenerateBody.project.outline.sections.length,
  );
  assert.equal(animationSyncCalls, 1);

  const repeatedSyncResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"10"',
      },
      body: JSON.stringify({generationId: syncGenerationId}),
    },
  );
  assert.equal(repeatedSyncResponse.status, 200);
  assert.equal((await repeatedSyncResponse.json()).project.revision, 11);
  assert.equal(animationSyncCalls, 1);

  const syncFilesResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/files`,
  );
  const syncFilesBody = await syncFilesResponse.json();
  assert.equal(syncFilesResponse.status, 200);
  assert.equal(syncFilesBody.files.length, 3);
  assert.match(syncFilesBody.serveCommand, /sync:serve/);

  const syncAudioResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/audio?generation=${syncGenerationId}`,
  );
  assert.equal(syncAudioResponse.status, 200);
  assert.equal(syncAudioResponse.headers.get('content-type'), 'audio/wav');
  assert.equal(syncAudioResponse.headers.get('accept-ranges'), 'bytes');
  assert.match(
    Buffer.from(await syncAudioResponse.arrayBuffer()).toString(),
    /^RIFF/,
  );

  const syncAudioRangeResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/audio?generation=${syncGenerationId}`,
    {headers: {Range: 'bytes=-5'}},
  );
  assert.equal(syncAudioRangeResponse.status, 206);
  assert.equal(
    syncAudioRangeResponse.headers.get('content-range'),
    'bytes 10-14/15',
  );
  assert.equal(
    Buffer.from(await syncAudioRangeResponse.arrayBuffer()).toString(),
    'audio',
  );

  const syncPreviewResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/preview?generation=${syncGenerationId}`,
  );
  const syncPreviewBody = await syncPreviewResponse.json();
  assert.equal(syncPreviewResponse.status, 200);
  assert.equal(
    syncPreviewBody.preview.generationId,
    syncGenerationId,
  );
  assert.match(syncPreviewBody.preview.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(animationSyncPreviewCalls, 1);

  const syncApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/sync/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"11"'},
    },
  );
  const syncApproveBody = await syncApproveResponse.json();
  assert.equal(syncApproveResponse.status, 200);
  assert.equal(syncApproveBody.project.revision, 12);
  assert.equal(
    syncApproveBody.project.animationSyncBundle.status,
    'approved',
  );
  assert.equal(syncApproveBody.project.currentStep, 'layout');

  const initialLayoutStateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout`,
  );
  const initialLayoutState = await initialLayoutStateResponse.json();
  assert.equal(initialLayoutStateResponse.status, 200);
  assert.equal(initialLayoutState.bundle, null);
  assert.deepEqual(initialLayoutState.overrides.overrides, []);
  assert.equal(initialLayoutState.manifest, null);

  const invalidLayoutOriginResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/preview?generation=${syncGenerationId}`,
    {
      headers: {
        'X-Pad-Parent-Origin': 'https://example.com',
      },
    },
  );
  const invalidLayoutOriginBody =
    await invalidLayoutOriginResponse.json();
  assert.equal(invalidLayoutOriginResponse.status, 400);
  assert.equal(
    invalidLayoutOriginBody.error.code,
    'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
  );
  assert.equal(layoutPreviewCalls, 0);

  const layoutPreviewResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/preview?generation=${syncGenerationId}`,
    {
      headers: {
        'X-Pad-Parent-Origin': 'http://127.0.0.1:5173',
      },
    },
  );
  const layoutPreviewBody = await layoutPreviewResponse.json();
  assert.equal(layoutPreviewResponse.status, 200);
  assert.equal(
    layoutPreviewBody.preview.sourceSyncGenerationId,
    syncGenerationId,
  );
  assert.equal(
    layoutPreviewBody.preview.sessionNonce,
    layoutSessionNonce,
  );
  assert.equal(layoutParentOrigin, 'http://127.0.0.1:5173');
  assert.equal(layoutPreviewCalls, 1);
  const previewManifest =
    activeLayoutManifest as LayoutEditorManifest | null;
  assert.ok(previewManifest);

  const firstLayoutNode = previewManifest.scenes[0]!.nodes[0]!;
  const layoutGenerationId = randomUUID();
  const renderOptions = {
    watermark: {
      type: 'text' as const,
      text: 'PAD Studio',
      opacity: 0.31,
      xPercent: 88,
      yPercent: 92,
      fontSize: 44,
      color: '#ffffff',
    },
  };
  const layoutOverrides = [
    {
      sceneId: previewManifest.scenes[0]!.sceneId,
      nodeKey: firstLayoutNode.key,
      nodeFingerprint: firstLayoutNode.fingerprint,
      patch: {
        x: 36,
        scale: 1.1,
        fill: '#ABCDEF',
        hidden: false,
      },
    },
  ];
  const layoutCommitRequest = {
    generationId: layoutGenerationId,
    baseGenerationId: null,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sessionNonce: layoutSessionNonce,
    overrides: layoutOverrides,
    renderSettings: renderOptions,
  };
  const outdatedLayoutSourceResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
      },
      body: JSON.stringify({
        ...layoutCommitRequest,
        generationId: randomUUID(),
        sourceAnimationSyncGenerationId: randomUUID(),
      }),
    },
  );
  assert.equal(outdatedLayoutSourceResponse.status, 409);
  assert.equal(
    (await outdatedLayoutSourceResponse.json()).error.code,
    'LAYOUT_SOURCE_OUTDATED',
  );

  const invalidLayoutBaseResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
      },
      body: JSON.stringify({
        ...layoutCommitRequest,
        generationId: randomUUID(),
        baseGenerationId: randomUUID(),
      }),
    },
  );
  assert.equal(invalidLayoutBaseResponse.status, 409);
  assert.equal(
    (await invalidLayoutBaseResponse.json()).error.code,
    'LAYOUT_BASE_GENERATION_CONFLICT',
  );

  const invalidLayoutSessionResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
      },
      body: JSON.stringify({
        ...layoutCommitRequest,
        generationId: randomUUID(),
        sessionNonce: 's'.repeat(43),
      }),
    },
  );
  assert.equal(invalidLayoutSessionResponse.status, 409);
  assert.equal(
    (await invalidLayoutSessionResponse.json()).error.code,
    'LAYOUT_PREVIEW_SESSION_MISMATCH',
  );
  assert.equal(layoutWorkspaceCalls, 0);

  const layoutCommitResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
      },
      body: JSON.stringify(layoutCommitRequest),
    },
  );
  const layoutCommitBody = await layoutCommitResponse.json();
  assert.equal(layoutCommitResponse.status, 200);
  assert.equal(layoutCommitBody.project.revision, 13);
  assert.equal(layoutCommitBody.project.layoutBundle.status, 'draft');
  assert.equal(
    layoutCommitBody.project.layoutBundle.generation.generationId,
    layoutGenerationId,
  );
  assert.equal(layoutWorkspaceCalls, 1);
  assert.equal(layoutExpectedSourceHash, '9'.repeat(64));
  assert.deepEqual(
    layoutCommitBody.project.layoutBundle.renderSettings,
    renderOptions,
  );

  const repeatedLayoutCommitResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
      },
      body: JSON.stringify(layoutCommitRequest),
    },
  );
  assert.equal(repeatedLayoutCommitResponse.status, 200);
  assert.equal(
    (await repeatedLayoutCommitResponse.json()).project.revision,
    13,
  );
  assert.equal(layoutWorkspaceCalls, 1);

  const layoutStateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout`,
  );
  const layoutState = await layoutStateResponse.json();
  assert.equal(layoutStateResponse.status, 200);
  assert.equal(
    layoutState.bundle.generation.generationId,
    layoutGenerationId,
  );
  assert.deepEqual(layoutState.overrides.overrides, layoutOverrides);
  assert.equal(layoutState.manifest.scenes.length, 2);

  const layoutFilesResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/files`,
  );
  const layoutFilesBody = await layoutFilesResponse.json();
  assert.equal(layoutFilesResponse.status, 200);
  assert.deepEqual(
    layoutFilesBody.files.map((file: {path: string}) => file.path),
    [
      'overrides.json',
      'editor-manifest.json',
      'pad-studio.manifest.json',
    ],
  );

  const layoutApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"13"',
      },
      body: JSON.stringify({generationId: layoutGenerationId}),
    },
  );
  const layoutApproveBody = await layoutApproveResponse.json();
  assert.equal(layoutApproveResponse.status, 200);
  assert.equal(layoutApproveBody.project.revision, 14);
  assert.equal(layoutApproveBody.project.layoutBundle.status, 'approved');

  const repeatedLayoutApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"13"',
      },
      body: JSON.stringify({generationId: layoutGenerationId}),
    },
  );
  assert.equal(repeatedLayoutApproveResponse.status, 200);
  assert.equal(
    (await repeatedLayoutApproveResponse.json()).project.revision,
    14,
  );

  const mismatchedRenderSettingsResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"14"',
      },
      body: JSON.stringify({
        generationId: randomUUID(),
        playbackRate: 1,
        watermark: {type: 'none'},
      }),
    },
  );
  assert.equal(mismatchedRenderSettingsResponse.status, 422);
  assert.equal(
    (await mismatchedRenderSettingsResponse.json()).error.code,
    'VALIDATION_ERROR',
  );

  const watermarkImage = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.alloc(32, 9),
  ]);
  const watermarkUploadResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/watermark`,
    {
      method: 'POST',
      headers: {'Content-Type': 'image/png'},
      body: watermarkImage,
    },
  );
  const watermarkUploadBody = await watermarkUploadResponse.json();
  assert.equal(watermarkUploadResponse.status, 201);
  assert.equal(watermarkUploadBody.asset.contentType, 'image/png');
  const watermarkReadResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/watermark?asset=${watermarkUploadBody.asset.assetId}`,
  );
  assert.equal(watermarkReadResponse.status, 200);
  assert.equal(watermarkReadResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(
    Buffer.from(await watermarkReadResponse.arrayBuffer()),
    watermarkImage,
  );
  const finalRenderGenerationId = randomUUID();
  const finalRenderResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"14"',
      },
      body: JSON.stringify({
        generationId: finalRenderGenerationId,
      }),
    },
  );
  const finalRenderBody = await finalRenderResponse.json();
  assert.equal(finalRenderResponse.status, 202);
  assert.equal(finalRenderBody.status.generationId, finalRenderGenerationId);
  assert.equal(finalRenderBody.status.state, 'queued');
  let finalizedProject: TopicProject | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const projectResponse = await fetch(
      `${baseUrl}/api/projects/${project.id}`,
    );
    const projectBody = await projectResponse.json();
    if (
      projectBody.project.renderBundle?.generation.generationId ===
      finalRenderGenerationId
    ) {
      finalizedProject = projectBody.project;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(finalizedProject);
  assert.equal(finalizedProject.revision, 15);
  assert.equal(finalizedProject.currentStep, 'render');
  assert.equal(
    finalizedProject.renderBundle?.generation.generationId,
    finalRenderGenerationId,
  );
  assert.equal(finalRenderCalls, 1);
  assert.equal(
    finalizedProject.renderBundle?.durationSeconds,
    finalizedProject.layoutBundle!.totalDurationSeconds,
  );

  const finalRenderStatusResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/status?generationId=${finalRenderGenerationId}`,
  );
  const finalRenderStatusBody = await finalRenderStatusResponse.json();
  assert.equal(finalRenderStatusResponse.status, 200);
  assert.equal(finalRenderStatusBody.status.state, 'completed');

  const finalVideoRangeResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/video`,
    {headers: {Range: 'bytes=5-9'}},
  );
  assert.equal(finalVideoRangeResponse.status, 206);
  assert.equal(
    finalVideoRangeResponse.headers.get('content-range'),
    `bytes 5-9/${renderVideo.length}`,
  );
  assert.equal(
    Buffer.from(await finalVideoRangeResponse.arrayBuffer()).toString(),
    'final',
  );

  const repeatedFinalRenderResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/render/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"14"',
      },
      body: JSON.stringify({
        generationId: finalRenderGenerationId,
      }),
    },
  );
  assert.equal(repeatedFinalRenderResponse.status, 200);
  assert.equal(
    (await repeatedFinalRenderResponse.json()).status.state,
    'completed',
  );
  assert.equal(finalRenderCalls, 1);

  const motionPreviewResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/preview?generation=${motionGenerateBody.project.motionCanvasBundle.generation.generationId}`,
    {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1:5173'}},
  );
  const motionPreviewBody = await motionPreviewResponse.json();
  assert.equal(motionPreviewResponse.status, 200);
  assert.equal(
    motionPreviewBody.preview.sourceMotionCanvasGenerationId,
    motionGenerateBody.project.motionCanvasBundle.generation.generationId,
  );
  const motionDesignManifest = activeLayoutManifest!;
  const motionDesignNode = motionDesignManifest.scenes[0]!.nodes[0]!;
  const motionDesignOverrides = [
    {
      sceneId: motionDesignManifest.scenes[0]!.sceneId,
      nodeKey: motionDesignNode.key,
      nodeFingerprint: motionDesignNode.fingerprint,
      patch: {x: 28, opacity: 0.92},
    },
  ];
  const motionDesignResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/design`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"15"',
      },
      body: JSON.stringify({
        sourceMotionCanvasGenerationId:
          motionGenerateBody.project.motionCanvasBundle.generation.generationId,
        sessionNonce: layoutSessionNonce,
        overrides: motionDesignOverrides,
      }),
    },
  );
  const motionDesignBody = await motionDesignResponse.json();
  assert.equal(motionDesignResponse.status, 200);
  assert.equal(motionDesignBody.project.revision, 16);
  assert.deepEqual(
    motionDesignBody.project.visualDesignBundle.overrides,
    motionDesignOverrides,
  );
  assert.equal(
    motionDesignBody.project.animationSyncBundle.status,
    'draft',
  );
  assert.equal(motionDesignBody.project.layoutBundle.status, 'draft');
  assert.equal(motionDesignBody.project.renderBundle, null);

  const approvedPlan = syncApproveBody.project.voiceVisualPlan;
  const visualOnlyUpdateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"16"',
      },
      body: JSON.stringify({
        voiceDirection: approvedPlan.voiceDirection,
        visualDirection: approvedPlan.visualDirection,
        sections: approvedPlan.sections.map(
          (
            section: {
              outlineSectionId: string;
              beats: Array<Record<string, unknown>>;
            },
            sectionIndex: number,
          ) => ({
            ...section,
            beats: section.beats.map((beat, beatIndex) =>
              sectionIndex === 0 && beatIndex === 0
                ? {
                    ...beat,
                    visualDescription:
                      'Cùng lời đọc nhưng visual được bố cục lại rõ hơn.',
                  }
                : beat,
            ),
          }),
        ),
      }),
    },
  );
  const visualOnlyUpdateBody = await visualOnlyUpdateResponse.json();
  assert.equal(visualOnlyUpdateResponse.status, 200);
  assert.equal(visualOnlyUpdateBody.project.revision, 17);
  assert.equal(visualOnlyUpdateBody.project.voiceBundle.status, 'approved');
  assert.equal(
    visualOnlyUpdateBody.project.voiceVisualPlan.narrationRevision,
    approvedPlan.narrationRevision,
  );
  assert.equal(
    visualOnlyUpdateBody.project.motionCanvasBundle.status,
    'draft',
  );
  assert.equal(
    visualOnlyUpdateBody.project.animationSyncBundle.status,
    'draft',
  );
  assert.equal(visualOnlyUpdateBody.project.layoutBundle.status, 'draft');
  assert.equal(visualOnlyUpdateBody.project.renderBundle, null);

  const visualPlan = visualOnlyUpdateBody.project.voiceVisualPlan;
  const voiceTextUpdateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"17"',
      },
      body: JSON.stringify({
        voiceDirection: visualPlan.voiceDirection,
        visualDirection: visualPlan.visualDirection,
        sections: visualPlan.sections.map(
          (
            section: {
              outlineSectionId: string;
              beats: Array<Record<string, unknown>>;
            },
            sectionIndex: number,
          ) => ({
            ...section,
            beats: section.beats.map((beat, beatIndex) =>
              sectionIndex === 0 && beatIndex === 0
                ? {
                    ...beat,
                    voiceover: `${String(beat.voiceover)} Thêm một ý mới.`,
                  }
                : beat,
            ),
          }),
        ),
      }),
    },
  );
  const voiceTextUpdateBody = await voiceTextUpdateResponse.json();
  assert.equal(voiceTextUpdateResponse.status, 200);
  assert.equal(voiceTextUpdateBody.project.revision, 18);
  assert.equal(voiceTextUpdateBody.project.voiceBundle.status, 'draft');
  assert.equal(
    voiceTextUpdateBody.project.voiceVisualPlan.narrationRevision,
    visualPlan.narrationRevision + 1,
  );
  assert.ok(
    voiceTextUpdateBody.project.voiceVisualPlan.sections[0].beats[0]
      .durationSeconds >=
      visualPlan.sections[0].beats[0].durationSeconds,
  );

  const outline = voiceTextUpdateBody.project.outline;
  const outlineUpdateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/outline`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"18"',
      },
      body: JSON.stringify({
        brief: outline.brief,
        centralMessage:
          'Mỗi quyết định đúng giúp loại bỏ chính xác một nửa vùng còn lại.',
        sections: outline.sections,
      }),
    },
  );
  const outlineUpdateBody = await outlineUpdateResponse.json();
  assert.equal(outlineUpdateResponse.status, 200);
  assert.equal(outlineUpdateBody.project.currentStep, 'outline');
  assert.equal(
    outlineUpdateBody.project.voiceVisualPlan.status,
    'draft',
  );
  assert.equal(
    outlineUpdateBody.project.motionCanvasBundle.status,
    'draft',
  );
  assert.equal(outlineUpdateBody.project.voiceBundle.status, 'draft');
  assert.equal(
    outlineUpdateBody.project.animationSyncBundle.status,
    'draft',
  );

  const outdatedApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"19"'},
    },
  );
  const outdatedApproveBody = await outdatedApproveResponse.json();
  assert.equal(outdatedApproveResponse.status, 409);
  assert.equal(
    outdatedApproveBody.error.code,
    'VOICE_VISUAL_OUTDATED',
  );

  const outdatedMotionApproveResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/motion-canvas/approve`,
    {
      method: 'POST',
      headers: {'If-Match': '"19"'},
    },
  );
  const outdatedMotionApproveBody =
    await outdatedMotionApproveResponse.json();
  assert.equal(outdatedMotionApproveResponse.status, 409);
  assert.equal(
    outdatedMotionApproveBody.error.code,
    'MOTION_CANVAS_OUTDATED',
  );
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
          background: {mode: 'dark', color: '#10231D'},
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

test('POST /api/projects không thể khởi tạo ở bước tùy ý', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...createRequest(), currentStep: 'sync'}),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');

  const listBody = await (await fetch(`${baseUrl}/api/projects`)).json();
  assert.equal(listBody.projects.length, 0);
});

test('API đọc JSON trên 64 KiB và từ chối payload vượt cầu chì 16 MiB', async (context) => {
  const {baseUrl} = await startTestApp(context);
  const acceptedResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({unknown: 'x'.repeat(70_000)}),
  });
  const acceptedBody = await acceptedResponse.json();

  assert.equal(acceptedResponse.status, 422);
  assert.equal(acceptedBody.error.code, 'VALIDATION_ERROR');

  const rejectedResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      unknown: 'x'.repeat(pipelineSafetyLimits.maximumJsonBodyBytes),
    }),
  });
  const rejectedBody = await rejectedResponse.json();

  assert.equal(rejectedResponse.status, 413);
  assert.equal(rejectedBody.error.code, 'PAYLOAD_TOO_LARGE');
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
  const mismatchedId = 'mismatched-project';
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
    mkdir(path.join(projectsDirectory, mismatchedId), {recursive: true}),
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
    writeFile(
      path.join(projectsDirectory, mismatchedId, 'project.json'),
      JSON.stringify({...legacyProject, id: 'different-project'}),
      'utf8',
    ),
  ]);

  const listResponse = await fetch(`${baseUrl}/api/projects`);
  const listBody = await listResponse.json();

  assert.equal(listBody.projects.length, 1);
  assert.equal(listBody.projects[0].version, currentProjectVersion);
  assert.equal(listBody.projects[0].revision, 1);
  assert.equal(listBody.issues.length, 3);
  assert.deepEqual(
    listBody.issues.map((issue: {code: string}) => issue.code).sort(),
    [
      'INVALID_PROJECT_DATA',
      'INVALID_PROJECT_DATA',
      'UNSUPPORTED_PROJECT_VERSION',
    ],
  );

  const mismatchedResponse = await fetch(
    `${baseUrl}/api/projects/${mismatchedId}`,
  );
  const mismatchedBody = await mismatchedResponse.json();
  assert.equal(mismatchedResponse.status, 422);
  assert.equal(mismatchedBody.error.code, 'INVALID_PROJECT_DATA');

  const updateResponse = await updateProject(
    baseUrl,
    legacyId,
    1,
    {currentStep: 'outline'},
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.version, currentProjectVersion);
  assert.equal(updateBody.project.revision, 2);

  const migratedOnDisk = JSON.parse(
    await readFile(
      path.join(projectsDirectory, legacyId, 'project.json'),
      'utf8',
    ),
  );
  assert.equal(migratedOnDisk.version, currentProjectVersion);
  assert.equal(migratedOnDisk.revision, 2);
});
