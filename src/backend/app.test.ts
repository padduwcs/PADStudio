import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {closePadStudioServerServices, createPadStudioServer} from './app.ts';

const topicInput = {
  topic: 'Tim kiem nhi phan hoat dong nhu the nao?',
  background: {mode: 'dark' as const, color: '#10231D'},
  videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
  audience: 'beginner' as const,
  duration: 'standard' as const,
};

async function startApp(t: test.TestContext) {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-v16-'));
  const server = createPadStudioServer({projectsDirectory, logger: {info() {}, error() {}}});
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closePadStudioServerServices(server);
    await rm(projectsDirectory, {recursive: true, force: true});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function createProject(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({creationId: randomUUID(), topicInput, narrationSourceText: 'Day la loi thoai kiem thu du dai de tao project theo workflow moi.'}),
  });
  assert.equal(response.status, 201);
  return (await response.json() as {project: {id: string; revision: number; currentStep: string}}).project;
}

test('v16 project starts at pronunciation and revision guards writes', async t => {
  const baseUrl = await startApp(t);
  const project = await createProject(baseUrl);
  assert.equal(project.currentStep, 'pronunciation');
  const conflict = await fetch(`${baseUrl}/api/projects/${project.id}`, {
    method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': '"2"'}, body: JSON.stringify({topicInput}),
  });
  assert.equal(conflict.status, 409);
});

test('removed legacy endpoints return 404', async t => {
  const baseUrl = await startApp(t);
  const project = await createProject(baseUrl);
  for (const suffix of ['/api/topic-guidance/generate', `/api/projects/${project.id}/outline`, `/api/projects/${project.id}/voice-visual`, `/api/projects/${project.id}/layout`, `/api/projects/${project.id}/voice/approve`, `/api/projects/${project.id}/sync/files`, `/api/projects/${project.id}/sync/audio`]) {
    const response = await fetch(`${baseUrl}${suffix}`, {method: 'POST'});
    assert.equal(response.status, 404, suffix);
  }
});
