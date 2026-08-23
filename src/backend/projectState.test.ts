import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {TopicProject} from '../shared/topic.ts';
import {
  projectChangeAlreadyApplied,
  reconcileProjectState,
} from './projectState.ts';

function projectFixture(): TopicProject {
  const topicInput = {
    topic: 'Binary search',
    learningGoal: 'Understand an invariant.',
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };
  return {
    id: 'binary-search-20260101-12345678',
    version: 16,
    revision: 7,
    creationId: null,
    status: 'draft',
    currentStep: 'pronunciation',
    topicInput,
    outline: {
      status: 'approved',
      contentRevision: 1,
      sourceInput: structuredClone(topicInput),
      brief: 'A useful invariant.',
      centralMessage: 'Discard half safely.',
      sections: [],
    },
    voiceVisualPlan: null,
    motionCanvasBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    layoutBundle: null,
    renderBundle: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as TopicProject;
}

function projectWithReusableVoice() {
  const project = projectFixture();
  const outlineSectionId = '10000000-0000-4000-8000-000000000001';
  const beatId = '20000000-0000-4000-8000-000000000001';
  const spokenText = 'Binary search discards one half after every comparison.';
  const sourceHash = 'a'.repeat(64);
  project.narration = {
    sourceText: spokenText,
    projectRules: [],
    review: {
      sourceText: spokenText,
      normalizedText: spokenText,
      rules: [],
      aiPatches: [],
      sourceHash,
      rulesHash: 'b'.repeat(64),
      reviewedAt: project.updatedAt,
    },
    approvedSourceHash: sourceHash,
    approvedAt: project.updatedAt,
  };
  project.outline = {
    ...project.outline!,
    sections: [{
      id: outlineSectionId,
      title: 'Discard one half',
      goal: 'Show the invariant clearly.',
      content: spokenText,
      estimatedSeconds: 10,
    }],
  };
  project.voiceVisualPlan = {
    status: 'approved',
    contentRevision: 2,
    narrationRevision: 1,
    sourceOutlineContentRevision: project.outline.contentRevision,
    sourceNarrationHash: sourceHash,
    sourceNarrationRevision: 1,
    sections: [{
      outlineSectionId,
      stateHandoff: {incoming: null, outgoing: null},
      beats: [{
        id: beatId,
        voiceover: spokenText,
        spokenVoiceover: spokenText,
        visualPurpose: 'Show the discarded half.',
        visualDescription: 'A sorted row split at its midpoint.',
        animationDescription: 'Dim the discarded half.',
        visualHoldSeconds: 0,
        durationSeconds: 10,
      }],
    }],
  } as TopicProject['voiceVisualPlan'];
  const textHash = createHash('sha256').update(spokenText).digest('hex');
  project.voiceBundle = {
    status: 'approved',
    contentRevision: 3,
    sourceNarrationRevision: 1,
    track: {sourceTextHash: textHash},
    sections: [{
      outlineSectionId,
      sourceTextHash: textHash,
      beats: [{beatId}],
    }],
  } as TopicProject['voiceBundle'];
  return project;
}

test('project state keeps an already-applied command idempotent', () => {
  const project = projectFixture();
  assert.equal(projectChangeAlreadyApplied(project, {}), true);
  assert.strictEqual(
    reconcileProjectState(project, {}),
    project,
  );
});

test('project state invalidates downstream outline on topic input change', () => {
  const project = projectFixture();
  const topicInput = {...project.topicInput, duration: 'standard' as const};
  const next = reconcileProjectState(
    project,
    {topicInput},
    '2026-01-02T00:00:00.000Z',
  );

  assert.equal(next.revision, 8);
  assert.equal(next.currentStep, 'pronunciation');
  assert.equal(next.outline?.status, 'draft');
  assert.deepEqual(next.topicInput, topicInput);
  assert.equal(next.updatedAt, '2026-01-02T00:00:00.000Z');
});

test('visual input changes invalidate visual planning but preserve matching voice', () => {
  const project = projectWithReusableVoice();
  const voice = project.voiceBundle;
  const next = reconcileProjectState(project, {
    topicInput: {
      ...project.topicInput,
      background: {mode: 'dark', color: '#223344'},
    },
  });

  assert.equal(next.outline?.status, 'draft');
  assert.equal(next.voiceVisualPlan?.status, 'draft');
  assert.strictEqual(next.voiceBundle, voice);
  assert.equal(next.voiceBundle?.status, 'approved');
});

test('pronunciation proposals do not invalidate audio until spoken text changes', () => {
  const project = projectWithReusableVoice();
  const voice = project.voiceBundle;
  const narration = project.narration!;
  const next = reconcileProjectState(project, {
    narration: {
      ...narration,
      review: {
        ...narration.review!,
        aiPatches: [{
          start: 0,
          end: 6,
          source: 'Binary',
          spoken: 'bai-nơ-ri',
          reason: 'Pronunciation proposal only.',
          suggestedRule: null,
        }],
      },
      approvedSourceHash: null,
      approvedAt: null,
    },
  });

  assert.strictEqual(next.voiceBundle, voice);
  assert.strictEqual(next.voiceVisualPlan, project.voiceVisualPlan);
  assert.equal(next.currentStep, 'pronunciation');
});
