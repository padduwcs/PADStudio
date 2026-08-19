import type {CodexModelSummary} from '../shared/codex.ts';
import {effortMultipliers, type CodexGenerationTask} from './codexWaitEstimate.ts';

/**
 * Every AI stage (narration draft, pronunciation audit, AI Visual Planner,
 * Motion Canvas scene generation, ...) keeps its own model/reasoning
 * selection. This module is the pure, storage-injectable logic behind that
 * per-task selection — kept separate from useCodexConnection.ts so it can be
 * unit tested without rendering React.
 */

export interface CodexTaskSelection {
  model: string;
  reasoningEffort: string;
}

export type CodexTaskSelections = Record<CodexGenerationTask, CodexTaskSelection>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CODEX_TASKS: CodexGenerationTask[] = [
  'narration',
  'outline',
  'pronunciation',
  'visualPlanner',
  'motionCanvas',
];

// Unprefixed keys are the legacy (pre-task-scoped) global selection. They
// are only ever read as a best-effort seed for a task with no selection of
// its own yet, and are never written back to.
export const LEGACY_MODEL_STORAGE_KEY = 'pad-studio:codex-model';
export const LEGACY_REASONING_STORAGE_KEY = 'pad-studio:codex-reasoning-by-model';
export const DEFAULT_CODEX_MODEL = 'gpt-5.5';
export const DEFAULT_CODEX_REASONING_EFFORT = 'low';
const MANUAL_SELECTION_STORAGE_PREFIX = 'pad-studio:codex-manual-selection:v1';

// Pronunciation audit used to share the 'outline' task slot. A user who
// already picked a model/effort for 'outline' before the split gets it
// seeded once into 'pronunciation' too, so the split doesn't silently reset
// their choice. Once 'pronunciation' has its own stored value, this is
// never consulted again.
const PRONUNCIATION_LEGACY_SOURCE_TASK: CodexGenerationTask = 'outline';

function taskModelStorageKey(task: CodexGenerationTask) {
  return `${LEGACY_MODEL_STORAGE_KEY}:${task}`;
}

function taskReasoningStorageKey(task: CodexGenerationTask) {
  return `${LEGACY_REASONING_STORAGE_KEY}:${task}`;
}

function manualSelectionStorageKey(task: CodexGenerationTask) {
  return `${MANUAL_SELECTION_STORAGE_PREFIX}:${task}`;
}

function hasManualSelection(storage: StorageLike | null, task: CodexGenerationTask) {
  if (!storage) return false;
  try {
    return storage.getItem(manualSelectionStorageKey(task)) === 'true';
  } catch {
    return false;
  }
}

function markManualSelection(storage: StorageLike | null, task: CodexGenerationTask) {
  if (!storage) return;
  try {
    storage.setItem(manualSelectionStorageKey(task), 'true');
  } catch {
    // The selection can remain session-only if storage is unavailable.
  }
}

