import assert from 'node:assert/strict';
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
