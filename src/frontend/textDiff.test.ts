import assert from 'node:assert/strict';
import test from 'node:test';
import {textDiff} from './textDiff.ts';

test('text diff highlights pronunciation replacements and preserves context', () => {
  assert.deepEqual(textDiff('Độ phức tạp O(n).', 'Độ phức tạp ô en.'), [
    {kind: 'same', text: 'Độ phức tạp '},
    {kind: 'removed', text: 'O(n).'},
    {kind: 'added', text: 'ô en.'},
  ]);
});

test('text diff returns no marker for identical empty text', () => {
  assert.deepEqual(textDiff('', ''), []);
});
