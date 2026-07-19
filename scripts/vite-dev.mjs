import {createServer} from 'vite';

const supervisorPid = Number(process.env.PAD_DEV_SUPERVISOR_PID);
let shuttingDown = false;
let watchdog;

function isSupervisorAlive() {
  if (!Number.isInteger(supervisorPid) || supervisorPid <= 0) return true;
  try {
    process.kill(supervisorPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const server = await createServer();
await server.listen();
server.printUrls();

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (watchdog) clearInterval(watchdog);
  try {
    await server.close();
  } catch (error) {
    console.error('Không thể đóng PAD Studio frontend:', error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

if (Number.isInteger(supervisorPid) && supervisorPid > 0) {
  watchdog = setInterval(() => {
    if (!isSupervisorAlive()) void shutdown(0);
  }, 1_000);
  watchdog.unref();
}

process.on('message', (message) => {
  if (message?.type === 'pad-dev-shutdown') void shutdown(0);
});
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0));
