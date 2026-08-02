import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  EDITOR_CANVAS_ZOOM_MAX,
  EDITOR_CANVAS_ZOOM_MIN,
  EDITOR_CANVAS_ZOOM_STEP,
  EDITOR_WORKSPACE_DEFAULTS,
  fitEditorWorkspaceToBounds,
  normalizeEditorWorkspacePreferences,
  setEditorCanvasZoom,
  setEditorPanelSize,
  type EditorWorkspaceBounds,
  type EditorWorkspacePanel,
  type EditorWorkspacePreferences,
} from './editorWorkspaceState.ts';

const STORAGE_KEY = 'pad-studio:editor-workspace:v1';

function loadPreferences() {
  if (typeof window === 'undefined') return EDITOR_WORKSPACE_DEFAULTS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return normalizeEditorWorkspacePreferences(
      stored ? JSON.parse(stored) : null,
    );
  } catch {
    return EDITOR_WORKSPACE_DEFAULTS;
  }
}

interface ActiveResize {
  panel: EditorWorkspacePanel;
  pointerId: number;
  startX: number;
  startY: number;
  startPreferences: EditorWorkspacePreferences;
  bounds: EditorWorkspaceBounds;
}

export interface EditorWorkspaceController {
  preferences: EditorWorkspacePreferences;
  shellStyle: CSSProperties;
  setZoom: (zoom: number) => void;
  beginResize: (
    panel: EditorWorkspacePanel,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  moveResize: (event: PointerEvent<HTMLDivElement>) => void;
  endResize: (event: PointerEvent<HTMLDivElement>) => void;
  resizeWithKeyboard: (
    panel: EditorWorkspacePanel,
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
  togglePanel: (panel: EditorWorkspacePanel) => void;
}

function panelSize(
  preferences: EditorWorkspacePreferences,
  panel: EditorWorkspacePanel,
) {
  return preferences[panel];
}

export function useEditorWorkspaceLayout(
  shellRef: RefObject<HTMLElement | null>,
): EditorWorkspaceController {
  const [preferences, setPreferences] =
    useState<EditorWorkspacePreferences>(loadPreferences);
  const activeResizeRef = useRef<ActiveResize | null>(null);
  const lastExpandedRef = useRef({
    left:
      preferences.left || EDITOR_WORKSPACE_DEFAULTS.left,
    right:
      preferences.right || EDITOR_WORKSPACE_DEFAULTS.right,
    timeline:
      preferences.timeline || EDITOR_WORKSPACE_DEFAULTS.timeline,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Disabled storage must not block editor interactions.
    }
    for (const panel of ['left', 'right', 'timeline'] as const) {
      if (preferences[panel] > 0) {
        lastExpandedRef.current[panel] = preferences[panel];
      }
    }
  }, [preferences]);

  useEffect(
    () => () => document.body.classList.remove('is-resizing-editor-panel'),
    [],
  );

  const currentBounds = useCallback((): EditorWorkspaceBounds => {
    const bounds = shellRef.current?.getBoundingClientRect();
    return {
      width: Math.max(1, bounds?.width ?? window.innerWidth),
      height: Math.max(1, bounds?.height ?? window.innerHeight),
    };
  }, [shellRef]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const {width, height} = entry.contentRect;
      setPreferences(current => {
        if (!window.matchMedia('(min-width: 1001px)').matches) {
          return current;
        }
        return fitEditorWorkspaceToBounds(current, {width, height});
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef]);

  const setZoom = useCallback((zoom: number) => {
    setPreferences(current =>
      setEditorCanvasZoom(current, Math.round(zoom * 10) / 10),
    );
  }, []);

  useEffect(() => {
    function changeZoom(direction: 'in' | 'out' | 'reset') {
      if (direction === 'reset') {
        setZoom(EDITOR_WORKSPACE_DEFAULTS.canvasZoom);
        return;
      }
      setPreferences(current =>
        setEditorCanvasZoom(
          current,
          Math.round(
            (
              current.canvasZoom +
              (direction === 'in'
                ? EDITOR_CANVAS_ZOOM_STEP
                : -EDITOR_CANVAS_ZOOM_STEP)
            ) * 10,
          ) / 10,
        ),
      );
    }

    function handleZoomShortcut(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        (!event.ctrlKey && !event.metaKey) ||
        !shellRef.current?.contains(document.activeElement)
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        changeZoom('reset');
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        changeZoom('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        changeZoom('out');
      }
    }

    function handleRuntimeZoomShortcut(event: Event) {
      const action = (
        event as CustomEvent<{action?: string}>
      ).detail?.action;
      if (action === 'zoom-in') changeZoom('in');
      if (action === 'zoom-out') changeZoom('out');
      if (action === 'zoom-reset') changeZoom('reset');
    }

    window.addEventListener('keydown', handleZoomShortcut);
    window.addEventListener(
      'pad-layout-shortcut',
      handleRuntimeZoomShortcut,
    );
    return () => {
      window.removeEventListener('keydown', handleZoomShortcut);
      window.removeEventListener(
        'pad-layout-shortcut',
        handleRuntimeZoomShortcut,
      );
    };
  }, [setZoom, shellRef]);

  const beginResize = useCallback(
    (
      panel: EditorWorkspacePanel,
      event: PointerEvent<HTMLDivElement>,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      activeResizeRef.current = {
        panel,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPreferences: preferences,
        bounds: currentBounds(),
      };
      document.body.classList.add('is-resizing-editor-panel');
    },
    [currentBounds, preferences],
  );

  const moveResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const active = activeResizeRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      const horizontalDelta = event.clientX - active.startX;
      const verticalDelta = event.clientY - active.startY;
      const requestedSize =
        active.panel === 'left'
          ? active.startPreferences.left + horizontalDelta
          : active.panel === 'right'
            ? active.startPreferences.right - horizontalDelta
            : active.startPreferences.timeline - verticalDelta;
      setPreferences(
        setEditorPanelSize(
          active.startPreferences,
          active.panel,
          requestedSize,
          active.bounds,
        ),
      );
    },
    [],
  );

