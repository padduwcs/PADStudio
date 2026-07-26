import {constants} from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {normalizeMotionCanvasColorFormats} from './motionCanvasSourceCompatibility.ts';

export interface PreviewWorkspaceCopyOptions {
  motionCanvasScenePaths?: readonly string[];
}

export class PreviewWorkspaceCopyError extends Error {
  readonly code:
    | 'PREVIEW_WORKSPACE_COPY_INVALID'
    | 'PREVIEW_WORKSPACE_COPY_SOURCE_INVALID'
    | 'PREVIEW_WORKSPACE_COPY_DESTINATION_EXISTS'
    | 'PREVIEW_WORKSPACE_COPY_UNSAFE_ENTRY'
    | 'PREVIEW_WORKSPACE_COPY_FAILED';

  constructor(
    code: PreviewWorkspaceCopyError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}

function normalizedPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function isInside(root: string, candidate: string) {
  const normalizedRoot = normalizedPath(root);
  const normalizedCandidate = normalizedPath(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function pathsOverlap(left: string, right: string) {
  return isInside(left, right) || isInside(right, left);
}

async function requireNewDestination(destinationDirectory: string) {
  try {
    await lstat(destinationDirectory);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_FAILED',
      'Không thể kiểm tra thư mục preview đích.',
      {cause: error},
    );
  }
  throw new PreviewWorkspaceCopyError(
    'PREVIEW_WORKSPACE_COPY_DESTINATION_EXISTS',
    'Thư mục preview đích đã tồn tại.',
  );
}

async function copyDirectory(
  sourceRoot: string,
  destinationRoot: string,
  relativeDirectory: string,
): Promise<void> {
  const sourceDirectory = path.resolve(sourceRoot, relativeDirectory);
  const destinationDirectory = path.resolve(
    destinationRoot,
    relativeDirectory,
  );
  if (
    !isInside(sourceRoot, sourceDirectory) ||
    !isInside(destinationRoot, destinationDirectory)
  ) {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_INVALID',
      'Đường dẫn workspace preview thoát khỏi thư mục cho phép.',
    );
  }

  const directory = await opendir(sourceDirectory);
  for await (const entry of directory) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.resolve(sourceRoot, relativePath);
    const destinationPath = path.resolve(destinationRoot, relativePath);
    if (
      !isInside(sourceRoot, sourcePath) ||
      !isInside(destinationRoot, destinationPath)
    ) {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_INVALID',
        'Một file preview thoát khỏi workspace cho phép.',
      );
    }

    const sourceEntry = await lstat(sourcePath);
    if (sourceEntry.isSymbolicLink()) {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_UNSAFE_ENTRY',
        `Workspace preview không chấp nhận symbolic link “${relativePath}”.`,
      );
    }
    if (sourceEntry.isDirectory()) {
      await mkdir(destinationPath);
      await copyDirectory(sourceRoot, destinationRoot, relativePath);
      continue;
    }
    if (sourceEntry.isFile()) {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      continue;
    }
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_UNSAFE_ENTRY',
      `Workspace preview không chấp nhận entry đặc biệt “${relativePath}”.`,
    );
  }
}

function isPathReference(value: string) {
  return (
    path.isAbsolute(value) ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('.\\') ||
    value.startsWith('..\\')
  );
}

function absoluteConfigPath(baseDirectory: string, value: string) {
  const absolutePath = path.isAbsolute(value)
    ? value
    : path.resolve(baseDirectory, value);
  return absolutePath.replaceAll(path.sep, '/');
}

