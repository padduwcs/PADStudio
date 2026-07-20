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
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import type {
  AnimationSyncBundle,
  MotionCanvasBundle,
  VoiceBundle,
} from '../shared/topic.ts';
import {MOTION_CANVAS_VERSION} from './motionCanvasGenerator.ts';

const execFileAsync = promisify(execFile);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIO_FILE = 'audio/narration.wav' as const;
const PROJECT_FILE = 'src/project.ts' as const;
const OUTPUT_SAMPLE_RATE = 48_000;

interface WorkspaceFile {
  path: string;
  source: string | Buffer;
}

export interface PreparedAnimationSyncWorkspace {
  workspacePath: string;
  projectFile: typeof PROJECT_FILE;
  audioFile: typeof AUDIO_FILE;
  totalDurationSeconds: number;
  sections: AnimationSyncBundle['sections'];
  validation: AnimationSyncBundle['validation'];
}

export interface AnimationSyncWorkspaceFile {
  path: string;
  source: string;
}

export interface AnimationSyncWorkspace {
  prepare(
    projectId: string,
    generationId: string,
    motionCanvasBundle: MotionCanvasBundle,
    voiceBundle: VoiceBundle,
  ): Promise<PreparedAnimationSyncWorkspace>;
  readFiles(
    projectId: string,
    bundle: AnimationSyncBundle,
  ): Promise<AnimationSyncWorkspaceFile[]>;
  readAudio(
    projectId: string,
    bundle: AnimationSyncBundle,
  ): Promise<Buffer>;
}

