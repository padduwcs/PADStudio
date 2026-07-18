import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const backendHost = process.env.HOST ?? '127.0.0.1';
const requestedBackendPort = Number(process.env.PORT ?? 4174);

if (
  !Number.isInteger(requestedBackendPort) ||
  requestedBackendPort < 1 ||
  requestedBackendPort > 65_535
) {
  throw new Error(`PORT không hợp lệ: ${process.env.PORT}`);
}

function canListen(host, port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

async function findBackendPort(host, requestedPort) {
  const lastCandidate = Math.min(65_535, requestedPort + 20);

  for (let candidate = requestedPort; candidate <= lastCandidate; candidate += 1) {
    if (await canListen(host, candidate)) return candidate;
  }

  throw new Error(
    `Không tìm thấy cổng backend trống từ ${requestedPort} đến ${lastCandidate}.`,
  );
}

const backendPort = await findBackendPort(
  backendHost,
  requestedBackendPort,
);
const backendUrl = `http://${backendHost}:${backendPort}`;

if (backendPort !== requestedBackendPort) {
  console.warn(
    `Cổng backend ${requestedBackendPort} đang được dùng; PAD Studio chuyển sang ${backendPort}.`,
  );
}

const childEnvironment = {
  ...process.env,
  HOST: backendHost,
  PORT: String(backendPort),
  PAD_BACKEND_URL: backendUrl,
};
const children = [
  spawn(process.execPath, ['--watch', 'src/backend/server.ts'], {
    cwd: projectDirectory,
    env: childEnvironment,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    cwd: projectDirectory,
    env: childEnvironment,
    stdio: 'inherit',
  }),
];

let shuttingDown = false;
const stoppingPids = new Set();

function stopChild(child, signal) {
  if (!child.pid || child.killed || stoppingPids.has(child.pid)) return;
  stoppingPids.add(child.pid);

  if (process.platform !== 'win32') {
    child.kill(signal);
    return;
  }

  const killer = spawn(
    'taskkill',
    ['/pid', String(child.pid), '/t', '/f'],
    {stdio: 'ignore', windowsHide: true},
  );
  killer.on('error', () => {
    if (!child.killed) child.kill();
  });
}

function stopChildren(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    stopChild(child, signal);
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Không thể khởi động tiến trình dev:', error);
    process.exitCode = 1;
    stopChildren();
  });
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      stopChildren();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
