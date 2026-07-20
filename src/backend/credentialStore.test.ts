import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createProtectedFileCredentialStore,
  createWindowsDpapiProtector,
} from './credentialStore.ts';

test('credential store chỉ ghi ciphertext và hỗ trợ thay/xóa key', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pad-credentials-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'credentials.json');
  const store = createProtectedFileCredentialStore(file, {
    async protect(value) {
      return Buffer.from(`protected:${value}`).toString('base64');
    },
    async unprotect(value) {
      return Buffer.from(value, 'base64').toString('utf8').slice(10);
    },
  });

  await store.set('elevenlabs', 'secret-one');
  assert.equal(await store.get('elevenlabs'), 'secret-one');
  assert.doesNotMatch(await readFile(file, 'utf8'), /secret-one/);

  await store.set('elevenlabs', 'secret-two');
  assert.equal(await store.get('elevenlabs'), 'secret-two');
  await store.delete('elevenlabs');
  assert.equal(await store.get('elevenlabs'), null);
});

test(
  'Windows DPAPI bảo vệ và giải mã credential bằng tài khoản hiện tại',
  {skip: process.platform !== 'win32'},
  async () => {
    const protector = createWindowsDpapiProtector();
    const secret = `pad-dpapi-test-${randomUUID()}`;
    const encrypted = await protector.protect(secret);

    assert.notEqual(encrypted, secret);
    assert.equal(await protector.unprotect(encrypted), secret);
  },
);
