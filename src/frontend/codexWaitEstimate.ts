export type CodexGenerationTask =
  | 'narration'
  | 'outline'
  | 'voiceVisual'
  | 'motionCanvas';

export interface CodexWaitEstimate {
  minimumMs: number;
  maximumMs: number;
  basis: 'baseline' | 'observed';
  sampleCount: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'pad-studio:codex-wait-history:v1';
const MAX_SAMPLES = 8;
const MAX_ESTIMATE_MS = 3 * 60 * 60 * 1000;

const taskBaselines: Record<
  CodexGenerationTask,
  {minimumMs: number; maximumMs: number}
> = {
  narration: {minimumMs: 15_000, maximumMs: 90_000},
  outline: {minimumMs: 20_000, maximumMs: 120_000},
  voiceVisual: {minimumMs: 30_000, maximumMs: 180_000},
  motionCanvas: {minimumMs: 45_000, maximumMs: 240_000},
};

const effortMultipliers: Record<string, number> = {
  none: 0.7,
  minimal: 0.8,
  low: 1,
  medium: 1.6,
  high: 2.8,
  xhigh: 4.5,
  max: 7,
  ultra: 10,
};

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function historyKey(
  model: string,
  reasoningEffort: string,
  task: CodexGenerationTask,
) {
  return JSON.stringify([model || 'default', reasoningEffort || 'default', task]);
}

function workloadFactor(task: CodexGenerationTask, workUnits: number) {
  const units = Math.max(1, Math.min(80, Math.floor(workUnits) || 1));
  if (task === 'outline' || task === 'narration') return 1;
  if (task === 'voiceVisual') return Math.min(1.8, 0.9 + units * 0.1);

  // Motion scenes run four at a time. Extra batches extend wall-clock time,
  // but less than a fully sequential multiplier.
  const batches = Math.ceil(units / 4);
  return 1 + (batches - 1) * 0.75;
}

function readHistory(storage: StorageLike | null) {
  if (!storage) return {} as Record<string, number[]>;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const samples = value.filter(
        (sample): sample is number =>
          typeof sample === 'number' &&
          Number.isFinite(sample) &&
          sample >= 1_000 &&
          sample <= MAX_ESTIMATE_MS,
      );
      if (samples.length) result[key] = samples.slice(-MAX_SAMPLES);
    }
    return result;
  } catch {
    return {};
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function estimateCodexWait(
  {
    model,
    reasoningEffort,
    task,
    workUnits = 1,
  }: {
    model: string;
    reasoningEffort: string;
    task: CodexGenerationTask;
    workUnits?: number;
  },
  storage: StorageLike | null = browserStorage(),
): CodexWaitEstimate {
  const factor = workloadFactor(task, workUnits);
  const samples = readHistory(storage)[
    historyKey(model, reasoningEffort, task)
  ] ?? [];

  if (samples.length) {
    const typicalMs = median(samples) * factor;
    return {
      minimumMs: Math.max(10_000, Math.round(typicalMs * 0.65)),
      maximumMs: Math.min(
        MAX_ESTIMATE_MS,
        Math.max(20_000, Math.round(typicalMs * 1.8)),
      ),
      basis: 'observed',
      sampleCount: samples.length,
    };
  }

  const baseline = taskBaselines[task];
  // Unknown future effort identifiers get a conservative high-latency
  // estimate instead of being treated like a fast/default level.
  const effortFactor = effortMultipliers[reasoningEffort] ?? 4.5;
  return {
    minimumMs: Math.round(baseline.minimumMs * effortFactor * factor),
    maximumMs: Math.min(
      MAX_ESTIMATE_MS,
      Math.round(baseline.maximumMs * effortFactor * factor),
    ),
    basis: 'baseline',
    sampleCount: 0,
  };
}

export function recordCodexWaitSample(
  {
    model,
    reasoningEffort,
    task,
    workUnits = 1,
    elapsedMs,
  }: {
    model: string;
    reasoningEffort: string;
    task: CodexGenerationTask;
    workUnits?: number;
    elapsedMs: number;
  },
  storage: StorageLike | null = browserStorage(),
) {
  if (
    !storage ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 1_000 ||
    elapsedMs > MAX_ESTIMATE_MS
  ) return;

  const history = readHistory(storage);
  const key = historyKey(model, reasoningEffort, task);
  const normalizedMs = Math.round(elapsedMs / workloadFactor(task, workUnits));
  history[key] = [...(history[key] ?? []), normalizedMs].slice(-MAX_SAMPLES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Estimation history is optional and can remain unavailable.
  }
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = seconds / 60;
  if (minutes < 10) {
    return `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 1}).format(minutes)} phút`;
  }
  if (minutes < 90) return `${Math.round(minutes)} phút`;
  return `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 1}).format(minutes / 60)} giờ`;
}

export function formatCodexWaitEstimate(estimate: CodexWaitEstimate) {
  return `${formatDuration(estimate.minimumMs)}–${formatDuration(estimate.maximumMs)}`;
}