export class AnimationSyncWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new AnimationSyncWorkspaceError(
      'ANIMATION_SYNC_WORKSPACE_INVALID',
      'Project ID của workspace đồng bộ không hợp lệ.',
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

function portableConfigPath(fromDirectory: string, target: string) {
  const relativePath = path.relative(fromDirectory, target);
  if (path.isAbsolute(relativePath)) return target;
  const configPath = relativePath || '.';
  return configPath.startsWith('.') ? configPath : `./${configPath}`;
}

function projectSource(scenes: MotionCanvasBundle['scenes']) {
  const imports = scenes.map((scene, index) => {
    const importPath = `./scenes/${path.posix.basename(scene.filePath, '.tsx')}?scene`;
    return `import scene${String(index + 1).padStart(2, '0')} from '${importPath}';`;
  });
  const sceneNames = scenes.map(
    (_scene, index) => `scene${String(index + 1).padStart(2, '0')}`,
  );

  return [
    "import {makeProject} from '@motion-canvas/core';",
    `import narration from '../${AUDIO_FILE}';`,
    '',
    ...imports,
    '',
    'export default makeProject({',
    `  scenes: [${sceneNames.join(', ')}],`,
    '  audio: narration,',
    '});',
    '',
  ].join('\n');
}

function projectMetaSource(bundle: MotionCanvasBundle) {
  return `${JSON.stringify(
    {
      version: 1,
      shared: {
        background: 'rgb(17,31,27)',
        range: [0, null],
        size: {x: bundle.width, y: bundle.height},
        audioOffset: 0,
      },
      preview: {
        fps: bundle.fps,
        resolutionScale: 0.5,
      },
      rendering: {
        fps: bundle.fps,
        resolutionScale: 1,
        colorSpace: 'srgb',
        fileType: 'image/png',
        quality: 1,
      },
    },
    null,
    2,
  )}\n`;
}

function sceneMetaSource(
  sceneId: string,
  beats: AnimationSyncBundle['sections'][number]['beats'],
) {
  const seed = Number.parseInt(sceneId.replaceAll('-', '').slice(0, 8), 16);
  return `${JSON.stringify(
    {
      version: 0,
      timeEvents: beats.flatMap((beat) => [
        {name: beat.startEvent, targetTime: beat.voiceStartSeconds},
        {name: beat.endEvent, targetTime: beat.voiceEndSeconds},
      ]),
      seed: Number.isSafeInteger(seed) ? seed : 0,
    },
    null,
    2,
  )}\n`;
}

function tsconfigSource(
  motionCanvas2dConfig: string,
  motionCanvasPackagesPattern: string,
) {
  return `${JSON.stringify(
    {
      extends: motionCanvas2dConfig.replaceAll(path.sep, '/'),
      compilerOptions: {
        baseUrl: '.',
        noEmit: true,
        strict: true,
        paths: {
          '@motion-canvas/*': [
            motionCanvasPackagesPattern.replaceAll(path.sep, '/'),
          ],
        },
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`;
}

function declarationSource() {
  return `declare module '*?scene' {
  const value: import('@motion-canvas/core/lib/scenes/Scene').FullSceneDescription;
  export = value;
}

declare module '*.wav' {
  const source: string;
  export default source;
}

declare type Callback = (...args: any[]) => void;
`;
}

function sourceHash(files: WorkspaceFile[]) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.source);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function normalizeSceneTimingSource(
  source: string,
  timingEvents: NonNullable<
    MotionCanvasBundle['scenes'][number]['timingEvents']
  >,
) {
  const sourceFile = ts.createSourceFile(
    'synchronized-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const waitCounts = new Map<string, number>();
  const durationCounts = new Map<string, number>();
  const durationBindings = new Map<
    string,
    {name: string; statement: ts.VariableStatement}
  >();
  const removableEndWaits = new Map<string, ts.ExpressionStatement[]>();
  const endEvents = new Set(timingEvents.map((event) => event.endEvent));
  const sourceEdits: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];
  const semanticKeyPattern =
    /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
  const semanticKeyCounts = new Map<string, number>();
  let keySite = 0;
  let sceneBody: ts.Block | null = null;

  function staticSemanticKey(attribute: ts.JsxAttribute) {
    const initializer = attribute.initializer;
    let value: string | null = null;
    if (initializer && ts.isStringLiteral(initializer)) {
      value = initializer.text;
    } else if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      (ts.isStringLiteral(initializer.expression) ||
        ts.isNoSubstitutionTemplateLiteral(initializer.expression))
    ) {
      value = initializer.expression.text;
    }
    if (
      !value ||
      value.length > 80 ||
      !semanticKeyPattern.test(value) ||
      value
        .split('-')
        .some((segment) => /^[a-f0-9]{8,}$/i.test(segment))
    ) {
      return null;
    }
    return value;
  }

  function collectSemanticKeys(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'key'
    ) {
      const key = staticSemanticKey(node);
      if (key) {
        semanticKeyCounts.set(
          key,
          (semanticKeyCounts.get(key) ?? 0) + 1,
        );
      }
    }
    ts.forEachChild(node, collectSemanticKeys);
  }
  collectSemanticKeys(sourceFile);

  function eventName(
    node: ts.Node,
    functionName: 'waitUntil' | 'useDuration',
  ) {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== functionName ||
      node.arguments.length !== 1 ||
      !ts.isStringLiteral(node.arguments[0]!)
    ) {
      return null;
    }
    return node.arguments[0]!.text;
  }

  function increment(counts: Map<string, number>, event: string) {
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }

  function visit(node: ts.Node) {
    if (
      !sceneBody &&
      ts.isFunctionExpression(node) &&
      node.asteriskToken &&
      ts.isCallExpression(node.parent) &&
      ts.isIdentifier(node.parent.expression) &&
      node.parent.expression.text === 'makeScene2D'
    ) {
      sceneBody = node.body;
    }
    const waitEvent = eventName(node, 'waitUntil');
    const durationEvent = eventName(node, 'useDuration');
    if (waitEvent) increment(waitCounts, waitEvent);
    if (durationEvent) {
      increment(durationCounts, durationEvent);
      const declaration = node.parent;
      const declarationList = declaration.parent;
      const statement = declarationList.parent;
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer === node &&
        ts.isIdentifier(declaration.name) &&
        ts.isVariableDeclarationList(declarationList) &&
        ts.isVariableStatement(statement)
      ) {
        durationBindings.set(durationEvent, {
          name: declaration.name.text,
          statement,
        });
      }
    }

    if (
      ts.isExpressionStatement(node) &&
      ts.isYieldExpression(node.expression) &&
      node.expression.asteriskToken
    ) {
      const removableEvent = node.expression.expression
        ? eventName(node.expression.expression, 'waitUntil')
        : null;
      if (removableEvent && endEvents.has(removableEvent)) {
        const statements = removableEndWaits.get(removableEvent) ?? [];
        statements.push(node);
        removableEndWaits.set(removableEvent, statements);
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'key'
    ) {
      keySite += 1;
      const semanticKey = staticSemanticKey(node);
      if (
        semanticKey &&
        semanticKeyCounts.get(semanticKey) === 1
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      const prefix = `pad-sync-${keySite}-`;
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        sourceEdits.push({
          start: node.initializer.getStart(sourceFile),
          end: node.initializer.getEnd(),
          replacement: JSON.stringify(`${prefix}${node.initializer.text}`),
        });
      } else if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const expression = node.initializer.expression;
        const original = source.slice(
          expression.getStart(sourceFile),
          expression.getEnd(),
        );
        sourceEdits.push({
          start: expression.getStart(sourceFile),
          end: expression.getEnd(),
          replacement: `('${prefix}' + String(${original}))`,
        });
      } else {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_SOURCE_MISMATCH',
          'JSX key của scene nguồn không có giá trị hợp lệ.',
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  let needsCompatibilityTimingHelpers = false;
  const compatibilityEndNames: string[] = [];
  for (const [timingIndex, timingEvent] of timingEvents.entries()) {
    const endWaitCount = waitCounts.get(timingEvent.endEvent) ?? 0;
    const removable = removableEndWaits.get(timingEvent.endEvent) ?? [];
    const durationBinding = durationBindings.get(timingEvent.endEvent);
    if (
      (waitCounts.get(timingEvent.startEvent) ?? 0) !== 1 ||
      (durationCounts.get(timingEvent.startEvent) ?? 0) !== 0 ||
      (durationCounts.get(timingEvent.endEvent) ?? 0) !== 1 ||
      endWaitCount > 1 ||
      removable.length !== endWaitCount ||
      (endWaitCount === 1 && !durationBinding)
    ) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_SOURCE_MISMATCH',
        'Scene nguồn không giữ đúng waitUntil(start) và useDuration(end) duy nhất cho mỗi beat.',
      );
    }
    if (removable[0] && durationBinding) {
      needsCompatibilityTimingHelpers = true;
      const endTimeName = `padSyncBeatEnd${timingIndex + 1}`;
      compatibilityEndNames.push(endTimeName);
      const statementStart = durationBinding.statement.getStart(sourceFile);
      const lineStart = source.lastIndexOf('\n', statementStart - 1) + 1;
      const indentation =
        /^\s*/.exec(source.slice(lineStart, statementStart))?.[0] ?? '';
      sourceEdits.push({
        start: durationBinding.statement.getEnd(),
        end: durationBinding.statement.getEnd(),
        replacement:
          `\n${indentation}${endTimeName} = ` +
          `padSyncUseThread().time() + ${durationBinding.name};`,
      });
      sourceEdits.push({
        start: removable[0].getStart(sourceFile),
        end: removable[0].getEnd(),
        replacement:
          `yield* padSyncWaitFor(Math.max(0, ${endTimeName} - ` +
          'padSyncUseThread().time()));',
      });
    }
  }
  if (needsCompatibilityTimingHelpers) {
    const generatorBody = sceneBody as ts.Block | null;
    if (!generatorBody) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_SOURCE_MISMATCH',
        'Không tìm thấy generator scene để chuẩn hóa timing.',
      );
    }
    sourceEdits.push({
      start: 0,
      end: 0,
      replacement:
        "import {useThread as padSyncUseThread, waitFor as padSyncWaitFor} from '@motion-canvas/core';\n",
    });
    sourceEdits.push({
      start: generatorBody.getStart(sourceFile) + 1,
      end: generatorBody.getStart(sourceFile) + 1,
      replacement:
        '\n' +
        compatibilityEndNames
          .map((name) => `  let ${name} = 0;`)
          .join('\n'),
    });
  }

  return sourceEdits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (normalized, edit) =>
        normalized.slice(0, edit.start) +
        edit.replacement +
        normalized.slice(edit.end),
      source,
    );
}

