import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_MODEL_STORAGE_KEY,
  LEGACY_REASONING_STORAGE_KEY,
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

  assert.deepEqual(afterPlanner, {model: 'model-a', reasoningEffort: 'medium'});
  assert.deepEqual(afterMotionCanvas, {model: 'model-b', reasoningEffort: 'medium'});
  assert.equal(storedModel(storage, 'visualPlanner'), 'model-a');
  assert.equal(storedModel(storage, 'motionCanvas'), 'model-b');

  // Changing the planner's reasoning effort must not touch motionCanvas's.
  selectionAfterReasoningChange(storage, 'visualPlanner', 'model-a', 'high', available);
  assert.equal(storedReasoningForModel(storage, 'visualPlanner', 'model-a'), 'high');
  assert.equal(storedReasoningForModel(storage, 'motionCanvas', 'model-b'), 'medium');
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

test('selectionAfterModelChange bỏ qua model không có trong catalog', () => {
  const storage = memoryStorage();
  const result = selectionAfterModelChange(storage, 'visualPlanner', 'unknown-model', [model()]);
  assert.equal(result, null);
});

test('selectionAfterReasoningChange bỏ qua reasoning không được model hỗ trợ', () => {
  const storage = memoryStorage();
  selectionAfterModelChange(storage, 'visualPlanner', 'model-a', [model()]);
  const result = selectionAfterReasoningChange(storage, 'visualPlanner', 'model-a', 'ultra', [model()]);
  assert.equal(result, null);
});
