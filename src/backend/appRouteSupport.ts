import type {ElevenLabsUsagePreset} from '../shared/elevenLabs.ts';
import {plannedBeatDurationSeconds} from '../shared/narrationTiming.ts';
import {sameValue} from '../shared/projectPipeline.ts';
import type {MotionCanvasBundle, TeachingOutline, TopicProject, VoiceBundle, VoiceVisualPlan, VoiceVisualPlanContent} from '../shared/topic.ts';
import type {VideoFrame} from '../shared/videoFormat.ts';
import {defaultVideoFrame} from '../shared/videoFormat.ts';
import {speechTextForBeat} from '../shared/vietnameseSpeech.ts';
import {RequestBodyError} from './appErrors.ts';
import {hashJson} from './motionCanvasHistoryStore.ts';
import type {ProjectRepository} from './projectRepository.ts';

export function assertSameCodexGenerationSelection(
  generation: {
    model: string;
    requestedModel?: string;
    reasoningEffort?: string;
  },
  requested: {model?: string; reasoningEffort?: string;},
) {
  if (
    (requested.model &&
      requested.model !== (generation.requestedModel ?? generation.model)) ||
    (requested.reasoningEffort &&
      requested.reasoningEffort !== generation.reasoningEffort)
  ) {
    throw new RequestBodyError(
      409,
      'GENERATION_ID_REUSED',
      'Generation ID đã được dùng với model hoặc mức suy luận khác.',
    );
  }
}

export function outlineContent(outline: TeachingOutline) {
  return {
    brief: outline.brief,
    centralMessage: outline.centralMessage,
    sections: outline.sections,
  };
}

export function projectVideoFrame(project: Pick<TopicProject, 'topicInput' | 'renderProfile'>) {
  return project.renderProfile?.frame ?? project.topicInput.videoFrame ?? defaultVideoFrame;
}

export function workspaceVideoFrame(
  width: number,
  height: number,
  fps: number,
): VideoFrame {
  return {
    aspectRatio: 'custom' as const,
    width,
    height,
    fps: fps === 24 || fps === 60 ? fps : 30,
  };
}

export function outlineContextHash(
  topicInput: TopicProject['topicInput'],
  content: ReturnType<typeof outlineContent>,
  sourceInput: TeachingOutline['sourceInput'],
) {
  return hashJson({topicInput, content, sourceInput});
}

export function voiceVisualContent(plan: VoiceVisualPlan) {
  return {
    voiceDirection: plan.voiceDirection,
    visualDirection: plan.visualDirection,
    timingCalibration: plan.timingCalibration,
    sections: plan.sections,
  };
}

export function voiceVisualContextHash(
  project: Pick<TopicProject, 'topicInput' | 'outline'>,
  content: VoiceVisualPlanContent,
) {
  return hashJson({
    topicInput: project.topicInput,
    outline: project.outline
      ? {
        content: outlineContent(project.outline),
        contentRevision: project.outline.contentRevision,
        sourceInput: project.outline.sourceInput,
      }
      : null,
    content,
  });
}

export function motionCanvasContextHash(
  project: Pick<
    TopicProject,
    'topicInput' | 'outline' | 'voiceVisualPlan' | 'visualDesignBundle'
  >,
  bundle: MotionCanvasBundle,
) {
  return hashJson({
    topicInput: project.topicInput,
    outline: project.outline
      ? {
        content: outlineContent(project.outline),
        contentRevision: project.outline.contentRevision,
      }
      : null,
    voiceVisualPlan: project.voiceVisualPlan
      ? {
        content: voiceVisualContent(project.voiceVisualPlan),
        contentRevision: project.voiceVisualPlan.contentRevision,
        narrationRevision: project.voiceVisualPlan.narrationRevision,
      }
      : null,
    visualDesignBundle: project.visualDesignBundle,
    bundle,
  });
}

