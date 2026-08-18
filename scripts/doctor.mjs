import {accessSync, constants, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {findBrowserExecutable, resolveFinalRenderExecutables} from '../src/backend/finalRenderService.ts';

export const minimumNodeVersion = [24, 12, 0];

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function versionAtLeast(actual, required = minimumNodeVersion) {
  if (!actual) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] !== required[index]) {
      return (actual[index] ?? -1) > required[index];
    }
  }
  return true;
}

export function executableAvailability(command, probe = defaultExecutableProbe) {
  const result = probe(command);
  return result.available
    ? {state: 'available', detail: result.detail || command}
    : {state: 'unavailable', detail: result.detail || command};
}

function defaultExecutableProbe(command) {
  const result = spawnSync(command, ['-version'], {
    encoding: 'utf8', windowsHide: true, timeout: 5_000,
  });
  return {
    available: !result.error && result.status === 0,
    detail: result.error?.code === 'ENOENT' ? `${command} not found` : command,
  };
}

function accessible(target) {
  try {
    accessSync(target, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function hasStoredElevenLabsCredential(repositoryRoot) {
  try {
    const document = JSON.parse(
      readFileSync(
        path.join(repositoryRoot, '.pad-studio', 'credentials.json'),
        'utf8',
      ),
    );
    return Boolean(
      document &&
        typeof document === 'object' &&
        document.entries &&
        typeof document.entries === 'object' &&
        typeof document.entries.elevenlabs === 'string' &&
        document.entries.elevenlabs.length > 0,
    );
  } catch {
    return false;
  }
}

export function createDoctorReport({
  environment = process.env,
  nodeVersion = process.version,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  probe = defaultExecutableProbe,
  isAccessible = accessible,
  storedCredentialConfigured,
} = {}) {
  const node = parseVersion(nodeVersion);
  const executables = resolveFinalRenderExecutables({
    // Voice and Sync require the shared FFMPEG_* settings; PAD_* aliases are
    // intentionally final-render-only and cannot make full production ready.
    ffmpegPath: environment.FFMPEG_PATH,
    ffprobePath: environment.FFPROBE_PATH,
    browserPath: environment.PAD_RENDER_BROWSER_PATH,
  });
  const browser = environment.PAD_RENDER_BROWSER_PATH?.trim()
    ? environment.PAD_RENDER_BROWSER_PATH.trim()
    : findBrowserExecutable();
  const environmentCredentialConfigured = Boolean(
    environment.ELEVENLABS_API_KEY?.trim(),
  );
  const localCredentialConfigured =
    storedCredentialConfigured ?? hasStoredElevenLabsCredential(repositoryRoot);
  const credentialSource = environmentCredentialConfigured
    ? 'environment'
    : localCredentialConfigured
      ? 'protected local store'
      : 'credential indicator only';
  const items = [
    {name: 'Node.js >= 24.12.0', required: true, state: versionAtLeast(node) ? 'available' : 'unavailable', detail: nodeVersion},
    {name: 'FFmpeg', required: true, ...executableAvailability(executables.ffmpegPath, probe)},
    {name: 'FFprobe', required: true, ...executableAvailability(executables.ffprobePath, probe)},
    {name: 'Chrome or Edge', required: true, state: browser && existsSync(browser) ? 'available' : 'unavailable', detail: browser || 'not found'},
    {name: 'projects runtime directory', required: true, state: isAccessible(path.join(repositoryRoot, 'projects')) ? 'available' : 'unavailable', detail: path.join(repositoryRoot, 'projects')},
    {name: 'Motion Canvas runtime', required: true, state: isAccessible(path.join(repositoryRoot, 'motion-canvas-runtime')) ? 'available' : 'unavailable', detail: path.join(repositoryRoot, 'motion-canvas-runtime')},
    {name: 'ElevenLabs credential', required: false, state: environmentCredentialConfigured || localCredentialConfigured ? 'configured' : 'not configured', detail: credentialSource},
  ];
  return {items, requiredUnavailable: items.filter(item => item.required && item.state === 'unavailable')};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowMissingRuntime = process.argv.includes('--allow-missing-runtime');
  const report = createDoctorReport();
  for (const item of report.items) {
    const label = item.required ? 'required' : 'optional';
    console.log(`[${label}] ${item.name}: ${item.state} (${item.detail})`);
  }
  if (report.requiredUnavailable.length > 0) {
    console.error(`Missing required runtime dependencies: ${report.requiredUnavailable.map(item => item.name).join(', ')}.`);
    if (!allowMissingRuntime) process.exitCode = 1;
  }
}
