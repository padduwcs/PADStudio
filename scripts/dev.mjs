import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {existsSync, watch} from 'node:fs';
import {createServer} from 'node:net';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const backendHost = process.env.HOST ?? '127.0.0.1';
const backendPort = parsePort('PORT', process.env.PORT || '4174');
const frontendPort = parsePort(
  'PAD_FRONTEND_PORT',
  process.env.PAD_FRONTEND_PORT || '5173',
);

function parsePort(name, value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} không hợp lệ: ${value}`);
  }
  return port;
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

const unavailablePorts = [];
if (!(await canListen(backendHost, backendPort))) {
  unavailablePorts.push(`backend ${backendHost}:${backendPort}`);
}
if (!(await canListen('127.0.0.1', frontendPort))) {
  unavailablePorts.push(`frontend 127.0.0.1:${frontendPort}`);
}
if (unavailablePorts.length > 0) {
  throw new Error(
    `Cổng ${unavailablePorts.join(', ')} đang được sử dụng. Hãy dừng tiến trình cũ thay vì đổi port, hoặc đặt PORT/PAD_FRONTEND_PORT rõ ràng nếu bạn chủ động chạy nhiều instance.`,
  );
}

const backendUrl = `http://${backendHost}:${backendPort}`;
const supervisorPid = process.pid;
const originalParentPid = process.ppid;
const launcherPid = findLauncherPid();
const childEnvironment = {
  ...process.env,
  HOST: backendHost,
  PORT: String(backendPort),
  PAD_BACKEND_URL: backendUrl,
  PAD_FRONTEND_PORT: String(frontendPort),
  PAD_DEV_SUPERVISOR_PID: String(supervisorPid),
};

let shuttingDown = false;
let shutdownPromise;
let backendEntry;
let frontendEntry;
let parentWatchdog;
let restartTimer;
let restartPromise = Promise.resolve();
const sourceWatchers = [];
const stoppingPids = new Set();
const backendRestartDrainTimeoutMs = 3 * 60 * 60 * 1_000;

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function findLauncherPid() {
  if (process.platform !== 'win32') return originalParentPid;

  try {
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$items = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine',
      '$items | ConvertTo-Json -Compress',
    ].join('; ');
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {encoding: 'utf8', timeout: 4_000, windowsHide: true},
    ).trim();
    const parsed = JSON.parse(output);
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    const byPid = new Map(
      processes.map((entry) => [Number(entry.ProcessId), entry]),
    );
    let cursor = originalParentPid;

    for (let depth = 0; depth < 12; depth += 1) {
      const entry = byPid.get(cursor);
      if (!entry) break;
      if (!isDevCommandWrapper(entry)) return cursor;
      cursor = Number(entry.ParentProcessId);
    }
  } catch {
    // process.ppid remains a safe fallback when process inspection is unavailable.
  }

  return originalParentPid;
}

function isDevCommandWrapper(entry) {
  const name = String(entry.Name ?? '').toLowerCase();
  const commandLine = String(entry.CommandLine ?? '').toLowerCase();
  const runsDevScript =
    commandLine.includes('scripts/dev.mjs') ||
    commandLine.includes('scripts\\dev.mjs');
  const runsNpmDev =
    (commandLine.includes('npm-cli.js') || commandLine.includes('npm.cmd')) &&
    /\brun\s+dev\b/.test(commandLine);

  if (name === 'node.exe' || name === 'node') {
    return runsDevScript || runsNpmDev;
  }
  if (name === 'cmd.exe' || name === 'cmd') {
    return (commandLine.includes('/c') || commandLine.includes('/d /s /c')) &&
      (runsDevScript || runsNpmDev);
  }
  return false;
}

function spawnManaged(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: projectDirectory,
    env: childEnvironment,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  const entry = {name, child, expectedExit: false};

  child.on('error', (error) => {
    if (entry.expectedExit || shuttingDown) return;
    console.error(`Không thể khởi động ${name}:`, error);
    process.exitCode = 1;
    void stopChildren();
  });
  child.on('exit', (code, signal) => {
    stoppingPids.delete(child.pid);
    if (entry.expectedExit || shuttingDown) return;
    console.error(
      `${name} đã dừng ngoài dự kiến${signal ? ` (${signal})` : ` (mã ${code ?? 1})`}.`,
    );
    process.exitCode = code === 0 && !signal ? 0 : (code ?? 1);
    void stopChildren().then(() => process.exit(process.exitCode ?? 1));
  });

  return entry;
}

