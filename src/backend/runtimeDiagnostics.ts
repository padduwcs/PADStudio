import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import type {RuntimeDiagnostics, RuntimeToolDiagnostic} from '../shared/runtimeDiagnostics.ts';
import type {CodexConnectionService} from './codexConnection.ts';
import type {ElevenLabsConnectionService} from './elevenLabsConnection.ts';
import {resolveFinalRenderExecutables} from './finalRenderService.ts';

const execFileAsync = promisify(execFile);

async function resolvedExecutablePath(command: string): Promise<string | undefined> {
  if (path.isAbsolute(command)) return command;
  try {
    const {stdout} = await execFileAsync(
      process.platform === 'win32' ? 'where.exe' : 'which',
      [command],
      {timeout: 3_000, windowsHide: true, maxBuffer: 16 * 1024},
    );
    return String(stdout)
      .split(/\r?\n/)
      .map(value => value.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

async function inspectExecutable(
  command: string | null,
  label: string,
  versionArgument = '-version',
): Promise<RuntimeToolDiagnostic> {
  if (!command) {
    return {available: false, message: `Không tìm thấy ${label}.`};
  }
  const executablePath = await resolvedExecutablePath(command);
  try {
    await execFileAsync(command, [versionArgument], {
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 16 * 1024,
    });
    return {
      available: true,
      message: `${label} đã sẵn sàng.`,
      ...(executablePath ? {executablePath} : {}),
    };
  } catch {
    return {
      available: false,
      message: `${label} không thể khởi động từ cấu hình hiện tại.`,
      ...(executablePath ? {executablePath} : {}),
    };
  }
}

function inspectBrowserExecutable(command: string | null): RuntimeToolDiagnostic {
  if (!command) {
    return {available: false, message: 'Không tìm thấy Chrome hoặc Edge.'};
  }
  // findBrowserExecutable only returns existing files. Do not execute Chrome here:
  // on Windows, a version flag may open a new browser window.
  return {
    available: true,
    message: 'Chrome hoặc Edge đã sẵn sàng.',
    executablePath: command,
  };
}

export interface RuntimeDiagnosticsService {
  inspect(): Promise<RuntimeDiagnostics>;
}

export function createRuntimeDiagnosticsService({
  codexConnection,
  elevenLabsConnection,
}: {
  codexConnection: CodexConnectionService;
  elevenLabsConnection: ElevenLabsConnectionService;
}): RuntimeDiagnosticsService {
  return {
    async inspect() {
      const executables = resolveFinalRenderExecutables();
      const [ffmpeg, ffprobe, codex, elevenLabs] = await Promise.all([
        inspectExecutable(executables.ffmpegPath, 'FFmpeg'),
        inspectExecutable(executables.ffprobePath, 'FFprobe'),
        codexConnection.verifyConnection(),
        elevenLabsConnection.verifyConnection(),
      ]);
      const browser = inspectBrowserExecutable(executables.browserPath);
      return {
        checkedAt: new Date().toISOString(),
        tools: {ffmpeg, ffprobe, browser},
        providers: {codex, elevenLabs},
      };
    },
  };
}
