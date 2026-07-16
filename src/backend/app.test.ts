import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createPadStudioServer} from './app.ts';

test('POST /api/projects tạo và lưu topic draft', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-test-'),
  );
  const server = createPadStudioServer({
    projectsDirectory,
    logger: {info() {}, error() {}},
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(projectsDirectory, {recursive: true, force: true});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      learningGoal: 'Hiểu trực giác chia đôi không gian tìm kiếm.',
      audience: 'beginner',
      duration: 'standard',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.project.currentStep, 'topic');
  assert.equal(body.project.status, 'draft');

  const savedProject = JSON.parse(
    await readFile(
      path.join(projectsDirectory, body.project.id, 'project.json'),
      'utf8',
    ),
  );
  assert.equal(savedProject.topicInput.audience, 'beginner');

  const listResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects`,
  );
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.projects.length, 1);
  assert.equal(listBody.projects[0].id, body.project.id);

  const updateResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/${body.project.id}`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        topicInput: {
          ...body.project.topicInput,
          duration: 'deep',
        },
        currentStep: 'outline',
      }),
    },
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.project.topicInput.duration, 'deep');
  assert.equal(updateBody.project.currentStep, 'outline');

  const getResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/${body.project.id}`,
  );
  const getBody = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(getBody.project.currentStep, 'outline');

  const deleteResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/${body.project.id}`,
    {method: 'DELETE'},
  );
  assert.equal(deleteResponse.status, 204);

  const missingResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/${body.project.id}`,
  );
  assert.equal(missingResponse.status, 404);
});

test('POST /api/projects trả lỗi theo field khi input không hợp lệ', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-test-'),
  );
  const server = createPadStudioServer({
    projectsDirectory,
    logger: {info() {}, error() {}},
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(projectsDirectory, {recursive: true, force: true});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      topic: 'BFS',
      audience: 'beginner',
      duration: 'standard',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.ok(body.error.fields.topic.length > 0);
});
