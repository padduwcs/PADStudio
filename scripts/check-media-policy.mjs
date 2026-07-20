import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: rootDirectory,
    encoding,
    windowsHide: true,
  });
}

function trackedAudioPaths() {
  return git(
    ['ls-files', '-z', '--', '*.wav', '*.mp3', '*.pcm', '*.opus'],
    'buffer',
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replaceAll('\\', '/'));
}

function attributesFor(filePath) {
  const fields = git(
    [
      'check-attr',
      '-z',
      'filter',
      'diff',
      'merge',
      'text',
      '--',
      filePath,
    ],
    'buffer',
  )
    .toString('utf8')
    .split('\0');
  const attributes = new Map();

  for (let index = 0; index + 2 < fields.length; index += 3) {
    attributes.set(fields[index + 1], fields[index + 2]);
  }

  return attributes;
}

function indexBlobId(filePath) {
  const indexEntry = git(['ls-files', '-s', '--', filePath]).trim();
  const match = /^\d+\s+([0-9a-f]+)\s+0\t/u.exec(indexEntry);

  if (!match) {
    throw new Error(`Không đọc được index blob của ${filePath}.`);
  }

  return match[1];
}

function indexBlobIsLfsPointer(filePath) {
  const blobId = indexBlobId(filePath);
  const blobSize = Number.parseInt(
    git(['cat-file', '-s', blobId]).trim(),
    10,
  );

  if (!Number.isSafeInteger(blobSize) || blobSize > 1_024) return false;

  const content = git(['cat-file', 'blob', blobId], 'buffer')
    .toString('utf8')
    .replaceAll('\r\n', '\n');

  return /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n?$/u.test(
    content,
  );
}

function hasExpectedLfsAttributes(filePath, errors) {
  const attributes = attributesFor(filePath);
  const expected = new Map([
    ['filter', 'lfs'],
    ['diff', 'lfs'],
    ['merge', 'lfs'],
    ['text', 'unset'],
  ]);

  for (const [name, value] of expected) {
    if (attributes.get(name) !== value) {
      errors.push(
        `${filePath}: attribute ${name} phải là "${value}", ` +
          `hiện là "${attributes.get(name) ?? 'missing'}".`,
      );
    }
  }
}

const errors = [];
const trackedPaths = trackedAudioPaths();
let lfsPointerCount = 0;

for (const filePath of trackedPaths) {
  hasExpectedLfsAttributes(filePath, errors);
  if (!indexBlobIsLfsPointer(filePath)) {
    errors.push(
      `${filePath}: audio mới phải được stage bằng Git LFS pointer.`,
    );
  } else {
    lfsPointerCount += 1;
  }
}

const trackedProjectPaths = git(
  ['ls-files', '-z', '--', 'projects'],
  'buffer',
)
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

if (trackedProjectPaths.length > 0) {
  errors.push(
    `projects/: có ${trackedProjectPaths.length} artifact runtime đang được Git ` +
      'quản lý; hãy bỏ chúng khỏi index nhưng giữ nguyên file local.',
  );
}

for (const sentinel of [
  '__media-policy__/narration.wav',
  '__media-policy__/audio.mp3',
  '__media-policy__/audio.pcm',
  '__media-policy__/audio.opus',
]) {
  hasExpectedLfsAttributes(sentinel, errors);
}

if (errors.length > 0) {
  console.error('Media policy không hợp lệ:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.info(
    `Media policy: OK (${lfsPointerCount} tracked Git LFS audio, ` +
      'projects/ is local runtime data).',
  );
}
