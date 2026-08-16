/**
 * Coordinates idempotent, in-process generation requests.
 *
 * A durable workspace/history owns completed artifacts.  This registry owns
 * only the short-lived concern of joining duplicate HTTP requests while a
 * provider call is active, and of rejecting a reused generation id with a
 * different input fingerprint.
 */
export class GenerationIdReuseError extends Error {
  constructor() {
    super('Generation ID Ä‘Ã£ Ä‘Æ°á»£c dÃ¹ng vá»›i ná»™i dung khÃ¡c.');
  }
}

type Entry<Result> = {
  fingerprint: string;
  promise: Promise<{result: Result; generatedAt: string}>;
  settled: boolean;
};

export interface GenerationRegistry<Result> {
  run(
    generationId: string,
    fingerprint: string,
    operation: () => Promise<Result>,
    options?: {retainFailure?: (error: unknown) => boolean},
  ): Promise<{result: Result; generatedAt: string}>;
  clearMatching(predicate: (generationId: string) => boolean): void;
}

export function createInMemoryGenerationRegistry<Result>(
  maximumEntries = 50,
): GenerationRegistry<Result> {
  const entries = new Map<string, Entry<Result>>();

  function trim(exceptGenerationId: string) {
    while (entries.size > maximumEntries) {
      const oldestSettled = [...entries.entries()].find(
        ([generationId, entry]) =>
          generationId !== exceptGenerationId && entry.settled,
      )?.[0];
      if (!oldestSettled) return;
      entries.delete(oldestSettled);
    }
  }

  return {
    run(generationId, fingerprint, operation, options = {}) {
      const existing = entries.get(generationId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new GenerationIdReuseError();
        }
        return existing.promise;
      }

      const promise = operation().then((result) => ({
        result,
        generatedAt: new Date().toISOString(),
      }));
      const entry: Entry<Result> = {fingerprint, promise, settled: false};
      entries.set(generationId, entry);
      void promise.then(
        () => {
          entry.settled = true;
          trim(generationId);
        },
        (error) => {
          entry.settled = true;
          if (!options.retainFailure?.(error) && entries.get(generationId) === entry) {
            entries.delete(generationId);
          }
          trim(generationId);
        },
      );
      return promise;
    },
    clearMatching(predicate) {
      for (const generationId of entries.keys()) {
        if (predicate(generationId)) entries.delete(generationId);
      }
    },
  };
}
