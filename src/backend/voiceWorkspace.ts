import {execFile} from 'node:child_process';
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
import {promisify} from 'node:util';
import {z} from 'zod';
import {
  calibrationFromActualNarration,
  countNarrationCharacters,
  countNarrationWhitespaceTokens,
} from '../shared/narrationTiming.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {
  VoiceBundle,
  VoiceSectionAudio,
} from '../shared/topic.ts';
import {VoiceBundleSchema} from '../shared/topic.ts';
import type {
  ElevenLabsAlignment,
  ElevenLabsSectionGeneration,
} from './elevenLabsVoiceService.ts';
import type {
  NarrationSourceSection,
} from './narrationSource.ts';

const execFileAsync = promisify(execFile);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OUTPUT_SAMPLE_RATE = 48_000;
const MASTER_AUDIO_PATH = 'audio/narration.wav' as const;
const MASTER_ALIGNMENT_PATH = 'alignments/narration.json' as const;

const checkpointAlignmentSchema = z
  .object({
    characters: z.array(z.string()),
    characterStartTimesSeconds: z.array(z.number().nonnegative()),
    characterEndTimesSeconds: z.array(z.number().nonnegative()),
  })
  .strict();

const checkpointMetadataSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    outputFormat: z.string().min(1),
    text: z.string().min(1),
    textStartIndex: z.number().int().nonnegative(),
    textEndIndex: z.number().int().positive(),
    alignment: checkpointAlignmentSchema,
    normalizedAlignment: checkpointAlignmentSchema.nullable(),
    requestId: z.string().min(1).nullable(),
    characterCost: z.number().int().nonnegative(),
  })
  .strict();

const preparedManifestSchema = z
  .object({
    version: z.literal(2),
    generationId: z.string().regex(uuidPattern),
    track: VoiceBundleSchema.shape.track,
    sections: VoiceBundleSchema.shape.sections,
    requestIds: z.array(z.string().min(1)),
  })
  .strict();

export interface GeneratedVoiceChunk {
  outputFormat: string;
  text: string;
  textStartIndex: number;
  textEndIndex: number;
  generated: ElevenLabsSectionGeneration;
}

export interface GeneratedVoiceNarration {
  text: string;
  sections: NarrationSourceSection[];
  chunks: GeneratedVoiceChunk[];
}

export interface PreparedVoiceWorkspace {
  workspacePath: string;
  track: VoiceBundle['track'];
  sections: VoiceSectionAudio[];
  totalDurationSeconds: number;
  characterCost: number;
  requestIds: string[];
}

export interface VoiceWorkspace {
  verifyDependencies?(): Promise<void>;
  readGenerationChunk?(
    projectId: string,
    generationId: string,
    chunkIndex: number,
    fingerprint: string,
  ): Promise<GeneratedVoiceChunk | null>;
  saveGenerationChunk?(
    projectId: string,
    generationId: string,
    chunkIndex: number,
    fingerprint: string,
    chunk: GeneratedVoiceChunk,
  ): Promise<void>;
  clearGenerationCheckpoint?(
    projectId: string,
    generationId: string,
  ): Promise<void>;
  prepare(
    projectId: string,
    generationId: string,
    narration: GeneratedVoiceNarration,
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

function alignmentDuration(alignment: ElevenLabsAlignment) {
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

function rawInputArguments(outputFormat: string, filePath: string) {
  if (path.extname(filePath).toLowerCase() !== '.pcm') return [];
  const sampleRateMatch = /_(\d+)(?:_|$)/.exec(outputFormat);
  const sampleRate = sampleRateMatch?.[1] ?? '44100';
  const format = outputFormat.startsWith('ulaw_')
    ? 'mulaw'
    : outputFormat.startsWith('alaw_')
      ? 'alaw'
      : 's16le';
  return ['-f', format, '-ar', sampleRate, '-ac', '1'];
}

function ffmpegArguments(
  chunks: Array<{
    filePath: string;
    outputFormat: string;
    durationSeconds: number;
  }>,
  destination: string,
) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  for (const chunk of chunks) {
    args.push(
      ...rawInputArguments(chunk.outputFormat, chunk.filePath),
      '-i',
      chunk.filePath,
    );
  }
  const filters = chunks.map((chunk, index) => {
    // Intermediate continuity groups must end at their alignment boundary so
    // the following group's timestamps remain exact. The final group is left
    // untrimmed because ElevenLabs can return a valid release/breath after the
    // last character timestamp. Trimming it used to cut the narration ending.
    const trim = index === chunks.length - 1
      ? ''
      : `atrim=duration=${chunk.durationSeconds.toFixed(6)},`;
    return `[${index}:a]${trim}asetpts=PTS-STARTPTS,aresample=${OUTPUT_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=stereo[a${index}]`;
  });
  if (chunks.length === 1) {
    filters.push('[a0]anull[outa]');
  } else {
    filters.push(
      `${chunks.map((_chunk, index) => `[a${index}]`).join('')}concat=n=${chunks.length}:v=0:a=1[outa]`,
    );
  }
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outa]',
    '-vn',
    '-c:a',
    'pcm_s16le',
    '-ar',
    String(OUTPUT_SAMPLE_RATE),
    '-ac',
    '2',
    '-y',
    destination,
  );
  return args;
}

