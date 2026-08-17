export interface SpeechReadyBeat {
  voiceover: string;
  spokenVoiceover?: string;
}

/**
 * A TTS request cannot recover Vietnamese diacritics that were already
 * replaced during copy/paste or an incorrect text encoding. Catch the common
 * lossy forms before a paid request is sent to ElevenLabs.
 */
export function textEncodingIssue(text: string) {
  if (text.includes('\uFFFD')) {
    return 'Văn bản có ký tự thay thế �, thường do lỗi mã hóa.';
  }
  if (/\p{L}\?\p{L}/u.test(text)) {
    return 'Văn bản có dấu ? nằm giữa một từ, thường do dấu tiếng Việt đã bị mất khi sao chép.';
  }
  return null;
}

const vietnameseLetterNames: Record<string, string> = {
  n: 'nờ',
};

function pronounceIdentifier(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  if (/^[a-z]$/i.test(normalized)) {
    return vietnameseLetterNames[normalized.toLocaleLowerCase('vi')] ?? normalized;
  }
  return normalized
    .replaceAll('_', ' ')
    .replace(/([a-zà-ỹ])([A-Z])/gu, '$1 $2');
}

function pronounceComplexityExpression(expression: string) {
  const compact = expression
    .trim()
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ');

  if (/^n\s*(?:\^?\s*2|²)$/u.test(compact)) return 'nờ bình';
  if (/^(?:log\s*n|logn)$/u.test(compact)) return 'lô-ga-rít nờ';
  if (/^n\s*(?:\*|×)?\s*(?:log\s*n|logn)$/u.test(compact)) {
    return 'nờ nhân lô-ga-rít nờ';
  }
  if (/^1$/u.test(compact)) return 'một';
  if (/^n$/u.test(compact)) return 'nờ';

  return pronounceMathExpression(compact);
}

function pronounceMathExpression(value: string) {
  return value
    .replace(/log\s*n/giu, 'lô-ga-rít nờ')
    .replace(/\bn\s*(?:\^\s*2|²)\b/giu, 'nờ bình')
    .replace(/\bn\b/giu, 'nờ')
    .replace(/\s*(?:\*|×)\s*/gu, ' nhân ')
    .replace(/\s*(?:\/|÷)\s*/gu, ' chia ')
    .replace(/\s*\+\s*/gu, ' cộng ')
    .replace(/\s*-\s*/gu, ' trừ ')
    .replace(/\s*\^\s*/gu, ' mũ ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function pronounceArrayAccess(identifier: string, indexes: string) {
  const spokenIndexes = [...indexes.matchAll(/\[([^\]\n]+)\]/gu)]
    .map((match) => pronounceMathExpression(match[1] ?? ''))
    .filter(Boolean);
  if (spokenIndexes.length === 0) return identifier;
  return `${pronounceIdentifier(identifier)} tại chỉ số ${spokenIndexes.join(', ')}`;
}

/**
 * Converts only technical notation into a Vietnamese TTS-oriented transcript.
 * Plain text, including English words, acronyms and technical terms, is kept
 * verbatim. The conversion is deterministic so retries, timing estimates and
 * ElevenLabs input stay in sync.
 */
export function toVietnameseSpeechText(text: string) {
  return text
    .trim()
    .replace(
      /\bO\s*\(\s*([^)]+?)\s*\)/giu,
      (_match, expression: string) =>
        `ô ${pronounceComplexityExpression(expression)}`,
    )
    .replace(
      /\b([A-Za-z][A-Za-z0-9_]*)\s*((?:\[[^\]\n]+\])(?:\s*\[[^\]\n]+\])*)/gu,
      (_match, identifier: string, indexes: string) =>
        pronounceArrayAccess(identifier, indexes),
    )
    .replace(/\s*(?:!==|!=|≠)\s*/gu, ' khác ')
    .replace(/\s*(?:===|==)\s*/gu, ' bằng ')
    .replace(/\s*(?:->|→)\s*/gu, ' dẫn đến ')
    .replace(/\s*(?:<-|←)\s*/gu, ' nhận từ ')
    .replace(/\s*(?:<=|≤)\s*/gu, ' nhỏ hơn hoặc bằng ')
    .replace(/\s*(?:>=|≥)\s*/gu, ' lớn hơn hoặc bằng ')
    .replace(/\s*<\s*/gu, ' nhỏ hơn ')
    .replace(/\s*>\s*/gu, ' lớn hơn ')
    .replace(/\s*(?:\+\+)\s*/gu, ' tăng một ')
    .replace(/\s*(?:--)\s*/gu, ' giảm một ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
}

export function speechTextForBeat(beat: SpeechReadyBeat) {
  const custom = beat.spokenVoiceover?.trim();
  return custom || toVietnameseSpeechText(beat.voiceover);
}