export function normalizedVoiceVisualContent(
  content: VoiceVisualPlanContent,
) {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      beats: section.beats.map((beat) => {
        const visualHoldSeconds = Math.max(
          0,
          Math.min(30, Math.round(beat.visualHoldSeconds)),
        );
        return {
          ...beat,
          visualHoldSeconds,
          durationSeconds: plannedBeatDurationSeconds(
            speechTextForBeat(beat),
            visualHoldSeconds,
            content.timingCalibration,
          ),
        };
      }),
    })),
  };
}

export function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export async function preferredNarrationCalibration(
  repository: ProjectRepository,
): Promise<VoiceVisualPlanContent['timingCalibration'] | undefined> {
  const {projects} = await repository.listProjects();
  const bundles = projects
    .map((project) => project.voiceBundle)
    .filter((bundle): bundle is VoiceBundle => bundle !== null)
    .sort((left, right) =>
      right.generation.generatedAt.localeCompare(left.generation.generatedAt),
    );
  const latest = bundles[0];
  if (!latest) return undefined;
  const matching = bundles.filter(
    (bundle) =>
      bundle.configuration.voiceId === latest.configuration.voiceId &&
      bundle.configuration.modelId === latest.configuration.modelId &&
      bundle.configuration.settings.speed ===
      latest.configuration.settings.speed,
  );
  return {
    source: 'voice-history',
    voiceId: latest.configuration.voiceId,
    modelId: latest.configuration.modelId,
    voiceName: latest.configuration.voiceName,
    sampleCount: matching.length,
    whitespaceTokensPerMinute: median(
      matching.map(
        (bundle) =>
          bundle.track.calibration.whitespaceTokensPerMinute,
      ),
    ),
    charactersPerSecond: median(
      matching.map(
        (bundle) => bundle.track.calibration.charactersPerSecond,
      ),
    ),
  };
}

export function narrationIdentity(plan: {
  sections: Array<{
    outlineSectionId: string;
    beats: Array<{id: string; voiceover: string;}>;
  }>;
}) {
  return plan.sections.map((section) => ({
    outlineSectionId: section.outlineSectionId,
    beats: section.beats.map((beat) => ({
      id: beat.id,
      voiceover: beat.voiceover.trim(),
    })),
  }));
}

export function nextNarrationRevision(
  currentPlan: VoiceVisualPlan | null,
  nextPlan: VoiceVisualPlanContent,
) {
  if (!currentPlan) return 1;
  return sameValue(
    narrationIdentity(currentPlan),
    narrationIdentity(nextPlan),
  )
    ? currentPlan.narrationRevision
    : currentPlan.narrationRevision + 1;
}

export async function localVoicePresets(
  repository: ProjectRepository,
): Promise<ElevenLabsUsagePreset[]> {
  const {projects} = await repository.listProjects();
  const grouped = new Map<string, ElevenLabsUsagePreset>();
  for (const project of projects) {
    const bundle = project.voiceBundle;
    if (!bundle) continue;
    const configuration = bundle.configuration;
    const key = JSON.stringify({
      voiceId: configuration.voiceId,
      modelId: configuration.modelId,
      settings: configuration.settings,
    });
    const current = grouped.get(key);
    if (current) {
      current.successfulGenerations += 1;
      if (bundle.generation.generatedAt > current.usedAt) {
        current.usedAt = bundle.generation.generatedAt;
        current.timingCalibration = {
          whitespaceTokensPerMinute:
            bundle.track.calibration.whitespaceTokensPerMinute,
          charactersPerSecond:
            bundle.track.calibration.charactersPerSecond,
        };
      }
      continue;
    }
    grouped.set(key, {
      id: `pad-studio:${configuration.voiceId}:${configuration.modelId}:${grouped.size}`,
      source: 'pad-studio',
      voiceId: configuration.voiceId,
      voiceName: configuration.voiceName,
      modelId: configuration.modelId,
      modelName: configuration.modelName,
      usedAt: bundle.generation.generatedAt,
      successfulGenerations: 1,
      settings: configuration.settings,
      timingCalibration: {
        whitespaceTokensPerMinute:
          bundle.track.calibration.whitespaceTokensPerMinute,
        charactersPerSecond:
          bundle.track.calibration.charactersPerSecond,
      },
    });
  }
  return [...grouped.values()];
}


