import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiRequestError,
  generateMotionCanvas,
  getMotionCanvasCandidatePreview,
} from './api.ts';
import type {TopicProject} from '../shared/topic.ts';

function progress(
  generationId: string,
  state: 'running' | 'completed' | 'failed',
) {
  return {
    version: 1 as const,
    projectId: 'project-id',
    generationId,
    state,
    stage: state === 'completed' ? 'committing' as const : 'generating-scenes' as const,
    message: state === 'failed' ? 'Scene failed.' : 'Scene running.',
    completedScenes: state === 'completed' ? 1 : 0,
    totalScenes: 1,
    completedSamples: 0,
    totalSamples: 0,
    cachedSamples: 0,
    attempt: 0,
    startedAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:01.000Z',
    finishedAt: state === 'completed' || state === 'failed'
      ? '2026-08-29T00:00:02.000Z'
      : null,
    error: state === 'failed' ? 'Visual quality failed.' : null,
  };
}

test('generateMotionCanvas polls a 202 job and fetches the project after completion', async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const generationId = '11111111-1111-4111-8111-111111111111';
  const requested: Array<{input: string | URL | Request; init?: RequestInit}> = [];
  const responses = [
    new Response(JSON.stringify({progress: progress(generationId, 'running')}), {status: 202}),
    new Response(JSON.stringify({progress: progress(generationId, 'completed')}), {status: 200}),
    new Response(JSON.stringify({project: {id: 'project-id'} as TopicProject}), {status: 200}),
  ];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      requested.push({input, init});
      return responses.shift()!;
    },
  });
  const states: string[] = [];
  try {
    const project = await generateMotionCanvas(
      'project-id',
      {generationId},
      7,
      {pollIntervalMs: 0, sleep: async () => undefined, onProgress: value => states.push(value.state)},
    );
    assert.equal(project.id, 'project-id');
    assert.deepEqual(states, ['running', 'completed']);
    assert.equal(requested.length, 3);
    assert.equal(requested[0]!.input, '/api/projects/project-id/motion-canvas/generate');
    assert.equal(requested[1]!.input, '/api/projects/project-id/motion-canvas/status');
    assert.equal(requested[2]!.input, '/api/projects/project-id');
    assert.equal((requested[0]!.init?.headers as Record<string, string>)['If-Match'], '"7"');
  } finally {
    if (fetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    } else {
      delete (globalThis as {fetch?: unknown}).fetch;
    }
  }
});

test('generateMotionCanvas turns a failed 202 job into an ApiRequestError', async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const generationId = '22222222-2222-4222-8222-222222222222';
  let calls = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({progress: progress(generationId, 'running')}), {status: 202})
        : new Response(JSON.stringify({progress: progress(generationId, 'failed')}), {status: 200});
    },
  });
  try {
    await assert.rejects(
      generateMotionCanvas(
        'project-id',
        {generationId},
        7,
        {pollIntervalMs: 0, sleep: async () => undefined},
      ),
      (error: unknown) => error instanceof ApiRequestError &&
        error.code === 'MOTION_CANVAS_GENERATION_FAILED' &&
        error.message === 'Visual quality failed.',
    );
    assert.equal(calls, 2);
  } finally {
    if (fetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    } else {
      delete (globalThis as {fetch?: unknown}).fetch;
    }
  }
});

test('candidate preview khai báo đúng origin của frontend qua proxy', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  const fetchDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'fetch',
  );
  let requestedInput: string | URL | Request = '';
  let requestedInit: RequestInit | undefined;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {location: {origin: 'http://127.0.0.1:5173'}},
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestedInput = input;
      requestedInit = init;
      return new Response(
        JSON.stringify({
          preview: {
            url: 'http://127.0.0.1:5175/',
            sessionNonce: 'candidate-session',
            sourceMotionCanvasGenerationId: 'candidate-id',
          },
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      );
    },
  });

  try {
    await getMotionCanvasCandidatePreview('project id', 'candidate/id');
    assert.equal(
      requestedInput,
      '/api/projects/project%20id/motion-canvas/candidates/candidate%2Fid/preview',
    );
    assert.deepEqual(requestedInit, {
      headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1:5173'},
    });
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      delete (globalThis as {window?: unknown}).window;
    }
    if (fetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    } else {
      delete (globalThis as {fetch?: unknown}).fetch;
    }
  }
});
