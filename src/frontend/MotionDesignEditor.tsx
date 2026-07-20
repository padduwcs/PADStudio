import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  LayoutEditorManifestSchema,
  LayoutEditorNodeSchema,
  LayoutNodePatchSchema,
  LayoutOverridesDocumentSchema,
  layoutFontFamilyValues,
  layoutFontWeightValues,
  type LayoutEditorManifest,
  type LayoutEditorNode,
  type LayoutNodePatch,
  type LayoutOverridesDocument,
} from '../shared/layout.ts';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeOffIcon,
  ExpandIcon,
  LayersIcon,
  LockIcon,
  MinimizeIcon,
  PaletteIcon,
  RedoIcon,
  ResetIcon,
  RotateIcon,
  TrashIcon,
  UndoIcon,
  UnlockIcon,
} from './icons.tsx';
import type {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';
import {useEditorFocusMode} from './useEditorFocusMode.ts';
import {
  parseRuntimeNodeVisibility,
  timelineVisibleEditorNodes,
  type RuntimeNodeVisibility,
} from './layoutEditorState.ts';

const PROTOCOL_SOURCE = 'pad-studio-layout-editor';
const PROTOCOL_VERSION = 1;

type MotionCanvasController = ReturnType<typeof useMotionCanvasDraft>;
type EditableProperty = LayoutEditorNode['editableProperties'][number];
type NumericProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'strokeWidth'
  | 'fontSize';

interface RuntimeSelection {
  sceneId: string;
  nodeKey: string;
  nodeFingerprint: string;
  label: string;
  nodeType: string;
  parentKey: string | null;
  identity: 'semantic' | 'legacy';
  editableProperties: LayoutEditorNode['editableProperties'];
  lockedProperties: LayoutEditorNode['lockedProperties'];
  lockReason: string | null;
  editorLocked: boolean;
  patch: LayoutNodePatch;
  base?: Record<string, unknown>;
}

interface RuntimeState {
  frame: number;
  duration: number;
  fps: number;
  paused: boolean;
  sceneId: string;
  sceneName: string;
  dirtyRevision: number;
  view?: {
    original: boolean;
    clean: boolean;
    grid: boolean;
    safeZone: boolean;
    snap: boolean;
  };
  history: {canUndo: boolean; canRedo: boolean};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRuntimeSelection(value: unknown): value is RuntimeSelection {
  if (!isRecord(value)) return false;
  const parsedNode = LayoutEditorNodeSchema.safeParse({
    key: value.nodeKey,
    fingerprint: value.nodeFingerprint,
    label: value.label,
    nodeType: value.nodeType,
    parentKey: value.parentKey,
    identity: value.identity,
    editableProperties: value.editableProperties,
    lockedProperties: value.lockedProperties,
    lockReason: value.lockReason,
  });
  return (
    typeof value.sceneId === 'string' &&
    parsedNode.success &&
    typeof value.editorLocked === 'boolean' &&
    isRecord(value.patch) &&
    (Object.keys(value.patch).length === 0 ||
      LayoutNodePatchSchema.safeParse(value.patch).success) &&
    (value.base === undefined || isRecord(value.base))
  );
}

function isRuntimeState(value: unknown): value is RuntimeState {
  return Boolean(
    isRecord(value) &&
      isRecord(value.history) &&
      Number.isFinite(value.frame) &&
      Number.isFinite(value.duration) &&
      Number.isFinite(value.fps) &&
      Number.isInteger(value.dirtyRevision) &&
      typeof value.paused === 'boolean' &&
      typeof value.sceneId === 'string' &&
      typeof value.sceneName === 'string' &&
      typeof value.history.canUndo === 'boolean' &&
      typeof value.history.canRedo === 'boolean',
  );
}

function matchesSource(
  document: LayoutOverridesDocument,
  generationId: string,
  contentRevision: number,
  sourceHash: string,
) {
  return (
    document.sourceAnimationSyncGenerationId === generationId &&
    document.sourceAnimationSyncContentRevision === contentRevision &&
    document.sourceAnimationSyncSourceHash === sourceHash
  );
}

function colorValue(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value)
    ? value
    : fallback;
}

function formatTime(frame: number, fps: number) {
  const seconds = Math.max(0, frame / Math.max(1, fps));
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function patchSummary(patch: LayoutNodePatch) {
  const count = Object.keys(patch).length;
  if (count === 0) return 'Chưa chỉnh';
  if (patch.hidden) return 'Đang ẩn';
  return `${count} thay đổi`;
}

function NumberInput({
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelBlurRef = useRef(false);

  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = Math.min(max, Math.max(min, parsed));
    setDraft(String(normalized));
    if (normalized !== value) onCommit(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelBlurRef.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}

function TextEditor({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const normalized = draft.slice(0, 500);
    if (normalized !== value) onCommit(normalized);
  }

  return (
    <div className="layout-text-editor">
      <textarea
        rows={4}
        maxLength={500}
        value={draft}
        disabled={disabled}
        aria-label="Nội dung chữ"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div>
        <small>{draft.length}/500 · tự áp dụng khi rời ô</small>
        <button type="button" disabled={disabled || draft === value} onClick={commit}>
          Áp dụng
        </button>
      </div>
    </div>
  );
}

export function MotionDesignEditor({
  motionCanvas,
}: {
  motionCanvas: MotionCanvasController;
}) {
  const {editorRef, focusMode, toggleFocusMode} =
    useEditorFocusMode<HTMLElement>();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const manifestStoredRef = useRef(false);
  const pendingOverridesRef = useRef<LayoutOverridesDocument['overrides'] | null>(null);
  const saveChainRef = useRef(Promise.resolve());
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [manifestStored, setManifestStored] = useState(false);
  const [manifest, setManifest] = useState<LayoutEditorManifest | null>(null);
  const [document, setDocument] = useState<LayoutOverridesDocument | null>(null);
  const [selection, setSelection] = useState<RuntimeSelection | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [runtimeVisibility, setRuntimeVisibility] =
    useState<RuntimeNodeVisibility | null>(null);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [search, setSearch] = useState('');
  const [copiedPatch, setCopiedPatch] = useState<LayoutNodePatch | null>(null);
  const motion = motionCanvas.project?.motionCanvasBundle;
  const generationId = motion?.generation.generationId ?? '';
  const contentRevision = motion?.contentRevision ?? 0;
  const sourceHash = motion?.validation.sourceHash ?? '';
  const sessionNonce = motionCanvas.previewSessionNonce;
  const expectedOrigin = useMemo(() => {
    try {
      return motionCanvas.previewUrl ? new URL(motionCanvas.previewUrl).origin : '';
    } catch {
      return '';
    }
  }, [motionCanvas.previewUrl]);

  const sendCommand = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!expectedOrigin || !frameRef.current?.contentWindow || !generationId || !sessionNonce) {
        return;
      }
      frameRef.current.contentWindow.postMessage(
        {
          source: PROTOCOL_SOURCE,
          version: PROTOCOL_VERSION,
          generationId,
          sessionId: sessionNonce,
          type,
          payload,
        },
        expectedOrigin,
      );
    },
    [expectedOrigin, generationId, sessionNonce],
  );

  useEffect(() => {
    manifestStoredRef.current = false;
    pendingOverridesRef.current = null;
    setRuntimeReady(false);
    setRuntimeError('');
    setManifestStored(false);
    setManifest(null);
    setDocument(null);
    setSelection(null);
    setRuntimeState(null);
    setRuntimeVisibility(null);
    setActiveSceneId('');
  }, [sessionNonce]);

  useEffect(() => {
    if (!generationId || !contentRevision || !sourceHash || !expectedOrigin || !sessionNonce) {
      return;
    }

    function persistPending() {
      const overrides = pendingOverridesRef.current;
      if (!overrides || !manifestStoredRef.current) return;
      pendingOverridesRef.current = null;
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const savedProject = await motionCanvas.saveDesign(overrides, sessionNonce);
          if (!savedProject && !pendingOverridesRef.current) {
            // Keep the latest committed runtime document available for the next
            // edit/retry instead of silently dropping it after a network error.
            pendingOverridesRef.current = overrides;
            return;
          }
          if (pendingOverridesRef.current) persistPending();
        });
    }

    function receiveMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== expectedOrigin) return;
      const message = isRecord(event.data) ? event.data : {};
      if (
        message.source !== PROTOCOL_SOURCE ||
        message.version !== PROTOCOL_VERSION ||
        message.generationId !== generationId ||
        message.sessionId !== sessionNonce ||
        typeof message.type !== 'string'
      ) {
        return;
      }
      const payload = isRecord(message.payload) ? message.payload : {};

      if (message.type === 'ready') {
        setRuntimeReady(true);
        setRuntimeError('');
        const parsedDocument = LayoutOverridesDocumentSchema.safeParse(payload.document);
        if (
          parsedDocument.success &&
          matchesSource(parsedDocument.data, generationId, contentRevision, sourceHash)
        ) {
          setDocument(parsedDocument.data);
        }
        sendCommand('requestState');
        return;
      }
      if (message.type === 'selection') {
        const nextSelection = payload.selection;
        const parsedSelection = isRuntimeSelection(nextSelection) ? nextSelection : null;
        setSelection(parsedSelection);
        if (parsedSelection) setActiveSceneId(parsedSelection.sceneId);
        return;
      }
      if (message.type === 'state') {
        if (isRuntimeState(payload)) {
          setRuntimeState(payload);
          setActiveSceneId(payload.sceneId);
        }
        return;
      }
      if (message.type === 'visibility') {
        const visibility = parseRuntimeNodeVisibility(payload);
        if (visibility) setRuntimeVisibility(visibility);
        return;
      }
      if (message.type === 'manifest') {
        const parsedManifest = LayoutEditorManifestSchema.safeParse(payload.manifest);
        const validManifest =
          parsedManifest.success &&
          parsedManifest.data.sourceAnimationSyncGenerationId === generationId &&
          parsedManifest.data.sourceAnimationSyncContentRevision === contentRevision &&
          parsedManifest.data.sourceAnimationSyncSourceHash === sourceHash;
        if (validManifest) setManifest(parsedManifest.data);
        if (payload.status === 'stored' && payload.complete === true) {
          if (!validManifest) {
            setRuntimeError('Node map không khớp scene Motion Canvas hiện hành.');
            return;
          }
          manifestStoredRef.current = true;
          setManifestStored(true);
          persistPending();
        }
        return;
      }
      if (message.type === 'documentChanged') {
        const parsed = LayoutOverridesDocumentSchema.safeParse(payload.document);
        if (!parsed.success || !matchesSource(parsed.data, generationId, contentRevision, sourceHash)) {
          setRuntimeError('Visual editor trả về dữ liệu không khớp scene hiện hành.');
          return;
        }
        setDocument(parsed.data);
        if (isRuntimeSelection(payload.selection)) setSelection(payload.selection);
        if (payload.transient !== true && payload.reason !== 'load-document') {
          pendingOverridesRef.current = parsed.data.overrides;
          persistPending();
        }
        return;
      }
      if (message.type === 'error') {
        setRuntimeError(
          typeof payload.message === 'string' ? payload.message : 'Visual editor gặp lỗi runtime.',
        );
      }
    }

    window.addEventListener('message', receiveMessage);
    return () => window.removeEventListener('message', receiveMessage);
  }, [contentRevision, expectedOrigin, generationId, sendCommand, sessionNonce, sourceHash]);

  const requestReady = useCallback(() => sendCommand('requestReady'), [sendCommand]);

  useEffect(() => {
    if (
      motionCanvas.previewState !== 'ready' ||
      !motionCanvas.previewUrl ||
      runtimeReady ||
      runtimeError
    ) {
      return;
    }
    requestReady();
    const retryTimer = window.setInterval(requestReady, 1_000);
    const timeout = window.setTimeout(() => {
      setRuntimeError(
        'Visual editor chưa phản hồi sau 30 giây. Scene và các chỉnh sửa đã lưu vẫn được giữ nguyên.',
      );
    }, 30_000);
    return () => {
      window.clearInterval(retryTimer);
      window.clearTimeout(timeout);
    };
  }, [motionCanvas.previewState, motionCanvas.previewUrl, requestReady, runtimeError, runtimeReady]);

  const scenes = useMemo(() => {
    if (!motion) return [];
    const manifestById = new Map(manifest?.scenes.map((scene) => [scene.sceneId, scene]));
    const outlineById = new Map(
      motionCanvas.project?.outline?.sections.map((section) => [section.id, section]) ?? [],
    );
    const query = search.trim().toLocaleLowerCase('vi');
    return motion.scenes.map((scene, index) => {
      const section = outlineById.get(scene.outlineSectionId);
      const label = section?.title ?? `Scene ${String(index + 1).padStart(2, '0')}`;
      const nodes = manifestById.get(scene.id)?.nodes ?? [];
      const filteredNodes = query
        ? nodes.filter((node) =>
            [node.label, node.key, node.nodeType].some((value) =>
              value.toLocaleLowerCase('vi').includes(query),
            ),
          )
        : nodes;
      return {sceneId: scene.id, filePath: scene.filePath, label, nodes: filteredNodes};
    });
  }, [manifest, motion, motionCanvas.project?.outline, search]);
  const activeScene =
    scenes.find((scene) => scene.sceneId === selection?.sceneId) ??
    scenes.find((scene) => scene.sceneId === activeSceneId) ??
    scenes.find((scene) => scene.sceneId === runtimeState?.sceneId) ??
    scenes[0] ??
    null;
  const activeSceneNodes = activeScene
    ? timelineVisibleEditorNodes(
        activeScene.nodes,
        activeScene.sceneId,
        runtimeVisibility,
      )
    : [];
  const timelineHiddenNodeCount = activeScene
    ? activeScene.nodes.length - activeSceneNodes.length
    : 0;

  function selectNode(sceneId: string, nodeKey?: string) {
    setActiveSceneId(sceneId);
    sendCommand('setSelected', {sceneId, nodeKey: nodeKey ?? null});
  }

  function canEdit(property: EditableProperty) {
    return Boolean(
      selection &&
        !selection.editorLocked &&
        selection.editableProperties.includes(property) &&
        !selection.lockedProperties.includes(property),
    );
  }

  function sendPatch(patch: LayoutNodePatch) {
    if (!selection) return;
    sendCommand('pause');
    sendCommand('patchSelected', {patch});
  }

  function sendNumericPatch(property: NumericProperty, value: number) {
    sendPatch({[property]: value} as LayoutNodePatch);
  }

  function copySelectedPatch() {
    if (!selection) return;
    setCopiedPatch(
      Object.fromEntries(
        Object.entries(selection.patch).filter(([property]) => property !== 'editorLocked'),
      ) as LayoutNodePatch,
    );
  }

  function pasteSelectedPatch() {
    if (!selection || selection.editorLocked || !copiedPatch) return;
    const editable = new Set(selection.editableProperties);
    const locked = new Set(selection.lockedProperties);
    const patch = Object.fromEntries(
      Object.entries(copiedPatch).filter(
        ([property]) => editable.has(property as EditableProperty) && !locked.has(property as EditableProperty),
      ),
    ) as LayoutNodePatch;
    if (Object.keys(patch).length > 0) sendPatch(patch);
  }

  const selectedText =
    typeof selection?.patch.text === 'string'
      ? selection.patch.text
      : typeof selection?.base?.text === 'string'
        ? selection.base.text
        : '';
  const selectedFontFamily =
    typeof selection?.patch.fontFamily === 'string'
      ? selection.patch.fontFamily
      : typeof selection?.base?.fontFamily === 'string' &&
          layoutFontFamilyValues.includes(selection.base.fontFamily as (typeof layoutFontFamilyValues)[number])
        ? selection.base.fontFamily
        : '';
  const selectedFontSize =
    typeof selection?.patch.fontSize === 'number'
      ? selection.patch.fontSize
      : typeof selection?.base?.fontSize === 'number'
        ? selection.base.fontSize
        : 48;
  const selectedFontWeight =
    typeof selection?.patch.fontWeight === 'number'
      ? selection.patch.fontWeight
      : typeof selection?.base?.fontWeight === 'number'
        ? selection.base.fontWeight
        : 400;
  const selectedFontStyle =
    selection?.patch.fontStyle === 'italic' || selection?.base?.fontStyle === 'italic'
      ? 'italic'
      : 'normal';

  return (
    <section className="motion-design-card motion-design-workbench">
      <header>
        <div>
          <span className="preview-kicker">Editor đầy đủ ngay sau khi sinh scene</span>
          <h2>Xem và chỉnh visual scene</h2>
          <p>
            Chọn layer từ danh sách hoặc bấm trực tiếp trên canvas. Có thể kéo chữ và hình,
            sửa nội dung, kiểu chữ, màu, opacity, thứ tự layer, đồng thời hoàn tác và tự lưu.
          </p>
        </div>
        <span className={`draft-status${motionCanvas.designSaveState === 'saved' ? ' is-saved' : ''}`}>
          <span />
          {motionCanvas.designSaveState === 'saving'
            ? 'Đang lưu…'
            : motionCanvas.designSaveState === 'error'
              ? 'Lưu chưa thành công'
              : motionCanvas.designSaveState === 'saved'
                ? 'Đã tự lưu'
                : 'Visual draft'}
        </span>
      </header>

      <section
        className={`layout-editor-shell motion-design-shell${focusMode ? ' is-editor-focus' : ''}`}
        ref={editorRef}
        role={focusMode ? 'dialog' : undefined}
        aria-modal={focusMode || undefined}
        aria-label={focusMode ? 'Visual editor toàn màn hình' : undefined}
        tabIndex={focusMode ? -1 : undefined}
      >
        <aside className="layout-tree-panel" aria-label="Danh sách scene và layer">
          <header>
            <div>
              <span className="preview-kicker"><LayersIcon /> Cấu trúc video</span>
              <strong>{document?.overrides.length ?? 0} modifier</strong>
            </div>
            <input
              type="search"
              value={search}
              placeholder="Tìm layer…"
              aria-label="Tìm layer"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </header>
          <div className="layout-scene-navigator motion-design-scene-list">
            <div className="layout-panel-label">
              <span>Scene</span><small>{scenes.length}</small>
            </div>
            <div className="layout-scene-rail" role="tablist" aria-label="Chọn scene">
              {scenes.map((scene, index) => {
                const active = activeScene?.sceneId === scene.sceneId;
                const modifierCount = document?.overrides.filter((item) => item.sceneId === scene.sceneId).length ?? 0;
                return (
                  <button
                    className={`layout-scene-chip${active ? ' is-active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    key={scene.sceneId}
                    onClick={() => selectNode(scene.sceneId)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{scene.label}</strong>
                    {modifierCount > 0 && <i>{modifierCount}</i>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="layout-layer-browser">
            <div className="layout-panel-label">
              <span>Layer</span>
              <small>
                {timelineHiddenNodeCount > 0
                  ? `${activeSceneNodes.length}/${activeScene?.nodes.length ?? 0} đang hiện`
                  : `${activeSceneNodes.length} node`}
              </small>
            </div>
            <div className="layout-layer-list">
              {!activeScene ? (
                <div className="layout-list-empty"><strong>Không có scene</strong></div>
              ) : timelineHiddenNodeCount > 0 && activeSceneNodes.length === 0 ? (
                <div className="layout-list-empty is-timeline-empty">
                  <strong>Chưa có layer nào xuất hiện</strong>
                  <span>Di chuyển playhead đến lúc hình bắt đầu hiện.</span>
                </div>
              ) : activeScene.nodes.length === 0 ? (
                <button className="layout-empty-scene" type="button" onClick={() => selectNode(activeScene.sceneId)}>
                  <LayersIcon />
                  <span>
                    <strong>{search ? 'Không tìm thấy layer' : 'Mở scene để nhận diện layer'}</strong>
                    <small>{search ? 'Thử từ khóa khác.' : 'Node map sẽ xuất hiện tại đây.'}</small>
                  </span>
                </button>
              ) : activeSceneNodes.map((node) => {
                const nodeOverride = document?.overrides.find(
                  (item) => item.sceneId === activeScene.sceneId && item.nodeKey === node.key,
                );
                const selected = selection?.sceneId === activeScene.sceneId && selection.nodeKey === node.key;
                return (
                  <button
                    className={`layout-node-row${selected ? ' is-selected' : ''}${nodeOverride?.patch.hidden ? ' is-hidden' : ''}`}
                    type="button"
                    key={node.key}
                    title={node.key}
                    aria-pressed={selected}
                    onClick={() => selectNode(activeScene.sceneId, node.key)}
                  >
                    <span className="layout-node-type">{node.nodeType.slice(0, 2).toUpperCase()}</span>
                    <span><strong>{node.label}</strong><small>{patchSummary(nodeOverride?.patch ?? {})}</small></span>
                    {nodeOverride?.patch.hidden && <span className="layout-node-state"><EyeOffIcon /></span>}
                  </button>
                );
              })}
            </div>
          </div>
          <footer>
            <span className={manifestStored ? 'is-ready' : ''} />
            {manifestStored ? 'Node map đã xác nhận' : 'Đang nhận diện node trong scene'}
          </footer>
        </aside>

        <div className="layout-preview-column">
          <div className="layout-preview-frame motion-design-frame">
            {motionCanvas.previewState === 'loading' && (
              <div className="layout-preview-state" role="status">
                <span className="spinner" /><strong>Đang khởi động Motion Canvas…</strong>
              </div>
            )}
            {motionCanvas.previewState === 'error' && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Chưa mở được visual editor</strong><p>{motionCanvas.previewError}</p>
                <button className="secondary-button" type="button" onClick={motionCanvas.retryPreview}>Thử lại</button>
              </div>
            )}
            {motionCanvas.previewState === 'ready' && motionCanvas.previewUrl && (
              <iframe
                ref={frameRef}
                title="Visual editor Motion Canvas"
                src={motionCanvas.previewUrl}
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                allowFullScreen
                onLoad={requestReady}
                onError={() => setRuntimeError('Trình duyệt không tải được visual editor. Hãy mở lại.')}
              />
            )}
            {motionCanvas.previewState === 'ready' && !runtimeReady && !runtimeError && (
              <div className="layout-preview-state" role="status">
                <span className="spinner" /><strong>Đang nối với visual editor…</strong>
              </div>
            )}
            {runtimeError && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Visual editor cần tải lại</strong><p>{runtimeError}</p>
                <button className="secondary-button" type="button" onClick={motionCanvas.retryPreview}>Mở lại</button>
              </div>
            )}
          </div>
          <div className="layout-command-bar">
            <div className="layout-command-group">
              <button type="button" title="Hoàn tác" disabled={!runtimeState?.history.canUndo} onClick={() => sendCommand('undo')}>
                <UndoIcon /><kbd>Ctrl Z</kbd>
              </button>
              <button type="button" title="Làm lại" disabled={!runtimeState?.history.canRedo} onClick={() => sendCommand('redo')}>
                <RedoIcon /><kbd>Ctrl ⇧ Z</kbd>
              </button>
            </div>
            <div className="layout-command-context">
              <span className="layout-selection-dot" />
              <span>{selection?.label ?? activeScene?.label ?? 'Chưa chọn layer'}</span>
              <code>
                {runtimeState
                  ? `${formatTime(runtimeState.frame, runtimeState.fps)} / ${formatTime(runtimeState.duration, runtimeState.fps)}`
                  : 'Đang kết nối…'}
              </code>
            </div>
            <div className="layout-command-group is-secondary">
              {focusMode && (
                <span
                  className={`layout-focus-save-state${
                    motionCanvas.designSaveState === 'saved'
                      ? ' is-saved'
                      : motionCanvas.designSaveState === 'error'
                        ? ' is-error'
                        : ''
                  }`}
                  role="status"
                >
                  <i />
                  {motionCanvas.designSaveState === 'saving'
                    ? 'Đang lưu…'
                    : motionCanvas.designSaveState === 'error'
                      ? 'Lưu lỗi'
                      : motionCanvas.designSaveState === 'saved'
                        ? 'Đã lưu'
                        : 'Bản nháp'}
                </span>
              )}
              <button type="button" disabled={!selection} onClick={copySelectedPatch}>Sao chép</button>
              <button type="button" disabled={!selection || selection.editorLocked || !copiedPatch} onClick={pasteSelectedPatch}>Dán</button>
              <button
                className={`layout-command-focus${focusMode ? ' is-active' : ''}`}
                type="button"
                title={focusMode ? 'Thoát chế độ toàn màn hình (Esc)' : 'Chỉ hiển thị editor và video'}
                aria-label={focusMode ? 'Thoát chế độ toàn màn hình' : 'Mở editor toàn màn hình'}
                aria-pressed={focusMode}
                onClick={() => void toggleFocusMode()}
              >
                {focusMode ? <MinimizeIcon /> : <ExpandIcon />}
                <span>{focusMode ? 'Thu nhỏ' : 'Toàn màn hình'}</span>
                {focusMode && <kbd>Esc</kbd>}
              </button>
            </div>
          </div>
        </div>

        <aside className="layout-inspector" aria-label="Thuộc tính layer">
          {!selection ? (
            <div className="layout-inspector-empty">
              <span><RotateIcon /></span>
              <strong>Chọn một layer để chỉnh</strong>
              <p>Bấm trực tiếp trên canvas hoặc chọn từ danh sách layer.</p>
            </div>
          ) : (
            <>
              <header>
                <div><span>{selection.nodeType}</span><h2>{selection.label}</h2><code title={selection.nodeKey}>{selection.nodeKey}</code></div>
                <button
                  type="button"
                  title={selection.editorLocked ? 'Mở khóa chỉnh sửa' : 'Khóa thao tác nhầm'}
                  onClick={() => sendPatch({editorLocked: !selection.editorLocked})}
                >
                  {selection.editorLocked ? <LockIcon /> : <UnlockIcon />}
                </button>
              </header>
              {selection.lockReason && <p className="layout-legacy-note">{selection.lockReason}</p>}
              <section className="layout-property-section">
                <h3>Biến đổi</h3>
                <div className="layout-number-grid">
                  {(
                    [
                      ['x', 'X', 0, 1, -100_000, 100_000],
                      ['y', 'Y', 0, 1, -100_000, 100_000],
                      ['scale', 'Tỉ lệ', 1, 0.05, 0.05, 20],
                      ['rotation', 'Xoay °', 0, 1, -3_600, 3_600],
                    ] as const
                  ).map(([property, label, fallback, step, min, max]) => (
                    <label key={property}>
                      <span>{label}</span>
                      <NumberInput
                        value={selection.patch[property] ?? fallback}
                        min={min}
                        max={max}
                        step={step}
                        disabled={!canEdit(property)}
                        onCommit={(value) => sendNumericPatch(property, value)}
                      />
                    </label>
                  ))}
                </div>
              </section>
              {selection.editableProperties.includes('text') && (
                <section className="layout-property-section layout-typography-section">
                  <h3>Nội dung &amp; kiểu chữ</h3>
                  <TextEditor value={selectedText} disabled={!canEdit('text')} onCommit={(text) => sendPatch({text})} />
                  <div className="layout-type-grid">
                    <label className="layout-font-family-field">
                      <span>Font chữ</span>
                      <select
                        value={selectedFontFamily}
                        disabled={!canEdit('fontFamily')}
                        onChange={(event) => event.currentTarget.value && sendPatch({fontFamily: event.currentTarget.value as LayoutNodePatch['fontFamily']})}
                      >
                        <option value="" disabled>Font từ source</option>
                        {layoutFontFamilyValues.map((font) => <option value={font} key={font}>{font.split(',')[0]}</option>)}
                      </select>
                    </label>
                    <label><span>Cỡ chữ</span><NumberInput value={selectedFontSize} min={8} max={500} step={1} disabled={!canEdit('fontSize')} onCommit={(value) => sendNumericPatch('fontSize', value)} /></label>
                    <label>
                      <span>Độ đậm</span>
                      <select value={selectedFontWeight} disabled={!canEdit('fontWeight')} onChange={(event) => sendPatch({fontWeight: Number(event.currentTarget.value)})}>
                        {layoutFontWeightValues.map((weight) => <option value={weight} key={weight}>{weight}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="layout-text-style-group" aria-label="Kiểu chữ">
                    <button type="button" className={selectedFontWeight >= 600 ? 'is-active' : ''} disabled={!canEdit('fontWeight')} onClick={() => sendPatch({fontWeight: selectedFontWeight >= 600 ? 400 : 700})}><strong>B</strong><span>Đậm</span></button>
                    <button type="button" className={selectedFontStyle === 'italic' ? 'is-active' : ''} disabled={!canEdit('fontStyle')} onClick={() => sendPatch({fontStyle: selectedFontStyle === 'italic' ? 'normal' : 'italic'})}><i>I</i><span>Nghiêng</span></button>
                    <button type="button" className={selection.patch.underline ? 'is-active' : ''} disabled={!canEdit('underline')} onClick={() => sendPatch({underline: !selection.patch.underline})}><u>U</u><span>Gạch chân</span></button>
                    <button type="button" className={selection.patch.strikethrough ? 'is-active' : ''} disabled={!canEdit('strikethrough')} onClick={() => sendPatch({strikethrough: !selection.patch.strikethrough})}><s>S</s><span>Gạch bỏ</span></button>
                  </div>
                </section>
              )}
              <section className="layout-property-section">
                <h3><PaletteIcon /> Hiển thị</h3>
                <label className="layout-range-field">
                  <span>Opacity <strong>{Math.round((selection.patch.opacity ?? 1) * 100)}%</strong></span>
                  <input type="range" min={0} max={1} step={0.01} value={selection.patch.opacity ?? 1} disabled={!canEdit('opacity')} onChange={(event) => sendNumericPatch('opacity', Number(event.currentTarget.value))} />
                  <NumberInput value={selection.patch.opacity ?? 1} min={0} max={1} step={0.01} disabled={!canEdit('opacity')} onCommit={(value) => sendNumericPatch('opacity', value)} />
                </label>
                {selection.editableProperties.includes('fill') && (
                  <div className="layout-color-field">
                    <label><span>Fill</span><input type="color" value={colorValue(selection.patch.fill, colorValue(selection.base?.fill, '#ffffff'))} disabled={!canEdit('fill')} onChange={(event) => sendPatch({fill: event.currentTarget.value})} /></label>
                    <button type="button" disabled={!canEdit('fill')} onClick={() => sendPatch({fill: null})}>Bỏ fill</button>
                  </div>
                )}
                {selection.editableProperties.includes('stroke') && (
                  <div className="layout-color-field">
                    <label><span>Viền</span><input type="color" value={colorValue(selection.patch.stroke, colorValue(selection.base?.stroke, '#18342c'))} disabled={!canEdit('stroke')} onChange={(event) => sendPatch({stroke: event.currentTarget.value})} /></label>
                    <label><span>Độ dày</span><NumberInput value={selection.patch.strokeWidth ?? (typeof selection.base?.strokeWidth === 'number' ? selection.base.strokeWidth : 0)} min={0} max={200} step={1} disabled={!canEdit('strokeWidth')} onCommit={(value) => sendNumericPatch('strokeWidth', value)} /></label>
                  </div>
                )}
              </section>
              <section className="layout-property-section">
                <h3>Layer &amp; trạng thái</h3>
                <div className="layout-layer-actions">
                  <button type="button" disabled={!canEdit('zIndexDelta')} onClick={() => sendPatch({zIndexDelta: (selection.patch.zIndexDelta ?? 0) + 1})}><ChevronUpIcon />Đưa lên</button>
                  <button type="button" disabled={!canEdit('zIndexDelta')} onClick={() => sendPatch({zIndexDelta: (selection.patch.zIndexDelta ?? 0) - 1})}><ChevronDownIcon />Đưa xuống</button>
                </div>
                <button className={`layout-visibility-button${selection.patch.hidden ? ' is-hidden' : ''}`} type="button" disabled={!canEdit('hidden')} onClick={() => sendPatch({hidden: !selection.patch.hidden})}>
                  <EyeOffIcon />{selection.patch.hidden ? 'Khôi phục layer' : 'Ẩn layer khỏi video'}
                </button>
              </section>
              <footer>
                <button type="button" disabled={selection.editorLocked} onClick={() => sendCommand('resetSelected')}><ResetIcon />Reset layer</button>
                <button className="is-danger" type="button" disabled={!canEdit('hidden')} onClick={() => sendPatch({hidden: true})}><TrashIcon />Delete (ẩn)</button>
              </footer>
            </>
          )}
        </aside>
      </section>
    </section>
  );
}
