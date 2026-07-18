import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRoute, projectStepPath} from './router.ts';

test('parseRoute đọc route project hợp lệ', () => {
  assert.deepEqual(parseRoute('/projects/du-an-01/topic'), {
    name: 'project-topic',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/outline/'), {
    name: 'project-outline',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/voice-visual'), {
    name: 'project-voice-visual',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/motion-canvas'), {
    name: 'project-motion-canvas',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/voice'), {
    name: 'project-voice',
    projectId: 'du-an-01',
  });
});

test('parseRoute không crash với URL encoding hỏng', () => {
  assert.deepEqual(parseRoute('/projects/%E0%A4%A/topic'), {
    name: 'new-topic',
  });
});

test('projectStepPath ánh xạ tập trung các bước đã hỗ trợ', () => {
  assert.equal(
    projectStepPath('du an', 'topic'),
    '/projects/du%20an/topic',
  );
  assert.equal(
    projectStepPath('du an', 'outline'),
    '/projects/du%20an/outline',
  );
  assert.equal(
    projectStepPath('du an', 'voiceVisual'),
    '/projects/du%20an/voice-visual',
  );
  assert.equal(
    projectStepPath('du an', 'motionCanvas'),
    '/projects/du%20an/motion-canvas',
  );
  assert.equal(
    projectStepPath('du an', 'voice'),
    '/projects/du%20an/voice',
  );
});
