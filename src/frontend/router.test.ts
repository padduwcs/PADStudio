import assert from 'node:assert/strict';
import test from 'node:test';
import {
  navigate,
  navigateDiscardingPendingChanges,
  parseRoute,
  projectResumePath,
  projectStepLabel,
  projectStepPath,
  registerNavigationGuard,
} from './router.ts';

test('parseRoute đọc route project hợp lệ', () => {
  assert.deepEqual(parseRoute('/projects/du-an-01/topic'), {
    name: 'project-topic',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/narration'), {
    name: 'project-narration',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/production'), {
    name: 'project-production',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/scene-review'), {
    name: 'project-scene-review',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/outline/'), {
    name: 'project-outline',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/voice-visual'), {
    name: 'project-voice-visual',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/motion-canvas'), {
    name: 'project-motion-canvas',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/voice'), {
    name: 'project-voice',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/sync'), {
    name: 'project-sync',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/layout'), {
    name: 'project-layout',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/render'), {
    name: 'project-render',
    projectId: 'du-an-01',
  });
});

test('parseRoute không crash với URL encoding hỏng', () => {
  assert.deepEqual(parseRoute('/projects/%E0%A4%A/topic'), {
    name: 'new-topic',
  });
});

test('projectStepPath ánh xạ tập trung các bước đã hỗ trợ', () => {
  assert.equal(
    projectStepPath('du an', 'topic'),
    '/projects/du%20an/topic',
  );
  assert.equal(
    projectStepPath('du an', 'outline'),
    '/projects/du%20an/outline',
  );
  assert.equal(
    projectStepPath('du an', 'voiceVisual'),
    '/projects/du%20an/voice-visual',
  );
  assert.equal(
    projectStepPath('du an', 'motionCanvas'),
    '/projects/du%20an/scene-review',
  );
  assert.equal(
    projectStepPath('du an', 'voice'),
    '/projects/du%20an/voice',
  );
  assert.equal(
    projectStepPath('du an', 'sync'),
    '/projects/du%20an/sync',
  );
  assert.equal(
    projectStepPath('du an', 'layout'),
    '/projects/du%20an/layout',
  );
  assert.equal(
    projectStepPath('du an', 'render'),
    '/projects/du%20an/render',
  );
});

test('projectStepLabel không gắn nhầm project Layout hoặc Render về bước đầu', () => {
  assert.equal(projectStepLabel('topic'), 'Bước 01 · Chủ đề');
  assert.equal(projectStepLabel('layout'), 'Bước 07 · Layout Editor');
  assert.equal(projectStepLabel('render'), 'Bước 08 · Render cuối');
  assert.equal(projectStepLabel('render', true), 'Bước 05 · Xuất video');
});

test('projectResumePath đưa project lời thoại thẳng về đúng luồng 5 bước', () => {
  const directProject = {
    id: 'du-an-truc-tiep',
    currentStep: 'voice',
    outline: {generation: {promptVersion: 'direct-narration-v1'}},
    voiceVisualPlan: {generation: {promptVersion: 'direct-narration-v1'}},
  } as unknown as import('../shared/topic.ts').TopicProject;

  assert.equal(
    projectResumePath(directProject),
    '/projects/du-an-truc-tiep/production',
  );
  assert.equal(
    projectResumePath({...directProject, currentStep: 'sync'}),
    '/projects/du-an-truc-tiep/scene-review',
  );
  assert.equal(
    projectResumePath({...directProject, currentStep: 'render'}),
    '/projects/du-an-truc-tiep/render',
  );
});

test('navigate chờ navigation guard và không rời trang khi lưu thất bại', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  const popStateDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'PopStateEvent',
  );
  const navigations: Array<{path: string; replace: boolean}> = [];
  let historyState: unknown = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      history: {
        get state() {
          return historyState;
        },
        pushState: (state: unknown, _title: string, path?: string) => {
          historyState = state;
          if (path !== undefined) {
            navigations.push({path, replace: false});
          }
        },
        replaceState: (state: unknown, _title: string, path?: string) => {
          historyState = state;
          if (path !== undefined) {
            navigations.push({path, replace: true});
          }
        },
      },
      dispatchEvent: () => true,
    },
  });
  Object.defineProperty(globalThis, 'PopStateEvent', {
    configurable: true,
    value: class {
      readonly type: string;

      constructor(type: string) {
        this.type = type;
      }
    },
  });

  let unregister = registerNavigationGuard(() => false);
  try {
    navigate('/blocked');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(navigations, []);

    navigateDiscardingPendingChanges('/deleted');
    assert.deepEqual(navigations, [
      {path: '/deleted', replace: false},
    ]);
    navigations.length = 0;

    unregister();
    unregister = registerNavigationGuard(async () => true);
    navigate('/saved');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(navigations, [
      {path: '/saved', replace: false},
    ]);
  } finally {
    unregister();
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      delete (globalThis as {window?: unknown}).window;
    }
    if (popStateDescriptor) {
      Object.defineProperty(
        globalThis,
        'PopStateEvent',
        popStateDescriptor,
      );
    } else {
      delete (globalThis as {PopStateEvent?: unknown}).PopStateEvent;
    }
  }
});
