import type {CodexAccountSummary} from '../shared/codex.ts';

const CODEX_ACCOUNT_CACHE_KEY = 'pad-studio:codex-account:v1';

export type CachedCodexAccount = {
  account:
    | {
        type: 'chatgpt';
        planType: string;
      }
    | {
        type: 'apiKey';
      };
  verifiedAt: string;
};

export interface CodexAccountCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): CodexAccountCacheStorage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCachedCodexAccount(value: unknown): value is CachedCodexAccount {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as {
    account?: {type?: unknown; planType?: unknown};
    verifiedAt?: unknown;
  };
  if (
    typeof candidate.verifiedAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.verifiedAt)) ||
    !candidate.account ||
    typeof candidate.account !== 'object'
  ) {
    return false;
  }

  return (
    candidate.account.type === 'apiKey' ||
    (candidate.account.type === 'chatgpt' &&
      typeof candidate.account.planType === 'string' &&
      candidate.account.planType.length > 0)
  );
}

export function readCachedCodexAccount(
  storage: CodexAccountCacheStorage | null = defaultStorage(),
) {
  if (!storage) return null;

  try {
    const serializedAccount = storage.getItem(CODEX_ACCOUNT_CACHE_KEY);
    if (!serializedAccount) return null;

    const cachedAccount: unknown = JSON.parse(serializedAccount);
    if (isCachedCodexAccount(cachedAccount)) return cachedAccount;

    storage.removeItem(CODEX_ACCOUNT_CACHE_KEY);
  } catch {
    // Storage can be unavailable or contain data from an interrupted write.
  }

  return null;
}

export function cacheCodexAccount(
  account: CodexAccountSummary,
  verifiedAt: string,
  storage: CodexAccountCacheStorage | null = defaultStorage(),
): CachedCodexAccount {
  const cachedAccount: CachedCodexAccount = {
    account:
      account.type === 'chatgpt'
        ? {
            type: 'chatgpt',
            planType: account.planType,
          }
        : {type: 'apiKey'},
    verifiedAt,
  };

  try {
    storage?.setItem(CODEX_ACCOUNT_CACHE_KEY, JSON.stringify(cachedAccount));
  } catch {
    // The live Codex session remains authoritative when storage is unavailable.
  }

  return cachedAccount;
}

export function clearCachedCodexAccount(
  storage: CodexAccountCacheStorage | null = defaultStorage(),
) {
  try {
    storage?.removeItem(CODEX_ACCOUNT_CACHE_KEY);
  } catch {
    // Clearing a UI hint must not break live authentication checks.
  }
}
