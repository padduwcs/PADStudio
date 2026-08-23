import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  type LayoutPropertyTrack,
  type LayoutVisibilityKeyframe,
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
import type {useSyncSceneEditor} from './useSyncSceneEditor.ts';
import {useEditorFocusMode} from './useEditorFocusMode.ts';
import {
  EditorCanvasViewport,
  EditorCanvasZoom,
  EditorResizeHandle,
  useEditorWorkspaceLayout,
} from './useEditorWorkspaceLayout.tsx';
import {
  layoutEditorProtocolGenerationId,
  parseRuntimeNodeVisibility,
  timelineVisibleEditorNodes,
  type RuntimeNodeVisibility,
} from './layoutEditorState.ts';
import {groupEditorLayers} from './layerGroups.ts';
import {
  ProfessionalTimeline,
  type EditorTimelineScene,
} from './ProfessionalTimeline.tsx';
import type {RenderWatermark} from '../shared/render.ts';

const PROTOCOL_SOURCE = 'pad-studio-layout-editor';
const PROTOCOL_VERSION = 1;

type MotionCanvasController = ReturnType<typeof useMotionCanvasDraft>;
type SyncSceneEditorController = ReturnType<typeof useSyncSceneEditor>;
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
  role: LayoutEditorNode['role'];
  editableProperties: LayoutEditorNode['editableProperties'];
  lockedProperties: LayoutEditorNode['lockedProperties'];
  lockReason: string | null;
  editorLocked: boolean;
  patch: LayoutNodePatch;
  animatedPatch?: LayoutNodePatch;
  visibility?: LayoutVisibilityKeyframe[];
  animations?: LayoutPropertyTrack[];
  userText?: boolean;
  base?: Record<string, unknown>;
}

