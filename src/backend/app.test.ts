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
import type {AnimationSyncWorkspace} from './animationSyncWorkspace.ts';
import type {AnimationSyncPreviewService} from './animationSyncPreviewService.ts';
import {createPadStudioServer} from './app.ts';
import type {CodexConnectionService} from './codexConnection.ts';
import type {ElevenLabsConnectionService} from './elevenLabsConnection.ts';
import type {ElevenLabsVoiceService} from './elevenLabsVoiceService.ts';
import type {OutlineGenerator} from './outlineGenerator.ts';
import type {MotionCanvasGenerator} from './motionCanvasGenerator.ts';
import type {VoiceVisualGenerator} from './voiceVisualGenerator.ts';
import type {VoiceWorkspace} from './voiceWorkspace.ts';

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
    elevenLabsConnection?: ElevenLabsConnectionService;
    elevenLabsVoiceService?: ElevenLabsVoiceService;
    outlineGenerator?: OutlineGenerator;
    voiceVisualGenerator?: VoiceVisualGenerator;
    motionCanvasGenerator?: MotionCanvasGenerator;
    voiceWorkspace?: VoiceWorkspace;
    animationSyncWorkspace?: AnimationSyncWorkspace;
    animationSyncPreviewService?: AnimationSyncPreviewService;
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
    outlineGenerator: options.outlineGenerator,
    voiceVisualGenerator: options.voiceVisualGenerator,
    motionCanvasGenerator: options.motionCanvasGenerator,
    voiceWorkspace: options.voiceWorkspace,
    animationSyncWorkspace: options.animationSyncWorkspace,
    animationSyncPreviewService: options.animationSyncPreviewService,
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

test('API tạo, chỉnh sửa và chốt kế hoạch voice–visual an toàn', async (context) => {
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
  const {baseUrl} = await startTestApp(context, {
    outlineGenerator,
    voiceVisualGenerator,
    motionCanvasGenerator,
    elevenLabsVoiceService,
    voiceWorkspace,
    animationSyncWorkspace,
    animationSyncPreviewService,
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
  assert.equal(motionGenerateResponse.status, 200);
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
  assert.match(
    Buffer.from(await voiceAudioResponse.arrayBuffer()).toString(),
    /^RIFF-master/,
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
  assert.match(
    Buffer.from(await syncAudioResponse.arrayBuffer()).toString(),
    /^RIFF/,
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

  const approvedPlan = syncApproveBody.project.voiceVisualPlan;
  const visualOnlyUpdateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"12"',
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
  assert.equal(visualOnlyUpdateBody.project.revision, 13);
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

  const visualPlan = visualOnlyUpdateBody.project.voiceVisualPlan;
  const voiceTextUpdateResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/voice-visual`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"13"',
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
  assert.equal(voiceTextUpdateBody.project.revision, 14);
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
        'If-Match': '"14"',
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
      headers: {'If-Match': '"15"'},
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
      headers: {'If-Match': '"15"'},
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

test('API đọc JSON trên 64 KiB và từ chối payload lớn hơn 1 MiB', async (context) => {
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
    body: JSON.stringify({unknown: 'x'.repeat(1024 * 1024)}),
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
