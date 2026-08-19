import assert from 'node:assert/strict';
import test from 'node:test';
import {nextWorkflowStep} from './projectPipeline.ts';
import {
  currentProjectVersion,
  parseTopicProject,
  TopicProjectSchema,
  type TopicProject,
} from './topic.ts';

function projectFixture(): TopicProject {
  const now = '2026-08-18T00:00:00.000Z';
  return {
    id: 'workflow-v16',
    version: currentProjectVersion,
    revision: 1,
    creationId: null,
    status: 'draft',
    currentStep: 'pronunciation',
    topicInput: {
      topic: 'Cách hoạt động của tìm kiếm nhị phân',
      background: {mode: 'dark', color: '#10231D'},
      videoFrame: {aspectRatio: 'portrait', width: 1080, height: 1920, fps: 30},
      audience: 'beginner',
      duration: 'standard',
    },
    narration: {
      sourceText: 'Tìm kiếm nhị phân liên tục loại bỏ một nửa không gian tìm kiếm.',
      projectRules: [],
      review: null,
      approvedSourceHash: null,
      approvedAt: null,
    },
    outline: null,
    voiceVisualPlan: null,
    motionCanvasBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    layoutBundle: null,
    renderBundle: null,
    createdAt: now,
    updatedAt: now,
  };
}

test('project format v17 parses and rejects every older format', () => {
  const project = projectFixture();
  assert.deepEqual(parseTopicProject(project), project);
  assert.equal(TopicProjectSchema.safeParse(project).success, true);
  assert.throws(() => parseTopicProject({...project, version: 15}));
  assert.equal(TopicProjectSchema.safeParse({...project, currentStep: 'voice'}).success, false);
});

test('v16 projects with the removed visualDesignBundle field migrate to v17 on load', () => {
  const project = projectFixture();
  const legacyStored = {
    ...project,
    version: 16,
    visualDesignBundle: null,
  };
  assert.deepEqual(parseTopicProject(legacyStored), project);
});

test('v16 animationSyncBundle.sourceVisualDesignContentRevision is stripped on migration', () => {
  const project = projectFixture();
  const generationId = '11111111-1111-4111-8111-111111111111';
  const beatId = '22222222-2222-4222-8222-222222222222';
  const animationSyncBundle = {
    status: 'draft' as const,
    contentRevision: 1,
    sourceMotionCanvasContentRevision: 1,
    sourceVoiceContentRevision: 1,
    sourceVisualDesignContentRevision: null,
    workspacePath: `sync/generations/${generationId}`,
    projectFile: 'src/project.ts' as const,
    audioFile: 'audio/narration.wav' as const,
    totalDurationSeconds: 4,
    sections: [
      {
        outlineSectionId: '33333333-3333-4333-8333-333333333333',
        sceneId: '44444444-4444-4444-8444-444444444444',
        filePath: 'src/scenes/intro.tsx',
        plannedDurationSeconds: 4,
        synchronizedDurationSeconds: 4,
        driftSeconds: 0,
        beats: [
          {
            beatId,
            startEvent: `beat:${beatId}:start`,
            endEvent: `beat:${beatId}:end`,
            plannedDurationSeconds: 4,
            voiceStartSeconds: 0,
            voiceEndSeconds: 4,
            synchronizedDurationSeconds: 4,
          },
        ],
      },
    ],
    validation: {
      validatedAt: project.createdAt,
      sourceHash: 'a'.repeat(64),
      motionCanvasVersion: '1.0.0',
      audioDurationSeconds: 4,
    },
    generation: {
      generationId,
      provider: 'local' as const,
      tool: 'ffmpeg' as const,
      generatedAt: project.createdAt,
    },
  };
  const projectWithSync = {...project, animationSyncBundle};
  const legacyStored = {
    ...projectWithSync,
    version: 16,
    visualDesignBundle: null,
  };
  const migrated = parseTopicProject(legacyStored);
  assert.equal(migrated.version, 17);
  assert.equal(
    (migrated.animationSyncBundle as {sourceVisualDesignContentRevision?: unknown} | null)
      ?.sourceVisualDesignContentRevision,
    undefined,
  );
});

test('resume begins at pronunciation and approved narration advances to production', () => {
  const project = projectFixture();
  assert.equal(nextWorkflowStep(project), 'pronunciation');
  const sourceHash = 'a'.repeat(64);
  const approved = {
    ...project,
    narration: {
      ...project.narration!,
      review: {
        sourceText: project.narration!.sourceText,
        normalizedText: project.narration!.sourceText,
        rules: [],
        aiPatches: [],
        sourceHash,
        rulesHash: sourceHash,
        reviewedAt: '2026-08-18T00:00:00.000Z',
      },
      approvedSourceHash: sourceHash,
      approvedAt: '2026-08-18T00:00:00.000Z',
    },
  };
  assert.equal(nextWorkflowStep(approved), 'production');
});
