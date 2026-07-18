import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const legacyAudioBlobs = new Map([
  [
    'projects/bo-nho-dem-lru-hoat-dong-nhu-the-nao-20260718-8575297b/sync/generations/a40006e2-ca08-4ee9-ba28-0a926ded28d6/audio/narration.wav',
    'c60ff29babe0afbeef34d09de2caaef5a9f5fffa',
  ],
  [
    'projects/bo-nho-dem-lru-hoat-dong-nhu-the-nao-20260718-8575297b/voice/generations/a0f4c878-da39-4e87-a324-265c1d6b45db/audio/narration.wav',
    'c60ff29babe0afbeef34d09de2caaef5a9f5fffa',
  ],
  [
    'projects/bo-nho-dem-lru-hoat-dong-nhu-the-nao-20260718-8575297b/voice/generations/a0f4c878-da39-4e87-a324-265c1d6b45db/chunks/audio/01.mp3',
    'bf6753750c3cf7a46a7fe95e974f9838c6470f1c',
  ],
  [
    'projects/de-quy-20260718-88b2276f/sync/generations/ac342c74-c1ae-4ce8-8ede-5da39cca3084/audio/narration.wav',
    '75f8320bd51e348b9b930d760e4a746cf84ce8b2',
  ],
  [
    'projects/de-quy-20260718-88b2276f/sync/generations/c8fa3d3f-5e30-4ea2-81e7-07c0407e146e/audio/narration.wav',
    '75f8320bd51e348b9b930d760e4a746cf84ce8b2',
  ],
  [
    'projects/de-quy-20260718-88b2276f/voice/generations/83babbb8-0a86-434f-aa81-7d8447640fc9/audio/01-66f5a6b2-2047-4966-b846-21fc276101b9.mp3',
    '340ccca6d03addac7f026835f7828270ae9a7029',
  ],
  [
    'projects/de-quy-20260718-88b2276f/voice/generations/83babbb8-0a86-434f-aa81-7d8447640fc9/audio/02-7f3f1c64-ac1b-41b1-aad4-efa01bc68400.mp3',
    '70e1330ed5227d41a12586200dfa54ee76a9aac7',
  ],
  [
    'projects/de-quy-20260718-88b2276f/voice/generations/83babbb8-0a86-434f-aa81-7d8447640fc9/audio/03-803fea6e-8021-4767-895c-7bc3ba621824.mp3',
    '6ff725b7a802fb37be35900f4038a2816ac1f5bc',
  ],
  [
    'projects/de-quy-20260718-88b2276f/voice/generations/83babbb8-0a86-434f-aa81-7d8447640fc9/audio/04-0848969e-51df-4563-bae9-e76349342003.mp3',
    '9ef5549340fccd45b6c1f762d91cb2d359675355',
  ],
  [
    'projects/de-quy-20260718-88b2276f/voice/generations/83babbb8-0a86-434f-aa81-7d8447640fc9/audio/05-a2d66544-ccb4-478b-aaad-b15a337e9c7b.mp3',
    '5f71c1e944c91a3bf2a9c7a3fa90e97ced28be6c',
  ],
]);

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
const trackedPathSet = new Set(trackedPaths);
let lfsPointerCount = 0;

for (const filePath of trackedPaths) {
  const isPointer = indexBlobIsLfsPointer(filePath);

  const legacyBlobId = legacyAudioBlobs.get(filePath);
  if (legacyBlobId) {
    const attributes = attributesFor(filePath);
    if (isPointer) {
      errors.push(
        `${filePath}: đã là LFS pointer nhưng vẫn nằm trong danh sách legacy.`,
      );
    }
    const currentBlobId = indexBlobId(filePath);
    if (currentBlobId !== legacyBlobId) {
      errors.push(
        `${filePath}: nội dung legacy đã thay đổi; audio thay thế phải dùng LFS.`,
      );
    }
    for (const name of ['filter', 'diff', 'merge', 'text']) {
      if (attributes.get(name) !== 'unset') {
        errors.push(
          `${filePath}: legacy exception phải unset attribute ${name}.`,
        );
      }
    }
    continue;
  }

  hasExpectedLfsAttributes(filePath, errors);
  if (!isPointer) {
    errors.push(
      `${filePath}: audio mới phải được stage bằng Git LFS pointer.`,
    );
  } else {
    lfsPointerCount += 1;
  }
}

for (const legacyPath of legacyAudioBlobs.keys()) {
  if (!trackedPathSet.has(legacyPath)) {
    errors.push(
      `${legacyPath}: legacy exception không còn file tương ứng; ` +
        'hãy xóa exception khỏi .gitattributes và policy script.',
    );
  }
}

for (const sentinel of [
  'projects/__media-policy__/voice/generations/new/audio/narration.wav',
  'projects/__media-policy__/voice/generations/new/chunks/audio/01.mp3',
  'projects/__media-policy__/voice/generations/new/chunks/audio/01.pcm',
  'projects/__media-policy__/voice/generations/new/chunks/audio/01.opus',
]) {
  hasExpectedLfsAttributes(sentinel, errors);
}

if (errors.length > 0) {
  console.error('Media policy không hợp lệ:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.info(
    `Media policy: OK (${legacyAudioBlobs.size} legacy, ` +
      `${lfsPointerCount} Git LFS).`,
  );
}
