import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {
  VoiceVisualCandidateDecisionSchema,
  VoiceVisualCandidateRecordSchema,
  VoiceVisualVersionRecordSchema,
  type VoiceVisualCandidateRecord,
  type VoiceVisualVersionRecord,
} from '../shared/voiceVisualHistory.ts';
import {
  VoiceVisualPlanContentSchema,
  VoiceVisualPlanSchema,
  type VoiceVisualPlan,
  type VoiceVisualPlanContent,
} from '../shared/topic.ts';
import {hashJson} from './outlineHistoryStore.ts';

const versionManifestSchema = VoiceVisualVersionRecordSchema.omit({
  artifact: true,
});
const candidateManifestSchema = VoiceVisualCandidateRecordSchema.omit({
  content: true,
  decision: true,
  decidedAt: true,
  appliedVersionId: true,
});

type VersionCreate = Omit<
  VoiceVisualVersionRecord,
  'versionId' | 'createdAt'
> & {versionId?: string; createdAt?: string};

export interface VoiceVisualHistoryStore {
  ensureVersion(
    record: VersionCreate,
    options?: {force?: boolean},
  ): Promise<VoiceVisualVersionRecord>;
  getVersion(
    projectId: string,
    versionId: string,
  ): Promise<VoiceVisualVersionRecord | null>;
  listVersions(projectId: string): Promise<VoiceVisualVersionRecord[]>;
  saveCandidate(
    candidate: VoiceVisualCandidateRecord,
  ): Promise<VoiceVisualCandidateRecord>;
  getCandidate(
    projectId: string,
    candidateId: string,
  ): Promise<VoiceVisualCandidateRecord | null>;
  listCandidates(projectId: string): Promise<VoiceVisualCandidateRecord[]>;
  setCandidateDecision(
    projectId: string,
    candidateId: string,
    decision: 'accepted' | 'rejected',
    appliedVersionId?: string | null,
  ): Promise<VoiceVisualCandidateRecord>;
}

export class VoiceVisualHistoryStoreError extends Error {
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
    throw new VoiceVisualHistoryStoreError(
      'VOICE_VISUAL_HISTORY_ID_INVALID',
      'Định danh lịch sử voice–visual không hợp lệ.',
    );
  }
}

export function versionedVoiceVisualContent(
  plan: VoiceVisualPlan,
): VoiceVisualPlanContent {
  return VoiceVisualPlanContentSchema.parse({
    voiceDirection: plan.voiceDirection,
    visualDirection: plan.visualDirection,
    timingCalibration: plan.timingCalibration,
    sections: plan.sections,
  });
}

export function hashVoiceVisualContent(
  plan: VoiceVisualPlan | VoiceVisualPlanContent,
) {
  return hashJson(
    'status' in plan && 'generation' in plan
      ? versionedVoiceVisualContent(plan)
      : plan,
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
      throw new VoiceVisualHistoryStoreError(
        'VOICE_VISUAL_HISTORY_IMMUTABLE_CONFLICT',
        'Artifact lịch sử voice–visual đã tồn tại với nội dung khác.',
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

export function createFileVoiceVisualHistoryStore(
  projectsDirectory: string,
): VoiceVisualHistoryStore {
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
    const root = path.join(
      projectsDirectory,
      projectId,
      'history',
      'voice-visual',
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
    const parsed = VoiceVisualVersionRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      artifact,
    });
    if (!parsed.success) {
      throw new VoiceVisualHistoryStoreError(
        'VOICE_VISUAL_VERSION_INVALID',
        'Một phiên bản voice–visual đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.versionId !== versionId ||
      parsed.data.contentHash !== hashVoiceVisualContent(parsed.data.artifact)
    ) {
      throw new VoiceVisualHistoryStoreError(
        'VOICE_VISUAL_VERSION_INTEGRITY_FAILED',
        'Hash hoặc định danh của phiên bản voice–visual không khớp artifact.',
      );
    }
    return parsed.data;
  }

  async function readCandidate(projectId: string, candidateId: string) {
    const files = recordPaths(projectId, 'candidates', candidateId);
    const [manifest, content, decision] = await Promise.all([
      readJson(files.manifest),
      readJson(files.artifact),
      readJson(files.decision),
    ]);
    if (manifest === null || content === null) return null;
    const parsed = VoiceVisualCandidateRecordSchema.safeParse({
      ...((manifest && typeof manifest === 'object') ? manifest : {}),
      ...((decision && typeof decision === 'object')
        ? decision
        : {decision: 'pending', decidedAt: null, appliedVersionId: null}),
      content,
    });
    if (!parsed.success) {
      throw new VoiceVisualHistoryStoreError(
        'VOICE_VISUAL_CANDIDATE_INVALID',
        'Một đề xuất voice–visual đã lưu không còn hợp lệ.',
        {cause: parsed.error},
      );
    }
    if (
      parsed.data.projectId !== projectId ||
      parsed.data.candidateId !== candidateId ||
      parsed.data.candidateContentHash !==
        hashVoiceVisualContent(parsed.data.content)
    ) {
      throw new VoiceVisualHistoryStoreError(
        'VOICE_VISUAL_CANDIDATE_INTEGRITY_FAILED',
        'Hash hoặc định danh của candidate voice–visual không khớp artifact.',
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
      .filter((version): version is VoiceVisualVersionRecord => version !== null)
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
        (candidate): candidate is VoiceVisualCandidateRecord =>
          candidate !== null,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  return {
    ensureVersion(record, options = {}) {
      return runSerialized(record.projectId, async () => {
        const artifact = VoiceVisualPlanSchema.parse(record.artifact);
        const contentHash = hashVoiceVisualContent(artifact);
        if (!options.force) {
          const existing = (await listVersions(record.projectId)).find(
            version => version.contentHash === contentHash,
          );
          if (existing) return existing;
        }
        const versionId = record.versionId ?? randomUUID();
        const version = VoiceVisualVersionRecordSchema.parse({
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
            throw new VoiceVisualHistoryStoreError(
              'VOICE_VISUAL_CANDIDATE_ID_REUSED',
              'Generation ID đã được dùng cho một đề xuất voice–visual khác.',
            );
          }
          return existing;
        }
        const parsed = VoiceVisualCandidateRecordSchema.parse(candidate);
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
          throw new VoiceVisualHistoryStoreError(
            'VOICE_VISUAL_CANDIDATE_NOT_FOUND',
            'Không tìm thấy candidate voice–visual cần cập nhật.',
          );
        }
        VoiceVisualCandidateDecisionSchema.parse(decision);
        if (candidate.decision !== 'pending') {
          if (
            candidate.decision === decision &&
            candidate.appliedVersionId === appliedVersionId
          ) {
            return candidate;
          }
          throw new VoiceVisualHistoryStoreError(
            'VOICE_VISUAL_CANDIDATE_ALREADY_DECIDED',
            'Candidate voice–visual đã được xử lý trước đó.',
          );
        }
        if (appliedVersionId !== null && !isUuid(appliedVersionId)) {
          throw new VoiceVisualHistoryStoreError(
            'VOICE_VISUAL_HISTORY_ID_INVALID',
            'Định danh phiên bản áp dụng không hợp lệ.',
          );
        }
        const files = recordPaths(projectId, 'candidates', candidateId);
        const decisionRecord = {
          decision,
          decidedAt: new Date().toISOString(),
          appliedVersionId,
        };
        await writeJsonImmutable(files.decision, decisionRecord);
        return VoiceVisualCandidateRecordSchema.parse({
          ...candidate,
          ...decisionRecord,
        });
      });
    },
  };
}