function readJsonMap(
  storage: StorageLike | null,
  key: string,
): Record<string, string> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function storedModel(
  storage: StorageLike | null,
  task: CodexGenerationTask,
) {
  if (!storage) return '';
  try {
    return (
      storage.getItem(taskModelStorageKey(task)) ||
      (task === 'pronunciation'
        ? storage.getItem(taskModelStorageKey(PRONUNCIATION_LEGACY_SOURCE_TASK))
        : '') ||
      storage.getItem(LEGACY_MODEL_STORAGE_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export function storedReasoningForModel(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
) {
  if (!model) return '';
  const taskMap = readJsonMap(storage, taskReasoningStorageKey(task));
  if (typeof taskMap[model] === 'string') return taskMap[model];
  if (task === 'pronunciation') {
    const seedMap = readJsonMap(storage, taskReasoningStorageKey(PRONUNCIATION_LEGACY_SOURCE_TASK));
    if (typeof seedMap[model] === 'string') return seedMap[model];
  }
  const legacyMap = readJsonMap(storage, LEGACY_REASONING_STORAGE_KEY);
  return typeof legacyMap[model] === 'string' ? legacyMap[model] : '';
}

export function saveModel(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
  manual = true,
) {
  if (!storage || !model) return;
  try {
    storage.setItem(taskModelStorageKey(task), model);
    if (manual) markManualSelection(storage, task);
  } catch {
    // Selection can remain session-only if storage is unavailable.
  }
}

export function saveReasoning(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
  reasoningEffort: string,
  manual = true,
) {
  if (!storage || !model || !reasoningEffort) return;
  try {
    const key = taskReasoningStorageKey(task);
    const selections = readJsonMap(storage, key);
    storage.setItem(
      key,
      JSON.stringify({...selections, [model]: reasoningEffort}),
    );
    if (manual) markManualSelection(storage, task);
  } catch {
    // Keep the selection for this session.
  }
}

/** Picks the cheapest supported tier so a task with no remembered choice of
 * its own starts at minimum cost, rather than the provider's declared
 * default (which is often a mid/high tier). An unranked effort identifier
 * is treated as expensive so it is never picked over a known cheap one. */
export function cheapestReasoningEffort(supportedReasoningEfforts: string[]) {
  return [...supportedReasoningEfforts].sort(
    (left, right) =>
      (effortMultipliers[left] ?? Infinity) -
      (effortMultipliers[right] ?? Infinity),
  )[0] ?? '';
}

export function preferredReasoningEffort(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: CodexModelSummary,
  useRememberedSelection = true,
) {
  const remembered = useRememberedSelection
    ? storedReasoningForModel(storage, task, model.model)
    : '';
  if (model.supportedReasoningEfforts.includes(remembered)) return remembered;
  if (
    model.model === DEFAULT_CODEX_MODEL &&
    model.supportedReasoningEfforts.includes(DEFAULT_CODEX_REASONING_EFFORT)
  ) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }
  return cheapestReasoningEffort(model.supportedReasoningEfforts);
}

export function emptyTaskSelections(): CodexTaskSelections {
  return Object.fromEntries(
    CODEX_TASKS.map((task) => [task, {model: '', reasoningEffort: ''}]),
  ) as CodexTaskSelections;
}

/** Seeds each task's remembered model before the Codex model catalog has
 * loaded. reasoningEffort is resolved once real model capabilities are
 * known, via recomputeTaskSelections. */
export function initialTaskSelections(
  storage: StorageLike | null,
): CodexTaskSelections {
  const selections = emptyTaskSelections();
  for (const task of CODEX_TASKS) {
    selections[task] = {model: storedModel(storage, task), reasoningEffort: ''};
  }
  return selections;
}

/**
 * Derives each task's next selection independently from its own remembered
 * model — one task's outcome never depends on, or overwrites, another's.
 * Used after the model catalog refreshes (login, reconnect, ...).
 */
export function recomputeTaskSelections(
  storage: StorageLike | null,
  previous: CodexTaskSelections,
  availableModels: CodexModelSummary[],
): CodexTaskSelections {
  const next = emptyTaskSelections();
  for (const task of CODEX_TASKS) {
    const useRememberedSelection = hasManualSelection(storage, task);
    const rememberedModel = useRememberedSelection
      ? previous[task]?.model || storedModel(storage, task)
      : '';
    const matched = availableModels.find((item) => item.model === rememberedModel);
    const configuredDefault = availableModels.find(
      (item) => item.model === DEFAULT_CODEX_MODEL,
    );
    const chosen =
      matched ??
      configuredDefault ??
      availableModels.find((item) => item.isDefault) ??
      availableModels[0];
    const model = chosen?.model ?? '';
    const reasoningEffort = chosen
      ? preferredReasoningEffort(storage, task, chosen, useRememberedSelection)
      : '';
    next[task] = {model, reasoningEffort};
    if (model) saveModel(storage, task, model, useRememberedSelection);
    if (reasoningEffort) {
      saveReasoning(storage, task, model, reasoningEffort, useRememberedSelection);
    }
  }
  return next;
}

export function selectionAfterModelChange(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
  availableModels: CodexModelSummary[],
): CodexTaskSelection | null {
  const selected = availableModels.find((item) => item.model === model);
  if (!selected) return null;
  const reasoningEffort = preferredReasoningEffort(storage, task, selected);
  saveModel(storage, task, model);
  if (reasoningEffort) saveReasoning(storage, task, model, reasoningEffort);
  return {model, reasoningEffort};
}

export function selectionAfterReasoningChange(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  currentModel: string,
  reasoningEffort: string,
  availableModels: CodexModelSummary[],
): CodexTaskSelection | null {
  const selected = availableModels.find((item) => item.model === currentModel);
  if (!selected?.supportedReasoningEfforts.includes(reasoningEffort)) return null;
  saveReasoning(storage, task, selected.model, reasoningEffort);
  return {model: selected.model, reasoningEffort};
}
