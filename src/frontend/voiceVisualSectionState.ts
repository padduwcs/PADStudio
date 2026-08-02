import type {
  TeachingOutlineSection,
  VoiceVisualBeat,
  VoiceVisualPlan,
} from '../shared/topic.ts';

type VoiceVisualSection = VoiceVisualPlan['sections'][number];

export interface VoiceVisualSectionPresentation {
  title: string;
  goal: string;
  estimatedSeconds: number;
  belongsToCurrentOutline: boolean;
}

export function resolveVoiceVisualSectionPresentation(
  outlineSections: TeachingOutlineSection[],
  outlineSectionId: string,
  sectionIndex: number,
  plannedDurationSeconds: number,
): VoiceVisualSectionPresentation {
  const currentSection = outlineSections.find(
    section => section.id === outlineSectionId,
  );
  if (currentSection) {
    return {
      title: currentSection.title,
      goal: currentSection.goal,
      estimatedSeconds: currentSection.estimatedSeconds,
      belongsToCurrentOutline: true,
    };
  }

  return {
    title: `Ý cũ ${String(sectionIndex + 1).padStart(2, '0')}`,
    goal:
      'Phần này thuộc kế hoạch trước khi mạch giảng được chỉnh sửa.',
    estimatedSeconds: Math.max(1, Math.round(plannedDurationSeconds)),
    belongsToCurrentOutline: false,
  };
}

export function findVoiceVisualSection(
  sections: VoiceVisualSection[],
  outlineSectionId: string,
): VoiceVisualSection | undefined {
  return sections.find(
    section => section.outlineSectionId === outlineSectionId,
  );
}

export function findVoiceVisualBeat(
  section: VoiceVisualSection | undefined,
  beatId: string,
): VoiceVisualBeat | undefined {
  return section?.beats.find(beat => beat.id === beatId);
}
