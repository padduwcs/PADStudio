import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createWatermarkAssetStore,
  WatermarkAssetError,
} from './watermarkAssetStore.ts';

test('watermark asset được lưu theo hash và chỉ nhận định dạng ảnh hỗ trợ', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pad-watermark-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const store = createWatermarkAssetStore(root);
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.alloc(32, 7),
  ]);

  const first = await store.save('project-one', png);
  const repeated = await store.save('project-one', png);
  assert.deepEqual(repeated, first);
  assert.equal(first.contentType, 'image/png');
  assert.deepEqual((await store.read('project-one', first.assetId)).value, png);

  await assert.rejects(
    () => store.save('project-one', Buffer.from('not-an-image')),
    (error: unknown) =>
      error instanceof WatermarkAssetError &&
      error.code === 'WATERMARK_ASSET_UNSUPPORTED',
  );
});
