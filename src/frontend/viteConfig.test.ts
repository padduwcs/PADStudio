import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {createServer} from 'vite';
import viteConfig, {frontendWatchIgnored} from '../../vite.config.ts';

test('frontend HMR bỏ qua mọi workspace runtime có tsconfig riêng', () => {
  assert.deepEqual(frontendWatchIgnored, [
    '**/projects/**',
    '**/.pad-studio/**',
    '**/dist/**',
    '**/tmp/**',
  ]);
  assert.deepEqual(viteConfig.server?.watch?.ignored, [
    '**/projects/**',
    '**/.pad-studio/**',
    '**/dist/**',
    '**/tmp/**',
  ]);
});

test('Vite watcher không nhận tsconfig được sinh trong projects', async () => {
  const root = path.resolve('.');
  const probeDirectory = path.join(
    root,
    'projects',
    `.vite-watch-probe-${randomUUID()}`,
  );
  const observed: string[] = [];
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [],
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      watch: {ignored: [...frontendWatchIgnored]},
    },
  });
  server.watcher.on('all', (_event, file) => {
    if (path.resolve(file).startsWith(probeDirectory)) observed.push(file);
  });

  try {
    await delay(100);
    await mkdir(probeDirectory, {recursive: true});
    await writeFile(
      path.join(probeDirectory, 'tsconfig.json'),
      '{"compilerOptions":{"strict":true}}\n',
      'utf8',
    );
    await delay(500);
    assert.deepEqual(observed, []);
  } finally {
    await server.close();
    await rm(probeDirectory, {recursive: true, force: true});
  }
});
