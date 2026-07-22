import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {
  MotionCanvasCandidateDecisionSchema,
  MotionCanvasCandidateRecordSchema,
  MotionCanvasVersionRecordSchema,
  type MotionCanvasCandidateRecord,
  type MotionCanvasVersionRecord,
} from '../shared/motionCanvasHistory.ts';
import {
  MotionCanvasBundleSchema,
  type MotionCanvasBundle,
} from '../shared/topic.ts';
import {hashJson} from './outlineHistoryStore.ts';

const versionManifestSchema = MotionCanvasVersionRecordSchema.omit({
  artifact: true,
});
const candidateManifestSchema = MotionCanvasCandidateRecordSchema.omit({
  bundle: true,
  decision: true,
  decidedAt: true,
  appliedVersionId: true,
});
type VersionCreate = Omit<
  MotionCanvasVersionRecord,
  'versionId' | 'createdAt'
> & {versionId?: string; createdAt?: string};

export interface MotionCanvasHistoryStore {
  ensureVersion(
    record: VersionCreate,
    options?: {force?: boolean},
  ): Promise<MotionCanvasVersionRecord>;
  getVersion(
    projectId: string,
    versionId: string,
  ): Promise<MotionCanvasVersionRecord | null>;
  listVersions(projectId: string): Promise<MotionCanvasVersionRecord[]>;
  saveCandidate(
    candidate: MotionCanvasCandidateRecord,
  ): Promise<MotionCanvasCandidateRecord>;
  getCandidate(
    projectId: string,
    candidateId: string,
  ): Promise<MotionCanvasCandidateRecord | null>;
  listCandidates(projectId: string): Promise<MotionCanvasCandidateRecord[]>;
  setCandidateDecision(
    projectId: string,
    candidateId: string,
    decision: 'accepted' | 'rejected',
    appliedVersionId?: string | null,
  ): Promise<MotionCanvasCandidateRecord>;
}

export class MotionCanvasHistoryStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function isProjectId(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,100}$/.test(value);
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function assertIdentifiers(projectId: string, recordId?: string) {
  if (!isProjectId(projectId) || (recordId !== undefined && !isUuid(recordId))) {
    throw new MotionCanvasHistoryStoreError(
      'MOTION_CANVAS_HISTORY_ID_INVALID',
      'Định danh lịch sử Motion Canvas không hợp lệ.',
    );
  }
}

export function hashMotionCanvasBundle(bundle: MotionCanvasBundle) {
  return hashJson(bundle);
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) return null;
    throw error;
  }
}

async function writeJsonImmutable(filePath: string, value: unknown) {
  const existing = await readJson(filePath);
  if (existing !== null) {
    if (hashJson(existing) !== hashJson(value)) {
      throw new MotionCanvasHistoryStoreError(
        'MOTION_CANVAS_HISTORY_IMMUTABLE_CONFLICT',
        'Artifact lịch sử Motion Canvas đã tồn tại với nội dung khác.',
      );
    }
    return;
  }
  const temporaryFile = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryFile,
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryFile, filePath);
  } finally {
    await rm(temporaryFile, {force: true}).catch(() => undefined);
  }
}

