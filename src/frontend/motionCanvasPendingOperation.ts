import {
  CreateMotionCanvasCandidateSchema,
  type CreateMotionCanvasCandidate,
} from '../shared/motionCanvasHistory.ts';

const STORAGE_PREFIX = 'pad-studio:motion-canvas-candidate:';
const MAXIMUM_PENDING_AGE_MS = 24 * 60 * 60 * 1_000;
const projectIdPattern = /^[a-z0-9][a-z0-9-]{0,100}$/;
const generationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OperationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingMotionCanvasCandidateOperation {
  version: 1;
  projectId: string;
  expectedRevision: number;
  request: CreateMotionCanvasCandidate;
  reviewerRepairGenerationId: string | null;
  savedAt: number;
}

function operationStorage(storage?: OperationStorage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(projectId: string) {
  return `${STORAGE_PREFIX}${projectId}`;
}

function validOperation(
  value: unknown,
  projectId: string,
  now: number,
): PendingMotionCanvasCandidateOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const parsedRequest = CreateMotionCanvasCandidateSchema.safeParse(
    candidate.request,
  );
  if (
    candidate.version !== 1 ||
    candidate.projectId !== projectId ||
    !projectIdPattern.test(projectId) ||
    !Number.isSafeInteger(candidate.expectedRevision) ||
    Number(candidate.expectedRevision) < 1 ||
    !parsedRequest.success ||
    (candidate.reviewerRepairGenerationId !== null &&
      (typeof candidate.reviewerRepairGenerationId !== 'string' ||
        !generationIdPattern.test(candidate.reviewerRepairGenerationId))) ||
    typeof candidate.savedAt !== 'number' ||
    !Number.isFinite(candidate.savedAt) ||
    candidate.savedAt > now + 60_000 ||
    now - candidate.savedAt > MAXIMUM_PENDING_AGE_MS
  ) {
    return null;
  }
  return {
    version: 1,
    projectId,
    expectedRevision: Number(candidate.expectedRevision),
    request: parsedRequest.data,
    reviewerRepairGenerationId:
      candidate.reviewerRepairGenerationId as string | null,
    savedAt: candidate.savedAt,
  };
}

export function readPendingMotionCanvasCandidateOperation(
  projectId: string,
  options: {storage?: OperationStorage; now?: number} = {},
) {
  const storage = operationStorage(options.storage);
  if (!storage || !projectIdPattern.test(projectId)) return null;
  const key = storageKey(projectId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const operation = validOperation(
      JSON.parse(raw) as unknown,
      projectId,
      options.now ?? Date.now(),
    );
    if (!operation) storage.removeItem(key);
    return operation;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage is an optional recovery aid; the request can still run.
    }
    return null;
  }
}

export function writePendingMotionCanvasCandidateOperation(
  operation: PendingMotionCanvasCandidateOperation,
  storage?: OperationStorage,
) {
  const target = operationStorage(storage);
  if (!target) return;
  try {
    target.setItem(storageKey(operation.projectId), JSON.stringify(operation));
  } catch {
    // A disabled/full sessionStorage must not block scene generation.
  }
}

export function clearPendingMotionCanvasCandidateOperation(
  projectId: string,
  generationId?: string,
  storage?: OperationStorage,
) {
  const target = operationStorage(storage);
  if (!target) return;
  const key = storageKey(projectId);
  try {
    if (generationId) {
      const current = readPendingMotionCanvasCandidateOperation(projectId, {
        storage: target,
      });
      if (current?.request.generationId !== generationId) return;
    }
    target.removeItem(key);
  } catch {
    // Recovery state is best-effort and contains no credential.
  }
}

export function shouldRetainPendingMotionCanvasCandidateOperation(
  error: unknown,
) {
  return !(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status > 0
  );
}
