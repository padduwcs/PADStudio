import type {CodexModelSummary} from '../shared/codex.ts';
import type {CodexGenerationTask} from './codexWaitEstimate.ts';

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
  'visualPlanner',
  'motionCanvas',
];

// Unprefixed keys are the legacy (pre-task-scoped) global selection. They
// are only ever read as a best-effort seed for a task with no selection of
// its own yet, and are never written back to.
export const LEGACY_MODEL_STORAGE_KEY = 'pad-studio:codex-model';
export const LEGACY_REASONING_STORAGE_KEY = 'pad-studio:codex-reasoning-by-model';

function taskModelStorageKey(task: CodexGenerationTask) {
  return `${LEGACY_MODEL_STORAGE_KEY}:${task}`;
}

function taskReasoningStorageKey(task: CodexGenerationTask) {
  return `${LEGACY_REASONING_STORAGE_KEY}:${task}`;
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
  const legacyMap = readJsonMap(storage, LEGACY_REASONING_STORAGE_KEY);
  return typeof legacyMap[model] === 'string' ? legacyMap[model] : '';
}

export function saveModel(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
) {
  if (!storage || !model) return;
  try {
    storage.setItem(taskModelStorageKey(task), model);
  } catch {
    // Selection can remain session-only if storage is unavailable.
  }
}

export function saveReasoning(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: string,
  reasoningEffort: string,
) {
  if (!storage || !model || !reasoningEffort) return;
  try {
    const key = taskReasoningStorageKey(task);
    const selections = readJsonMap(storage, key);
    storage.setItem(
      key,
      JSON.stringify({...selections, [model]: reasoningEffort}),
    );
  } catch {
    // Keep the selection for this session.
  }
}

export function preferredReasoningEffort(
  storage: StorageLike | null,
  task: CodexGenerationTask,
  model: CodexModelSummary,
) {
  const remembered = storedReasoningForModel(storage, task, model.model);
  if (model.supportedReasoningEfforts.includes(remembered)) return remembered;
  if (
    model.defaultReasoningEffort &&
    model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)
  ) return model.defaultReasoningEffort;
  return model.supportedReasoningEfforts[0] ?? '';
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
    const rememberedModel = previous[task]?.model || storedModel(storage, task);
    const matched = availableModels.find((item) => item.model === rememberedModel);
    const chosen =
      matched ?? availableModels.find((item) => item.isDefault) ?? availableModels[0];
    const model = chosen?.model ?? '';
    const reasoningEffort = chosen
      ? preferredReasoningEffort(storage, task, chosen)
      : '';
    next[task] = {model, reasoningEffort};
    if (model) saveModel(storage, task, model);
    if (reasoningEffort) saveReasoning(storage, task, model, reasoningEffort);
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
