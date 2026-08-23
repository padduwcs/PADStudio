import {readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRepositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function findPortableExecutable(
  executableName: string,
  repositoryRoot = defaultRepositoryRoot,
) {
  const root = path.join(repositoryRoot, '.runtime-tools', 'ffmpeg');
  const queue: Array<{directory: string; depth: number}> = [
    {directory: root, depth: 0},
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(current.directory, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(current.directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === executableName) {
        return candidate;
      }
      if (entry.isDirectory() && current.depth < 4) {
        queue.push({directory: candidate, depth: current.depth + 1});
      }
    }
  }
  return null;
}

export function resolveFfmpegExecutable(
  explicit?: string,
  repositoryRoot = defaultRepositoryRoot,
) {
  return (
    explicit?.trim() ||
    process.env.PAD_FFMPEG_PATH?.trim() ||
    process.env.FFMPEG_PATH?.trim() ||
    findPortableExecutable('ffmpeg.exe', repositoryRoot) ||
    findPortableExecutable('ffmpeg', repositoryRoot) ||
    'ffmpeg'
  );
}

export function resolveFfprobeExecutable(
  explicit?: string,
  ffmpegPath = resolveFfmpegExecutable(),
  repositoryRoot = defaultRepositoryRoot,
) {
  const configured =
    explicit?.trim() ||
    process.env.PAD_FFPROBE_PATH?.trim() ||
    process.env.FFPROBE_PATH?.trim();
  if (configured) return configured;
  const portable =
    findPortableExecutable('ffprobe.exe', repositoryRoot) ||
    findPortableExecutable('ffprobe', repositoryRoot);
  if (portable) return portable;
  if (!path.dirname(ffmpegPath) || path.dirname(ffmpegPath) === '.') {
    return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  }
  return path.join(
    path.dirname(ffmpegPath),
    `ffprobe${path.extname(ffmpegPath)}`,
  );
}

