import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_MODEL_STORAGE_KEY,
  LEGACY_REASONING_STORAGE_KEY,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  cheapestReasoningEffort,
  emptyTaskSelections,
  initialTaskSelections,
  recomputeTaskSelections,
  saveModel,
  saveReasoning,
  selectionAfterModelChange,
  selectionAfterReasoningChange,
  storedModel,
  storedReasoningForModel,
} from './codexTaskSelection.ts';
import type {CodexModelSummary} from '../shared/codex.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

function model(overrides: Partial<CodexModelSummary> = {}): CodexModelSummary {
  return {
    id: overrides.model ?? 'model-a',
    model: 'model-a',
    displayName: 'Model A',
    description: '',
    isDefault: false,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    ...overrides,
  };
}

test('selection cho một task không làm đổi selection của task khác', () => {
  const storage = memoryStorage();
  const modelA = model({id: 'model-a', model: 'model-a'});
  const modelB = model({id: 'model-b', model: 'model-b', isDefault: true});
  const available = [modelA, modelB];

  const afterPlanner = selectionAfterModelChange(storage, 'visualPlanner', 'model-a', available);
  const afterMotionCanvas = selectionAfterModelChange(storage, 'motionCanvas', 'model-b', available);

  // No remembered choice yet, so both default to the cheapest supported
  // tier ('low'), not the model's declared default ('medium').
  assert.deepEqual(afterPlanner, {model: 'model-a', reasoningEffort: 'low'});
  assert.deepEqual(afterMotionCanvas, {model: 'model-b', reasoningEffort: 'low'});
  assert.equal(storedModel(storage, 'visualPlanner'), 'model-a');
  assert.equal(storedModel(storage, 'motionCanvas'), 'model-b');

  // Changing the planner's reasoning effort must not touch motionCanvas's.
  selectionAfterReasoningChange(storage, 'visualPlanner', 'model-a', 'high', available);
  assert.equal(storedReasoningForModel(storage, 'visualPlanner', 'model-a'), 'high');
  assert.equal(storedReasoningForModel(storage, 'motionCanvas', 'model-b'), 'low');
});

test('recomputeTaskSelections cho planner và scene generator model khác nhau trong cùng một lượt refresh', () => {
  const storage = memoryStorage();
  saveModel(storage, 'visualPlanner', 'model-a');
  saveReasoning(storage, 'visualPlanner', 'model-a', 'high');
  saveModel(storage, 'motionCanvas', 'model-b');
  saveReasoning(storage, 'motionCanvas', 'model-b', 'low');
  const available = [
    model({id: 'model-a', model: 'model-a'}),
    model({id: 'model-b', model: 'model-b', isDefault: true}),
  ];

  const next = recomputeTaskSelections(storage, emptyTaskSelections(), available);

  assert.equal(next.visualPlanner.model, 'model-a');
  assert.equal(next.visualPlanner.reasoningEffort, 'high');
  assert.equal(next.motionCanvas.model, 'model-b');
  assert.equal(next.motionCanvas.reasoningEffort, 'low');
  assert.notEqual(next.visualPlanner.model, next.motionCanvas.model);
});

test('legacy global selection chỉ seed task chưa từng được chọn riêng, không ghi đè task đã có lựa chọn', () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_MODEL_STORAGE_KEY, 'legacy-model');
  storage.setItem(LEGACY_REASONING_STORAGE_KEY, JSON.stringify({'legacy-model': 'high'}));

  // A task with no task-scoped key yet falls back to the legacy global one.
  assert.equal(storedModel(storage, 'visualPlanner'), 'legacy-model');
  assert.equal(storedReasoningForModel(storage, 'visualPlanner', 'legacy-model'), 'high');

  // Once a task saves its own choice, that choice wins over the legacy key.
  saveModel(storage, 'visualPlanner', 'model-a');
  saveReasoning(storage, 'visualPlanner', 'model-a', 'medium');
  assert.equal(storedModel(storage, 'visualPlanner'), 'model-a');

  // motionCanvas never chose anything of its own, so it still falls back to
  // the same legacy value — independently from visualPlanner's new choice.
  assert.equal(storedModel(storage, 'motionCanvas'), 'legacy-model');

  const seeded = initialTaskSelections(storage);
  assert.equal(seeded.visualPlanner.model, 'model-a');
  assert.equal(seeded.motionCanvas.model, 'legacy-model');
});

