import {useEffect, useRef, useState} from 'react';
import type {ProjectStep, TopicProject} from '../shared/topic.ts';

type NavigationGuard = () => boolean | Promise<boolean>;

const navigationGuards = new Set<NavigationGuard>();
const HISTORY_INDEX_KEY = '__padStudioHistoryIndex';
let navigationRequestRevision = 0;
let bypassNextPopStateGuard = false;
let currentHistoryIndex: number | null = null;

function readHistoryIndex(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const index = (value as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0
    ? index
    : null;
}

function historyStateWithIndex(index: number) {
  const current = window.history.state;
  return {
    ...(current && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {}),
    [HISTORY_INDEX_KEY]: index,
  };
}

function ensureCurrentHistoryIndex() {
  if (currentHistoryIndex !== null) return currentHistoryIndex;
  const stored = readHistoryIndex(window.history.state);
  currentHistoryIndex = stored ?? 0;
  if (stored === null) {
    window.history.replaceState(historyStateWithIndex(currentHistoryIndex), '');
  }
  return currentHistoryIndex;
}

async function navigationGuardsAllow() {
  for (const guard of [...navigationGuards]) {
    try {
      if (!(await guard())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Used before destructive actions which do not navigate until after commit. */
export function requestNavigationPermission() {
  return navigationGuardsAllow();
}

function commitNavigation(pathname: string, replace: boolean) {
  navigationRequestRevision++;
  const currentIndex = ensureCurrentHistoryIndex();
  const nextIndex = replace ? currentIndex : currentIndex + 1;
  const state = historyStateWithIndex(nextIndex);
  if (replace) window.history.replaceState(state, '', pathname);
  else window.history.pushState(state, '', pathname);
  currentHistoryIndex = nextIndex;
  bypassNextPopStateGuard = true;
  window.dispatchEvent(new PopStateEvent('popstate'));
  bypassNextPopStateGuard = false;
}

function requestGuardedNavigation(pathname: string, replace: boolean) {
  const requestRevision = ++navigationRequestRevision;
  void navigationGuardsAllow().then((allowed) => {
    if (allowed && requestRevision === navigationRequestRevision) {
      commitNavigation(pathname, replace);
    }
  });
}

export function registerNavigationGuard(guard: NavigationGuard) {
  navigationGuards.add(guard);
  return () => {
    navigationGuards.delete(guard);
  };
}

export type AppRoute =
  | {name: 'new-project'}
  | {name: 'project-content'; projectId: string}
  | {name: 'project-pronunciation'; projectId: string}
  | {name: 'project-production'; projectId: string}
  | {name: 'project-scenes'; projectId: string}
  | {name: 'project-render'; projectId: string};

export type WorkflowStepIndex = 0 | 1 | 2 | 3 | 4;

export function workflowStepIndex(route: Pick<AppRoute, 'name'>): WorkflowStepIndex {
  switch (route.name) {
    case 'project-pronunciation': return 1;
    case 'project-production': return 2;
    case 'project-scenes': return 3;
    case 'project-render': return 4;
    case 'new-project':
    case 'project-content': return 0;
  }
}

function decodeProjectId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function projectRoute(pathname: string, segment: string, name: Exclude<AppRoute['name'], 'new-project'>) {
  const match = new RegExp(`^/projects/([^/]+)/${segment}/?$`).exec(pathname);
  if (!match?.[1]) return null;
  const projectId = decodeProjectId(match[1]);
  return projectId
    ? {name, projectId} as AppRoute
    : {name: 'new-project'} as AppRoute;
}

export function parseRoute(pathname: string): AppRoute {
  if (pathname === '/' || pathname === '') return {name: 'new-project'};
  return projectRoute(pathname, 'content', 'project-content') ??
    projectRoute(pathname, 'pronunciation', 'project-pronunciation') ??
    projectRoute(pathname, 'production', 'project-production') ??
    projectRoute(pathname, 'scenes', 'project-scenes') ??
    projectRoute(pathname, 'render', 'project-render') ??
    {name: 'new-project'};
}

export function navigate(pathname: string, replace = false) {
  if (navigationGuards.size > 0) {
    requestGuardedNavigation(pathname, replace);
    return;
  }
  commitNavigation(pathname, replace);
}

export function navigateDiscardingPendingChanges(pathname: string, replace = false) {
  commitNavigation(pathname, replace);
}

function projectPath(projectId: string, page: string) {
  return `/projects/${encodeURIComponent(projectId)}/${page}`;
}

export function projectContentPath(projectId: string) { return projectPath(projectId, 'content'); }
export function projectPronunciationPath(projectId: string) { return projectPath(projectId, 'pronunciation'); }
export function projectProductionPath(projectId: string) { return projectPath(projectId, 'production'); }
export function projectScenesPath(projectId: string) { return projectPath(projectId, 'scenes'); }
export function projectRenderPath(projectId: string) { return projectPath(projectId, 'render'); }

export function projectWorkflowPath(projectId: string, step: WorkflowStepIndex) {
  const path = [
    projectContentPath,
    projectPronunciationPath,
    projectProductionPath,
    projectScenesPath,
    projectRenderPath,
  ][step]!;
  return path(projectId);
}

function workflowStepForProjectStep(step: ProjectStep): WorkflowStepIndex {
  switch (step) {
    case 'content': return 0;
    case 'pronunciation': return 1;
    case 'production': return 2;
    case 'scenes': return 3;
    case 'render': return 4;
  }
}

const workflowStepLabels = [
  'Bước 01 · Nội dung',
  'Bước 02 · Cách đọc',
  'Bước 03 · Giọng đọc & scene',
  'Bước 04 · Chỉnh scene',
  'Bước 05 · Xuất video',
] as const;

export function projectStepLabel(step: ProjectStep) {
  return workflowStepLabels[workflowStepForProjectStep(step)];
}

export function projectResumePath(project: TopicProject) {
  return projectWorkflowPath(project.id, workflowStepForProjectStep(project.currentStep));
}

export function useAppRoute() {
  const initialHistoryIndex = ensureCurrentHistoryIndex();
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));
  const currentPathRef = useRef(window.location.pathname);
  const currentIndexRef = useRef(initialHistoryIndex);

  useEffect(() => {
    let pendingPopNavigation: {
      targetPath: string;
      targetIndex: number;
      delta: number;
      requestRevision: number;
      allowed: Promise<boolean>;
      phase: 'restoring' | 'navigating';
    } | null = null;

    const publishRoute = (pathname: string, historyIndex: number) => {
      currentPathRef.current = pathname;
      currentIndexRef.current = historyIndex;
      currentHistoryIndex = historyIndex;
      setRoute(parseRoute(pathname));
    };

    const updateRoute = (event: PopStateEvent) => {
      const requestedPath = window.location.pathname;
      const requestedIndex = readHistoryIndex(event.state) ?? readHistoryIndex(window.history.state);
      if (bypassNextPopStateGuard) {
        bypassNextPopStateGuard = false;
        publishRoute(requestedPath, requestedIndex ?? ensureCurrentHistoryIndex());
        return;
      }
      if (pendingPopNavigation) {
        const pending = pendingPopNavigation;
        if (pending.phase === 'restoring' && requestedIndex === currentIndexRef.current) {
          void pending.allowed.then((allowed) => {
            if (pendingPopNavigation !== pending || pending.requestRevision !== navigationRequestRevision) {
              if (pendingPopNavigation === pending) pendingPopNavigation = null;
              return;
            }
            if (!allowed) {
              pendingPopNavigation = null;
              return;
            }
            pending.phase = 'navigating';
            window.history.go(pending.delta);
          });
          return;
        }
        if (pending.phase === 'navigating' && requestedIndex === pending.targetIndex) {
          pendingPopNavigation = null;
          publishRoute(pending.targetPath, pending.targetIndex);
          return;
        }
        pendingPopNavigation = null;
      }
      if (navigationGuards.size > 0 && requestedPath !== currentPathRef.current && requestedIndex !== null && requestedIndex !== currentIndexRef.current) {
        const delta = requestedIndex - currentIndexRef.current;
        const requestRevision = ++navigationRequestRevision;
        pendingPopNavigation = {
          targetPath: requestedPath,
          targetIndex: requestedIndex,
          delta,
          requestRevision,
          allowed: navigationGuardsAllow(),
          phase: 'restoring',
        };
        window.history.go(-delta);
        return;
      }
      publishRoute(requestedPath, requestedIndex ?? currentIndexRef.current);
    };
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  return route;
}
