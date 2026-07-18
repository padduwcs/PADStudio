import {createHash, randomUUID} from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {
  VoiceBundle,
  VoiceSectionAudio,
} from '../shared/topic.ts';
import type {
  ElevenLabsAlignment,
  ElevenLabsSectionGeneration,
} from './elevenLabsVoiceService.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface VoiceSourceBeat {
  beatId: string;
  textStartIndex: number;
  textEndIndex: number;
}

export interface GeneratedVoiceSection {
  outlineSectionId: string;
  outputFormat: string;
  text: string;
  beats: VoiceSourceBeat[];
  generated: ElevenLabsSectionGeneration;
}

export interface PreparedVoiceWorkspace {
  workspacePath: string;
  sections: VoiceSectionAudio[];
  totalDurationSeconds: number;
  characterCost: number;
  requestIds: string[];
}

export interface VoiceWorkspace {
  prepare(
    projectId: string,
    generationId: string,
    sections: GeneratedVoiceSection[],
  ): Promise<PreparedVoiceWorkspace>;
  readAudio(
    projectId: string,
    bundle: VoiceBundle,
    outlineSectionId: string,
  ): Promise<{audio: Buffer; contentType: string}>;
}

export class VoiceWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new VoiceWorkspaceError(
      'VOICE_WORKSPACE_INVALID',
      'Project ID của workspace voice không hợp lệ.',
    );
  }
}

function isInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function sectionDuration(alignment: ElevenLabsAlignment) {
  return alignment.characterEndTimesSeconds.at(-1) ?? 0;
}

function alignmentMatchesText(
  alignment: ElevenLabsAlignment,
  text: string,
) {
  const length = alignment.characters.length;
  if (
    length !== Array.from(text).length ||
    alignment.characters.join('') !== text ||
    alignment.characterStartTimesSeconds.length !== length ||
    alignment.characterEndTimesSeconds.length !== length
  ) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    const start = alignment.characterStartTimesSeconds[index];
    const end = alignment.characterEndTimesSeconds[index];
    const previousStart =
      index > 0
        ? alignment.characterStartTimesSeconds[index - 1]
        : undefined;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      (previousStart !== undefined && start < previousStart)
    ) {
      return false;
    }
  }
  return length > 0;
}

function timeAt(
  alignment: ElevenLabsAlignment,
  characterIndex: number,
  side: 'start' | 'end',
) {
  const values =
    side === 'start'
      ? alignment.characterStartTimesSeconds
      : alignment.characterEndTimesSeconds;
  if (values.length === 0) return 0;
  const boundedIndex = Math.max(0, Math.min(characterIndex, values.length - 1));
  return values[boundedIndex] ?? 0;
}

function audioExtension(outputFormat: string) {
  if (outputFormat.startsWith('mp3_')) return 'mp3';
  if (outputFormat.startsWith('opus_')) return 'opus';
  return 'pcm';
}

function audioContentType(filePath: string) {
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.opus')) return 'audio/ogg; codecs=opus';
  return 'application/octet-stream';
}

async function commitWorkspace(stagingDirectory: string, finalDirectory: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(stagingDirectory, finalDirectory);
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace voice.',
          {cause: error},
        );
      }
      const transientLock = code === 'EPERM' || code === 'EBUSY';
      if (transientLock && attempt === 5 && process.platform === 'win32') {
        try {
          await cp(stagingDirectory, finalDirectory, {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
          return;
        } catch (copyError) {
          await rm(finalDirectory, {recursive: true, force: true}).catch(
            () => undefined,
          );
          throw new VoiceWorkspaceError(
            'VOICE_WORKSPACE_WRITE_FAILED',
            'Không thể hoàn tất workspace voice.',
            {cause: copyError},
          );
        }
      }
      if (!transientLock || attempt === 5) {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_WRITE_FAILED',
          'Không thể hoàn tất workspace voice.',
          {cause: error},
        );
      }
      await delay(50 * 2 ** attempt);
    }
  }
}

