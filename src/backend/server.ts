import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {
  closePadStudioServerServices,
  createPadStudioServer,
} from './app.ts';
import {closeHttpServer} from './httpServerShutdown.ts';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? '127.0.0.1';
const devSupervisorPid = Number(process.env.PAD_DEV_SUPERVISOR_PID);
const server = createPadStudioServer();

server.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `Không thể mở PAD Studio backend: ${host}:${port} đang được sử dụng.`,
    );
  } else {
    console.error('PAD Studio backend gặp lỗi:', error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.info(`PAD Studio backend: http://${host}:${port}`);
});

let shutdownPromise: Promise<void> | null = null;
let supervisorWatchdog: NodeJS.Timeout | null = null;

function shutdown(options: {drainInFlight?: boolean} = {}) {
  if (shutdownPromise) return shutdownPromise;
  if (supervisorWatchdog) {
    clearInterval(supervisorWatchdog);
    supervisorWatchdog = null;
  }
  shutdownPromise = (async () => {
    await closeHttpServer(server, {
      forceCloseAfterMs: options.drainInFlight ? null : 1_500,
    });
    await closePadStudioServerServices(server);
  })();
  return shutdownPromise;
}

function shutdownAndExit(
  exitCode = 0,
  options: {drainInFlight?: boolean} = {},
) {
  void shutdown(options)
    .catch((error) => {
      console.error('Không thể đóng PAD Studio sạch sẽ:', error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode ?? exitCode));
}

if (Number.isInteger(devSupervisorPid) && devSupervisorPid > 0) {
  supervisorWatchdog = setInterval(() => {
    try {
      process.kill(devSupervisorPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      shutdownAndExit(0);
    }
  }, 1_000);
  supervisorWatchdog.unref();
}

process.on('message', (message) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'pad-dev-shutdown'
  ) {
    shutdownAndExit(0);
    return;
  }
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'pad-dev-restart'
  ) {
    shutdownAndExit(0, {drainInFlight: true});
  }
});
process.on('SIGINT', () => shutdownAndExit(0));
process.on('SIGTERM', () => shutdownAndExit(0));
process.on('SIGHUP', () => shutdownAndExit(0));
