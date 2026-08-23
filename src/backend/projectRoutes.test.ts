import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectLayoutRoute,
  getProjectMotionCanvasRoute,
  getProjectMotionCanvasHistoryRoute,
  getProjectProductionRoute,
  getPronunciationLibraryRuleRoute,
  getProjectRenderRoute,
  getProjectVoiceRoute,
} from './projectRoutes.ts';

const projectId = 'binary-search-20260101-12345678';
const recordId = '10000000-0000-4000-8000-000000000001';

test('project route parsers only accept stable project and record identities', () => {
  assert.deepEqual(
    getProjectMotionCanvasRoute(
      `/api/projects/${projectId}/motion-canvas/failure`,
    ),
    {projectId, action: 'failure'},
  );
  assert.deepEqual(
    getProjectMotionCanvasHistoryRoute(
      `/api/projects/${projectId}/motion-canvas/candidates/${recordId}/apply`,
    ),
    {
      projectId,
      resource: 'candidates',
      recordId,
      action: 'apply',
    },
  );
  assert.equal(
    getProjectMotionCanvasHistoryRoute(
      `/api/projects/${projectId}/motion-canvas/candidates/not-a-uuid/apply`,
    ),
    null,
  );
});

test('project route parsers reject malformed URL encoding', () => {
  assert.equal(getProjectVoiceRoute(`/api/projects/${projectId}/voice/audio/%ZZ`), null);
  assert.deepEqual(getProjectRenderRoute(`/api/projects/${projectId}/render/status`), {
    projectId,
    action: 'status',
  });
});

test('pronunciation library route only accepts a stable UUID rule identity', () => {
  assert.deepEqual(getPronunciationLibraryRuleRoute('/api/pronunciation/rules'), {
    ruleId: null,
  });
  assert.deepEqual(
    getPronunciationLibraryRuleRoute(`/api/pronunciation/rules/${recordId}`),
    {ruleId: recordId},
  );
  assert.equal(
    getPronunciationLibraryRuleRoute('/api/pronunciation/rules/not-an-id'),
    null,
  );
});

test('direct production route accepts only its explicit actions', () => {
  assert.deepEqual(
    getProjectProductionRoute(`/api/projects/${projectId}/production/prepare`),
    {projectId, action: 'prepare'},
  );
  assert.equal(
    getProjectProductionRoute(`/api/projects/${projectId}/production/output`),
    null,
  );
  assert.equal(
    getProjectProductionRoute(`/api/projects/${projectId}/production`),
    null,
  );
});

test('layout route accepts only its explicit actions', () => {
  assert.deepEqual(
    getProjectLayoutRoute(`/api/projects/${projectId}/layout/preview`),
    {projectId, action: 'preview'},
  );
  assert.deepEqual(
    getProjectLayoutRoute(`/api/projects/${projectId}/layout/design`),
    {projectId, action: 'design'},
  );
  assert.deepEqual(
    getProjectLayoutRoute(`/api/projects/${projectId}/layout/approve`),
    {projectId, action: 'approve'},
  );
  assert.equal(getProjectLayoutRoute(`/api/projects/${projectId}/layout`), null);
  assert.equal(
    getProjectLayoutRoute(`/api/projects/${projectId}/layout/output`),
    null,
  );
});