  const endResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const active = activeResizeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove('is-resizing-editor-panel');
  }, []);

  const togglePanel = useCallback(
    (panel: EditorWorkspacePanel) => {
      setPreferences(current =>
        setEditorPanelSize(
          current,
          panel,
          panelSize(current, panel) === 0
            ? lastExpandedRef.current[panel]
            : 0,
          currentBounds(),
        ),
      );
    },
    [currentBounds],
  );

  const resizeWithKeyboard = useCallback(
    (
      panel: EditorWorkspacePanel,
      event: KeyboardEvent<HTMLDivElement>,
    ) => {
      const size = panelSize(preferences, panel);
      let requestedSize: number | null = null;
      if (event.key === 'Home') {
        requestedSize = 0;
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        togglePanel(panel);
        return;
      } else if (panel === 'left') {
        if (event.key === 'ArrowLeft') requestedSize = size - 16;
        if (event.key === 'ArrowRight') {
          requestedSize =
            size === 0 ? lastExpandedRef.current.left : size + 16;
        }
      } else if (panel === 'right') {
        if (event.key === 'ArrowLeft') {
          requestedSize =
            size === 0 ? lastExpandedRef.current.right : size + 16;
        }
        if (event.key === 'ArrowRight') requestedSize = size - 16;
      } else {
        if (event.key === 'ArrowUp') {
          requestedSize =
            size === 0 ? lastExpandedRef.current.timeline : size + 16;
        }
        if (event.key === 'ArrowDown') requestedSize = size - 16;
      }
      if (requestedSize === null) return;
      event.preventDefault();
      setPreferences(current =>
        setEditorPanelSize(
          current,
          panel,
          requestedSize!,
          currentBounds(),
        ),
      );
    },
    [currentBounds, preferences, togglePanel],
  );

  const shellStyle = {
    '--editor-left-panel': `${preferences.left}px`,
    '--editor-right-panel': `${preferences.right}px`,
    '--editor-timeline-panel': `${preferences.timeline}px`,
  } as CSSProperties;

  return {
    preferences,
    shellStyle,
    setZoom,
    beginResize,
    moveResize,
    endResize,
    resizeWithKeyboard,
    togglePanel,
  };
}

