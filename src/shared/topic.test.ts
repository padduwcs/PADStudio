import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreateTopicProjectSchema,
  currentProjectVersion,
  parseTopicProject,
  TopicInputSchema,
  UpdateProjectSchema,
} from './topic.ts';

test('TopicInputSchema chuẩn hóa khoảng trắng ở đầu và cuối', () => {
  const result = TopicInputSchema.parse({
    topic: '  Tìm kiếm nhị phân  ',
    learningGoal: '  Hiểu vì sao mỗi bước loại được một nửa dữ liệu.  ',
    audience: 'beginner',
    duration: 'standard',
  });

  assert.equal(result.topic, 'Tìm kiếm nhị phân');
  assert.equal(
    result.learningGoal,
    'Hiểu vì sao mỗi bước loại được một nửa dữ liệu.',
  );
});

test('TopicInputSchema từ chối chủ đề quá mơ hồ', () => {
  const result = TopicInputSchema.safeParse({
    topic: 'Sort',
    audience: 'beginner',
    duration: 'concise',
  });

  assert.equal(result.success, false);
});

test('CreateTopicProjectSchema chỉ khởi tạo project ở bước outline', () => {
  const request = {
    creationId: '00000000-0000-4000-8000-000000000001',
    topicInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'standard',
    },
  };

  assert.equal(
    CreateTopicProjectSchema.safeParse({
      ...request,
      currentStep: 'outline',
    }).success,
    true,
  );
  assert.equal(
    CreateTopicProjectSchema.safeParse({
      ...request,
      currentStep: 'sync',
    }).success,
    false,
  );
});

test('UpdateProjectSchema chỉ cho phép dữ liệu của trang topic', () => {
  assert.equal(UpdateProjectSchema.safeParse({}).success, false);
  assert.equal(
    UpdateProjectSchema.safeParse({currentStep: 'outline'}).success,
    true,
  );
  assert.equal(
    UpdateProjectSchema.safeParse({currentStep: 'sync'}).success,
    false,
  );
  assert.equal(
    UpdateProjectSchema.safeParse({
      topicInput: {
        topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
        audience: 'beginner',
        duration: 'standard',
      },
    }).success,
    true,
  );

  for (const forbiddenField of [
    'status',
    'outline',
    'voiceVisualPlan',
    'motionCanvasBundle',
    'voiceBundle',
    'animationSyncBundle',
  ]) {
    assert.equal(
      UpdateProjectSchema.safeParse({
        [forbiddenField]: {status: 'approved'},
      }).success,
      false,
      forbiddenField,
    );
  }
});

test('parseTopicProject nâng project v1 lên model hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'legacy-project',
    version: 1,
    status: 'draft',
    currentStep: 'topic',
    topicInput: {
      topic: 'Tìm kiếm nhị phân',
      audience: 'beginner',
      duration: 'standard',
    },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 1);
  assert.equal(project.creationId, null);
  assert.equal(project.outline, null);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
});

test('parseTopicProject nâng project v2 và giữ revision hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-two-project',
    version: 2,
    revision: 7,
    creationId: null,
    status: 'draft',
    currentStep: 'outline',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 7);
  assert.equal(project.outline, null);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
});

test('parseTopicProject nâng project v3 và giữ outline hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-three-project',
    version: 3,
    revision: 4,
    creationId: null,
    status: 'draft',
    currentStep: 'outline',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    outline: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 4);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
});

test('parseTopicProject nâng project v4 và giữ kế hoạch voice–visual', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-four-project',
    version: 4,
    revision: 5,
    creationId: null,
    status: 'draft',
    currentStep: 'voiceVisual',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    outline: null,
    voiceVisualPlan: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 5);
  assert.equal(project.motionCanvasBundle, null);
});

test('parseTopicProject nâng project v6 và bổ sung workspace đồng bộ', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-six-project',
    version: 6,
    revision: 10,
    creationId: null,
    status: 'draft',
    currentStep: 'voice',
    topicInput: {
      topic: 'Đệ quy hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'standard',
    },
    outline: null,
    voiceVisualPlan: null,
    motionCanvasBundle: null,
    voiceBundle: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 10);
  assert.equal(project.currentStep, 'voice');
  assert.equal(project.animationSyncBundle, null);
});

test('parseTopicProject nâng v7, bổ sung timing profile và buộc tạo lại voice section-based', () => {
  const now = new Date().toISOString();
  const outlineSectionIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const project = parseTopicProject({
    id: 'version-seven-project',
    version: 7,
    revision: 12,
    creationId: null,
    status: 'draft',
    currentStep: 'sync',
    topicInput: {
      topic: 'Ngăn xếp hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'concise',
    },
    outline: null,
    voiceVisualPlan: {
      voiceDirection: 'Giọng rõ ràng và gần gũi với người mới.',
      visualDirection: 'Hình khối tối giản mô tả thao tác vào và ra.',
      sections: outlineSectionIds.map((outlineSectionId, index) => ({
        outlineSectionId,
        beats: [
          {
            id:
              index === 0
                ? '33333333-3333-4333-8333-333333333333'
                : '44444444-4444-4444-8444-444444444444',
            voiceover:
              index === 0
                ? 'Ta đặt phần tử đầu tiên lên trên cùng của ngăn xếp.'
                : 'Sau đó, phần tử trên cùng sẽ được lấy ra trước.',
            visualDescription:
              'Một khối chữ nhật nằm trên đỉnh của chồng phần tử.',
            animationDescription:
              'Khối di chuyển theo chiều dọc để thể hiện thao tác.',
            durationSeconds: 12,
          },
        ],
      })),
      status: 'approved',
      contentRevision: 2,
      sourceOutlineContentRevision: 1,
      generation: {
        generationId: '55555555-5555-4555-8555-555555555555',
        provider: 'codex',
        model: 'legacy-model',
        promptVersion: 'voice-visual-v1',
        generatedAt: now,
        usage: null,
      },
    },
    motionCanvasBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.currentStep, 'voice');
  assert.equal(project.voiceVisualPlan?.narrationRevision, 1);
  assert.equal(
    project.voiceVisualPlan?.timingCalibration.source,
    'default',
  );
  assert.equal(
    project.voiceVisualPlan?.sections[0]?.beats[0]?.visualHoldSeconds,
    0,
  );
  assert.equal(project.voiceBundle, null);
  assert.equal(project.animationSyncBundle, null);
});

test('parseTopicProject không âm thầm bỏ field lạ', () => {
  const now = new Date().toISOString();

  assert.throws(() =>
    parseTopicProject({
      id: 'future-project',
      version: 3,
      revision: 1,
      creationId: null,
      status: 'draft',
      currentStep: 'topic',
      topicInput: {
        topic: 'Tìm kiếm nhị phân',
        audience: 'beginner',
        duration: 'standard',
      },
      outline: null,
      createdAt: now,
      updatedAt: now,
      futureField: true,
    }),
  );
});
