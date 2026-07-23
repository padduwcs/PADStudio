import type {Server} from 'node:http';

export interface CloseHttpServerOptions {
  /**
   * Force-closes connections after the grace period. Use `null` when an
   * external supervisor owns the upper bound.
   */
  forceCloseAfterMs?: number | null;
}

/**
 * Stops accepting new connections while allowing in-flight HTTP responses to
 * finish. Long AI generations keep their request open, so draining the server
 * preserves their result across a development hot restart.
 */
export function closeHttpServer(
  server: Server,
  options: CloseHttpServerOptions = {},
) {
  if (!server.listening) return Promise.resolve();
  const configuredTimeout =
    options.forceCloseAfterMs === undefined
      ? 1_500
      : options.forceCloseAfterMs;
  const forceCloseAfterMs =
    configuredTimeout === null
      ? null
      : Math.max(1, Math.floor(configuredTimeout));

  return new Promise<void>((resolve) => {
    let settled = false;
    let forceClose: NodeJS.Timeout | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (forceClose) clearTimeout(forceClose);
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
      resolve();
    };

    if (forceCloseAfterMs !== null) {
      forceClose = setTimeout(() => {
        server.closeAllConnections();
      }, forceCloseAfterMs);
      forceClose.unref();
    }

    try {
      server.close((error) => finish(error ?? undefined));
      server.closeIdleConnections();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
