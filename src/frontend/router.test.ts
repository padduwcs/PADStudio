import assert from 'node:assert/strict';
import test from 'node:test';
import {
  navigate,
  navigateDiscardingPendingChanges,
  parseRoute,
  projectContentPath,
  projectProductionPath,
  projectPronunciationPath,
  projectRenderPath,
  projectResumePath,
  projectScenesPath,
  projectStepLabel,
  projectWorkflowPath,
  registerNavigationGuard,
  workflowStepIndex,
} from './router.ts';

test('parseRoute chỉ nhận năm URL workflow hiện tại', () => {
  assert.deepEqual(parseRoute('/'), {name: 'new-project'});
  assert.deepEqual(parseRoute('/projects/du-an-01/content'), {
    name: 'project-content',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/pronunciation/'), {
    name: 'project-pronunciation',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/production'), {
    name: 'project-production',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/scenes'), {
    name: 'project-scenes',
    projectId: 'du-an-01',
  });
  assert.deepEqual(parseRoute('/projects/du-an-01/render'), {
    name: 'project-render',
    projectId: 'du-an-01',
  });
});

test('URL legacy và encoding lỗi đều quay về màn tạo project', () => {
  assert.deepEqual(parseRoute('/projects/du-an-01/topic'), {name: 'new-project'});
  assert.deepEqual(parseRoute('/projects/du-an-01/scene-review'), {name: 'new-project'});
  assert.deepEqual(parseRoute('/projects/%E0%A4%A/content'), {name: 'new-project'});
});

test('path helper và chỉ số workflow dùng đúng năm bước', () => {
  const projectId = 'du an';
  assert.equal(projectContentPath(projectId), '/projects/du%20an/content');
  assert.equal(projectPronunciationPath(projectId), '/projects/du%20an/pronunciation');
  assert.equal(projectProductionPath(projectId), '/projects/du%20an/production');
  assert.equal(projectScenesPath(projectId), '/projects/du%20an/scenes');
  assert.equal(projectRenderPath(projectId), '/projects/du%20an/render');
  assert.equal(projectWorkflowPath(projectId, 0), projectContentPath(projectId));
  assert.equal(projectWorkflowPath(projectId, 4), projectRenderPath(projectId));
  assert.equal(workflowStepIndex({name: 'project-content'}), 0);
  assert.equal(workflowStepIndex({name: 'project-pronunciation'}), 1);
  assert.equal(workflowStepIndex({name: 'project-production'}), 2);
  assert.equal(workflowStepIndex({name: 'project-scenes'}), 3);
  assert.equal(workflowStepIndex({name: 'project-render'}), 4);
});

test('resume ánh xạ trực tiếp state workflow hiện tại', () => {
  const project = {id: 'du-an', currentStep: 'production'} as unknown as import('../shared/topic.ts').TopicProject;
  assert.equal(projectResumePath(project), '/projects/du-an/production');
  assert.equal(projectResumePath({...project, currentStep: 'render'}), '/projects/du-an/render');
  assert.equal(projectStepLabel('render'), 'Bước 05 · Xuất video');
});

test('navigate chờ navigation guard và có thể bỏ qua guard khi cần', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const popStateDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PopStateEvent');
  const navigations: Array<{path: string; replace: boolean}> = [];
  let historyState: unknown = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      history: {
        get state() { return historyState; },
        pushState: (state: unknown, _title: string, path?: string) => {
          historyState = state;
          if (path !== undefined) navigations.push({path, replace: false});
        },
        replaceState: (state: unknown, _title: string, path?: string) => {
          historyState = state;
          if (path !== undefined) navigations.push({path, replace: true});
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
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(navigations, []);
    navigateDiscardingPendingChanges('/deleted');
    assert.deepEqual(navigations, [{path: '/deleted', replace: false}]);
    navigations.length = 0;
    unregister();
    unregister = registerNavigationGuard(async () => true);
    navigate('/saved');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(navigations, [{path: '/saved', replace: false}]);
  } finally {
    unregister();
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else delete (globalThis as {window?: unknown}).window;
    if (popStateDescriptor) Object.defineProperty(globalThis, 'PopStateEvent', popStateDescriptor);
    else delete (globalThis as {PopStateEvent?: unknown}).PopStateEvent;
  }
});
