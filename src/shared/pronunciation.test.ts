import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPronunciationPatches,
  normalizePronunciation,
  reviewedPronunciationText,
  validatePronunciationPatches,
  type PronunciationRule,
} from './pronunciation.ts';

const rule: PronunciationRule = {
  id: '00000000-0000-4000-8000-000000000001',
  source: 'logarithm',
  spoken: 'lô-ga-rít',
  scope: 'library',
  origin: 'builtin',
  caseSensitive: false,
};

test('pronunciation memory preserves English and converts only explicit terms plus notation', () => {
  assert.equal(
    normalizePronunciation('Binary Search có O(log n) và logarithm.', [rule]),
    'Binary Search có ô lô-ga-rít nờ và lô-ga-rít.',
  );
});

test('AI pronunciation patches are span-bound and cannot rewrite narration freely', () => {
  const source = 'Ta xét f(x).';
  const start = source.indexOf('f(x)');
  const patches = [{
    start,
    end: start + 'f(x)'.length,
    source: 'f(x)',
    spoken: 'ép của x',
    reason: 'Hàm số',
    suggestedRule: null,
  }];
  assert.equal(validatePronunciationPatches(source, patches), true);
  assert.equal(applyPronunciationPatches(source, patches), 'Ta xét ép của x.');
  assert.equal(validatePronunciationPatches(source, [{...patches[0]!, start: 0}]), false);
  assert.equal(
    reviewedPronunciationText(source, [], patches),
    'Ta xét ép của x.',
  );
});