export function createVoiceWorkspace(
  projectsDirectory: string,
): VoiceWorkspace {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);

  function projectDirectory(projectId: string) {
    assertProjectId(projectId);
    return path.join(resolvedProjectsDirectory, projectId);
  }

  function resolveBundleDirectory(projectId: string, bundle: VoiceBundle) {
    const root = projectDirectory(projectId);
    const directory = path.resolve(root, bundle.workspacePath);
    if (!isInside(root, directory)) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_INVALID',
        'Workspace voice nằm ngoài project.',
      );
    }
    return directory;
  }

  return {
    async prepare(projectId, generationId, sections) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId) || sections.length < 2) {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_INVALID',
          'Dữ liệu generation voice không hợp lệ.',
        );
      }

      const root = projectDirectory(projectId);
      const generationsDirectory = path.join(root, 'voice', 'generations');
      const finalDirectory = path.join(generationsDirectory, generationId);
      const stagingDirectory = path.join(
        generationsDirectory,
        `.staging-${randomUUID()}`,
      );
      const workspacePath = `voice/generations/${generationId}` as const;
      await mkdir(generationsDirectory, {recursive: true});
      if (
        await stat(finalDirectory)
          .then((entry) => entry.isDirectory())
          .catch(() => false)
      ) {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace voice.',
        );
      }

      const preparedSections: VoiceSectionAudio[] = [];
      try {
        for (const [index, section] of sections.entries()) {
          const alignment = section.generated.alignment;
          const durationSeconds = sectionDuration(alignment);
          if (
            !alignmentMatchesText(alignment, section.text) ||
            section.generated.audio.byteLength === 0 ||
            durationSeconds <= 0
          ) {
            throw new VoiceWorkspaceError(
              'VOICE_ALIGNMENT_INVALID',
              'Alignment ElevenLabs không khớp nguyên văn section.',
            );
          }

          const prefix = `${String(index + 1).padStart(2, '0')}-${section.outlineSectionId}`;
          const extension = audioExtension(section.outputFormat);
          const audioPath = `audio/${prefix}.${extension}`;
          const alignmentPath = `alignments/${prefix}.json`;
          const audioFile = path.resolve(stagingDirectory, audioPath);
          const alignmentFile = path.resolve(
            stagingDirectory,
            alignmentPath,
          );
          if (
            !isInside(stagingDirectory, audioFile) ||
            !isInside(stagingDirectory, alignmentFile)
          ) {
            throw new VoiceWorkspaceError(
              'VOICE_WORKSPACE_INVALID',
              'Đường dẫn artifact voice không hợp lệ.',
            );
          }
          await mkdir(path.dirname(audioFile), {recursive: true});
          await mkdir(path.dirname(alignmentFile), {recursive: true});
          await writeFile(audioFile, section.generated.audio);
          await writeFile(
            alignmentFile,
            `${JSON.stringify(
              {
                version: 1,
                outlineSectionId: section.outlineSectionId,
                text: section.text,
                alignment: section.generated.alignment,
                normalizedAlignment:
                  section.generated.normalizedAlignment,
              },
              null,
              2,
            )}\n`,
            'utf8',
          );

          preparedSections.push({
            outlineSectionId: section.outlineSectionId,
            audioPath,
            alignmentPath,
            durationSeconds,
            characterCost: section.generated.characterCost,
            requestId: section.generated.requestId,
            sourceTextHash: createHash('sha256')
              .update(section.text)
              .digest('hex'),
            beats: section.beats.map((beat) => ({
              ...beat,
              startSeconds: timeAt(
                alignment,
                beat.textStartIndex,
                'start',
              ),
              endSeconds: timeAt(
                alignment,
                beat.textEndIndex - 1,
                'end',
              ),
            })),
          });
        }

        const manifest = {
          version: 1,
          generationId,
          sections: preparedSections,
        };
        await writeFile(
          path.join(stagingDirectory, 'manifest.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
          'utf8',
        );
        await commitWorkspace(stagingDirectory, finalDirectory);
      } catch (error) {
        await rm(stagingDirectory, {recursive: true, force: true}).catch(
          () => undefined,
        );
        if (error instanceof VoiceWorkspaceError) throw error;
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_WRITE_FAILED',
          'Không thể lưu audio và timing của voice.',
          {cause: error},
        );
      }

      return {
        workspacePath,
        sections: preparedSections,
        totalDurationSeconds: preparedSections.reduce(
          (total, section) => total + section.durationSeconds,
          0,
        ),
        characterCost: preparedSections.reduce(
          (total, section) => total + section.characterCost,
          0,
        ),
        requestIds: preparedSections
          .map((section) => section.requestId)
          .filter((requestId): requestId is string => requestId !== null),
      };
    },

    async readAudio(projectId, bundle, outlineSectionId) {
      const section = bundle.sections.find(
        (item) => item.outlineSectionId === outlineSectionId,
      );
      if (!section) {
        throw new VoiceWorkspaceError(
          'VOICE_AUDIO_NOT_FOUND',
          'Không tìm thấy audio của section.',
        );
      }
      const directory = resolveBundleDirectory(projectId, bundle);
      const filePath = path.resolve(directory, section.audioPath);
      if (!isInside(directory, filePath)) {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_INVALID',
          'Đường dẫn audio nằm ngoài workspace voice.',
        );
      }
      try {
        return {
          audio: await readFile(filePath),
          contentType: audioContentType(filePath),
        };
      } catch (error) {
        throw new VoiceWorkspaceError(
          'VOICE_AUDIO_READ_FAILED',
          'Không thể đọc audio của section.',
          {cause: error},
        );
      }
    },
  };
}
