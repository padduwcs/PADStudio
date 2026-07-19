import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PreviewWorkspaceCopyError,
  copyPreviewWorkspace,
} from './previewWorkspaceCopy.ts';

async function temporaryDirectory(context: test.TestContext) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'pad-preview-workspace-copy-'),
  );
  context.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

async function pathExists(value: string) {
  return lstat(value)
    .then(() => true)
    .catch((error) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false;
      }
      throw error;
    });
}

test('copyPreviewWorkspace sao chép đệ quy chính xác và không sửa nguồn', async (context) => {
  const root = await temporaryDirectory(context);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'preview');
  const binary = Buffer.from([0, 1, 2, 127, 128, 255]);
  await mkdir(path.join(source, 'src', 'scenes'), {recursive: true});
  await Promise.all([
    writeFile(path.join(source, '.hidden'), 'metadata\n', 'utf8'),
    writeFile(
      path.join(source, 'src', 'project.ts'),
      'export default {};\n',
      'utf8',
    ),
    writeFile(path.join(source, 'src', 'scenes', '01.tsx'), binary),
  ]);

  await copyPreviewWorkspace(source, destination);

  assert.equal(
    await readFile(path.join(destination, '.hidden'), 'utf8'),
    'metadata\n',
  );
  assert.equal(
    await readFile(path.join(destination, 'src', 'project.ts'), 'utf8'),
    'export default {};\n',
  );
  assert.deepEqual(
    await readFile(path.join(destination, 'src', 'scenes', '01.tsx')),
    binary,
  );
  await writeFile(
    path.join(destination, 'src', 'project.ts'),
    'preview mutation\n',
    'utf8',
  );
  assert.equal(
    await readFile(path.join(source, 'src', 'project.ts'), 'utf8'),
    'export default {};\n',
  );
});

test('copyPreviewWorkspace rebase đường dẫn tsconfig khi preview đổi độ sâu thư mục', async (context) => {
  const root = await temporaryDirectory(context);
  const source = path.join(
    root,
    'projects',
    'project-1',
    'sync',
    'generations',
    'generation-1',
  );
  const destination = path.join(
    root,
    'cache',
    'preview',
    'workspace',
  );
  const motionCanvasConfig = path.join(
    root,
    'repository',
    'node_modules',
    '@motion-canvas',
    '2d',
    'tsconfig.project.json',
  );
  const motionCanvasPackages = path.join(
    root,
    'repository',
    'node_modules',
    '@motion-canvas',
    '*',
  );
  const sourceConfig = {
    extends: path.relative(source, motionCanvasConfig),
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@motion-canvas/*': [
          path.relative(source, motionCanvasPackages),
        ],
        'package-alias': ['some-package'],
      },
    },
    include: ['src'],
  };
  await mkdir(path.join(source, 'src'), {recursive: true});
  await mkdir(path.dirname(destination), {recursive: true});
  await writeFile(
    path.join(source, 'tsconfig.json'),
    `${JSON.stringify(sourceConfig, null, 2)}\n`,
    'utf8',
  );

  await copyPreviewWorkspace(source, destination);

  const previewConfig = JSON.parse(
    await readFile(path.join(destination, 'tsconfig.json'), 'utf8'),
  ) as {
    extends: string;
    compilerOptions: {paths: Record<string, string[]>};
  };
  assert.equal(
    previewConfig.extends,
    motionCanvasConfig.replaceAll(path.sep, '/'),
  );
  assert.deepEqual(
    previewConfig.compilerOptions.paths['@motion-canvas/*'],
    [motionCanvasPackages.replaceAll(path.sep, '/')],
  );
  assert.deepEqual(
    previewConfig.compilerOptions.paths['package-alias'],
    ['some-package'],
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(source, 'tsconfig.json'), 'utf8')),
    sourceConfig,
    'Bản preview không được sửa tsconfig của workspace nguồn.',
  );
});

test('copyPreviewWorkspace từ chối destination có sẵn và giữ nguyên dữ liệu', async (context) => {
  const root = await temporaryDirectory(context);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'preview');
  await Promise.all([
    mkdir(source),
    mkdir(destination),
  ]);
  await writeFile(path.join(destination, 'owner.txt'), 'keep', 'utf8');

  await assert.rejects(
    copyPreviewWorkspace(source, destination),
    (error: unknown) =>
      error instanceof PreviewWorkspaceCopyError &&
      error.code === 'PREVIEW_WORKSPACE_COPY_DESTINATION_EXISTS',
  );
  assert.equal(
    await readFile(path.join(destination, 'owner.txt'), 'utf8'),
    'keep',
  );
});

test('copyPreviewWorkspace từ chối source và destination chồng lấn', async (context) => {
  const root = await temporaryDirectory(context);
  const source = path.join(root, 'source');
  await mkdir(source);

  for (const destination of [
    source,
    path.join(source, 'preview'),
    root,
  ]) {
    await assert.rejects(
      copyPreviewWorkspace(source, destination),
      (error: unknown) =>
        error instanceof PreviewWorkspaceCopyError &&
        error.code === 'PREVIEW_WORKSPACE_COPY_INVALID',
    );
  }
  assert.equal(await pathExists(path.join(source, 'preview')), false);
});

test('copyPreviewWorkspace từ chối symbolic link và cleanup destination', async (context) => {
  const root = await temporaryDirectory(context);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'preview');
  const external = path.join(root, 'external.txt');
  const externalDirectory = path.join(root, 'external-directory');
  await mkdir(source);
  await mkdir(externalDirectory);
  await writeFile(external, 'external', 'utf8');
  try {
    await symlink(external, path.join(source, 'linked.txt'), 'file');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      try {
        await symlink(
          externalDirectory,
          path.join(source, 'linked-directory'),
          'junction',
        );
      } catch (junctionError) {
        if (
          junctionError &&
          typeof junctionError === 'object' &&
          'code' in junctionError &&
          (junctionError.code === 'EPERM' ||
            junctionError.code === 'EACCES')
        ) {
          context.skip(
            'Môi trường hiện tại không cho phép tạo symbolic link.',
          );
          return;
        }
        throw junctionError;
      }
    } else {
      throw error;
    }
  }

  await assert.rejects(
    copyPreviewWorkspace(source, destination),
    (error: unknown) =>
      error instanceof PreviewWorkspaceCopyError &&
      error.code === 'PREVIEW_WORKSPACE_COPY_UNSAFE_ENTRY',
  );
  assert.equal(await pathExists(destination), false);
  assert.equal(await readFile(external, 'utf8'), 'external');
});
