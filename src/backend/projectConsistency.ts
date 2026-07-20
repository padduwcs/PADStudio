import {createHash} from 'node:crypto';
import {
  animationSyncMatchesSourcesStructure,
  voiceMatchesPlanStructure,
} from '../shared/projectPipeline.ts';
import type {
  AnimationSyncBundle,
  MotionCanvasBundle,
  VisualDesignBundle,
  VoiceBundle,
  VoiceVisualPlan,
} from '../shared/topic.ts';
import {buildNarrationSource} from './narrationSource.ts';

function textHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function voiceMatchesPlan(
  bundle: VoiceBundle,
  plan: VoiceVisualPlan,
): boolean {
  if (!voiceMatchesPlanStructure(bundle, plan)) return false;

  const narration = buildNarrationSource(plan);
  if (bundle.track.sourceTextHash !== textHash(narration.text)) {
    return false;
  }

  return bundle.sections.every((section, index) => {
    const sourceSection = narration.sections[index];
    if (!sourceSection) return false;

    const sectionText = Array.from(narration.text)
      .slice(sourceSection.textStartIndex, sourceSection.textEndIndex)
      .join('');
    return section.sourceTextHash === textHash(sectionText);
  });
}

export function animationSyncMatchesSources(
  bundle: AnimationSyncBundle,
  motion: MotionCanvasBundle,
  voice: VoiceBundle,
  visualDesign: VisualDesignBundle | null = null,
): boolean {
  return animationSyncMatchesSourcesStructure(
    bundle,
    motion,
    voice,
    visualDesign,
  );
}
