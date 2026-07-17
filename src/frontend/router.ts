import {useEffect, useState} from 'react';
import type {ProjectStep} from '../shared/topic.ts';

export type AppRoute =
  | {name: 'new-topic'}
  | {name: 'project-topic'; projectId: string}
  | {name: 'project-outline'; projectId: string}
  | {name: 'project-voice-visual'; projectId: string};

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

  return {name: 'new-topic'};
}

export function navigate(pathname: string, replace = false) {
  if (replace) window.history.replaceState(null, '', pathname);
  else window.history.pushState(null, '', pathname);

  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function projectTopicPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/topic`;
}

export function projectOutlinePath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
}

export function projectVoiceVisualPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/voice-visual`;
}

const projectStepPaths = {
  topic: projectTopicPath,
  outline: projectOutlinePath,
  voiceVisual: projectVoiceVisualPath,
} satisfies Record<ProjectStep, (projectId: string) => string>;

export function projectStepPath(projectId: string, step: ProjectStep) {
  return projectStepPaths[step](projectId);
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.pathname),
  );

  useEffect(() => {
    const updateRoute = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  return route;
}
