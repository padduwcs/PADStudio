import assert from 'node:assert/strict';
import test from 'node:test';
import {TopicInputSchema, UpdateTopicProjectSchema} from './topic.ts';

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

test('UpdateTopicProjectSchema yêu cầu ít nhất một thay đổi', () => {
  assert.equal(UpdateTopicProjectSchema.safeParse({}).success, false);
  assert.equal(
    UpdateTopicProjectSchema.safeParse({currentStep: 'outline'}).success,
    true,
  );
});
