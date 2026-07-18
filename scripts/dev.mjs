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

if (!(await canListen(backendHost, requestedBackendPort))) {
  throw new Error(
    `Cổng backend ${requestedBackendPort} đang được sử dụng. Hãy dừng tiến trình cũ thay vì đổi port, hoặc đặt PORT rõ ràng nếu bạn chủ động chạy nhiều instance.`,
  );
}

const backendPort = requestedBackendPort;
const backendUrl = `http://${backendHost}:${backendPort}`;

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
let shutdownPromise;

function stopChild(child, signal) {
  if (!child.pid || child.killed || stoppingPids.has(child.pid)) {
    return Promise.resolve();
  }
  stoppingPids.add(child.pid);

  if (process.platform !== 'win32') {
    child.kill(signal);
    return new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
  }

  return new Promise((resolve) => {
    const killer = spawn(
      'taskkill',
      ['/pid', String(child.pid), '/t', '/f'],
      {stdio: 'ignore', windowsHide: true},
    );
    killer.on('error', () => {
      if (!child.killed) child.kill();
      resolve();
    });
    killer.on('exit', resolve);
  });
}

function stopChildren(signal = 'SIGTERM') {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = Promise.all(
    children.map((child) => stopChild(child, signal)),
  ).then(() => undefined);
  return shutdownPromise;
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Không thể khởi động tiến trình dev:', error);
    process.exitCode = 1;
    stopChildren();
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      process.exitCode = code === 0 && !signal ? 0 : (code ?? 1);
      void stopChildren().then(() => {
        process.exit(process.exitCode ?? 0);
      });
    }
  });
}

function handleSignal(signal) {
  process.exitCode = 0;
  void stopChildren(signal).then(() => {
    process.exit(process.exitCode ?? 0);
  });
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
