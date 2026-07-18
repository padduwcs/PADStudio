import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {createPadStudioServer} from './app.ts';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? '127.0.0.1';
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

function shutdown() {
  if (!server.listening) return;
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
