import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'node:test';
import {closeHttpServer} from './httpServerShutdown.ts';

test('development restart drains an in-flight generation response', async () => {
  let releaseGeneration!: () => void;
  const generationGate = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  let markStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const server = createServer(async (_request, response) => {
    markStarted();
    await generationGate;
    response.writeHead(200, {
      'Content-Type': 'application/json',
      Connection: 'close',
    });
    response.end('{"candidate":"ready"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address() as AddressInfo;
  const responsePromise = fetch(
    `http://127.0.0.1:${address.port}/api/projects/test/motion-canvas/candidates`,
    {method: 'POST'},
  );
  await requestStarted;

  let shutdownCompleted = false;
  const shutdown = closeHttpServer(server, {
    forceCloseAfterMs: 5_000,
  }).then(() => {
    shutdownCompleted = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    shutdownCompleted,
    false,
    'Server không được cắt request AI đang chạy.',
  );

  releaseGeneration();
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {candidate: 'ready'});
  await shutdown;
  assert.equal(shutdownCompleted, true);
});