test('pronunciation seed một lần từ lựa chọn outline cũ, không ghi đè khi đã tự chọn', () => {
  const storage = memoryStorage();
  saveModel(storage, 'outline', 'outline-model');
  saveReasoning(storage, 'outline', 'outline-model', 'high');

  // Before this split, pronunciation audit reused the 'outline' slot. A user
  // upgrading must see their old choice carried over into 'pronunciation'.
  assert.equal(storedModel(storage, 'pronunciation'), 'outline-model');
  assert.equal(storedReasoningForModel(storage, 'pronunciation', 'outline-model'), 'high');

  // Once pronunciation saves its own choice, that wins — and no longer
  // tracks later changes to outline's selection.
  saveModel(storage, 'pronunciation', 'pronunciation-model');
  saveReasoning(storage, 'pronunciation', 'pronunciation-model', 'low');
  saveModel(storage, 'outline', 'a-different-outline-model');
  assert.equal(storedModel(storage, 'pronunciation'), 'pronunciation-model');
  assert.equal(storedReasoningForModel(storage, 'pronunciation', 'pronunciation-model'), 'low');
  assert.equal(storedModel(storage, 'outline'), 'a-different-outline-model');
});

test('pronunciation không seed từ outline khi outline cũng chưa từng được chọn', () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_MODEL_STORAGE_KEY, 'legacy-model');

  // With neither pronunciation nor outline scoped yet, pronunciation still
  // falls back to the same pre-task-scoping legacy key as every other task.
  assert.equal(storedModel(storage, 'pronunciation'), 'legacy-model');
});

test('selectionAfterModelChange bỏ qua model không có trong catalog', () => {
  const storage = memoryStorage();
  const result = selectionAfterModelChange(storage, 'visualPlanner', 'unknown-model', [model()]);
  assert.equal(result, null);
});

test('cheapestReasoningEffort chọn mức rẻ nhất và bỏ qua giá trị không xếp hạng được', () => {
  assert.equal(cheapestReasoningEffort(['medium', 'low', 'high']), 'low');
  assert.equal(cheapestReasoningEffort(['high', 'xhigh']), 'high');
  // An unranked identifier must never be picked over a known cheap tier.
  assert.equal(cheapestReasoningEffort(['exotic-tier', 'low']), 'low');
  assert.equal(cheapestReasoningEffort([]), '');
});

test('selectionAfterReasoningChange bỏ qua reasoning không được model hỗ trợ', () => {
  const storage = memoryStorage();
  selectionAfterModelChange(storage, 'visualPlanner', 'model-a', [model()]);
  const result = selectionAfterReasoningChange(storage, 'visualPlanner', 'model-a', 'ultra', [model()]);
  assert.equal(result, null);
});

test('unselected tasks default to gpt-5.5 with low reasoning', () => {
  const storage = memoryStorage();
  const available = [
    model({id: 'provider-default', model: 'provider-default', isDefault: true}),
    model({
      id: DEFAULT_CODEX_MODEL,
      model: DEFAULT_CODEX_MODEL,
      displayName: 'GPT-5.5',
      supportedReasoningEfforts: ['none', DEFAULT_CODEX_REASONING_EFFORT, 'medium'],
      defaultReasoningEffort: 'medium',
    }),
  ];

  const next = recomputeTaskSelections(storage, emptyTaskSelections(), available);

  for (const selection of Object.values(next)) {
    assert.deepEqual(selection, {
      model: DEFAULT_CODEX_MODEL,
      reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    });
  }
});

test('stored automatic defaults are upgraded to gpt-5.5 with low reasoning', () => {
  const storage = memoryStorage();
  storage.setItem('pad-studio:codex-model:visualPlanner', 'provider-default');
  storage.setItem(
    'pad-studio:codex-reasoning-by-model:visualPlanner',
    JSON.stringify({'provider-default': 'high'}),
  );
  const available = [
    model({id: 'provider-default', model: 'provider-default', isDefault: true}),
    model({
      id: DEFAULT_CODEX_MODEL,
      model: DEFAULT_CODEX_MODEL,
      supportedReasoningEfforts: [DEFAULT_CODEX_REASONING_EFFORT, 'medium'],
    }),
  ];

  const next = recomputeTaskSelections(storage, initialTaskSelections(storage), available);

  assert.deepEqual(next.visualPlanner, {
    model: DEFAULT_CODEX_MODEL,
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
  });
});
