import type {VoiceVisualPlan} from '../shared/topic.ts';
import {speechTextForBeat} from '../shared/vietnameseSpeech.ts';

export interface NarrationSourceBeat {
  beatId: string;
  textStartIndex: number;
  textEndIndex: number;
}

export interface NarrationSourceSection {
  outlineSectionId: string;
  textStartIndex: number;
  textEndIndex: number;
  beats: NarrationSourceBeat[];
}

export interface NarrationSource {
  text: string;
  sections: NarrationSourceSection[];
}

export interface NarrationChunk {
  text: string;
  textStartIndex: number;
  textEndIndex: number;
}

export function buildNarrationSource(plan: VoiceVisualPlan): NarrationSource {
  const characters: string[] = [];
  const sections = plan.sections.map((section, sectionIndex) => {
    if (sectionIndex > 0) characters.push('\n', '\n');
    const textStartIndex = characters.length;
    const beats = section.beats.map((beat, beatIndex) => {
      if (beatIndex > 0) characters.push('\n', '\n');
      const beatStartIndex = characters.length;
      characters.push(...Array.from(speechTextForBeat(beat)));
      return {
        beatId: beat.id,
        textStartIndex: beatStartIndex,
        textEndIndex: characters.length,
      };
    });
    return {
      outlineSectionId: section.outlineSectionId,
      textStartIndex,
      textEndIndex: characters.length,
      beats,
    };
  });

  return {
    text: characters.join(''),
    sections,
  };
}

export function splitNarrationSource(
  source: NarrationSource,
  maximumCharacters: number | null,
): NarrationChunk[] {
  const characters = Array.from(source.text);
  if (
    maximumCharacters === null ||
    characters.length <= maximumCharacters
  ) {
    return [
      {
        text: source.text,
        textStartIndex: 0,
        textEndIndex: characters.length,
      },
    ];
  }
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 12) {
    throw new Error('Giới hạn ký tự của model không hợp lệ.');
  }

  const safeBoundaries = new Set<number>([characters.length]);
  for (const section of source.sections) {
    safeBoundaries.add(section.textStartIndex);
    safeBoundaries.add(section.textEndIndex);
    for (const beat of section.beats) {
      safeBoundaries.add(beat.textStartIndex);
      safeBoundaries.add(beat.textEndIndex);
    }
  }
  safeBoundaries.delete(0);
  const sortedBoundaries = [...safeBoundaries].sort(
    (left, right) => left - right,
  );

  const chunks: NarrationChunk[] = [];
  let start = 0;
  while (start < characters.length) {
    const limit = Math.min(characters.length, start + maximumCharacters);
    let end = start;
    for (const boundary of sortedBoundaries) {
      if (boundary <= start) continue;
      if (boundary > limit) break;
      end = boundary;
    }
    if (end <= start) {
      throw new Error(
        `Một beat narration vượt giới hạn ${maximumCharacters.toLocaleString('vi-VN')} ký tự của model.`,
      );
    }
    chunks.push({
      text: characters.slice(start, end).join(''),
      textStartIndex: start,
      textEndIndex: end,
    });
    start = end;
  }
  return chunks;
}