export function voiceMasterTimeoutMs(durationSeconds: number) {
  return Math.round(
    Math.min(
      2 * 60 * 60_000,
      Math.max(120_000, durationSeconds * 500),
    ),
  );
}

function ffprobeExecutable(ffmpegPath: string, configured?: string) {
  if (configured) return configured;
  if (!path.dirname(ffmpegPath) || path.dirname(ffmpegPath) === '.') {
    return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  }
  return path.join(
    path.dirname(ffmpegPath),
    `ffprobe${path.extname(ffmpegPath)}`,
  );
}

async function probeAudioDuration(ffprobePath: string, audioPath: string) {
  try {
    const {stdout} = await execFileAsync(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    const durationSeconds = Number(stdout.trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('FFprobe returned an invalid audio duration.');
    }
    return durationSeconds;
  } catch (error) {
    throw new VoiceWorkspaceError(
      'VOICE_MASTER_AUDIO_PROBE_FAILED',
      'Không thể kiểm tra thời lượng thực của master narration.',
      {cause: error},
    );
  }
}

async function verifyExecutable(
  executable: string,
  code: string,
  message: string,
) {
  try {
    await execFileAsync(executable, ['-version'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new VoiceWorkspaceError(code, message, {cause: error});
  }
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

function validateNarration(narration: GeneratedVoiceNarration) {
  const textLength = Array.from(narration.text).length;
  if (
    narration.sections.length < pipelineSafetyLimits.minimumSections ||
    narration.sections.length > pipelineSafetyLimits.maximumSections ||
    narration.chunks.length < 1 ||
    narration.chunks.length > pipelineSafetyLimits.maximumVoiceChunks
  ) {
    throw new VoiceWorkspaceError(
      'VOICE_WORKSPACE_INVALID',
      'Dữ liệu master narration không hợp lệ.',
    );
  }
  let expectedStart = 0;
  for (const chunk of narration.chunks) {
    const chunkLength = Array.from(chunk.text).length;
    if (
      chunk.textStartIndex !== expectedStart ||
      chunk.textEndIndex !== expectedStart + chunkLength ||
      chunk.textEndIndex > textLength ||
      !alignmentMatchesText(chunk.generated.alignment, chunk.text) ||
      chunk.generated.audio.byteLength === 0 ||
      alignmentDuration(chunk.generated.alignment) <= 0
    ) {
      throw new VoiceWorkspaceError(
        'VOICE_ALIGNMENT_INVALID',
        'Alignment ElevenLabs không khớp master narration.',
      );
    }
    expectedStart = chunk.textEndIndex;
  }
  if (
    expectedStart !== textLength ||
    narration.chunks.map((chunk) => chunk.text).join('') !== narration.text
  ) {
    throw new VoiceWorkspaceError(
      'VOICE_ALIGNMENT_INVALID',
      'Các continuity group không bao phủ nguyên văn narration.',
    );
  }
}

function combineAlignments(chunks: GeneratedVoiceChunk[]) {
  const alignment: ElevenLabsAlignment = {
    characters: [],
    characterStartTimesSeconds: [],
    characterEndTimesSeconds: [],
  };
  let offsetSeconds = 0;
  for (const chunk of chunks) {
    alignment.characters.push(...chunk.generated.alignment.characters);
    alignment.characterStartTimesSeconds.push(
      ...chunk.generated.alignment.characterStartTimesSeconds.map(
        (value) => value + offsetSeconds,
      ),
    );
    alignment.characterEndTimesSeconds.push(
      ...chunk.generated.alignment.characterEndTimesSeconds.map(
        (value) => value + offsetSeconds,
      ),
    );
    offsetSeconds += alignmentDuration(chunk.generated.alignment);
  }
  return {alignment, durationSeconds: offsetSeconds};
}

function preparedSections(
  narration: GeneratedVoiceNarration,
  alignment: ElevenLabsAlignment,
  totalDurationSeconds: number,
) {
  return narration.sections.map((section, sectionIndex) => {
    const nextSection = narration.sections[sectionIndex + 1];
    const startSeconds =
      sectionIndex === 0
        ? 0
        : timeAt(alignment, section.textStartIndex, 'start');
    const endSeconds = nextSection
      ? timeAt(alignment, nextSection.textStartIndex, 'start')
      : totalDurationSeconds;
    const durationSeconds = endSeconds - startSeconds;
    if (durationSeconds <= 0) {
      throw new VoiceWorkspaceError(
        'VOICE_ALIGNMENT_INVALID',
        'Timing section trong master narration không tăng dần.',
      );
    }
    return {
      outlineSectionId: section.outlineSectionId,
      textStartIndex: section.textStartIndex,
      textEndIndex: section.textEndIndex,
      startSeconds,
      endSeconds,
      durationSeconds,
      sourceTextHash: createHash('sha256')
        .update(
          Array.from(narration.text)
            .slice(section.textStartIndex, section.textEndIndex)
            .join(''),
        )
        .digest('hex'),
      beats: section.beats.map((beat, beatIndex) => ({
        beatId: beat.beatId,
        textStartIndex: beat.textStartIndex,
        textEndIndex: beat.textEndIndex,
        startSeconds: Math.max(
          0,
          timeAt(alignment, beat.textStartIndex, 'start') - startSeconds,
        ),
        endSeconds:
          beatIndex === section.beats.length - 1
            ? durationSeconds
            : Math.max(
                0,
                timeAt(alignment, beat.textEndIndex - 1, 'end') -
                  startSeconds,
              ),
      })),
    };
  });
}

export function createVoiceWorkspace(
  projectsDirectory: string,
  options: {ffmpegPath?: string; ffprobePath?: string} = {},
): VoiceWorkspace {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath = ffprobeExecutable(
    ffmpegPath,
    options.ffprobePath ?? process.env.FFPROBE_PATH,
  );

  function projectDirectory(projectId: string) {
    assertProjectId(projectId);
    return path.join(resolvedProjectsDirectory, projectId);
  }

  function assertGenerationId(generationId: string) {
    if (!uuidPattern.test(generationId)) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_INVALID',
        'Generation ID của workspace voice không hợp lệ.',
      );
    }
  }

  function checkpointDirectory(projectId: string, generationId: string) {
    assertGenerationId(generationId);
    return path.join(
      projectDirectory(projectId),
      'voice',
      'pending',
      generationId,
    );
  }

  function checkpointChunkDirectory(
    projectId: string,
    generationId: string,
    chunkIndex: number,
  ) {
    if (
      !Number.isSafeInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= pipelineSafetyLimits.maximumVoiceChunks
    ) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_INVALID',
        'Chỉ số continuity group không hợp lệ.',
      );
    }
    return path.join(
      checkpointDirectory(projectId, generationId),
      'chunks',
      String(chunkIndex + 1).padStart(2, '0'),
    );
  }

  function assertCheckpointFingerprint(fingerprint: string) {
    if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_INVALID',
        'Fingerprint continuity group không hợp lệ.',
      );
    }
  }

  async function readGenerationChunk(
    projectId: string,
    generationId: string,
    chunkIndex: number,
    fingerprint: string,
  ): Promise<GeneratedVoiceChunk | null> {
    assertCheckpointFingerprint(fingerprint);
    const directory = checkpointChunkDirectory(
      projectId,
      generationId,
      chunkIndex,
    );
    let metadataSource: string;
    let audio: Buffer;
    try {
      [metadataSource, audio] = await Promise.all([
        readFile(path.join(directory, 'metadata.json'), 'utf8'),
        readFile(path.join(directory, 'audio.bin')),
      ]);
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (errorCode === 'ENOENT') return null;
      throw new VoiceWorkspaceError(
        'VOICE_GENERATION_CHECKPOINT_READ_FAILED',
        'Không thể đọc checkpoint audio đã tạo từ ElevenLabs.',
        {cause: error},
      );
    }

    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(metadataSource);
    } catch (error) {
      throw new VoiceWorkspaceError(
        'VOICE_GENERATION_CHECKPOINT_INVALID',
        'Checkpoint audio ElevenLabs không phải JSON hợp lệ.',
        {cause: error},
      );
    }
    const metadata = checkpointMetadataSchema.safeParse(rawMetadata);
    if (!metadata.success || audio.byteLength === 0) {
      throw new VoiceWorkspaceError(
        'VOICE_GENERATION_CHECKPOINT_INVALID',
        'Checkpoint audio ElevenLabs không đúng cấu trúc hỗ trợ.',
        {cause: metadata.success ? undefined : metadata.error},
      );
    }
    if (metadata.data.fingerprint !== fingerprint) {
      throw new VoiceWorkspaceError(
        'VOICE_GENERATION_CHECKPOINT_CONFLICT',
        'Generation ID đã có checkpoint từ một cấu hình voice khác.',
      );
    }
    return {
      outputFormat: metadata.data.outputFormat,
      text: metadata.data.text,
      textStartIndex: metadata.data.textStartIndex,
      textEndIndex: metadata.data.textEndIndex,
      generated: {
        audio,
        alignment: metadata.data.alignment,
        normalizedAlignment: metadata.data.normalizedAlignment,
        requestId: metadata.data.requestId,
        characterCost: metadata.data.characterCost,
      },
    };
  }

  async function readPreparedWorkspace(
    finalDirectory: string,
    generationId: string,
    narration: GeneratedVoiceNarration,
  ): Promise<PreparedVoiceWorkspace> {
    let manifestSource: string;
    try {
      manifestSource = await readFile(
        path.join(finalDirectory, 'manifest.json'),
        'utf8',
      );
    } catch (error) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_CONFLICT',
        'Generation voice đã tồn tại nhưng không thể tiếp tục từ manifest.',
        {cause: error},
      );
    }
    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(manifestSource);
    } catch (error) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_CONFLICT',
        'Manifest của generation voice đã tồn tại không hợp lệ.',
        {cause: error},
      );
    }
    const manifest = preparedManifestSchema.safeParse(rawManifest);
    const expectedSourceHash = createHash('sha256')
      .update(narration.text)
      .digest('hex');
    if (
      !manifest.success ||
      manifest.data.generationId !== generationId ||
      manifest.data.track.sourceTextHash !== expectedSourceHash ||
      manifest.data.track.chunkCount !== narration.chunks.length
    ) {
      throw new VoiceWorkspaceError(
        'VOICE_WORKSPACE_CONFLICT',
        'Generation voice đã tồn tại nhưng không khớp narration hiện tại.',
        {cause: manifest.success ? undefined : manifest.error},
      );
    }
    return {
      workspacePath: `voice/generations/${generationId}`,
      track: manifest.data.track,
      sections: manifest.data.sections,
      totalDurationSeconds: manifest.data.track.durationSeconds,
      characterCost: manifest.data.track.characterCost,
      requestIds: manifest.data.requestIds,
    };
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
    async verifyDependencies() {
      await verifyExecutable(
        ffmpegPath,
        'FFMPEG_NOT_AVAILABLE',
        'Chưa thể tạo voice: không tìm thấy FFmpeg. Hãy cài FFmpeg hoặc cấu hình FFMPEG_PATH; ElevenLabs chưa bị gọi và chưa trừ quota.',
      );
      await verifyExecutable(
        ffprobePath,
        'FFPROBE_NOT_AVAILABLE',
        'Chưa thể tạo voice: không tìm thấy FFprobe. Hãy cài FFmpeg đầy đủ hoặc cấu hình FFPROBE_PATH; ElevenLabs chưa bị gọi và chưa trừ quota.',
      );
    },

    readGenerationChunk,

    async saveGenerationChunk(
      projectId,
      generationId,
      chunkIndex,
      fingerprint,
      chunk,
    ) {
      assertCheckpointFingerprint(fingerprint);
      const existing = await readGenerationChunk(
        projectId,
        generationId,
        chunkIndex,
        fingerprint,
      );
      if (existing) return;

      const finalDirectory = checkpointChunkDirectory(
        projectId,
        generationId,
        chunkIndex,
      );
      const parentDirectory = path.dirname(finalDirectory);
      const stagingDirectory = path.join(
        parentDirectory,
        `.staging-${randomUUID()}`,
      );
      await mkdir(parentDirectory, {recursive: true});
      try {
        await mkdir(stagingDirectory, {recursive: false});
        await Promise.all([
          writeFile(path.join(stagingDirectory, 'audio.bin'), chunk.generated.audio),
          writeFile(
            path.join(stagingDirectory, 'metadata.json'),
            `${JSON.stringify(
              {
                version: 1,
                fingerprint,
                outputFormat: chunk.outputFormat,
                text: chunk.text,
                textStartIndex: chunk.textStartIndex,
                textEndIndex: chunk.textEndIndex,
                alignment: chunk.generated.alignment,
                normalizedAlignment: chunk.generated.normalizedAlignment,
                requestId: chunk.generated.requestId,
                characterCost: chunk.generated.characterCost,
              },
              null,
              2,
            )}\n`,
            'utf8',
          ),
        ]);
        await rename(stagingDirectory, finalDirectory);
      } catch (error) {
        const concurrent = await readGenerationChunk(
          projectId,
          generationId,
          chunkIndex,
          fingerprint,
        ).catch(() => null);
        if (!concurrent) {
          throw new VoiceWorkspaceError(
            'VOICE_GENERATION_CHECKPOINT_WRITE_FAILED',
            'Không thể lưu checkpoint audio ElevenLabs trước khi hậu xử lý.',
            {cause: error},
          );
        }
      } finally {
        await rm(stagingDirectory, {recursive: true, force: true}).catch(
          () => undefined,
        );
      }
    },

    async clearGenerationCheckpoint(projectId, generationId) {
      await rm(checkpointDirectory(projectId, generationId), {
        recursive: true,
        force: true,
      });
    },

    async prepare(projectId, generationId, narration) {
      assertProjectId(projectId);
      assertGenerationId(generationId);
      validateNarration(narration);

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
        return readPreparedWorkspace(
          finalDirectory,
          generationId,
          narration,
        );
      }

      try {
        const rawChunks: Array<{
          filePath: string;
          outputFormat: string;
          durationSeconds: number;
        }> = [];
        for (const [index, chunk] of narration.chunks.entries()) {
          const prefix = String(index + 1).padStart(2, '0');
          const extension = audioExtension(chunk.outputFormat);
          const audioPath = `chunks/audio/${prefix}.${extension}`;
          const alignmentPath = `chunks/alignments/${prefix}.json`;
          const audioFile = path.resolve(stagingDirectory, audioPath);
          const alignmentFile = path.resolve(stagingDirectory, alignmentPath);
          if (
            !isInside(stagingDirectory, audioFile) ||
            !isInside(stagingDirectory, alignmentFile)
          ) {
            throw new VoiceWorkspaceError(
              'VOICE_WORKSPACE_INVALID',
              'Đường dẫn continuity group không hợp lệ.',
            );
          }
          await mkdir(path.dirname(audioFile), {recursive: true});
          await mkdir(path.dirname(alignmentFile), {recursive: true});
          await writeFile(audioFile, chunk.generated.audio);
          await writeFile(
            alignmentFile,
            `${JSON.stringify(
              {
                version: 2,
                textStartIndex: chunk.textStartIndex,
                textEndIndex: chunk.textEndIndex,
                text: chunk.text,
                alignment: chunk.generated.alignment,
                normalizedAlignment: chunk.generated.normalizedAlignment,
                requestId: chunk.generated.requestId,
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
          rawChunks.push({
            filePath: audioFile,
            outputFormat: chunk.outputFormat,
            durationSeconds: alignmentDuration(chunk.generated.alignment),
          });
        }

        const combined = combineAlignments(narration.chunks);
        const masterAudioFile = path.resolve(
          stagingDirectory,
          MASTER_AUDIO_PATH,
        );
        const masterAlignmentFile = path.resolve(
          stagingDirectory,
          MASTER_ALIGNMENT_PATH,
        );
        await mkdir(path.dirname(masterAudioFile), {recursive: true});
        await mkdir(path.dirname(masterAlignmentFile), {recursive: true});
        try {
          await execFileAsync(
            ffmpegPath,
            ffmpegArguments(rawChunks, masterAudioFile),
            {
              windowsHide: true,
              timeout: voiceMasterTimeoutMs(combined.durationSeconds),
              maxBuffer: 2 * 1024 * 1024,
            },
          );
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : '';
          throw new VoiceWorkspaceError(
            code === 'ENOENT'
              ? 'FFMPEG_NOT_AVAILABLE'
              : 'VOICE_MASTER_AUDIO_FAILED',
            code === 'ENOENT'
              ? 'Không tìm thấy FFmpeg để dựng master narration.'
              : 'Không thể dựng master narration từ các continuity group.',
            {cause: error},
          );
        }

        const masterDurationSeconds = await probeAudioDuration(
          ffprobePath,
          masterAudioFile,
        );
        if (masterDurationSeconds + 0.01 < combined.durationSeconds) {
          throw new VoiceWorkspaceError(
            'VOICE_MASTER_AUDIO_INVALID',
            'Master narration ngắn hơn alignment do ElevenLabs trả về.',
          );
        }

        const sections = preparedSections(
          narration,
          combined.alignment,
          masterDurationSeconds,
        );
        const characterCost = narration.chunks.reduce(
          (total, chunk) => total + chunk.generated.characterCost,
          0,
        );
        const requestIds = narration.chunks
          .map((chunk) => chunk.generated.requestId)
          .filter((requestId): requestId is string => requestId !== null);
        const calibration = calibrationFromActualNarration(
          narration.text,
          masterDurationSeconds,
        );
        if (!calibration) {
          throw new VoiceWorkspaceError(
            'VOICE_ALIGNMENT_INVALID',
            'Không thể hiệu chỉnh timing từ master narration.',
          );
        }
        const track: VoiceBundle['track'] = {
          audioPath: MASTER_AUDIO_PATH,
          alignmentPath: MASTER_ALIGNMENT_PATH,
          sourceTextHash: createHash('sha256')
            .update(narration.text)
            .digest('hex'),
          durationSeconds: masterDurationSeconds,
          characterCost,
          strategy:
            narration.chunks.length === 1
              ? 'single-request'
              : 'continuity-groups',
          chunkCount: narration.chunks.length,
          calibration: {
            whitespaceTokenCount:
              countNarrationWhitespaceTokens(narration.text),
            characterCount: countNarrationCharacters(narration.text),
            ...calibration,
          },
        };
        await writeFile(
          masterAlignmentFile,
          `${JSON.stringify(
            {
              version: 2,
              text: narration.text,
              alignment: combined.alignment,
              sections,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        await writeFile(
          path.join(stagingDirectory, 'manifest.json'),
          `${JSON.stringify(
            {
              version: 2,
              generationId,
              track,
              sections,
              requestIds,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        await commitWorkspace(stagingDirectory, finalDirectory);

        return {
          workspacePath,
          track,
          sections,
          totalDurationSeconds: masterDurationSeconds,
          characterCost,
          requestIds,
        };
      } catch (error) {
        await rm(stagingDirectory, {recursive: true, force: true}).catch(
          () => undefined,
        );
        if (error instanceof VoiceWorkspaceError) throw error;
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_WRITE_FAILED',
          'Không thể lưu master audio và timing của voice.',
          {cause: error},
        );
      }
    },

    async readAudio(projectId, bundle, outlineSectionId) {
      if (
        !bundle.sections.some(
          (section) => section.outlineSectionId === outlineSectionId,
        )
      ) {
        throw new VoiceWorkspaceError(
          'VOICE_AUDIO_NOT_FOUND',
          'Không tìm thấy section trong master narration.',
        );
      }
      const directory = resolveBundleDirectory(projectId, bundle);
      const filePath = path.resolve(directory, bundle.track.audioPath);
      if (!isInside(directory, filePath)) {
        throw new VoiceWorkspaceError(
          'VOICE_WORKSPACE_INVALID',
          'Đường dẫn master narration nằm ngoài workspace voice.',
        );
      }
      try {
        return {
          audio: await readFile(filePath),
          contentType: 'audio/wav',
        };
      } catch (error) {
        throw new VoiceWorkspaceError(
          'VOICE_AUDIO_READ_FAILED',
          'Không thể đọc master narration.',
          {cause: error},
        );
      }
    },
  };
}
