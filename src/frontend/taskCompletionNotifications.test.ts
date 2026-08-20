import assert from 'node:assert/strict';
import test from 'node:test';
import {
  notifyTaskCompleted,
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
    {...notice, createdAt: 0},
  );
});
