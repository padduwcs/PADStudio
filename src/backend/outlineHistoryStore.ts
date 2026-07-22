import {createHash, randomUUID} from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  OutlineCandidateDecisionSchema,
  OutlineCandidateRecordSchema,
  OutlineVersionRecordSchema,
  type OutlineCandidateRecord,
  type OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import {
  TeachingOutlineSchema,
  type TeachingOutline,
  type TeachingOutlineContent,
} from '../shared/topic.ts';

const versionManifestSchema = OutlineVersionRecordSchema.omit({
  artifact: true,
});
const candidateManifestSchema = OutlineCandidateRecordSchema.omit({
  content: true,
  decision: true,
  decidedAt: true,
  appliedVersionId: true,
});

type VersionCreate = Omit<OutlineVersionRecord, 'versionId' | 'createdAt'> & {
  versionId?: string;
  createdAt?: string;
};

export interface OutlineHistoryStore {
  ensureVersion(
    record: VersionCreate,
    options?: {force?: boolean},
  ): Promise<OutlineVersionRecord>;
  getVersion(
    projectId: string,
    versionId: string,
  ): Promise<OutlineVersionRecord | null>;
  listVersions(projectId: string): Promise<OutlineVersionRecord[]>;
  saveCandidate(
    candidate: OutlineCandidateRecord,
  ): Promise<OutlineCandidateRecord>;
  getCandidate(
    projectId: string,
    candidateId: string,
  ): Promise<OutlineCandidateRecord | null>;
  listCandidates(projectId: string): Promise<OutlineCandidateRecord[]>;
  setCandidateDecision(
    projectId: string,
    candidateId: string,
    decision: 'accepted' | 'rejected',
    appliedVersionId?: string | null,
  ): Promise<OutlineCandidateRecord>;
}

export class OutlineHistoryStoreError extends Error {
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
    throw new OutlineHistoryStoreError(
      'OUTLINE_HISTORY_ID_INVALID',
      'Định danh lịch sử mạch giảng không hợp lệ.',
    );
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function outlineContent(outline: TeachingOutline): TeachingOutlineContent {
  return {
    brief: outline.brief,
    centralMessage: outline.centralMessage,
    sections: outline.sections,
  };
}

export function hashOutlineContent(
  outline: TeachingOutline | TeachingOutlineContent,
) {
  return hashJson(
    'status' in outline && 'generation' in outline
      ? outlineContent(outline)
      : outline,
  );
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
    ) {
      return null;
    }
    throw error;
  }
}

