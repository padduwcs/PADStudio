import {useEffect, useState} from 'react';

export type AppRoute =
  | {name: 'new-topic'}
  | {name: 'project-topic'; projectId: string}
  | {name: 'project-outline'; projectId: string};

function parseRoute(pathname: string): AppRoute {
  const topicMatch = /^\/projects\/([^/]+)\/topic\/?$/.exec(pathname);
  if (topicMatch?.[1]) {
    return {
      name: 'project-topic',
      projectId: decodeURIComponent(topicMatch[1]),
    };
  }

  const outlineMatch = /^\/projects\/([^/]+)\/outline\/?$/.exec(pathname);
  if (outlineMatch?.[1]) {
    return {
      name: 'project-outline',
      projectId: decodeURIComponent(outlineMatch[1]),
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
