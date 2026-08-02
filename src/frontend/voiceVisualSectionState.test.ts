import assert from 'node:assert/strict';
import test from 'node:test';
import type {TeachingOutlineSection} from '../shared/topic.ts';
import {
  findVoiceVisualBeat,
  findVoiceVisualSection,
  resolveVoiceVisualSectionPresentation,
} from './voiceVisualSectionState.ts';

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';

const sections: TeachingOutlineSection[] = [
  {
    id: firstId,
    title: 'Ý thứ nhất',
    goal: 'Mục tiêu thứ nhất',
    content: 'Nội dung thứ nhất',
    estimatedSeconds: 30,
  },
  {
    id: secondId,
    title: 'Ý thứ hai',
    goal: 'Mục tiêu thứ hai',
    content: 'Nội dung thứ hai',
    estimatedSeconds: 45,
  },
];

test('voice–visual ghép section bằng ID sau khi mạch giảng đổi thứ tự', () => {
  const result = resolveVoiceVisualSectionPresentation(
    [...sections].reverse(),
    firstId,
    0,
    20,
  );
  assert.deepEqual(result, {
    title: 'Ý thứ nhất',
    goal: 'Mục tiêu thứ nhất',
    estimatedSeconds: 30,
    belongsToCurrentOutline: true,
  });
});

test('voice–visual stale có fallback khi section cũ đã bị xóa', () => {
  const result = resolveVoiceVisualSectionPresentation(
    sections.slice(1),
    firstId,
    2,
    18.6,
  );
  assert.deepEqual(result, {
    title: 'Ý cũ 03',
    goal: 'Phần này thuộc kế hoạch trước khi mạch giảng được chỉnh sửa.',
    estimatedSeconds: 19,
    belongsToCurrentOutline: false,
  });
});

test('artifact downstream tìm section và beat bằng ID thay vì vị trí', () => {
  const firstBeatId = '20000000-0000-4000-8000-000000000001';
  const secondBeatId = '20000000-0000-4000-8000-000000000002';
  const plannedSections = [
    {
      outlineSectionId: secondId,
      beats: [
        {
          id: secondBeatId,
          voiceover: 'Lời đọc thứ hai.',
          visualDescription: 'Hình ảnh thứ hai.',
          animationDescription: 'Chuyển động thứ hai.',
          visualHoldSeconds: 0,
          durationSeconds: 8,
        },
      ],
    },
    {
      outlineSectionId: firstId,
      beats: [
        {
          id: firstBeatId,
          voiceover: 'Lời đọc thứ nhất.',
          visualDescription: 'Hình ảnh thứ nhất.',
          animationDescription: 'Chuyển động thứ nhất.',
          visualHoldSeconds: 0,
          durationSeconds: 7,
        },
      ],
    },
  ];

  const section = findVoiceVisualSection(plannedSections, firstId);
  assert.equal(section?.outlineSectionId, firstId);
  assert.equal(
    findVoiceVisualBeat(section, firstBeatId)?.voiceover,
    'Lời đọc thứ nhất.',
  );
  assert.equal(findVoiceVisualBeat(section, secondBeatId), undefined);
});