async function writeJsonImmutable(filePath: string, value: unknown) {
  const existing = await readJson(filePath);
  if (existing !== null) {
    if (hashJson(existing) !== hashJson(value)) {
      throw new OutlineHistoryStoreError(
        'OUTLINE_HISTORY_IMMUTABLE_CONFLICT',
        'Artifact lịch sử đã tồn tại với nội dung khác.',
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

export function createFileOutlineHistoryStore(
  projectsDirectory: string,
): OutlineHistoryStore {
  const operationQueues = new Map<string, Promise<void>>();

  function runSerialized<Result>(
    projectId: string,
    operation: () => Promise<Result>,
  ) {
    const previous = operationQueues.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    operationQueues.set(projectId, settled);
    return result.finally(() => {
      if (operationQueues.get(projectId) === settled) {
        operationQueues.delete(projectId);
      }
    });
  }

  function historyPaths(projectId: string) {
    assertIdentifiers(projectId);
    const root = path.join(projectsDirectory, projectId, 'history', 'outline');
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
    const parsed = OutlineVersionRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      artifact,
    });
    if (!parsed.success) {
      throw new OutlineHistoryStoreError(
        'OUTLINE_VERSION_INVALID',
        'Một phiên bản mạch giảng đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.versionId !== versionId ||
      parsed.data.contentHash !== hashOutlineContent(parsed.data.artifact)
    ) {
      throw new OutlineHistoryStoreError(
        'OUTLINE_VERSION_INTEGRITY_FAILED',
        'Hash hoặc định danh của phiên bản mạch giảng không khớp artifact.',
      );
    }
    return parsed.data;
  }

  async function readCandidate(projectId: string, candidateId: string) {
    const files = recordPaths(projectId, 'candidates', candidateId);
    const [manifest, content, storedDecision] = await Promise.all([
      readJson(files.manifest),
      readJson(files.artifact),
      readJson(files.decision),
    ]);
    if (manifest === null || content === null) return null;
    const decision = storedDecision === null
      ? {
          decision: 'pending' as const,
          decidedAt: null,
          appliedVersionId: null,
        }
      : storedDecision;
    const parsed = OutlineCandidateRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      ...((decision && typeof decision === 'object') ? decision : {}),
      content,
    });
    if (!parsed.success) {
      throw new OutlineHistoryStoreError(
        'OUTLINE_CANDIDATE_INVALID',
        'Một đề xuất chỉnh sửa đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.candidateId !== candidateId ||
      parsed.data.candidateContentHash !==
        hashOutlineContent(parsed.data.content)
    ) {
      throw new OutlineHistoryStoreError(
        'OUTLINE_CANDIDATE_INTEGRITY_FAILED',
        'Hash hoặc định danh của candidate không khớp artifact.',
      );
    }
    return parsed.data;
  }

  async function listRecordIds(
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
    const versions = await Promise.all(
      (await listRecordIds(projectId, 'versions')).map(versionId =>
        readVersion(projectId, versionId),
      ),
    );
    return versions
      .filter((version): version is OutlineVersionRecord => version !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async function listCandidates(projectId: string) {
    const candidates = await Promise.all(
      (await listRecordIds(projectId, 'candidates')).map(candidateId =>
        readCandidate(projectId, candidateId),
      ),
    );
    return candidates
      .filter(
        (candidate): candidate is OutlineCandidateRecord => candidate !== null,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  return {
    ensureVersion(record, options = {}) {
      return runSerialized(record.projectId, async () => {
        const parsedArtifact = TeachingOutlineSchema.parse(record.artifact);
        const contentHash = hashOutlineContent(parsedArtifact);
        if (!options.force) {
          const existing = (await listVersions(record.projectId)).find(
            version => version.contentHash === contentHash,
          );
          if (existing) return existing;
        }

        const versionId = record.versionId ?? randomUUID();
        const version = OutlineVersionRecordSchema.parse({
          ...record,
          versionId,
          createdAt: record.createdAt ?? new Date().toISOString(),
          contentHash,
          artifact: parsedArtifact,
        });
        const files = recordPaths(record.projectId, 'versions', versionId);
        await mkdir(files.directory, {recursive: true});
        await writeJsonImmutable(files.artifact, version.artifact);
        const {artifact: _artifact, ...versionManifest} = version;
        await writeJsonImmutable(
          files.manifest,
          versionManifestSchema.parse(versionManifest),
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
            throw new OutlineHistoryStoreError(
              'OUTLINE_CANDIDATE_ID_REUSED',
              'Generation ID đã được dùng cho một đề xuất khác.',
            );
          }
          return existing;
        }
        const parsed = OutlineCandidateRecordSchema.parse(candidate);
        const files = recordPaths(
          candidate.projectId,
          'candidates',
          candidate.candidateId,
        );
        await mkdir(files.directory, {recursive: true});
        await writeJsonImmutable(files.artifact, parsed.content);
        const {
          content: _content,
          decision: _decision,
          decidedAt: _decidedAt,
          appliedVersionId: _appliedVersionId,
          ...candidateManifest
        } = parsed;
        await writeJsonImmutable(
          files.manifest,
          candidateManifestSchema.parse(candidateManifest),
        );
        return parsed;
      });
    },

    getCandidate: readCandidate,
    listCandidates,

    setCandidateDecision(projectId, candidateId, decision, appliedVersionId = null) {
      return runSerialized(projectId, async () => {
        const candidate = await readCandidate(projectId, candidateId);
        if (!candidate) {
          throw new OutlineHistoryStoreError(
            'OUTLINE_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate cần cập nhật.',
          );
        }
        OutlineCandidateDecisionSchema.parse(decision);
        if (candidate.decision !== 'pending') {
          if (
            candidate.decision === decision &&
            candidate.appliedVersionId === appliedVersionId
          ) {
            return candidate;
          }
          throw new OutlineHistoryStoreError(
            'OUTLINE_CANDIDATE_ALREADY_DECIDED',
            'Candidate đã được chấp nhận hoặc từ chối trước đó.',
          );
        }
        const files = recordPaths(projectId, 'candidates', candidateId);
        await writeJsonImmutable(files.decision, {
          decision,
          decidedAt: new Date().toISOString(),
          appliedVersionId: decision === 'accepted' ? appliedVersionId : null,
        });
        const updated = await readCandidate(projectId, candidateId);
        if (!updated) {
          throw new OutlineHistoryStoreError(
            'OUTLINE_CANDIDATE_NOT_FOUND',
            'Candidate vừa cập nhật không còn khả dụng.',
          );
        }
        return updated;
      });
    },
  };
}