interface RuntimeState {
  frame: number;
  duration: number;
  fps: number;
  paused: boolean;
  muted?: boolean;
  sceneId: string;
  sceneName: string;
  sceneTimeSeconds?: number;
  enteredContainerKey?: string | null;
  scenes?: Array<{
    sceneId: string;
    name: string;
    firstFrame: number;
    lastFrame: number;
  }>;
  selection?: RuntimeSelection | null;
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
    role: value.role,
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

function watermarkEqual(a: RenderWatermark, b: RenderWatermark) {
  return JSON.stringify(a) === JSON.stringify(b);
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

function patchSummary(patch: LayoutNodePatch) {
  const count = Object.keys(patch).length;
  if (count === 0) return '';
  if (patch.hidden) return 'Ẩn';
  return `${count} chỉnh sửa`;
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
    if (draft !== value) onCommit(draft);
  }

  return (
    <div className="layout-text-editor">
      <textarea
        rows={4}
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
        <small>{draft.length} ký tự · tự áp dụng khi rời ô</small>
        <button type="button" disabled={disabled || draft === value} onClick={commit}>
          Áp dụng
        </button>
      </div>
    </div>
  );
}

export function SceneSyncEditor({
  motionCanvas,
  syncEditor,
  watermark = {type: 'none'},
  watermarkImageUrl = '',
}: {
  motionCanvas: MotionCanvasController;
  syncEditor: SyncSceneEditorController;
  watermark?: RenderWatermark;
  watermarkImageUrl?: string;
}) {
  const {editorRef, focusMode, toggleFocusMode} =
    useEditorFocusMode<HTMLElement>();
  const editorWorkspace = useEditorWorkspaceLayout(editorRef);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const manifestStoredRef = useRef(false);
  const pendingOverridesRef = useRef<LayoutOverridesDocument['overrides'] | null>(null);
  const saveChainRef = useRef(Promise.resolve());
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
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
  const sync = motionCanvas.project?.animationSyncBundle;
  const sourceGenerationId = sync?.generation.generationId ?? '';
  const protocolGenerationId = layoutEditorProtocolGenerationId(
    syncEditor.previewGenerationId,
    sourceGenerationId,
  );
  const contentRevision = sync?.contentRevision ?? 0;
  const sourceHash = sync?.validation.sourceHash ?? '';
  const sessionNonce = syncEditor.previewSessionNonce;
  const expectedOrigin = useMemo(() => {
    try {
      return syncEditor.previewUrl ? new URL(syncEditor.previewUrl).origin : '';
    } catch {
      return '';
    }
  }, [syncEditor.previewUrl]);

  const sendCommand = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!expectedOrigin || !frameRef.current?.contentWindow || !protocolGenerationId || !sessionNonce) {
        return;
      }
      frameRef.current.contentWindow.postMessage(
        {
          source: PROTOCOL_SOURCE,
          version: PROTOCOL_VERSION,
          generationId: protocolGenerationId,
          sessionId: sessionNonce,
          type,
          payload,
        },
        expectedOrigin,
      );
    },
    [expectedOrigin, protocolGenerationId, sessionNonce],
  );

  useEffect(() => {
    manifestStoredRef.current = false;
    pendingOverridesRef.current = null;
    setRuntimeReady(false);
    setRuntimeError('');
    setManifest(null);
    setDocument(null);
    setSelection(null);
    setRuntimeState(null);
    setRuntimeVisibility(null);
    setActiveSceneId('');
  }, [sessionNonce]);

  const documentRef = useRef(document);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  const layoutCurrentRef = useRef(syncEditor.ready);
  useEffect(() => {
    layoutCurrentRef.current = syncEditor.ready;
  }, [syncEditor.ready]);
  const watermarkRef = useRef(watermark);
  watermarkRef.current = watermark;

  const persistPendingRef = useRef<() => void>(() => {});
  const persistPending = useCallback(() => {
    const overrides = pendingOverridesRef.current;
    if (!overrides || !manifestStoredRef.current) return;
    pendingOverridesRef.current = null;
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const savedProject = await syncEditor.saveDesign(
          overrides,
          {watermark: watermarkRef.current},
          sessionNonce,
        );
        if (!savedProject && !pendingOverridesRef.current) {
          // Keep the latest committed runtime document available for the next
          // edit/retry instead of silently dropping it after a network error.
          pendingOverridesRef.current = overrides;
          return;
        }
        if (pendingOverridesRef.current) persistPendingRef.current();
      });
  }, [sessionNonce, syncEditor]);
  useEffect(() => {
    persistPendingRef.current = persistPending;
  }, [persistPending]);

  // A watermark-only change (no layer edits) must still reach the saved
  // draft — it does not arrive through a runtime postMessage like overrides do.
  // Compared by value, not reference: every successful save round-trips a
  // freshly parsed project, so a same-value watermark still gets a new
  // object identity and must not be treated as a new user change.
  const watermarkAppliedRef = useRef(watermark);
  useEffect(() => {
    if (watermarkEqual(watermarkAppliedRef.current, watermark)) return;
    if (!manifestStoredRef.current || !documentRef.current) return;
    watermarkAppliedRef.current = watermark;
    pendingOverridesRef.current = documentRef.current.overrides;
    persistPendingRef.current();
  }, [watermark]);

  useEffect(() => {
    if (!sourceGenerationId || !protocolGenerationId || !contentRevision || !sourceHash || !expectedOrigin || !sessionNonce) {
      return;
    }

    function receiveMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== expectedOrigin) return;
      const message = isRecord(event.data) ? event.data : {};
      if (
        message.source !== PROTOCOL_SOURCE ||
        message.version !== PROTOCOL_VERSION ||
        message.generationId !== protocolGenerationId ||
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
          matchesSource(parsedDocument.data, sourceGenerationId, contentRevision, sourceHash)
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
          if (isRuntimeSelection(payload.selection)) {
            setSelection(payload.selection);
          } else if (payload.selection === null) {
            setSelection(null);
          }
        }
        return;
      }
      if (message.type === 'visibility') {
        const visibility = parseRuntimeNodeVisibility(payload);
        if (visibility) setRuntimeVisibility(visibility);
        return;
      }
      if (
        message.type === 'shortcut' &&
        typeof payload.action === 'string'
      ) {
        window.dispatchEvent(
          new CustomEvent('pad-layout-shortcut', {
            detail: {action: payload.action},
          }),
        );
        return;
      }
      if (message.type === 'manifest') {
        const parsedManifest = LayoutEditorManifestSchema.safeParse(payload.manifest);
        const validManifest =
          parsedManifest.success &&
          parsedManifest.data.sourceAnimationSyncGenerationId === sourceGenerationId &&
          parsedManifest.data.sourceAnimationSyncContentRevision === contentRevision &&
          parsedManifest.data.sourceAnimationSyncSourceHash === sourceHash;
        if (validManifest) setManifest(parsedManifest.data);
        if (payload.status === 'error') {
          setRuntimeError(
            typeof payload.message === 'string'
              ? payload.message
              : 'Runtime không tìm thấy node chỉnh sửa được.',
          );
          return;
        }
        if (payload.status === 'stored' && payload.complete === true) {
          if (!validManifest) {
            setRuntimeError('Node map không khớp scene đã đồng bộ hiện hành.');
            return;
          }
          manifestStoredRef.current = true;
          const watermarkChanged = !watermarkEqual(
            watermarkAppliedRef.current,
            watermarkRef.current,
          );
          if (watermarkChanged) {
            watermarkAppliedRef.current = watermarkRef.current;
          }
          // Opening the editor with zero edits must still produce a
          // layoutBundle — otherwise "approve" stays blocked forever.
          if (
            !pendingOverridesRef.current &&
            (!layoutCurrentRef.current || watermarkChanged)
          ) {
            pendingOverridesRef.current = documentRef.current?.overrides ?? [];
          }
          persistPendingRef.current();
        }
        return;
      }
      if (message.type === 'documentChanged') {
        const parsed = LayoutOverridesDocumentSchema.safeParse(payload.document);
        if (!parsed.success || !matchesSource(parsed.data, sourceGenerationId, contentRevision, sourceHash)) {
          setRuntimeError('Editor scene trả về dữ liệu không khớp bản đồng bộ hiện hành.');
          return;
        }
        setDocument(parsed.data);
        if (isRuntimeSelection(payload.selection)) setSelection(payload.selection);
        if (payload.transient !== true && payload.reason !== 'load-document') {
          pendingOverridesRef.current = parsed.data.overrides;
          persistPendingRef.current();
        }
        return;
      }
      if (message.type === 'error') {
        setRuntimeError(
          typeof payload.message === 'string' ? payload.message : 'Editor scene gặp lỗi runtime.',
        );
      }
    }

    window.addEventListener('message', receiveMessage);
    return () => window.removeEventListener('message', receiveMessage);
  }, [contentRevision, expectedOrigin, protocolGenerationId, sendCommand, sessionNonce, sourceGenerationId, sourceHash]);

  const requestReady = useCallback(() => sendCommand('requestReady'), [sendCommand]);

  useEffect(() => {
    if (
      syncEditor.previewState !== 'ready' ||
      !syncEditor.previewUrl ||
      runtimeReady ||
      runtimeError
    ) {
      return;
    }
    requestReady();
    const retryTimer = window.setInterval(requestReady, 1_000);
    const timeout = window.setTimeout(() => {
      setRuntimeError(
        'Editor scene chưa phản hồi sau 30 giây. Scene và các chỉnh sửa đã lưu vẫn được giữ nguyên.',
      );
    }, 30_000);
    return () => {
      window.clearInterval(retryTimer);
      window.clearTimeout(timeout);
    };
  }, [syncEditor.previewState, syncEditor.previewUrl, requestReady, runtimeError, runtimeReady]);

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
  const activeSceneAllNodes =
    manifest?.scenes.find(scene => scene.sceneId === activeScene?.sceneId)
      ?.nodes ?? activeScene?.nodes ?? [];
  const activeLayerGroups = groupEditorLayers(
    activeSceneNodes,
    activeSceneAllNodes,
  );
  const activeContentFrame = activeSceneAllNodes.find(
    node => node.role === 'content',
  );

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
    if (
      ['x', 'y', 'scale', 'rotation', 'opacity'].includes(property) &&
      selection?.animations?.some(track => track.property === property)
    ) {
      sendCommand('setPropertyKeyframe', {property, value});
      return;
    }
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
  const timelineScenes: EditorTimelineScene[] = (() => {
    const labels = new Map(scenes.map(scene => [scene.sceneId, scene.label]));
    const nodes = new Map(
      manifest?.scenes.map(scene => [scene.sceneId, scene.nodes]) ?? [],
    );
    if (runtimeState?.scenes?.length) {
      return runtimeState.scenes.map((scene, index) => ({
        sceneId: scene.sceneId,
        label: labels.get(scene.sceneId) ?? `Scene ${index + 1}`,
        firstFrame: scene.firstFrame,
        lastFrame: scene.lastFrame,
        nodes: nodes.get(scene.sceneId) ?? [],
      }));
    }
    let cursor = 0;
    return (motion?.scenes ?? []).map((scene, index) => {
      const firstFrame = cursor;
      cursor += Math.max(
        1,
        Math.round(scene.durationSeconds * Math.max(1, runtimeState?.fps ?? 30)),
      );
      return {
        sceneId: scene.id,
        label: labels.get(scene.id) ?? `Scene ${index + 1}`,
        firstFrame,
        lastFrame: cursor,
        nodes: nodes.get(scene.id) ?? [],
      };
    });
  })();
  const timelineMarkers = (() => {
    const planBySection = new Map(
      motionCanvas.project?.voiceVisualPlan?.sections.map(section => [
        section.outlineSectionId,
        section,
      ]) ?? [],
    );
    return (motion?.scenes ?? []).flatMap(scene => {
      const timelineScene = timelineScenes.find(item => item.sceneId === scene.id);
      const plannedSection = planBySection.get(scene.outlineSectionId);
      if (!timelineScene || !plannedSection) return [];
      let elapsedSeconds = 0;
      return plannedSection.beats.map((beat, index) => {
        const frame = Math.min(
          timelineScene.lastFrame,
          timelineScene.firstFrame +
            Math.round(elapsedSeconds * Math.max(1, runtimeState?.fps ?? 30)),
        );
        elapsedSeconds += beat.durationSeconds;
        return {
          id: beat.id,
          label: `Beat ${index + 1}`,
          frame,
        };
      });
    });
  })();

  function selectedAnimationValue(
    property: LayoutPropertyTrack['property'],
  ) {
    const fallback = property === 'scale' || property === 'opacity' ? 1 : 0;
    return typeof selection?.animatedPatch?.[property] === 'number'
      ? selection.animatedPatch[property]
      : typeof selection?.patch[property] === 'number'
        ? selection.patch[property]
      : fallback;
  }

  return (
    <section className="motion-design-card motion-design-workbench">
      <header>
        <div>
          <span className="preview-kicker">Scene editor</span>
          <h2>Chỉnh scene theo giọng đọc</h2>
          <p>Editor này chạy trên bản đã đồng bộ — nghe giọng đọc thật trong lúc chỉnh layer, chữ, vị trí và chuyển động.</p>
        </div>
        <span className={`draft-status${syncEditor.saveState === 'saved' ? ' is-saved' : ''}`}>
          <span />
          {syncEditor.saveState === 'saving'
            ? 'Đang lưu…'
            : syncEditor.saveState === 'error'
              ? 'Lưu chưa thành công'
              : syncEditor.saveState === 'saved'
                ? 'Đã tự lưu'
                : 'Bản nháp'}
        </span>
      </header>

      <section
        className={`layout-editor-shell motion-design-shell${focusMode ? ' is-editor-focus' : ''}`}
        ref={editorRef}
        style={editorWorkspace.shellStyle}
        data-editor-left-collapsed={
          editorWorkspace.preferences.left === 0 || undefined
        }
        data-editor-right-collapsed={
          editorWorkspace.preferences.right === 0 || undefined
        }
        data-editor-timeline-collapsed={
          editorWorkspace.preferences.timeline === 0 || undefined
        }
        role={focusMode ? 'dialog' : undefined}
        aria-modal={focusMode || undefined}
        aria-label={focusMode ? 'Editor scene toàn màn hình' : undefined}
        tabIndex={focusMode ? -1 : undefined}
      >
        <aside className="layout-tree-panel" aria-label="Danh sách layer">
          <header>
            <div>
              <span className="preview-kicker"><LayersIcon /> Layers</span>
              <strong>
                {timelineHiddenNodeCount > 0
                  ? `${activeSceneNodes.length}/${activeScene?.nodes.length ?? 0}`
                  : activeSceneNodes.length}
              </strong>
            </div>
            <input
              type="search"
              value={search}
              placeholder="Tìm layer…"
              aria-label="Tìm layer"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </header>
          <div className="layout-layer-browser">
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
              ) : activeLayerGroups.map(group => (
                <details
                  className="layout-layer-group"
                  key={group.id}
                  open
                >
                  <summary>
                    <span>{group.label}</span>
                    <small>{group.nodes.length}</small>
                  </summary>
                  <div>
                    {group.nodes.map((node) => {
                      const nodeOverride = document?.overrides.find(
                        (item) =>
                          item.sceneId === activeScene.sceneId &&
                          item.nodeKey === node.key,
                      );
                      const selected =
                        selection?.sceneId === activeScene.sceneId &&
                        selection.nodeKey === node.key;
                      const summary = patchSummary(nodeOverride?.patch ?? {});
                      return (
                        <button
                          className={`layout-node-row${selected ? ' is-selected' : ''}${nodeOverride?.patch.hidden ? ' is-hidden' : ''}`}
                          type="button"
                          key={node.key}
                          title={node.key}
                          aria-pressed={selected}
                          onClick={() =>
                            selectNode(activeScene.sceneId, node.key)
                          }
                        >
                          <span className="layout-node-type">
                            {node.nodeType.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>{node.label}</strong>
                            {summary && <small>{summary}</small>}
                          </span>
                          {nodeOverride?.patch.hidden && (
                            <span className="layout-node-state">
                              <EyeOffIcon />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </aside>
        <EditorResizeHandle panel="left" controller={editorWorkspace} />

        <div className="layout-preview-column">
          <div className="layout-preview-frame motion-design-frame">
            {syncEditor.previewState === 'loading' && (
              <div className="layout-preview-state" role="status">
                <span className="spinner" /><strong>Đang mở bản đồng bộ để chỉnh…</strong>
              </div>
            )}
            {syncEditor.previewState === 'error' && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Chưa mở được editor scene</strong><p>{syncEditor.previewError}</p>
                <button className="secondary-button" type="button" onClick={syncEditor.retryPreview}>Thử lại</button>
              </div>
            )}
            {syncEditor.previewState === 'ready' && syncEditor.previewUrl && (
              <EditorCanvasViewport
                zoom={editorWorkspace.preferences.canvasZoom}
              >
                <iframe
                  ref={frameRef}
                  title="Editor scene đã đồng bộ"
                  src={syncEditor.previewUrl}
                  allow="autoplay; fullscreen"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  allowFullScreen
                  onLoad={requestReady}
                  onError={() => setRuntimeError('Trình duyệt không tải được editor scene. Hãy mở lại.')}
                />
              </EditorCanvasViewport>
            )}
            {syncEditor.previewState === 'ready' && !runtimeReady && !runtimeError && (
              <div className="layout-preview-state" role="status">
                <span className="spinner" /><strong>Đang nối với editor scene…</strong>
              </div>
            )}
            {runtimeError && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Editor scene cần tải lại</strong><p>{runtimeError}</p>
                <button className="secondary-button" type="button" onClick={syncEditor.retryPreview}>Mở lại</button>
              </div>
            )}
            {watermark.type === 'text' && <div className="motion-design-watermark" style={{'--watermark-x': `${watermark.xPercent}%`, '--watermark-y': `${watermark.yPercent}%`, '--watermark-opacity': watermark.opacity, '--watermark-size': `${watermark.fontSize}px`, color: watermark.color} as CSSProperties}>{watermark.text}</div>}
            {watermark.type === 'image' && watermarkImageUrl && <div className="motion-design-watermark is-image" style={{'--watermark-x': `${watermark.xPercent}%`, '--watermark-y': `${watermark.yPercent}%`, '--watermark-opacity': watermark.opacity, '--watermark-width': `${watermark.widthPercent}%`} as CSSProperties}><img src={watermarkImageUrl} alt="Watermark" /></div>}
          </div>
          <div className="layout-command-bar">
            <div className="layout-command-group">
              <button
                type="button"
                title="Thêm text vào scene hiện tại"
                disabled={!runtimeReady || !activeScene}
                onClick={() => sendCommand('addText')}
              >
                ＋ Text
              </button>
              <button
                type="button"
                title="Chọn khung nội dung của scene"
                disabled={!runtimeReady || !activeScene || !activeContentFrame}
                onClick={() =>
                  activeScene &&
                  activeContentFrame &&
                  selectNode(activeScene.sceneId, activeContentFrame.key)
                }
              >
                Toàn cảnh
              </button>
              <button type="button" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" disabled={!runtimeState?.history.canUndo} onClick={() => sendCommand('undo')}>
                <UndoIcon />
              </button>
              <button type="button" title="Làm lại (Ctrl+Shift+Z)" aria-label="Làm lại" disabled={!runtimeState?.history.canRedo} onClick={() => sendCommand('redo')}>
                <RedoIcon />
              </button>
            </div>
            <div className="layout-command-group is-secondary">
              <EditorCanvasZoom controller={editorWorkspace} />
              {focusMode && (
                <span
                  className={`layout-focus-save-state${
                    syncEditor.saveState === 'saved'
                      ? ' is-saved'
                      : syncEditor.saveState === 'error'
                        ? ' is-error'
                        : ''
                  }`}
                  role="status"
                >
                  <i />
                  {syncEditor.saveState === 'saving'
                    ? 'Đang lưu…'
                    : syncEditor.saveState === 'error'
                      ? 'Lưu lỗi'
                      : syncEditor.saveState === 'saved'
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
        <EditorResizeHandle panel="right" controller={editorWorkspace} />

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
                <div><span>{selection.nodeType}</span><h2>{selection.label}</h2></div>
                <button
                  type="button"
                  title={selection.editorLocked ? 'Mở khóa chỉnh sửa' : 'Khóa thao tác nhầm'}
                  onClick={() => sendPatch({editorLocked: !selection.editorLocked})}
                >
                  {selection.editorLocked ? <LockIcon /> : <UnlockIcon />}
                </button>
              </header>
              <div className="layout-container-actions">
                <span>
                  {selection.role === 'content'
                    ? 'Khung nội dung'
                    : selection.role === 'block'
                      ? 'Khối visual'
                      : 'Phần tử'}
                </span>
                {(selection.role === 'block' ||
                  selection.role === 'content') && (
                  <button
                    type="button"
                    onClick={() => sendCommand('enterSelectedContainer')}
                  >
                    Chỉnh bên trong
                  </button>
                )}
                {runtimeState?.enteredContainerKey && (
                  <button
                    type="button"
                    onClick={() => sendCommand('selectParentContainer')}
                  >
                    Lên khung cha
                  </button>
                )}
              </div>
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
                        value={
                          selection.animatedPatch?.[property] ??
                          selection.patch[property] ??
                          fallback
                        }
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
              {selection.animations && selection.animations.length > 0 && (
                <section className="layout-property-section">
                  <h3>Chuyển động</h3>
                  <div className="layout-animation-tracks">
                    {selection.animations.map(track => (
                      <div key={track.property}>
                        <span>
                          {track.property}
                          <small>{track.keyframes.length} keyframe</small>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            sendCommand('clearPropertyTrack', {
                              property: track.property,
                            })
                          }
                        >
                          Xóa track
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
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
                  <span>Opacity <strong>{Math.round((selection.animatedPatch?.opacity ?? selection.patch.opacity ?? 1) * 100)}%</strong></span>
                  <input type="range" min={0} max={1} step={0.01} value={selection.animatedPatch?.opacity ?? selection.patch.opacity ?? 1} disabled={!canEdit('opacity')} onChange={(event) => sendNumericPatch('opacity', Number(event.currentTarget.value))} />
                  <NumberInput value={selection.animatedPatch?.opacity ?? selection.patch.opacity ?? 1} min={0} max={1} step={0.01} disabled={!canEdit('opacity')} onCommit={(value) => sendNumericPatch('opacity', value)} />
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
                <div className="layout-temporal-visibility">
                  <strong>Ẩn/hiện theo thời gian</strong>
                  <p>
                    Đặt trạng thái tại playhead
                    {typeof runtimeState?.sceneTimeSeconds === 'number'
                      ? ` (${runtimeState.sceneTimeSeconds.toFixed(2)}s trong scene)`
                      : ''}.
                  </p>
                  <div>
                    <button type="button" disabled={!canEdit('hidden')} onClick={() => sendCommand('setVisibilityAtTime', {hidden: true})}>
                      <EyeOffIcon />Ẩn từ đây
                    </button>
                    <button type="button" disabled={!canEdit('hidden')} onClick={() => sendCommand('setVisibilityAtTime', {hidden: false})}>
                      Hiện từ đây
                    </button>
                    <button type="button" disabled={(selection.visibility?.length ?? 0) === 0} onClick={() => sendCommand('clearVisibilityTrack')}>
                      Xóa timing
                    </button>
                  </div>
                  {(selection.visibility?.length ?? 0) > 0 && (
                    <small>
                      {selection.visibility!
                        .map((keyframe) => `${keyframe.timeSeconds.toFixed(2)}s ${keyframe.hidden ? 'ẩn' : 'hiện'}`)
                        .join(' · ')}
                    </small>
                  )}
                </div>
                <button className={`layout-visibility-button${selection.patch.hidden ? ' is-hidden' : ''}`} type="button" disabled={!canEdit('hidden')} onClick={() => sendPatch({hidden: !selection.patch.hidden})}>
                  <EyeOffIcon />{selection.patch.hidden ? 'Khôi phục toàn scene' : 'Ẩn trong toàn scene'}
                </button>
              </section>
              <footer>
                <button type="button" disabled={selection.editorLocked} onClick={() => sendCommand('resetSelected')}><ResetIcon />Reset layer</button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={selection.userText ? selection.editorLocked : !canEdit('hidden')}
                  onClick={() => selection.userText ? sendCommand('deleteSelected') : sendPatch({hidden: true})}
                >
                  <TrashIcon />{selection.userText ? 'Xóa text' : 'Delete (ẩn)'}
                </button>
              </footer>
            </>
          )}
        </aside>
        {runtimeState && timelineScenes.length > 0 && (
          <>
            <EditorResizeHandle
              panel="timeline"
              controller={editorWorkspace}
            />
            <ProfessionalTimeline
              frame={runtimeState.frame}
              duration={runtimeState.duration}
              fps={runtimeState.fps}
              scenes={timelineScenes}
              markers={timelineMarkers}
              activeSceneId={activeScene?.sceneId ?? runtimeState.sceneId}
              selectedNodeKey={selection?.nodeKey}
              editableProperties={selection?.editableProperties}
              animationDisabled={selection?.editorLocked}
              overrides={document?.overrides ?? []}
              onSeek={frame => sendCommand('seek', {frame})}
              onSelectNode={selectNode}
              onSetKeyframe={(property, _value, easing) =>
                sendCommand('setPropertyKeyframe', {
                  property,
                  value: selectedAnimationValue(property),
                  easing,
                })
              }
              onRemoveKeyframe={(property, timeSeconds) =>
                sendCommand('removePropertyKeyframe', {
                  property,
                  timeSeconds,
                })
              }
              onMoveKeyframe={(
                property,
                fromTimeSeconds,
                toTimeSeconds,
              ) =>
                sendCommand('movePropertyKeyframe', {
                  property,
                  fromTimeSeconds,
                  toTimeSeconds,
                })
              }
            />
          </>
        )}
      </section>
    </section>
  );
}