function synchronizedSections(
  motionCanvasBundle: MotionCanvasBundle,
  voiceBundle: VoiceBundle,
): AnimationSyncBundle['sections'] {
  if (
    motionCanvasBundle.timingContractVersion !== 1 ||
    motionCanvasBundle.scenes.length !== voiceBundle.sections.length
  ) {
    throw new AnimationSyncWorkspaceError(
      'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED',
      'Scene Motion Canvas chưa có timing contract hiện hành. Hãy sinh lại scene trước khi đồng bộ.',
    );
  }

  return motionCanvasBundle.scenes.map((scene, sectionIndex) => {
    const voiceSection = voiceBundle.sections[sectionIndex];
    const timingEvents = scene.timingEvents;
    if (
      !voiceSection ||
      voiceSection.outlineSectionId !== scene.outlineSectionId ||
      !timingEvents ||
      timingEvents.length !== voiceSection.beats.length
    ) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_SOURCE_MISMATCH',
        'Scene và voice không còn bao phủ cùng danh sách section/beat.',
      );
    }

    const seenBeatIds = new Set<string>();
    const beats = timingEvents.map((event, beatIndex) => {
      const voiceBeat = voiceSection.beats[beatIndex];
      const previousVoiceBeat = voiceSection.beats[beatIndex - 1];
      const expectedStart = `beat:${event.beatId}:start`;
      const expectedEnd = `beat:${event.beatId}:end`;
      if (
        !voiceBeat ||
        voiceBeat.beatId !== event.beatId ||
        seenBeatIds.has(event.beatId) ||
        event.startEvent !== expectedStart ||
        event.endEvent !== expectedEnd ||
        voiceBeat.endSeconds <= voiceBeat.startSeconds ||
        voiceBeat.endSeconds > voiceSection.durationSeconds + 0.001 ||
        (previousVoiceBeat !== undefined &&
          voiceBeat.startSeconds < previousVoiceBeat.endSeconds - 0.001)
      ) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_SOURCE_MISMATCH',
          'Beat ID, time-event hoặc thứ tự timing của scene không khớp voice hiện tại.',
        );
      }
      seenBeatIds.add(event.beatId);

      return {
        beatId: event.beatId,
        startEvent: event.startEvent,
        endEvent: event.endEvent,
        plannedDurationSeconds: event.plannedDurationSeconds,
        voiceStartSeconds: voiceBeat.startSeconds,
        voiceEndSeconds: voiceBeat.endSeconds,
        synchronizedDurationSeconds:
          voiceBeat.endSeconds - voiceBeat.startSeconds,
      };
    });
    const finalBeat = voiceSection.beats.at(-1);
    if (
      !finalBeat ||
      Math.abs(finalBeat.endSeconds - voiceSection.durationSeconds) > 0.001
    ) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_SOURCE_MISMATCH',
        'Mốc kết thúc beat cuối không khớp thời lượng section voice.',
      );
    }
    const plannedDurationSeconds = timingEvents.reduce(
      (total, event) => total + event.plannedDurationSeconds,
      0,
    );

    return {
      outlineSectionId: scene.outlineSectionId,
      sceneId: scene.id,
      filePath: scene.filePath,
      plannedDurationSeconds,
      synchronizedDurationSeconds: voiceSection.durationSeconds,
      driftSeconds: voiceSection.durationSeconds - plannedDurationSeconds,
      beats,
    };
  });
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
  inputFile: string,
  voiceBundle: VoiceBundle,
  destination: string,
) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    ...rawInputArguments(
      voiceBundle.configuration.outputFormat,
      inputFile,
    ),
    '-i',
    inputFile,
    '-af',
    `atrim=duration=${voiceBundle.totalDurationSeconds.toFixed(6)},asetpts=PTS-STARTPTS,aresample=${OUTPUT_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=stereo`,
    '-vn',
    '-c:a',
    'pcm_s16le',
    '-ar',
    String(OUTPUT_SAMPLE_RATE),
    '-ac',
    '2',
    '-y',
    destination,
  ];
}