function startBackend() {
  return spawnManaged('PAD Studio backend', ['src/backend/server.ts']);
}

function startFrontend() {
  return spawnManaged('PAD Studio frontend', ['scripts/vite-dev.mjs']);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
  });
}

async function stopChild(entry, signal = 'SIGTERM') {
  const {child} = entry;
  entry.expectedExit = true;
  if (!child.pid || child.exitCode !== null || stoppingPids.has(child.pid)) return;
  stoppingPids.add(child.pid);

  try {
    if (child.connected) child.send({type: 'pad-dev-shutdown', signal});
    else child.kill(signal);
  } catch {
    // The child may have exited between the liveness check and the stop request.
  }

  if (await waitForExit(child, 2_000)) return;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // The child already exited.
    }
  }
  await waitForExit(child, 1_000);
}

function closeSourceWatchers() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = undefined;
  for (const sourceWatcher of sourceWatchers.splice(0)) sourceWatcher.close();
}

function stopChildren(signal = 'SIGTERM') {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  closeSourceWatchers();
  if (parentWatchdog) clearInterval(parentWatchdog);
  shutdownPromise = Promise.all(
    [backendEntry, frontendEntry]
      .filter(Boolean)
      .map((entry) => stopChild(entry, signal)),
  ).then(() => undefined);
  return shutdownPromise;
}

async function restartBackend() {
  if (shuttingDown || !backendEntry) return;
  const previous = backendEntry;
  console.info('\nMã backend thay đổi, đang khởi động lại...');
  previous.expectedExit = true;
  let draining = false;
  try {
    if (previous.child.connected) {
      previous.child.send({type: 'pad-dev-restart'});
      draining = true;
    }
  } catch {
    draining = false;
  }
  if (
    !draining ||
    !(await waitForExit(
      previous.child,
      backendRestartDrainTimeoutMs,
    ))
  ) {
    await stopChild(previous);
  }
  if (!shuttingDown && backendEntry === previous) backendEntry = startBackend();
}

function scheduleBackendRestart() {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    restartPromise = restartPromise
      .then(restartBackend)
      .catch((error) => {
        console.error('Không thể khởi động lại backend:', error);
        process.exitCode = 1;
        return stopChildren();
      });
  }, 150);
}

for (const relativeDirectory of ['src/backend', 'src/shared']) {
  const sourceWatcher = watch(
    fileURLToPath(new URL(`../${relativeDirectory}/`, import.meta.url)),
    {recursive: true},
    scheduleBackendRestart,
  );
  sourceWatcher.on('error', (error) => {
    console.error(`Không thể theo dõi ${relativeDirectory}:`, error);
    process.exitCode = 1;
    void stopChildren();
  });
  sourceWatchers.push(sourceWatcher);
}

backendEntry = startBackend();
frontendEntry = startFrontend();

const watchedParentPids = [...new Set([originalParentPid, launcherPid])].filter(
  (pid) => pid > 0,
);
parentWatchdog = setInterval(() => {
  const missingParent = watchedParentPids.find((pid) => !isPidAlive(pid));
  if (!missingParent || shuttingDown) return;
  console.info('\nTerminal chạy PAD Studio đã đóng; đang dừng các dịch vụ dev...');
  process.exitCode = 0;
  void stopChildren().then(() => process.exit(0));
}, 1_000);
parentWatchdog.unref();

function handleSignal(signal) {
  process.exitCode = 0;
  void stopChildren(signal).then(() => process.exit(0));
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGHUP', () => handleSignal('SIGHUP'));

process.on('uncaughtException', (error) => {
  console.error('PAD Studio dev gặp lỗi ngoài dự kiến:', error);
  process.exitCode = 1;
  void stopChildren().then(() => process.exit(1));
});
process.on('unhandledRejection', (error) => {
  console.error('PAD Studio dev gặp promise lỗi chưa được xử lý:', error);
  process.exitCode = 1;
  void stopChildren().then(() => process.exit(1));
});

process.on('exit', () => {
  if (process.platform !== 'win32') return;
  for (const entry of [backendEntry, frontendEntry]) {
    const pid = entry?.child.pid;
    if (!pid || entry.child.exitCode !== null) continue;
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
});
