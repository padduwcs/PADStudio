import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(repositoryRoot, 'src');

async function discover(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return discover(target);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [target] : [];
  }));
  return files.flat();
}

export async function discoverTests() {
  return (await discover(sourceDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
}

const tests = await discoverTests();
if (process.argv.includes('--list')) {
  for (const test of tests) console.log(path.relative(repositoryRoot, test));
  process.exit(0);
}

const child = spawn(process.execPath, ['--test', ...tests], {stdio: 'inherit'});
child.once('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
