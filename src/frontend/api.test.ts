import assert from 'node:assert/strict';
import test from 'node:test';
import {getMotionCanvasCandidatePreview} from './api.ts';

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
