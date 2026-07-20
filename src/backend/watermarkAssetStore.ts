import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {WatermarkAssetSummary} from '../shared/render.ts';

const extensions = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

export class WatermarkAssetError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function assertProjectId(projectId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
    throw new WatermarkAssetError(
      'WATERMARK_ASSET_INVALID',
      'Project ID của watermark không hợp lệ.',
    );
  }
}

function detectContentType(value: Buffer): keyof typeof extensions | null {
  if (
    value.length >= 8 &&
    value.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  ) return 'image/png';
  if (
    value.length >= 3 &&
    value[0] === 0xff &&
    value[1] === 0xd8 &&
    value[2] === 0xff
  ) return 'image/jpeg';
  if (
    value.length >= 12 &&
    value.subarray(0, 4).toString('ascii') === 'RIFF' &&
    value.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

export interface WatermarkAssetStore {
  save(projectId: string, value: Buffer): Promise<WatermarkAssetSummary>;
  read(
    projectId: string,
    assetId: string,
  ): Promise<{value: Buffer; summary: WatermarkAssetSummary}>;
}

export function createWatermarkAssetStore(
  projectsDirectory: string,
): WatermarkAssetStore {
  const root = path.resolve(projectsDirectory);

  function directory(projectId: string) {
    assertProjectId(projectId);
    return path.join(root, projectId, 'branding', 'watermarks');
  }

  return {
    async save(projectId, value) {
      const contentType = detectContentType(value);
      if (!contentType || value.length === 0) {
        throw new WatermarkAssetError(
          'WATERMARK_ASSET_UNSUPPORTED',
          'Watermark cần là ảnh PNG, JPEG hoặc WebP hợp lệ.',
        );
      }
      const assetId = createHash('sha256').update(value).digest('hex');
      const targetDirectory = directory(projectId);
      const target = path.join(targetDirectory, `${assetId}${extensions[contentType]}`);
      await mkdir(targetDirectory, {recursive: true});
      const exists = await stat(target).then(item => item.isFile()).catch(() => false);
      if (!exists) {
        const temporary = path.join(targetDirectory, `.${randomUUID()}.tmp`);
        await writeFile(temporary, value, {flag: 'wx', mode: 0o600});
        try {
          await rename(temporary, target).catch(async error => {
            const nowExists = await stat(target)
              .then(item => item.isFile())
              .catch(() => false);
            if (!nowExists) throw error;
          });
        } finally {
          await rm(temporary, {force: true}).catch(() => undefined);
        }
      }
      return {assetId, contentType, sizeBytes: value.length};
    },
    async read(projectId, assetId) {
      if (!/^[a-f0-9]{64}$/.test(assetId)) {
        throw new WatermarkAssetError(
          'WATERMARK_ASSET_INVALID',
          'Watermark image ID không hợp lệ.',
        );
      }
      const targetDirectory = directory(projectId);
      for (const [contentType, extension] of Object.entries(extensions)) {
        const target = path.join(targetDirectory, `${assetId}${extension}`);
        try {
          const value = await readFile(target);
          if (createHash('sha256').update(value).digest('hex') !== assetId) {
            throw new WatermarkAssetError(
              'WATERMARK_ASSET_CORRUPTED',
              'Ảnh watermark đã thay đổi hoặc bị hỏng.',
            );
          }
          return {
            value,
            summary: {
              assetId,
              contentType: contentType as WatermarkAssetSummary['contentType'],
              sizeBytes: value.length,
            },
          };
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            continue;
          }
          throw error;
        }
      }
      throw new WatermarkAssetError(
        'WATERMARK_ASSET_NOT_FOUND',
        'Không tìm thấy ảnh watermark đã tải lên.',
      );
    },
  };
}
