import {createServer, type Server} from 'node:http';
import {createApiRequestHandler} from './apiDispatcher.ts';
import {createAppContext, type AppOptions} from './appContext.ts';

export type {AppOptions} from './appContext.ts';

const serverCleanupTasks = new WeakMap<Server, () => Promise<void>>();

export function closePadStudioServerServices(server: Server): Promise<void> {
  return serverCleanupTasks.get(server)?.() ?? Promise.resolve();
}

export function createPadStudioServer(options: AppOptions = {}) {
  const context = createAppContext(options);
  const server = createServer(createApiRequestHandler(context));
  let cleanupPromise: Promise<void> | null = null;
  const closeServices = () => {
    if (cleanupPromise) return cleanupPromise;
    const tasks: Array<Promise<unknown>> = [
      Promise.resolve().then(() => context.codexConnection.close()),
      Promise.resolve().then(() => context.animationSyncPreviewService.close()),
      Promise.resolve().then(() => context.layoutPreviewService.close()),
      Promise.resolve().then(async () => {
        await context.finalRenderService.close();
        await Promise.allSettled([...context.finalRenderCommits]);
      }),
    ];
    if (options.codexConnection && context.sharedCodexClient) {
      tasks.push(Promise.resolve().then(() => context.sharedCodexClient?.close()));
    }
    cleanupPromise = Promise.allSettled(tasks).then(results => {
      for (const result of results) {
        if (result.status === 'rejected') context.logger.error(result.reason);
      }
    });
    return cleanupPromise;
  };
  serverCleanupTasks.set(server, closeServices);
  server.on('close', () => void closeServices());
  return server;
}
