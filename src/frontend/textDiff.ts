export type TextDiffPart = {
  kind: 'same' | 'added' | 'removed';
  text: string;
};

function tokens(value: string) {
  return value.match(/\s+|[^\s]+/gu) ?? [];
}

function append(parts: TextDiffPart[], kind: TextDiffPart['kind'], text: string) {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
  } else {
    parts.push({kind, text});
  }
}

/**
 * Small, dependency-free word diff for the pronunciation review. The bounded
 * fallback keeps unusually large scripts responsive instead of building an
 * unbounded LCS matrix.
 */
export function textDiff(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{kind: 'same', text: before}] : [];
  const left = tokens(before);
  const right = tokens(after);

  if (left.length * right.length > 1_000_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const parts: TextDiffPart[] = [];
    append(parts, 'same', before.slice(0, prefix));
    append(parts, 'removed', before.slice(prefix, before.length - suffix));
    append(parts, 'added', after.slice(prefix, after.length - suffix));
    append(parts, 'same', before.slice(before.length - suffix));
    return parts;
  }

  const width = right.length + 1;
  const matrix = new Uint32Array((left.length + 1) * width);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const offset = leftIndex * width + rightIndex;
      matrix[offset] = left[leftIndex - 1] === right[rightIndex - 1]
        ? matrix[(leftIndex - 1) * width + rightIndex - 1]! + 1
        : Math.max(matrix[(leftIndex - 1) * width + rightIndex]!, matrix[offset - 1]!);
    }
  }

  const reversed: TextDiffPart[] = [];
  let leftIndex = left.length;
  let rightIndex = right.length;
  while (leftIndex > 0 || rightIndex > 0) {
    if (
      leftIndex > 0 &&
      rightIndex > 0 &&
      left[leftIndex - 1] === right[rightIndex - 1]
    ) {
      reversed.push({kind: 'same', text: left[leftIndex - 1]!});
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (
      rightIndex > 0 &&
      (leftIndex === 0 ||
        matrix[leftIndex * width + rightIndex - 1]! >= matrix[(leftIndex - 1) * width + rightIndex]!)
    ) {
      reversed.push({kind: 'added', text: right[rightIndex - 1]!});
      rightIndex -= 1;
    } else {
      reversed.push({kind: 'removed', text: left[leftIndex - 1]!});
      leftIndex -= 1;
    }
  }

  const parts: TextDiffPart[] = [];
  for (const part of reversed.reverse()) append(parts, part.kind, part.text);
  return parts;
}
