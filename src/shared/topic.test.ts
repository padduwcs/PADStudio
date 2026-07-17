import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('UpdateProjectSchema yêu cầu ít nhất một thay đổi', () => {
  assert.equal(UpdateProjectSchema.safeParse({}).success, false);
  assert.equal(
    UpdateProjectSchema.safeParse({currentStep: 'outline'}).success,
    true,
  );
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
