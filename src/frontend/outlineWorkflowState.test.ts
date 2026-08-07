import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  OutlineCandidateRecord,
  OutlineHistoryResponse,
  OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import type {TeachingOutline, TopicProject} from '../shared/topic.ts';
import {
  outlineCandidateMatchesCurrentContext,
  outlineVersionMatchesTopicInput,
} from './outlineWorkflowState.ts';

const topicInput = {
  topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
  background: {mode: 'dark' as const, color: '#10231D'},
  audience: 'beginner' as const,
  duration: 'standard' as const,
};

const outline: TeachingOutline = {
  brief: {
    summary: 'Video giúp người mới hiểu trực giác tìm kiếm nhị phân.',
    assumptions: ['Mảng đầu vào đã được sắp xếp.'],
  },
  centralMessage: 'Mỗi lần so sánh sẽ loại bỏ một nửa vùng tìm kiếm.',
  sections: [{
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Đặt vấn đề',
    goal: 'Nhận ra giới hạn của cách tìm tuần tự.',
    content: 'Bắt đầu từ nhu cầu tìm một số trong danh sách rất dài.',
    estimatedSeconds: 60,
  }],
  status: 'draft',
  contentRevision: 1,
  sourceInput: topicInput,
  generation: {
    generationId: '22222222-2222-4222-8222-222222222222',
    provider: 'codex',
    model: 'test-model',
    promptVersion: 'outline-v3',
    generatedAt: '2026-08-04T00:00:00.000Z',
    usage: null,
  },
};

const project = {outline} as Pick<TopicProject, 'outline'>;
const draft = {
  brief: outline.brief,
  centralMessage: outline.centralMessage,
  sections: outline.sections,
};
const candidate = {
  rootBaseContextHash: 'a'.repeat(64),
} as Pick<OutlineCandidateRecord, 'rootBaseContextHash'>;
const history = {
  currentContextHash: 'a'.repeat(64),
} as Pick<OutlineHistoryResponse, 'currentContextHash'>;

test('candidate chỉ có thể thao tác khi context và bản nháp đều còn nguyên', () => {
  assert.equal(
    outlineCandidateMatchesCurrentContext(candidate, history, project, draft),
    true,
  );
  assert.equal(
    outlineCandidateMatchesCurrentContext(
      candidate,
      {...history, currentContextHash: 'b'.repeat(64)},
      project,
      draft,
    ),
    false,
  );
  assert.equal(
    outlineCandidateMatchesCurrentContext(candidate, history, project, {
      ...draft,
      centralMessage: 'Bản nháp đã được người dùng chỉnh sau khi tạo candidate.',
    }),
    false,
  );
  assert.equal(
    outlineCandidateMatchesCurrentContext(candidate, null, project, draft),
    false,
  );
});

test('phiên bản chỉ được khôi phục trực tiếp cho đúng đầu vào hiện tại', () => {
  const version = {artifact: outline} as Pick<
    OutlineVersionRecord,
    'artifact'
  >;
  assert.equal(outlineVersionMatchesTopicInput(version, topicInput), true);
  assert.equal(
    outlineVersionMatchesTopicInput(version, {
      ...topicInput,
      videoDirection: 'Đầu vào đã thay đổi.',
    }),
    false,
  );
});
