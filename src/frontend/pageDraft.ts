import type {StorageLike} from './newTopicSession.ts';

type StoredDraft = {
  version: 1;
  value: unknown;
};

function browserSessionStorage() {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage as StorageLike;
  } catch {
    return null;
  }
}

function storageKey(page: string, projectId?: string) {
  return `pad-studio:${page}:draft:v1:${projectId ?? 'new'}`;
}

export function readPageDraft<T>(
  page: string,
  projectId?: string,
  sessionStorage: StorageLike | null = browserSessionStorage(),
): T | null {
  try {
    const raw = sessionStorage?.getItem(storageKey(page, projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return parsed?.version === 1 ? parsed.value as T : null;
  } catch {
    return null;
  }
}

export function savePageDraft(
  page: string,
  value: unknown,
  projectId?: string,
  sessionStorage: StorageLike | null = browserSessionStorage(),
) {
  try {
    sessionStorage?.setItem(
      storageKey(page, projectId),
      JSON.stringify({version: 1, value} satisfies StoredDraft),
    );
  } catch {
    // Draft persistence is best-effort; the active form remains usable.
  }
}

export function clearPageDraft(
  page: string,
  projectId?: string,
  sessionStorage: StorageLike | null = browserSessionStorage(),
) {
  try {
    sessionStorage?.removeItem(storageKey(page, projectId));
  } catch {
    // Storage can be unavailable in a restricted browser context.
  }
}