async function rebaseTypeScriptConfig(
  sourceDirectory: string,
  destinationDirectory: string,
) {
  const destinationConfig = path.join(
    destinationDirectory,
    'tsconfig.json',
  );
  let source: string;
  try {
    source = await readFile(destinationConfig, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }

  const config = JSON.parse(source) as {
    extends?: unknown;
    compilerOptions?: {
      baseUrl?: unknown;
      paths?: unknown;
    };
  };
  let changed = false;
  if (
    typeof config.extends === 'string' &&
    isPathReference(config.extends)
  ) {
    config.extends = absoluteConfigPath(
      sourceDirectory,
      config.extends,
    );
    changed = true;
  }

  const compilerOptions = config.compilerOptions;
  const paths = compilerOptions?.paths;
  if (
    paths &&
    typeof paths === 'object' &&
    !Array.isArray(paths)
  ) {
    const baseUrl =
      typeof compilerOptions.baseUrl === 'string'
        ? compilerOptions.baseUrl
        : '.';
    const sourceBaseDirectory = path.isAbsolute(baseUrl)
      ? baseUrl
      : path.resolve(sourceDirectory, baseUrl);
    for (const [alias, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue;
      const rebasedTargets = targets.map((target) =>
        typeof target === 'string' && isPathReference(target)
          ? absoluteConfigPath(sourceBaseDirectory, target)
          : target,
      );
      if (
        rebasedTargets.some(
          (target, index) => target !== targets[index],
        )
      ) {
        (paths as Record<string, unknown>)[alias] = rebasedTargets;
        changed = true;
      }
    }
  }

  if (changed) {
    await writeFile(
      destinationConfig,
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    );
  }
}

async function normalizeMotionCanvasScenes(
  destinationDirectory: string,
  scenePaths: readonly string[],
) {
  for (const relativePath of new Set(scenePaths)) {
    const scenePath = path.resolve(destinationDirectory, relativePath);
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      !isInside(destinationDirectory, scenePath) ||
      normalizedPath(scenePath) === normalizedPath(destinationDirectory)
    ) {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_INVALID',
        'Đường dẫn scene cần nâng tương thích không hợp lệ.',
      );
    }
    const entry = await lstat(scenePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_UNSAFE_ENTRY',
        `Scene preview “${relativePath}” không phải file an toàn.`,
      );
    }
    const source = await readFile(scenePath, 'utf8');
    const normalized = normalizeMotionCanvasColorFormats(source);
    if (normalized !== source) {
      await writeFile(scenePath, normalized, 'utf8');
    }
  }
}

export async function copyPreviewWorkspace(
  sourceDirectory: string,
  destinationDirectory: string,
  options: PreviewWorkspaceCopyOptions = {},
): Promise<void> {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(destinationDirectory);
  if (pathsOverlap(source, destination)) {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_INVALID',
      'Workspace nguồn và thư mục preview đích không được trùng hoặc lồng nhau.',
    );
  }

  const sourceEntry = await lstat(source).catch((error) => {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_SOURCE_INVALID',
      'Không thể truy cập workspace nguồn.',
      {cause: error},
    );
  });
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_SOURCE_INVALID',
      'Workspace nguồn phải là thư mục thật.',
    );
  }

  const destinationParent = path.dirname(destination);
  const destinationParentEntry = await lstat(destinationParent).catch(
    (error) => {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_INVALID',
        'Thư mục cha của preview đích không tồn tại.',
        {cause: error},
      );
    },
  );
  if (
    !destinationParentEntry.isDirectory() ||
    destinationParentEntry.isSymbolicLink()
  ) {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_INVALID',
      'Thư mục cha của preview đích phải là thư mục thật.',
    );
  }

  const [realSource, realDestinationParent] = await Promise.all([
    realpath(source),
    realpath(destinationParent),
  ]);
  const realDestination = path.join(
    realDestinationParent,
    path.basename(destination),
  );
  if (
    normalizedPath(realSource) !== normalizedPath(source) ||
    pathsOverlap(realSource, realDestination)
  ) {
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_INVALID',
      'Đường dẫn workspace preview đi qua symbolic link hoặc bị chồng lấn.',
    );
  }

  await requireNewDestination(destination);
  let destinationCreated = false;
  try {
    await mkdir(destination);
    destinationCreated = true;
    await copyDirectory(source, destination, '');
    await rebaseTypeScriptConfig(source, destination);
    await normalizeMotionCanvasScenes(
      destination,
      options.motionCanvasScenePaths ?? [],
    );
  } catch (error) {
    if (destinationCreated) {
      await rm(destination, {recursive: true, force: true}).catch(
        () => undefined,
      );
    }
    if (error instanceof PreviewWorkspaceCopyError) throw error;
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
    ) {
      throw new PreviewWorkspaceCopyError(
        'PREVIEW_WORKSPACE_COPY_DESTINATION_EXISTS',
        'Thư mục preview đích đã tồn tại.',
        {cause: error},
      );
    }
    throw new PreviewWorkspaceCopyError(
      'PREVIEW_WORKSPACE_COPY_FAILED',
      'Không thể tạo bản sao workspace cho preview.',
      {cause: error},
    );
  }
}
