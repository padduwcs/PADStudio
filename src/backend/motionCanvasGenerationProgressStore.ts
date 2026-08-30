import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {
  MotionCanvasGenerationProgressSchema,
  type MotionCanvasGenerationProgress,
} from '../shared/motionCanvasGenerationProgress.ts';

const StoredProgressSchema = MotionCanvasGenerationProgressSchema.extend({
  serverInstanceId: z.string().uuid(),
}).strict();

type StoredProgress = z.infer<typeof StoredProgressSchema>;
type ProgressPatch = Partial<Pick<
  MotionCanvasGenerationProgress,
  | 'stage'
  | 'message'
  | 'completedScenes'
  | 'failedScenes'
  | 'totalScenes'
  | 'completedSamples'
  | 'totalSamples'
  | 'cachedSamples'
  | 'attempt'
>>;

export interface MotionCanvasGenerationProgressStore {
  start(input: {
    projectId: string;
    generationId: string;
    totalScenes: number;
  }): Promise<MotionCanvasGenerationProgress>;
  update(
    projectId: string,
    generationId: string,
    patch: ProgressPatch,
  ): Promise<MotionCanvasGenerationProgress | null>;
  complete(
    projectId: string,
    generationId: string,
    message?: string,
  ): Promise<MotionCanvasGenerationProgress | null>;
  fail(
    projectId: string,
    generationId: string,
    error: unknown,
  ): Promise<MotionCanvasGenerationProgress | null>;
  get(projectId: string): Promise<MotionCanvasGenerationProgress | null>;
}

function publicProgress(record: StoredProgress): MotionCanvasGenerationProgress {
  const {serverInstanceId: _serverInstanceId, ...progress} = record;
  return MotionCanvasGenerationProgressSchema.parse(progress);
}

export function createFileMotionCanvasGenerationProgressStore(
  projectsDirectory: string,
  options: {now?: () => string; serverInstanceId?: string} = {},
): MotionCanvasGenerationProgressStore {
  const root = path.resolve(projectsDirectory);
  const serverInstanceId = options.serverInstanceId ?? randomUUID();
  const now = options.now ?? (() => new Date().toISOString());
  const records = new Map<string, StoredProgress>();
  const writes = new Map<string, Promise<void>>();

  function progressPath(projectId: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId)) {
      throw new Error('Project id không hợp lệ cho trạng thái sinh scene.');
    }
    return path.join(root, projectId, 'motion-canvas', 'generation-status.json');
  }

  function persist(record: StoredProgress) {
    const previous = writes.get(record.projectId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const destination = progressPath(record.projectId);
      await mkdir(path.dirname(destination), {recursive: true});
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await rm(destination, {force: true});
        await rename(temporary, destination);
      } finally {
        await rm(temporary, {force: true}).catch(() => undefined);
      }
    });
    writes.set(record.projectId, operation);
    return operation.finally(() => {
      if (writes.get(record.projectId) === operation) {
        writes.delete(record.projectId);
      }
    });
  }

  async function readStored(projectId: string) {
    const current = records.get(projectId);
    if (current) return current;
    try {
      const parsed = StoredProgressSchema.parse(
        JSON.parse(await readFile(progressPath(projectId), 'utf8')),
      );
      records.set(projectId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async function terminal(
    projectId: string,
    generationId: string,
    state: 'completed' | 'failed',
    message: string,
    error: string | null,
  ) {
    const record = await readStored(projectId);
    if (!record || record.generationId !== generationId) return null;
    const timestamp = now();
    const next = StoredProgressSchema.parse({
      ...record,
      state,
      stage: state === 'completed' ? 'committing' : record.stage,
      message,
      updatedAt: timestamp,
      finishedAt: timestamp,
      error,
      serverInstanceId,
    });
    records.set(projectId, next);
    await persist(next);
    return publicProgress(next);
  }

  return {
    async start({projectId, generationId, totalScenes}) {
      const timestamp = now();
      const record = StoredProgressSchema.parse({
        version: 1,
        projectId,
        generationId,
        state: 'running',
        stage: 'queued',
        message: 'Đã xếp hàng sinh scene.',
        completedScenes: 0,
        failedScenes: 0,
        totalScenes,
        completedSamples: 0,
        totalSamples: 0,
        cachedSamples: 0,
        attempt: 0,
        startedAt: timestamp,
        updatedAt: timestamp,
        finishedAt: null,
        error: null,
        serverInstanceId,
      });
      records.set(projectId, record);
      await persist(record);
      return publicProgress(record);
    },

    async update(projectId, generationId, patch) {
      const record = await readStored(projectId);
      if (
        !record ||
        record.generationId !== generationId ||
        record.state !== 'running'
      ) return null;
      const next = StoredProgressSchema.parse({
        ...record,
        ...patch,
        updatedAt: now(),
        serverInstanceId,
      });
      records.set(projectId, next);
      await persist(next);
      return publicProgress(next);
    },

    complete(projectId, generationId, message = 'Scene đã được tạo và kiểm định xong.') {
      return terminal(projectId, generationId, 'completed', message, null);
    },

    fail(projectId, generationId, error) {
      const reason = error instanceof Error ? error.message : String(error);
      return terminal(
        projectId,
        generationId,
        'failed',
        'Lượt sinh scene chưa hoàn tất.',
        reason.slice(0, 1_000) || 'Lỗi không xác định.',
      );
    },

    async get(projectId) {
      const record = await readStored(projectId);
      if (!record) return null;
      if (record.state !== 'running' || record.serverInstanceId === serverInstanceId) {
        return publicProgress(record);
      }
      const timestamp = now();
      const interrupted = StoredProgressSchema.parse({
        ...record,
        state: 'interrupted',
        message: 'Máy chủ đã dừng trước khi lượt sinh scene hoàn tất.',
        updatedAt: timestamp,
        finishedAt: timestamp,
        error: 'Generation bị gián đoạn do phiên máy chủ trước kết thúc.',
        serverInstanceId,
      });
      records.set(projectId, interrupted);
      await persist(interrupted);
      return publicProgress(interrupted);
    },
  };
}
