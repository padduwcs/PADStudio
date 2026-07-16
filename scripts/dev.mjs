import {spawn} from 'node:child_process';

const children = [
  spawn(process.execPath, ['--watch', 'src/backend/server.ts'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    stdio: 'inherit',
  }),
];

let shuttingDown = false;

function stopChildren(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      stopChildren();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
