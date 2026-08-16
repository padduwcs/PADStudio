import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectMotionCanvasHistoryRoute,
  getProjectRenderRoute,
  getProjectVoiceRoute,
} from './projectRoutes.ts';

const projectId = 'binary-search-20260101-12345678';
const recordId = '10000000-0000-4000-8000-000000000001';

test('project route parsers only accept stable project and record identities', () => {
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
