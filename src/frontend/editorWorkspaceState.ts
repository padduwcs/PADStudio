export type EditorWorkspacePanel = 'left' | 'right' | 'timeline';

export interface EditorWorkspacePreferences {
  left: number;
  right: number;
  timeline: number;
  canvasZoom: number;
}

export interface EditorWorkspaceBounds {
  width: number;
  height: number;
}

export const EDITOR_WORKSPACE_DEFAULTS: EditorWorkspacePreferences = {
  left: 232,
  right: 282,
  timeline: 250,
  canvasZoom: 1,
};

export const EDITOR_CANVAS_ZOOM_MIN = 0.5;
export const EDITOR_CANVAS_ZOOM_MAX = 3;
export const EDITOR_CANVAS_ZOOM_STEP = 0.1;

const SIDE_PANEL_MIN = 180;
const SIDE_PANEL_MAX = 460;
const TIMELINE_MIN = 150;
const TIMELINE_MAX = 480;
const PANEL_COLLAPSE_THRESHOLD = 96;
const TIMELINE_COLLAPSE_THRESHOLD = 76;
const EDITOR_CENTER_MIN = 420;
const EDITOR_CANVAS_HEIGHT_MIN = 300;
const RESIZER_AND_PADDING_BUDGET = 48;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function normalizedPanel(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = finiteNumber(value, fallback);
  return number === 0 ? 0 : clamp(number, minimum, maximum);
}

export function normalizeEditorWorkspacePreferences(
  value: unknown,
): EditorWorkspacePreferences {
  const input =
    typeof value === 'object' && value !== null
      ? value as Partial<EditorWorkspacePreferences>
      : {};
  return {
    left: normalizedPanel(
      input.left,
      EDITOR_WORKSPACE_DEFAULTS.left,
      SIDE_PANEL_MIN,
      SIDE_PANEL_MAX,
    ),
    right: normalizedPanel(
      input.right,
      EDITOR_WORKSPACE_DEFAULTS.right,
      SIDE_PANEL_MIN,
      SIDE_PANEL_MAX,
    ),
    timeline: normalizedPanel(
      input.timeline,
      EDITOR_WORKSPACE_DEFAULTS.timeline,
      TIMELINE_MIN,
      TIMELINE_MAX,
    ),
    canvasZoom: clamp(
      finiteNumber(
        input.canvasZoom,
        EDITOR_WORKSPACE_DEFAULTS.canvasZoom,
      ),
      EDITOR_CANVAS_ZOOM_MIN,
      EDITOR_CANVAS_ZOOM_MAX,
    ),
  };
}

export function setEditorCanvasZoom(
  preferences: EditorWorkspacePreferences,
  zoom: number,
): EditorWorkspacePreferences {
  return {
    ...preferences,
    canvasZoom: clamp(
      finiteNumber(zoom, EDITOR_WORKSPACE_DEFAULTS.canvasZoom),
      EDITOR_CANVAS_ZOOM_MIN,
      EDITOR_CANVAS_ZOOM_MAX,
    ),
  };
}

export function setEditorPanelSize(
  preferences: EditorWorkspacePreferences,
  panel: EditorWorkspacePanel,
  requestedSize: number,
  bounds: EditorWorkspaceBounds,
): EditorWorkspacePreferences {
  if (!Number.isFinite(requestedSize)) return preferences;

  if (panel === 'timeline') {
    const maximum = Math.max(
      TIMELINE_MIN,
      Math.min(
        TIMELINE_MAX,
        bounds.height -
          EDITOR_CANVAS_HEIGHT_MIN -
          RESIZER_AND_PADDING_BUDGET,
      ),
    );
    return {
      ...preferences,
      timeline:
        requestedSize < TIMELINE_COLLAPSE_THRESHOLD
          ? 0
          : clamp(requestedSize, TIMELINE_MIN, maximum),
    };
  }

  const otherSize =
    panel === 'left' ? preferences.right : preferences.left;
  const maximum = Math.max(
    SIDE_PANEL_MIN,
    Math.min(
      SIDE_PANEL_MAX,
      bounds.width -
        otherSize -
        EDITOR_CENTER_MIN -
        RESIZER_AND_PADDING_BUDGET,
    ),
  );
  return {
    ...preferences,
    [panel]:
      requestedSize < PANEL_COLLAPSE_THRESHOLD
        ? 0
        : clamp(requestedSize, SIDE_PANEL_MIN, maximum),
  };
}

export function fitEditorWorkspaceToBounds(
  preferences: EditorWorkspacePreferences,
  bounds: EditorWorkspaceBounds,
): EditorWorkspacePreferences {
  let left = preferences.left;
  let right = preferences.right;
  let timeline = preferences.timeline;

  const available = Math.max(
    0,
    bounds.width - EDITOR_CENTER_MIN - RESIZER_AND_PADDING_BUDGET,
  );
  const minimumLeft = left > 0 ? SIDE_PANEL_MIN : 0;
  const minimumRight = right > 0 ? SIDE_PANEL_MIN : 0;
  if (left + right > available) {
    const flexibleAvailable = Math.max(
      0,
      available - minimumLeft - minimumRight,
    );
    const leftFlex = Math.max(0, left - minimumLeft);
    const rightFlex = Math.max(0, right - minimumRight);
    const flexTotal = leftFlex + rightFlex;
    const leftShare =
      flexTotal > 0
        ? flexibleAvailable * (leftFlex / flexTotal)
        : flexibleAvailable / 2;
    left =
      left === 0
        ? 0
        : clamp(minimumLeft + leftShare, SIDE_PANEL_MIN, SIDE_PANEL_MAX);
    right =
      right === 0
        ? 0
        : clamp(
            minimumRight + flexibleAvailable - leftShare,
            SIDE_PANEL_MIN,
            SIDE_PANEL_MAX,
          );
  }

  if (timeline > 0) {
    timeline = clamp(
      timeline,
      TIMELINE_MIN,
      Math.max(
        TIMELINE_MIN,
        Math.min(
          TIMELINE_MAX,
          bounds.height -
            EDITOR_CANVAS_HEIGHT_MIN -
            RESIZER_AND_PADDING_BUDGET,
        ),
      ),
    );
  }

  if (
    left === preferences.left &&
    right === preferences.right &&
    timeline === preferences.timeline
  ) {
    return preferences;
  }
  return {...preferences, left, right, timeline};
}
