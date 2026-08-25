import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTaskCompletionMode,
  notifyTaskCompleted,
  notifyTaskFailed,
  setTaskCompletionMode,
  taskCompletionModeStorageKey,
  taskCompletionEventName,
  type TaskCompletionNotice,
} from './taskCompletionNotifications.ts';

test('completion notifications emit once for each task identity', t => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fakeWindow = new EventTarget();
  Object.defineProperties(fakeWindow, {
    hasFocus: {value: () => true},
    focus: {value: () => undefined},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  t.after(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  const received: TaskCompletionNotice[] = [];
  fakeWindow.addEventListener(taskCompletionEventName, event => {
    received.push((event as CustomEvent<TaskCompletionNotice>).detail);
  });

  const notice = {
    id: `test-task-${crypto.randomUUID()}`,
    title: 'Tác vụ đã xong',
    message: 'Kết quả đã sẵn sàng.',
  };
  notifyTaskCompleted(notice);
  notifyTaskCompleted(notice);

  assert.equal(received.length, 1);
  assert.deepEqual(
    {...received[0], createdAt: 0},
    {...notice, createdAt: 0, mode: 'normal', outcome: 'success'},
  );
});

test('failed tasks emit a distinct error outcome', t => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fakeWindow = new EventTarget();
  Object.defineProperty(fakeWindow, 'localStorage', {
    value: {getItem: () => 'normal'},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  t.after(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  const received: TaskCompletionNotice[] = [];
  fakeWindow.addEventListener(taskCompletionEventName, event => {
    received.push((event as CustomEvent<TaskCompletionNotice>).detail);
  });
  notifyTaskFailed({
    id: `failed-task-${crypto.randomUUID()}`,
    title: 'Không thể render video',
    message: 'Hãy kiểm tra lại cấu hình render.',
  });

  assert.equal(received[0]?.outcome, 'error');
});

test('completion notification mode is persisted and invalid values use the normal default', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };

  assert.equal(getTaskCompletionMode(storage), 'normal');
  setTaskCompletionMode('persistent', storage);
  assert.equal(values.get(taskCompletionModeStorageKey), 'persistent');
  assert.equal(getTaskCompletionMode(storage), 'persistent');
  values.set(taskCompletionModeStorageKey, 'unexpected');
  assert.equal(getTaskCompletionMode(storage), 'normal');
});

test('off mode suppresses completion events', t => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fakeWindow = new EventTarget();
  Object.defineProperty(fakeWindow, 'localStorage', {
    value: {
      getItem(key: string) {
        return key === taskCompletionModeStorageKey ? 'off' : null;
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  t.after(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  let received = false;
  fakeWindow.addEventListener(taskCompletionEventName, () => {
    received = true;
  });
  notifyTaskCompleted({
    id: `off-task-${crypto.randomUUID()}`,
    title: 'Tác vụ đã xong',
    message: 'Kết quả đã sẵn sàng.',
  });

  assert.equal(received, false);
});