const PANEL_LABELS: Record<EditorWorkspacePanel, string> = {
  left: 'bảng Layers',
  right: 'bảng Thuộc tính',
  timeline: 'Timeline',
};

export function EditorResizeHandle({
  panel,
  controller,
}: {
  panel: EditorWorkspacePanel;
  controller: EditorWorkspaceController;
}) {
  const value = controller.preferences[panel];
  const orientation = panel === 'timeline' ? 'horizontal' : 'vertical';
  return (
    <div
      className={`editor-resize-handle is-${panel}${
        value === 0 ? ' is-collapsed' : ''
      }`}
      data-editor-resize={panel}
      role="separator"
      tabIndex={0}
      aria-label={`Thay đổi kích thước ${PANEL_LABELS[panel]}`}
      aria-orientation={orientation}
      aria-valuemin={0}
      aria-valuemax={panel === 'timeline' ? 480 : 460}
      aria-valuenow={Math.round(value)}
      title={`Kéo để đổi kích thước ${PANEL_LABELS[panel]}; nhấp đúp để thu gọn hoặc mở lại`}
      onPointerDown={event => controller.beginResize(panel, event)}
      onPointerMove={controller.moveResize}
      onPointerUp={controller.endResize}
      onPointerCancel={controller.endResize}
      onDoubleClick={() => controller.togglePanel(panel)}
      onKeyDown={event => controller.resizeWithKeyboard(panel, event)}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function EditorCanvasViewport({
  zoom,
  children,
}: {
  zoom: number;
  children: ReactNode;
}) {
  const size = `${zoom * 100}%`;
  const inverseSize = `${100 / zoom}%`;
  return (
    <div
      className="layout-preview-viewport"
      style={{
        '--canvas-zoom': zoom,
        '--canvas-surface-size': size,
        '--canvas-inverse-size': inverseSize,
      } as CSSProperties}
    >
      <div
        className={`layout-preview-zoom-surface${
          zoom < 1 ? ' is-contained' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function EditorCanvasZoom({
  controller,
}: {
  controller: EditorWorkspaceController;
}) {
  const zoom = controller.preferences.canvasZoom;
  return (
    <div className="layout-canvas-zoom" aria-label="Thu phóng canvas">
      <button
        type="button"
        aria-label="Thu nhỏ canvas"
        title="Thu nhỏ canvas"
        disabled={zoom <= EDITOR_CANVAS_ZOOM_MIN}
        onClick={() => controller.setZoom(zoom - EDITOR_CANVAS_ZOOM_STEP)}
      >
        −
      </button>
      <input
        type="range"
        min={EDITOR_CANVAS_ZOOM_MIN}
        max={EDITOR_CANVAS_ZOOM_MAX}
        step={EDITOR_CANVAS_ZOOM_STEP}
        value={zoom}
        aria-label="Mức thu phóng canvas"
        onChange={event =>
          controller.setZoom(Number(event.currentTarget.value))
        }
      />
      <button
        className="layout-canvas-zoom-value"
        type="button"
        title="Đưa canvas về vừa khung"
        aria-label={`Mức thu phóng ${Math.round(zoom * 100)}%. Đưa về vừa khung`}
        onClick={() =>
          controller.setZoom(EDITOR_WORKSPACE_DEFAULTS.canvasZoom)
        }
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Phóng to canvas"
        title="Phóng to canvas"
        disabled={zoom >= EDITOR_CANVAS_ZOOM_MAX}
        onClick={() => controller.setZoom(zoom + EDITOR_CANVAS_ZOOM_STEP)}
      >
        ＋
      </button>
    </div>
  );
}
