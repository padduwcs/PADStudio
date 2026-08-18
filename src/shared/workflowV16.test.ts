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
    visualDesignBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    layoutBundle: null,
    renderBundle: null,
    createdAt: now,
    updatedAt: now,
  };
}

test('project format v16 parses and rejects every older format', () => {
  const project = projectFixture();
  assert.deepEqual(parseTopicProject(project), project);
  assert.equal(TopicProjectSchema.safeParse(project).success, true);
  assert.throws(() => parseTopicProject({...project, version: 15}));
  assert.equal(TopicProjectSchema.safeParse({...project, currentStep: 'voice'}).success, false);
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
