/** Pure route parsers for project-scoped HTTP endpoints. */
export function decodeProjectId(value: string) {
  try {
    const projectId = decodeURIComponent(value);
    return /^[a-z0-9][a-z0-9-]{0,100}$/.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
}

function routeWithRecord(
  pathname: string,
  expression: RegExp,
  resources: readonly string[],
  actions: readonly string[],
) {
  const match = expression.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  const projectId = decodeProjectId(match[1]);
  if (!projectId || !resources.includes(match[2])) return null;
  let recordId: string | null = null;
  if (match[3]) {
    try {
      recordId = decodeURIComponent(match[3]);
    } catch {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  }
  return {
    projectId,
    resource: match[2],
    recordId,
    action: match[4] && actions.includes(match[4]) ? match[4] : null,
  };
}

export function getProjectId(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  return match?.[1] ? decodeProjectId(match[1]) : null;
}

export function getProjectOutlineRoute(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)\/outline(?:\/(generate|approve))?$/.exec(pathname);
  const projectId = match?.[1] ? decodeProjectId(match[1]) : null;
  return projectId ? {projectId, action: match?.[2] ?? 'update'} : null;
}

export function getProjectOutlineHistoryRoute(pathname: string) {
  return routeWithRecord(
    pathname,
    /^\/api\/projects\/([^/]+)\/outline\/(history|versions|candidates)(?:\/([^/]+)(?:\/(restore|apply|reject))?)?$/,
    ['history', 'versions', 'candidates'],
    ['restore', 'apply', 'reject'],
  ) as {
    projectId: string;
    resource: 'history' | 'versions' | 'candidates';
    recordId: string | null;
    action: 'restore' | 'apply' | 'reject' | null;
  } | null;
}

export function getProjectVoiceVisualRoute(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)\/voice-visual(?:\/(generate|approve))?$/.exec(pathname);
  const projectId = match?.[1] ? decodeProjectId(match[1]) : null;
  return projectId ? {projectId, action: match?.[2] ?? 'update'} : null;
}

export function getProjectVoiceVisualHistoryRoute(pathname: string) {
  return routeWithRecord(
    pathname,
    /^\/api\/projects\/([^/]+)\/voice-visual\/(history|versions|candidates|reviews)(?:\/([^/]+)(?:\/(restore|apply|reject))?)?$/,
    ['history', 'versions', 'candidates', 'reviews'],
    ['restore', 'apply', 'reject'],
  ) as {
    projectId: string;
    resource: 'history' | 'versions' | 'candidates' | 'reviews';
    recordId: string | null;
    action: 'restore' | 'apply' | 'reject' | null;
  } | null;
}

export function getProjectMotionCanvasRoute(pathname: string) {
  const match = /^\/api\/projects\/([^/]+)\/motion-canvas(?:\/(generate|approve|files|preview|design))?$/.exec(pathname);
  const projectId = match?.[1] ? decodeProjectId(match[1]) : null;
  return projectId ? {projectId, action: match?.[2] ?? 'read'} : null;
}

export function getProjectMotionCanvasHistoryRoute(pathname: string) {
  return routeWithRecord(
    pathname,
    /^\/api\/projects\/([^/]+)\/motion-canvas\/(history|versions|candidates)(?:\/([^/]+)(?:\/(restore|apply|reject|preview|files))?)?$/,
    ['history', 'versions', 'candidates'],
    ['restore', 'apply', 'reject', 'preview', 'files'],
  ) as {
    projectId: string;
    resource: 'history' | 'versions' | 'candidates';
    recordId: string | null;
    action: 'restore' | 'apply' | 'reject' | 'preview' | 'files' | null;
  } | null;
}

export function getProjectVoiceRoute(pathname: string) {
  const audio = /^\/api\/projects\/([^/]+)\/voice\/audio\/([^/]+)$/.exec(pathname);
  if (audio?.[1] && audio[2]) {
    const projectId = decodeProjectId(audio[1]);
    try {
      return projectId
        ? {projectId, action: 'audio' as const, outlineSectionId: decodeURIComponent(audio[2])}
        : null;
    } catch {
      return null;
    }
  }
  const match = /^\/api\/projects\/([^/]+)\/voice(?:\/(generate|approve))?$/.exec(pathname);
  const projectId = match?.[1] ? decodeProjectId(match[1]) : null;
  return projectId
    ? {projectId, action: (match?.[2] ?? 'read') as 'generate' | 'approve' | 'read', outlineSectionId: null}
    : null;
}

function simpleRoute(pathname: string, expression: RegExp, readAction: string) {
  const match = expression.exec(pathname);
  const projectId = match?.[1] ? decodeProjectId(match[1]) : null;
  return projectId ? {projectId, action: match?.[2] ?? readAction} : null;
}

export const getProjectAnimationSyncRoute = (pathname: string) =>
  simpleRoute(pathname, /^\/api\/projects\/([^/]+)\/sync(?:\/(generate|approve|files|audio|preview))?$/, 'read') as
    | {projectId: string; action: 'generate' | 'approve' | 'files' | 'audio' | 'preview' | 'read'}
    | null;

export const getProjectLayoutRoute = (pathname: string) =>
  simpleRoute(pathname, /^\/api\/projects\/([^/]+)\/layout(?:\/(commit|approve|files|preview))?$/, 'read') as
    | {projectId: string; action: 'commit' | 'approve' | 'files' | 'preview' | 'read'}
    | null;

export const getProjectRenderRoute = (pathname: string) =>
  simpleRoute(pathname, /^\/api\/projects\/([^/]+)\/render(?:\/(generate|status|video|watermark))?$/, 'read') as
    | {projectId: string; action: 'generate' | 'status' | 'video' | 'watermark' | 'read'}
    | null;