export function createFileMotionCanvasHistoryStore(
  projectsDirectory: string,
): MotionCanvasHistoryStore {
  const queues = new Map<string, Promise<void>>();
  function runSerialized<Result>(
    projectId: string,
    operation: () => Promise<Result>,
  ) {
    const previous = queues.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    queues.set(projectId, settled);
    return result.finally(() => {
      if (queues.get(projectId) === settled) queues.delete(projectId);
    });
  }
  function historyPaths(projectId: string) {
    assertIdentifiers(projectId);
    const root = path.join(
      projectsDirectory,
      projectId,
      'history',
      'motion-canvas',
    );
    return {
      versions: path.join(root, 'versions'),
      candidates: path.join(root, 'candidates'),
    };
  }
  function recordPaths(
    projectId: string,
    kind: 'versions' | 'candidates',
    recordId: string,
  ) {
    assertIdentifiers(projectId, recordId);
    const directory = path.join(historyPaths(projectId)[kind], recordId);
    return {
      directory,
      manifest: path.join(directory, 'manifest.json'),
      artifact: path.join(directory, 'artifact.json'),
      decision: path.join(directory, 'decision.json'),
    };
  }
  async function readVersion(projectId: string, versionId: string) {
    const files = recordPaths(projectId, 'versions', versionId);
    const [manifest, artifact] = await Promise.all([
      readJson(files.manifest),
      readJson(files.artifact),
    ]);
    if (manifest === null || artifact === null) return null;
    const parsed = MotionCanvasVersionRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      artifact,
    });
    if (!parsed.success) {
      throw new MotionCanvasHistoryStoreError(
        'MOTION_CANVAS_VERSION_INVALID',
        'Một phiên bản Motion Canvas đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.versionId !== versionId ||
      parsed.data.contentHash !== hashMotionCanvasBundle(parsed.data.artifact)
    ) {
      throw new MotionCanvasHistoryStoreError(
        'MOTION_CANVAS_VERSION_INTEGRITY_FAILED',
        'Hash hoặc định danh phiên bản Motion Canvas không khớp artifact.',
      );
    }
    return parsed.data;
  }
  async function readCandidate(projectId: string, candidateId: string) {
    const files = recordPaths(projectId, 'candidates', candidateId);
    const [manifest, bundle, decision] = await Promise.all([
      readJson(files.manifest),
      readJson(files.artifact),
      readJson(files.decision),
    ]);
    if (manifest === null || bundle === null) return null;
    const parsed = MotionCanvasCandidateRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      ...((decision && typeof decision === 'object')
        ? decision
        : {decision: 'pending', decidedAt: null, appliedVersionId: null}),
      bundle,
    });
    if (!parsed.success) {
      throw new MotionCanvasHistoryStoreError(
        'MOTION_CANVAS_CANDIDATE_INVALID',
        'Một candidate Motion Canvas đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.candidateId !== candidateId ||
      parsed.data.candidateContentHash !==
        hashMotionCanvasBundle(parsed.data.bundle)
    ) {
      throw new MotionCanvasHistoryStoreError(
        'MOTION_CANVAS_CANDIDATE_INTEGRITY_FAILED',
        'Hash hoặc định danh candidate Motion Canvas không khớp artifact.',
      );
    }
    return parsed.data;
  }
  async function listIds(
    projectId: string,
    kind: 'versions' | 'candidates',
  ) {
    const directory = historyPaths(projectId)[kind];
    await mkdir(directory, {recursive: true});
    return (await readdir(directory, {withFileTypes: true}))
      .filter(entry => entry.isDirectory() && isUuid(entry.name))
      .map(entry => entry.name);
  }
  async function listVersions(projectId: string) {
    const records = await Promise.all(
      (await listIds(projectId, 'versions')).map(id => readVersion(projectId, id)),
    );
    return records
      .filter((item): item is MotionCanvasVersionRecord => item !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async function listCandidates(projectId: string) {
    const records = await Promise.all(
      (await listIds(projectId, 'candidates')).map(id =>
        readCandidate(projectId, id),
      ),
    );
    return records
      .filter((item): item is MotionCanvasCandidateRecord => item !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  return {
    ensureVersion(record, options = {}) {
      return runSerialized(record.projectId, async () => {
        const artifact = MotionCanvasBundleSchema.parse(record.artifact);
        const contentHash = hashMotionCanvasBundle(artifact);
        if (!options.force) {
          const existing = (await listVersions(record.projectId)).find(
            item => item.contentHash === contentHash,
          );
          if (existing) return existing;
        }
        const versionId = record.versionId ?? randomUUID();
        const version = MotionCanvasVersionRecordSchema.parse({
          ...record,
          versionId,
          createdAt: record.createdAt ?? new Date().toISOString(),
          contentHash,
          artifact,
        });
        const files = recordPaths(record.projectId, 'versions', versionId);
        await mkdir(files.directory, {recursive: true});
        await writeJsonImmutable(files.artifact, version.artifact);
        const {artifact: _artifact, ...manifest} = version;
        await writeJsonImmutable(
          files.manifest,
          versionManifestSchema.parse(manifest),
        );
        return version;
      });
    },
    getVersion: readVersion,
    listVersions,
    saveCandidate(candidate) {
      return runSerialized(candidate.projectId, async () => {
        const existing = await readCandidate(
          candidate.projectId,
          candidate.candidateId,
        );
        if (existing) {
          if (existing.requestFingerprint !== candidate.requestFingerprint) {
            throw new MotionCanvasHistoryStoreError(
              'MOTION_CANVAS_CANDIDATE_ID_REUSED',
              'Generation ID đã được dùng cho candidate scene khác.',
            );
          }
          return existing;
        }
        const parsed = MotionCanvasCandidateRecordSchema.parse(candidate);
        const files = recordPaths(
          candidate.projectId,
          'candidates',
          candidate.candidateId,
        );
        await mkdir(files.directory, {recursive: true});
        await writeJsonImmutable(files.artifact, parsed.bundle);
        const {
          bundle: _bundle,
          decision: _decision,
          decidedAt: _decidedAt,
          appliedVersionId: _appliedVersionId,
          ...manifest
        } = parsed;
        await writeJsonImmutable(
          files.manifest,
          candidateManifestSchema.parse(manifest),
        );
        return parsed;
      });
    },
    getCandidate: readCandidate,
    listCandidates,
    setCandidateDecision(
      projectId,
      candidateId,
      decision,
      appliedVersionId = null,
    ) {
      return runSerialized(projectId, async () => {
        const candidate = await readCandidate(projectId, candidateId);
        if (!candidate) {
          throw new MotionCanvasHistoryStoreError(
            'MOTION_CANVAS_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate Motion Canvas cần cập nhật.',
          );
        }
        MotionCanvasCandidateDecisionSchema.parse(decision);
        if (candidate.decision !== 'pending') {
          if (
            candidate.decision === decision &&
            candidate.appliedVersionId === appliedVersionId
          ) return candidate;
          throw new MotionCanvasHistoryStoreError(
            'MOTION_CANVAS_CANDIDATE_ALREADY_DECIDED',
            'Candidate Motion Canvas đã được xử lý trước đó.',
          );
        }
        if (appliedVersionId !== null && !isUuid(appliedVersionId)) {
          throw new MotionCanvasHistoryStoreError(
            'MOTION_CANVAS_HISTORY_ID_INVALID',
            'Định danh phiên bản áp dụng không hợp lệ.',
          );
        }
        const decisionRecord = {
          decision,
          decidedAt: new Date().toISOString(),
          appliedVersionId,
        };
        await writeJsonImmutable(
          recordPaths(projectId, 'candidates', candidateId).decision,
          decisionRecord,
        );
        return MotionCanvasCandidateRecordSchema.parse({
          ...candidate,
          ...decisionRecord,
        });
      });
    },
  };
}
