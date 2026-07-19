export const LAYOUT_EDITOR_SOURCE = 'pad-studio-layout-editor';
export const LAYOUT_EDITOR_PROTOCOL_VERSION = 1;

function safeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readEditorContext(locationValue = window.location) {
  const params = new URLSearchParams(locationValue.search);
  const generationId = params.get('generation') ?? '';
  const sessionId = params.get('session') ?? '';
  const parentOrigin = safeOrigin(params.get('parentOrigin'));
  return {
    generationId,
    sessionId,
    parentOrigin,
    sourceSyncGenerationId:
      params.get('sourceSyncGeneration') ??
      params.get('sourceAnimationSyncGenerationId') ??
      '',
    sourceSyncContentRevision: Number(
      params.get('sourceSyncContentRevision') ?? 0,
    ),
    sourceSyncSourceHash: params.get('sourceSyncSourceHash') ?? '',
    manifestUrl: params.get('manifest'),
    overridesUrl: params.get('overrides'),
  };
}

export function createProtocol(context, parentWindow = window.parent) {
  function envelope(type, payload = {}) {
    return {
      source: LAYOUT_EDITOR_SOURCE,
      version: LAYOUT_EDITOR_PROTOCOL_VERSION,
      generationId: context.generationId,
      sessionId: context.sessionId,
      type,
      payload,
    };
  }

  function post(type, payload = {}) {
    if (!context.parentOrigin || !parentWindow || parentWindow === window) {
      return false;
    }
    parentWindow.postMessage(
      envelope(type, payload),
      context.parentOrigin,
    );
    return true;
  }

  function accepts(event) {
    const data = event.data;
    return Boolean(
      context.parentOrigin &&
        event.source === parentWindow &&
        event.origin === context.parentOrigin &&
        data &&
        typeof data === 'object' &&
        data.source === LAYOUT_EDITOR_SOURCE &&
        data.version === LAYOUT_EDITOR_PROTOCOL_VERSION &&
        data.generationId === context.generationId &&
        data.sessionId === context.sessionId &&
        typeof data.type === 'string',
    );
  }

  return {accepts, envelope, post};
}

export async function fetchOptionalJson(value, locationValue = window.location) {
  if (!value) return null;
  const url = new URL(value, locationValue.href);
  if (url.origin !== locationValue.origin) {
    throw new Error('Từ chối đọc dữ liệu Layout Editor khác origin.');
  }
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) {
    throw new Error(
      `Không thể đọc ${url.pathname} (HTTP ${response.status}).`,
    );
  }
  return response.json();
}
