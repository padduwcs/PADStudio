import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TopicProject} from '../shared/topic.ts';
import {createFileProjectRepository} from './projectRepository.ts';

test('repository rejects an invalid transition before replacing project.json', async () => {
  const projectsDirectory = await mkdtemp(path.join(tmpdir(), 'pad-project-repository-'));
  try {
    const repository = createFileProjectRepository(projectsDirectory);
    const project = await repository.createTopicProject({
      creationId: '10000000-0000-4000-8000-000000000001',
      topicInput: {
        topic: 'Recursion',
        background: {mode: 'custom', color: '#000000'},
        videoFrame: {
          aspectRatio: 'portrait',
          width: 1080,
          height: 1920,
          fps: 30,
        },
        audience: 'beginner',
        duration: 'standard',
      },
      narrationSourceText: 'Recursion calls a smaller version of itself.',
    });
    const storedBefore = await readFile(
      path.join(projectsDirectory, project.id, 'project.json'),
      'utf8',
    );

    await assert.rejects(() => repository.updateProject(
      project.id,
      {topicInput: {...project.topicInput, topic: 'x'} as TopicProject['topicInput']},
      project.revision,
    ));

    const storedAfter = await readFile(
      path.join(projectsDirectory, project.id, 'project.json'),
      'utf8',
    );
    assert.equal(storedAfter, storedBefore);
    assert.deepEqual(await repository.getProject(project.id), project);
  } finally {
    await rm(projectsDirectory, {recursive: true, force: true});
  }
});