function wavDuration(buffer: Buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new AnimationSyncWorkspaceError(
      'ANIMATION_SYNC_AUDIO_INVALID',
      'Track narration sau khi ghép không phải WAV hợp lệ.',
    );
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 12) {
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    } else if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, buffer.length - chunkStart);
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataSize <= 0) {
    throw new AnimationSyncWorkspaceError(
      'ANIMATION_SYNC_AUDIO_INVALID',
      'Không đọc được thời lượng track narration đã ghép.',
    );
  }
  return dataSize / byteRate;
}

async function commitWorkspace(
  stagingDirectory: string,
  finalDirectory: string,
) {
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
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace đồng bộ.',
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
          throw new AnimationSyncWorkspaceError(
            'ANIMATION_SYNC_WORKSPACE_WRITE_FAILED',
            'Không thể hoàn tất workspace đồng bộ.',
            {cause: copyError},
          );
        }
      }
      if (!transientLock || attempt === 5) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_WRITE_FAILED',
          'Không thể hoàn tất workspace đồng bộ.',
          {cause: error},
        );
      }
      await delay(50 * 2 ** attempt);
    }
  }
}

export function createAnimationSyncWorkspace(
  projectsDirectory: string,
  options: {
    ffmpegPath?: string;
    typescriptPath?: string;
  } = {},
): AnimationSyncWorkspace {
  const resolvedProjectsDirectory = path.resolve(projectsDirectory);
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const ffmpegPath =
    (options.ffmpegPath ?? process.env.FFMPEG_PATH ?? '').trim() ||
    'ffmpeg';
  const typescriptPath =
    options.typescriptPath ??
    path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const motionCanvas2dConfig = path.join(
    repositoryRoot,
    'node_modules',
    '@motion-canvas',
    '2d',
    'tsconfig.project.json',
  );
  const motionCanvasPackagesPattern = path.join(
    repositoryRoot,
    'node_modules',
    '@motion-canvas',
    '*',
  );

  function projectDirectory(projectId: string) {
    assertProjectId(projectId);
    return path.join(resolvedProjectsDirectory, projectId);
  }

  function resolveInsideProject(
    projectId: string,
    relativePath: string,
    label: string,
  ) {
    const root = projectDirectory(projectId);
    const resolved = path.resolve(root, relativePath);
    if (!isInside(root, resolved)) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_WORKSPACE_INVALID',
        `${label} nằm ngoài project.`,
      );
    }
    return resolved;
  }

  function resolveSyncDirectory(
    projectId: string,
    bundle: AnimationSyncBundle,
  ) {
    return resolveInsideProject(
      projectId,
      bundle.workspacePath,
      'Workspace đồng bộ',
    );
  }

  async function readWorkspaceFile(directory: string, relativePath: string) {
    const filePath = path.resolve(directory, relativePath);
    if (!isInside(directory, filePath)) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_WORKSPACE_INVALID',
        'Đường dẫn file workspace đồng bộ không hợp lệ.',
      );
    }
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      throw new AnimationSyncWorkspaceError(
        'ANIMATION_SYNC_WORKSPACE_READ_FAILED',
        `Không thể đọc file đồng bộ “${relativePath}”.`,
        {cause: error},
      );
    }
  }

  return {
    async prepare(
      projectId,
      generationId,
      motionCanvasBundle,
      voiceBundle,
    ) {
      assertProjectId(projectId);
      if (!uuidPattern.test(generationId)) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_INVALID',
          'Generation ID của workspace đồng bộ không hợp lệ.',
        );
      }

      const sections = synchronizedSections(
        motionCanvasBundle,
        voiceBundle,
      );
      const root = projectDirectory(projectId);
      const motionDirectory = resolveInsideProject(
        projectId,
        motionCanvasBundle.workspacePath,
        'Workspace Motion Canvas',
      );
      const voiceDirectory = resolveInsideProject(
        projectId,
        voiceBundle.workspacePath,
        'Workspace voice',
      );
      const generationsDirectory = path.join(root, 'sync', 'generations');
      const finalDirectory = path.join(generationsDirectory, generationId);
      const stagingDirectory = path.join(
        generationsDirectory,
        `.staging-${randomUUID()}`,
      );
      const workspacePath = `sync/generations/${generationId}` as const;

      await mkdir(generationsDirectory, {recursive: true});
      if (
        await stat(finalDirectory)
          .then((entry) => entry.isDirectory())
          .catch(() => false)
      ) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_CONFLICT',
          'Generation ID này đã có workspace đồng bộ.',
        );
      }

      const sceneSources = await Promise.all(
        motionCanvasBundle.scenes.map(async (scene) => {
          const sourceFile = path.resolve(motionDirectory, scene.filePath);
          if (!isInside(motionDirectory, sourceFile)) {
            throw new AnimationSyncWorkspaceError(
              'ANIMATION_SYNC_WORKSPACE_INVALID',
              'Đường dẫn scene nguồn không hợp lệ.',
            );
          }
          try {
            const source = await readFile(sourceFile, 'utf8');
            return normalizeSceneTimingSource(
              source,
              scene.timingEvents ?? [],
            );
          } catch (error) {
            if (error instanceof AnimationSyncWorkspaceError) throw error;
            throw new AnimationSyncWorkspaceError(
              'ANIMATION_SYNC_WORKSPACE_READ_FAILED',
              `Không thể đọc scene nguồn “${scene.filePath}”.`,
              {cause: error},
            );
          }
        }),
      );
      const audioInput = path.resolve(
        voiceDirectory,
        voiceBundle.track.audioPath,
      );
      if (!isInside(voiceDirectory, audioInput)) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_INVALID',
          'Đường dẫn master narration không hợp lệ.',
        );
      }

      const storedMotionCanvas2dConfig = portableConfigPath(
        finalDirectory,
        motionCanvas2dConfig,
      );
      const storedMotionCanvasPackagesPattern = portableConfigPath(
        finalDirectory,
        motionCanvasPackagesPattern,
      );
      const textFiles: WorkspaceFile[] = [
        {
          path: PROJECT_FILE,
          source: projectSource(motionCanvasBundle.scenes),
        },
        {
          path: 'src/project.meta',
          source: projectMetaSource(motionCanvasBundle),
        },
        {
          path: 'src/motion-canvas.d.ts',
          source: declarationSource(),
        },
        {
          path: 'tsconfig.json',
          source: tsconfigSource(
            storedMotionCanvas2dConfig,
            storedMotionCanvasPackagesPattern,
          ),
        },
        ...motionCanvasBundle.scenes.flatMap((scene, index) => [
          {
            path: scene.filePath,
            source: sceneSources[index]!,
          },
          {
            path: scene.filePath.replace(/\.tsx$/, '.meta'),
            source: sceneMetaSource(
              scene.id,
              sections[index]!.beats,
            ),
          },
        ]),
      ];

      try {
        for (const file of textFiles) {
          const destination = path.resolve(stagingDirectory, file.path);
          if (!isInside(stagingDirectory, destination)) {
            throw new AnimationSyncWorkspaceError(
              'ANIMATION_SYNC_WORKSPACE_INVALID',
              'Đường dẫn file đồng bộ nằm ngoài workspace.',
            );
          }
          await mkdir(path.dirname(destination), {recursive: true});
          await writeFile(destination, file.source);
        }

        const audioDestination = path.resolve(stagingDirectory, AUDIO_FILE);
        await mkdir(path.dirname(audioDestination), {recursive: true});
        try {
          await execFileAsync(
            ffmpegPath,
            ffmpegArguments(
              audioInput,
              voiceBundle,
              audioDestination,
            ),
            {
              cwd: repositoryRoot,
              windowsHide: true,
              timeout: Math.min(
                2 * 60 * 60_000,
                Math.max(120_000, voiceBundle.totalDurationSeconds * 500),
              ),
              maxBuffer: 2 * 1024 * 1024,
            },
          );
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : '';
          throw new AnimationSyncWorkspaceError(
            code === 'ENOENT'
              ? 'FFMPEG_NOT_AVAILABLE'
              : 'ANIMATION_SYNC_AUDIO_MERGE_FAILED',
            code === 'ENOENT'
              ? 'Không tìm thấy FFmpeg. Hãy cài FFmpeg hoặc cấu hình FFMPEG_PATH.'
              : 'Không thể chuẩn hóa master narration cho workspace đồng bộ.',
            {cause: error},
          );
        }

        try {
          await execFileAsync(
            process.execPath,
            [
              typescriptPath,
              '--project',
              path.join(stagingDirectory, 'tsconfig.json'),
            ],
            {
              cwd: repositoryRoot,
              windowsHide: true,
              timeout: Math.min(
                10 * 60_000,
                60_000 + motionCanvasBundle.scenes.length * 15_000,
              ),
              maxBuffer: 1024 * 1024,
            },
          );
        } catch (error) {
          const details =
            error && typeof error === 'object' && 'stdout' in error
              ? String(error.stdout).trim().slice(0, 2_000)
              : '';
          throw new AnimationSyncWorkspaceError(
            'ANIMATION_SYNC_VALIDATION_FAILED',
            details
              ? `Workspace đồng bộ chưa biên dịch được: ${details}`
              : 'Workspace đồng bộ chưa biên dịch được.',
            {cause: error},
          );
        }

        const audio = await readFile(audioDestination);
        const audioDurationSeconds = wavDuration(audio);
        const totalDurationSeconds = voiceBundle.totalDurationSeconds;
        if (
          Math.abs(audioDurationSeconds - totalDurationSeconds) >
          Math.max(0.05, 1 / motionCanvasBundle.fps)
        ) {
          throw new AnimationSyncWorkspaceError(
            'ANIMATION_SYNC_AUDIO_DURATION_MISMATCH',
            'Thời lượng track narration không khớp tổng timing voice.',
          );
        }

        const allFiles = [
          ...textFiles,
          {path: AUDIO_FILE, source: audio},
        ];
        const hash = sourceHash(allFiles);
        await writeFile(
          path.join(stagingDirectory, 'pad-studio.manifest.json'),
          `${JSON.stringify(
            {
              version: 2,
              generationId,
              motionCanvasVersion: MOTION_CANVAS_VERSION,
              sourceHash: hash,
              audioDurationSeconds,
              sourceMotionCanvasGenerationId:
                motionCanvasBundle.generation.generationId,
              sourceVoiceGenerationId:
                voiceBundle.generation.generationId,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        await commitWorkspace(stagingDirectory, finalDirectory);

        return {
          workspacePath,
          projectFile: PROJECT_FILE,
          audioFile: AUDIO_FILE,
          totalDurationSeconds,
          sections,
          validation: {
            validatedAt: new Date().toISOString(),
            sourceHash: hash,
            motionCanvasVersion: MOTION_CANVAS_VERSION,
            audioDurationSeconds,
          },
        };
      } finally {
        await rm(stagingDirectory, {recursive: true, force: true}).catch(
          () => undefined,
        );
      }
    },

    async readFiles(projectId, bundle) {
      const directory = resolveSyncDirectory(projectId, bundle);
      const paths = [
        bundle.projectFile,
        ...bundle.sections.map((section) => section.filePath),
      ];
      return Promise.all(
        paths.map(async (filePath) => ({
          path: filePath,
          source: await readWorkspaceFile(directory, filePath),
        })),
      );
    },

    async readAudio(projectId, bundle) {
      const directory = resolveSyncDirectory(projectId, bundle);
      const audioPath = path.resolve(directory, bundle.audioFile);
      if (!isInside(directory, audioPath)) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_WORKSPACE_INVALID',
          'Đường dẫn narration nằm ngoài workspace đồng bộ.',
        );
      }
      try {
        return await readFile(audioPath);
      } catch (error) {
        throw new AnimationSyncWorkspaceError(
          'ANIMATION_SYNC_AUDIO_READ_FAILED',
          'Không thể đọc track narration đã đồng bộ.',
          {cause: error},
        );
      }
    },
  };
}
