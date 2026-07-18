import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {VoiceVisualPlanSchema} from '../shared/topic.ts';
import {
  buildNarrationSource,
  splitNarrationSource,
} from './narrationSource.ts';

function planFixture() {
  return VoiceVisualPlanSchema.parse({
    voiceDirection: 'Giọng kể liền mạch, tự nhiên và rõ ràng.',
    visualDirection: 'Hình khối tối giản, chỉ giữ chi tiết cần thiết.',
    sections: [
      {
        outlineSectionId: randomUUID(),
        beats: [
          {
            id: randomUUID(),
            voiceover: 'Ta bắt đầu từ một hình ảnh rất quen thuộc.',
            visualDescription: 'Một hình khối xuất hiện ở chính giữa.',
            animationDescription: 'Hình khối hiện dần rồi đứng yên.',
            durationSeconds: 8,
          },
          {
            id: randomUUID(),
            voiceover: 'Từ đó, ý tưởng tiếp theo được nối vào tự nhiên.',
            visualDescription: 'Hình thứ hai nối trực tiếp với hình đầu.',
            animationDescription: 'Một đường nối được vẽ từ trái sang phải.',
            durationSeconds: 9,
          },
        ],
      },
      {
        outlineSectionId: randomUUID(),
        beats: [
          {
            id: randomUUID(),
            voiceover: 'Mạch giải thích tiếp tục mà không mở đầu lại.',
            visualDescription: 'Cả hai hình cùng dịch chuyển sang trạng thái mới.',
            animationDescription: 'Hai hình đổi màu theo cùng một nhịp.',
            durationSeconds: 8,
          },
        ],
      },
    ],
    status: 'approved',
    contentRevision: 1,
    sourceOutlineContentRevision: 1,
    generation: {
      generationId: randomUUID(),
      provider: 'codex',
      model: 'test-model',
      promptVersion: 'voice-visual-v2',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  });
}

test('Narration source giữ nguyên character offset toàn bài và chia ít group nhất', () => {
  const source = buildNarrationSource(planFixture());
  assert.equal(source.sections.length, 2);
  assert.equal(
    source.text,
    source.sections
      .flatMap((section) =>
        section.beats.map((beat) =>
          Array.from(source.text)
            .slice(beat.textStartIndex, beat.textEndIndex)
            .join(''),
        ),
      )
      .join('\n\n'),
  );

  const single = splitNarrationSource(source, 10_000);
  assert.equal(single.length, 1);
  assert.equal(single[0]?.text, source.text);

  const maximumCharacters = 95;
  const chunks = splitNarrationSource(source, maximumCharacters);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), source.text);
  assert.ok(
    chunks.every(
      (chunk) => Array.from(chunk.text).length <= maximumCharacters,
    ),
  );
  assert.equal(chunks[0]?.textStartIndex, 0);
  assert.equal(chunks.at(-1)?.textEndIndex, Array.from(source.text).length);
});

test('Narration source từ chối beat đơn lẻ vượt giới hạn model', () => {
  const source = buildNarrationSource(planFixture());
  assert.throws(
    () => splitNarrationSource(source, 20),
    /Một beat narration vượt giới hạn/,
  );
});
