/**
 * A new project has not acquired a project ID yet, so its draft must never be
 * kept in origin-wide localStorage. sessionStorage is scoped to one top-level
 * browser tab and survives reloads in that tab, which is the ownership model
 * the form needs.
 */
export type StorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

const SESSION_DRAFT_KEY = 'pad-studio:topic-form:v2';
const LEGACY_SHARED_DRAFT_KEY = 'pad-studio:topic-form:v1';

function browserStorage(kind: 'localStorage' | 'sessionStorage') {
  try {
    if (typeof window === 'undefined') return null;
    return window[kind] as StorageLike;
  } catch {
    return null;
  }
}

/**
 * Reads the tab-owned draft. The legacy v1 draft is imported once so an
 * upgrade does not discard an existing unsaved form; it is immediately
 * removed from shared storage so later tabs cannot adopt it.
 */
export function readNewTopicDraft(
  sessionStorage: StorageLike | null = browserStorage('sessionStorage'),
  localStorage: StorageLike | null = browserStorage('localStorage'),
) {
  if (!sessionStorage) return null;

  try {
    const current = sessionStorage.getItem(SESSION_DRAFT_KEY);
    if (current) return current;

    const legacy = localStorage?.getItem(LEGACY_SHARED_DRAFT_KEY) ?? null;
    if (!legacy) return null;

    sessionStorage.setItem(SESSION_DRAFT_KEY, legacy);
    localStorage?.removeItem(LEGACY_SHARED_DRAFT_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function saveNewTopicDraft(
  value: string,
  sessionStorage: StorageLike | null = browserStorage('sessionStorage'),
) {
  try {
    sessionStorage?.setItem(SESSION_DRAFT_KEY, value);
  } catch {
    // Persistence is best-effort; the form remains usable in this tab.
  }
}

export function clearNewTopicDraft(
  sessionStorage: StorageLike | null = browserStorage('sessionStorage'),
) {
  try {
    sessionStorage?.removeItem(SESSION_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in a restricted browser context.
  }
}

/**
 * This identifier deliberately belongs to the mounted form, not browser
 * storage. Retries from one tab reuse it through the hook ref, while two tabs
 * (including duplicated tabs) always create distinct projects.
 */
export function createNewTopicCreationId(
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  return randomUuid();
}
