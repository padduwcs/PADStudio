import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  cacheCodexAccount,
  clearCachedCodexAccount,
  type CodexAccountCacheStorage,
  readCachedCodexAccount,
} from './codexConnectionCache.ts';

function createMemoryStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set('pad-studio:codex-account:v1', initialValue);
  }

  const storage: CodexAccountCacheStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
  };

  return {storage, values};
}

describe('Codex account cache', () => {
  it('persists only the non-secret ChatGPT account summary', () => {
    const {storage, values} = createMemoryStorage();
    const verifiedAt = '2026-07-17T08:30:00.000Z';

    const cachedAccount = cacheCodexAccount(
      {
        type: 'chatgpt',
        email: 'person@example.com',
        planType: 'plus',
      },
      verifiedAt,
      storage,
    );

    assert.deepEqual(cachedAccount, {
      account: {type: 'chatgpt', planType: 'plus'},
      verifiedAt,
    });
    assert.equal(
      values.get('pad-studio:codex-account:v1')?.includes(
        'person@example.com',
      ),
      false,
    );
    assert.deepEqual(readCachedCodexAccount(storage), cachedAccount);
  });

  it('removes malformed or unsupported cached data', () => {
    const {storage, values} = createMemoryStorage(
      JSON.stringify({
        account: {type: 'chatgpt'},
        verifiedAt: 'not-a-date',
      }),
    );

    assert.equal(readCachedCodexAccount(storage), null);
    assert.equal(values.size, 0);
  });

  it('clears the cached summary after an explicit logout', () => {
    const {storage} = createMemoryStorage();
    cacheCodexAccount(
      {type: 'apiKey'},
      '2026-07-17T08:30:00.000Z',
      storage,
    );

    clearCachedCodexAccount(storage);

    assert.equal(readCachedCodexAccount(storage), null);
  });

  it('does not fail authentication flow when storage is unavailable', () => {
    const storage: CodexAccountCacheStorage = {
      getItem: () => {
        throw new Error('Storage is blocked');
      },
      setItem: () => {
        throw new Error('Storage is blocked');
      },
      removeItem: () => {
        throw new Error('Storage is blocked');
      },
    };

    assert.equal(readCachedCodexAccount(storage), null);
    assert.doesNotThrow(() =>
      cacheCodexAccount(
        {type: 'apiKey'},
        '2026-07-17T08:30:00.000Z',
        storage,
      ),
    );
    assert.doesNotThrow(() => clearCachedCodexAccount(storage));
  });
});
