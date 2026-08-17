import assert from 'node:assert/strict';
import test from 'node:test';
import {
  speechTextForBeat,
  textEncodingIssue,
  toVietnameseSpeechText,
} from './vietnameseSpeech.ts';

test('phiên âm độ phức tạp thuật toán cho TTS tiếng Việt', () => {
  assert.equal(toVietnameseSpeechText('O(n)'), 'ô nờ');
  assert.equal(toVietnameseSpeechText('O(n^2)'), 'ô nờ bình');
  assert.equal(toVietnameseSpeechText('O(n²)'), 'ô nờ bình');
  assert.equal(toVietnameseSpeechText('O(logn)'), 'ô lô-ga-rít nờ');
  assert.equal(toVietnameseSpeechText('O(log n)'), 'ô lô-ga-rít nờ');
  assert.equal(toVietnameseSpeechText('O(n log n)'), 'ô nờ nhân lô-ga-rít nờ');
});

test('phiên âm truy cập mảng và toán tử thay vì gửi ký hiệu thô sang TTS', () => {
  assert.equal(
    toVietnameseSpeechText('Nếu a[i] >= a[i+1] thì i++.'),
    'Nếu a tại chỉ số i lớn hơn hoặc bằng a tại chỉ số i cộng 1 thì i tăng một.',
  );
  assert.equal(
    toVietnameseSpeechText('a[i] !== a[j]'),
    'a tại chỉ số i khác a tại chỉ số j',
  );
});

test('giữ nguyên từ tiếng Anh và chỉ phiên âm ký hiệu kỹ thuật', () => {
  assert.equal(
    toVietnameseSpeechText(
      'Binary Search dùng API để tìm target trong array[mid] với O(log n).',
    ),
    'Binary Search dùng API để tìm target trong array tại chỉ số mid với ô lô-ga-rít nờ.',
  );
  assert.equal(
    toVietnameseSpeechText('Nếu left <= right thì update cache.'),
    'Nếu left nhỏ hơn hoặc bằng right thì update cache.',
  );
});

test('ưu tiên cách đọc do người dùng chỉnh và có fallback xác định', () => {
  assert.equal(
    speechTextForBeat({voiceover: 'Độ phức tạp là O(n^2).'}),
    'Độ phức tạp là ô nờ bình.',
  );
  assert.equal(
    speechTextForBeat({
      voiceover: 'Độ phức tạp là O(n^2).',
      spokenVoiceover: 'Độ phức tạp là ô nờ bình phương.',
    }),
    'Độ phức tạp là ô nờ bình phương.',
  );
});

test('chặn văn bản mất dấu do lỗi mã hóa trước khi gửi TTS', () => {
  assert.equal(textEncodingIssue('Vì sao thuật toán này nhanh?'), null);
  assert.match(textEncodingIssue('V? sao thu?ng nhanh hơn?') ?? '', /mất/i);
  assert.match(textEncodingIssue('Lời thoại có �.') ?? '', /mã hóa/i);
});
