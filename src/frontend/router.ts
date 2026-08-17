import {useEffect, useRef, useState} from 'react';
import type {ProjectStep} from '../shared/topic.ts';

type NavigationGuard = () => boolean | Promise<boolean>;

const navigationGuards = new Set<NavigationGuard>();
const HISTORY_INDEX_KEY = '__padStudioHistoryIndex';
let navigationRequestRevision = 0;
let bypassNextPopStateGuard = false;
let currentHistoryIndex: number | null = null;

function readHistoryIndex(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }
  const index = (value as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return typeof index === 'number' &&
    Number.isSafeInteger(index) &&
    index >= 0
    ? index
    : null;
}

function historyStateWithIndex(index: number) {
  const current = window.history.state;
  return {
    ...(current &&
    typeof current === 'object' &&
    !Array.isArray(current)
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
    window.history.replaceState(
      historyStateWithIndex(currentHistoryIndex),
      '',
    );
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
  | {name: 'new-topic'}
  | {name: 'project-topic'; projectId: string}
  | {name: 'project-narration'; projectId: string}
  | {name: 'project-production'; projectId: string}
  | {name: 'project-outline'; projectId: string}
  | {name: 'project-voice-visual'; projectId: string}
  | {name: 'project-motion-canvas'; projectId: string}
  | {name: 'project-voice'; projectId: string}
  | {name: 'project-sync'; projectId: string}
  | {name: 'project-layout'; projectId: string}
  | {name: 'project-render'; projectId: string};

function decodeProjectId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): AppRoute {
  const topicMatch = /^\/projects\/([^/]+)\/topic\/?$/.exec(pathname);
  if (topicMatch?.[1]) {
    const projectId = decodeProjectId(topicMatch[1]);
    if (!projectId) return {name: 'new-topic'};

    return {
      name: 'project-topic',
      projectId,
    };
  }

  const narrationMatch = /^\/projects\/([^/]+)\/narration\/?$/.exec(pathname);
  if (narrationMatch?.[1]) {
    const projectId = decodeProjectId(narrationMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-narration', projectId};
  }

  const productionMatch = /^\/projects\/([^/]+)\/production\/?$/.exec(pathname);
  if (productionMatch?.[1]) {
    const projectId = decodeProjectId(productionMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-production', projectId};
  }

  const outlineMatch = /^\/projects\/([^/]+)\/outline\/?$/.exec(pathname);
  if (outlineMatch?.[1]) {
    const projectId = decodeProjectId(outlineMatch[1]);
    if (!projectId) return {name: 'new-topic'};

    return {
      name: 'project-outline',
      projectId,
    };
  }

  const voiceVisualMatch =
    /^\/projects\/([^/]+)\/voice-visual\/?$/.exec(pathname);
  if (voiceVisualMatch?.[1]) {
    const projectId = decodeProjectId(voiceVisualMatch[1]);
    if (!projectId) return {name: 'new-topic'};

    return {
      name: 'project-voice-visual',
      projectId,
    };
  }

  const motionCanvasMatch =
    /^\/projects\/([^/]+)\/motion-canvas\/?$/.exec(pathname);
  if (motionCanvasMatch?.[1]) {
    const projectId = decodeProjectId(motionCanvasMatch[1]);
    if (!projectId) return {name: 'new-topic'};

    return {
      name: 'project-motion-canvas',
      projectId,
    };
  }

  const voiceMatch = /^\/projects\/([^/]+)\/voice\/?$/.exec(pathname);
  if (voiceMatch?.[1]) {
    const projectId = decodeProjectId(voiceMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-voice', projectId};
  }

  const syncMatch = /^\/projects\/([^/]+)\/sync\/?$/.exec(pathname);
  if (syncMatch?.[1]) {
    const projectId = decodeProjectId(syncMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-sync', projectId};
  }

  const layoutMatch = /^\/projects\/([^/]+)\/layout\/?$/.exec(pathname);
  if (layoutMatch?.[1]) {
    const projectId = decodeProjectId(layoutMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-layout', projectId};
  }

  const renderMatch = /^\/projects\/([^/]+)\/render\/?$/.exec(pathname);
  if (renderMatch?.[1]) {
    const projectId = decodeProjectId(renderMatch[1]);
    if (!projectId) return {name: 'new-topic'};
    return {name: 'project-render', projectId};
  }

  return {name: 'new-topic'};
}

export function navigate(pathname: string, replace = false) {
  if (navigationGuards.size > 0) {
    requestGuardedNavigation(pathname, replace);
    return;
  }
  commitNavigation(pathname, replace);
}

export function navigateDiscardingPendingChanges(
  pathname: string,
  replace = false,
) {
  commitNavigation(pathname, replace);
}

export function projectTopicPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/topic`;
}

export function projectOutlinePath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
}

export function projectNarrationPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/narration`;
}

export function projectProductionPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/production`;
}

export function projectVoiceVisualPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/voice-visual`;
}

export function projectMotionCanvasPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/motion-canvas`;
}

export function projectVoicePath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/voice`;
}

export function projectSyncPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/sync`;
}

export function projectLayoutPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/layout`;
}

export function projectRenderPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/render`;
}

const projectStepPaths = {
  topic: projectTopicPath,
  outline: projectOutlinePath,
  voiceVisual: projectVoiceVisualPath,
  motionCanvas: projectMotionCanvasPath,
  voice: projectVoicePath,
  sync: projectSyncPath,
  layout: projectLayoutPath,
  render: projectRenderPath,
} satisfies Record<ProjectStep, (projectId: string) => string>;

export function projectStepPath(projectId: string, step: ProjectStep) {
  return projectStepPaths[step](projectId);
}

export function useAppRoute() {
  const initialHistoryIndex = ensureCurrentHistoryIndex();
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.pathname),
  );
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
      const requestedIndex =
        readHistoryIndex(event.state) ??
        readHistoryIndex(window.history.state);
      if (bypassNextPopStateGuard) {
        bypassNextPopStateGuard = false;
        publishRoute(
          requestedPath,
          requestedIndex ?? ensureCurrentHistoryIndex(),
        );
        return;
      }
      if (pendingPopNavigation) {
        const pending = pendingPopNavigation;
        if (
          pending.phase === 'restoring' &&
          requestedIndex === currentIndexRef.current
        ) {
          void pending.allowed.then((allowed) => {
            if (
              pendingPopNavigation !== pending ||
              pending.requestRevision !== navigationRequestRevision
            ) {
              if (pendingPopNavigation === pending) {
                pendingPopNavigation = null;
              }
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
        if (
          pending.phase === 'navigating' &&
          requestedIndex === pending.targetIndex
        ) {
          pendingPopNavigation = null;
          publishRoute(pending.targetPath, pending.targetIndex);
          return;
        }
        pendingPopNavigation = null;
      }
      if (
        navigationGuards.size > 0 &&
        requestedPath !== currentPathRef.current &&
        requestedIndex !== null &&
        requestedIndex !== currentIndexRef.current
      ) {
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
      publishRoute(
        requestedPath,
        requestedIndex ?? currentIndexRef.current,
      );
    };
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  return route;
}
