import {
  useEffect,
  useLayoutEffect,
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
  LayoutRenderSettingsSchema,
  defaultLayoutRenderSettings,
  layoutFontFamilyValues,
  layoutFontWeightValues,
  type LayoutEditorManifest,
  type LayoutEditorNode,
  type LayoutNodePatch,
  type LayoutOverridesDocument,
  type LayoutRenderSettings,
} from '../shared/layout.ts';
import type {RenderWatermark} from '../shared/render.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  ExpandIcon,
  KeyboardIcon,
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
  XIcon,
} from './icons.tsx';
import {
  parseRuntimeNodeVisibility,
  resolveLayoutEditorManifest,
  timelineVisibleEditorNodes,
  type RuntimeNodeVisibility,
} from './layoutEditorState.ts';
import {groupEditorLayers} from './layerGroups.ts';
import {
  navigate,
  projectRenderPath,
  projectSyncPath,
  registerNavigationGuard,
} from './router.ts';
import {useLayoutEditor} from './useLayoutEditor.ts';
import {useEditorFocusMode} from './useEditorFocusMode.ts';
import {
  ApiRequestError,
  uploadWatermarkImage,
  watermarkAssetUrl,
} from './api.ts';

const PROTOCOL_SOURCE = 'pad-studio-layout-editor';
const PROTOCOL_VERSION = 1;
const RUNTIME_READY_TIMEOUT_MS = 20_000;
const RUNTIME_READY_POLL_MS = 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATED_EDITOR_NODE_PATTERN =
  /\/[A-Za-z][A-Za-z0-9]*\[\d+\]$/;

const LAYOUT_SHORTCUT_GROUPS = [
  {
    title: 'Chỉnh sửa',
    shortcuts: [
      ['Hoàn tác', 'Ctrl/Cmd', 'Z'],
      ['Làm lại', 'Ctrl/Cmd', 'Shift', 'Z'],
      ['Sao chép modifier', 'Ctrl/Cmd', 'C'],
      ['Dán modifier', 'Ctrl/Cmd', 'V'],
      ['Lưu ngay', 'Ctrl/Cmd', 'S'],
    ],
  },
  {
    title: 'Node đang chọn',
    shortcuts: [
      ['Di chuyển 1 px', '←', '↑', '↓', '→'],
      ['Di chuyển 10 px', 'Shift', '← ↑ ↓ →'],
      ['Ẩn node', 'Delete'],
      ['Ẩn / hiện', 'H'],
      ['Reset node', 'R'],
      ['Đưa xuống / lên', '[', ']'],
    ],
  },
  {
    title: 'Điều hướng',
    shortcuts: [
      ['Phát / tạm dừng', 'Space', 'K'],
      ['Lùi / tiến 5 giây', 'J', 'L'],
      ['Lùi / tiến 1 giây', 'Alt', '← / →'],
      ['Lùi / tiến 1 frame', ',', '.'],
      ['Đầu / cuối video', 'Home', 'End'],
      ['Bỏ chọn / đóng', 'Esc'],
      ['Chọn nhanh scene', '1', '…', '9'],
      ['Mở bảng phím tắt', '?'],
    ],
  },
] as const;

type NumericLayoutProperty =
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
  muted: boolean;
  sceneId: string;
  sceneName: string;
  dirtyRevision: number;
  reviewed: boolean;
  view?: {
    original: boolean;
    clean: boolean;
    grid: boolean;
    safeZone: boolean;
    snap: boolean;
  };
  history: {canUndo: boolean; canRedo: boolean};
}

interface RuntimeMessage {
  source?: string;
  version?: number;
  generationId?: string;
  sessionId?: string;
  type?: string;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value),
  );
}

function isRuntimeSelection(value: unknown): value is RuntimeSelection {
  if (!isRecord(value)) return false;
  const selection = value as Partial<RuntimeSelection>;
  const parsedNode = LayoutEditorNodeSchema.safeParse({
    key: selection.nodeKey,
    fingerprint: selection.nodeFingerprint,
    label: selection.label,
    nodeType: selection.nodeType,
    parentKey: selection.parentKey,
    identity: selection.identity,
    editableProperties: selection.editableProperties,
    lockedProperties: selection.lockedProperties,
    lockReason: selection.lockReason,
  });
  const patchIsValid =
    isRecord(selection.patch) &&
    (Object.keys(selection.patch).length === 0 ||
      LayoutNodePatchSchema.safeParse(selection.patch).success);
  return (
    UUID_PATTERN.test(selection.sceneId ?? '') &&
    parsedNode.success &&
    typeof selection.editorLocked === 'boolean' &&
    patchIsValid &&
    (selection.base === undefined || isRecord(selection.base))
  );
}

function isRuntimeState(value: unknown): value is RuntimeState {
  if (!isRecord(value) || !isRecord(value.history)) return false;
  return (
    Number.isFinite(value.frame) &&
    Number.isFinite(value.duration) &&
    Number.isFinite(value.fps) &&
    Number.isInteger(value.dirtyRevision) &&
    Number(value.dirtyRevision) >= 0 &&
    typeof value.paused === 'boolean' &&
    typeof value.muted === 'boolean' &&
    typeof value.sceneId === 'string' &&
    typeof value.sceneName === 'string' &&
    typeof value.reviewed === 'boolean' &&
    typeof value.history.canUndo === 'boolean' &&
    typeof value.history.canRedo === 'boolean'
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

function editorFacingNodes(nodes: LayoutEditorNode[]) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  return nodes.filter((node) => {
    if (!GENERATED_EDITOR_NODE_PATTERN.test(node.key)) return true;
    let parentKey = node.parentKey;
    const visited = new Set<string>();
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      const parent = byKey.get(parentKey);
      if (!parent) return true;
      if (!GENERATED_EDITOR_NODE_PATTERN.test(parent.key)) return false;
      parentKey = parent.parentKey;
    }
    return true;
  });
}

interface LayoutNumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}

function LayoutNumberInput({
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: LayoutNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      setDraft(String(value));
      return;
    }
    if (!draft.trim()) {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
    );
    setDraft(String(normalized));
    if (normalized !== value) onCommit(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
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

interface LayoutTextEditorProps {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}

function LayoutTextEditor({
  value,
  disabled,
  onCommit,
}: LayoutTextEditorProps) {
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
        <button
          type="button"
          disabled={disabled || draft === value}
          onClick={commit}
        >
          Áp dụng
        </button>
      </div>
    </div>
  );
}

export function LayoutEditorPage({projectId}: {projectId: string}) {
  const layout = useLayoutEditor(projectId);
  const {editorRef, focusMode, toggleFocusMode} =
    useEditorFocusMode<HTMLElement>();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sceneRailRef = useRef<HTMLDivElement | null>(null);
  const shortcutCloseRef = useRef<HTMLButtonElement | null>(null);
  const documentRef = useRef<LayoutOverridesDocument | null>(null);
  const committedDocumentRef =
    useRef<LayoutOverridesDocument | null>(null);
  const projectRef = useRef(layout.project);
  const saveRef = useRef(layout.save);
  const saveTimerRef = useRef<number | null>(null);
  const activeSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const dirtyRevisionRef = useRef(0);
  const savedRevisionRef = useRef(-1);
  const savingRevisionRef = useRef<number | null>(null);
  const savePendingAfterCurrentRef = useRef(false);
  const renderSettingsRef = useRef<LayoutRenderSettings>(
    defaultLayoutRenderSettings,
  );
  const renderSettingsDirtyRef = useRef(false);
  const leavingPageRef = useRef(false);
  const lastRuntimeDirtyRevisionRef = useRef(0);
  const manifestStoredRef = useRef(false);
  const manifestSaveRequiredRef = useRef(false);
  const persistedManifestSignatureRef = useRef('');
  const latestRuntimeManifestSignatureRef = useRef('');
  const runtimeFailedRef = useRef(false);
  const runtimeReadyRef = useRef(false);
  const automaticRecoveryCountRef = useRef(0);
  const pendingSelectionRef = useRef<{
    sceneId: string;
    nodeKey: string | null;
  } | null>(null);
  const loadedLayoutKeyRef = useRef('');
  const [document, setDocument] =
    useState<LayoutOverridesDocument | null>(null);
  const [manifest, setManifest] =
    useState<LayoutEditorManifest | null>(null);
  const [selection, setSelection] =
    useState<RuntimeSelection | null>(null);
  const [runtimeState, setRuntimeState] =
    useState<RuntimeState | null>(null);
  const [runtimeVisibility, setRuntimeVisibility] =
    useState<RuntimeNodeVisibility | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [frameReloadKey, setFrameReloadKey] = useState(0);
  const [manifestStored, setManifestStored] = useState(false);
  const [manifestSaveRequired, setManifestSaveRequired] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(-1);
  const [playedRevision, setPlayedRevision] = useState(-1);
  const [reviewedRevision, setReviewedRevision] = useState(-1);
  const [search, setSearch] = useState('');
  const [navigatorSceneId, setNavigatorSceneId] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [copiedPatch, setCopiedPatch] =
    useState<LayoutNodePatch | null>(null);
  const [renderSettings, setRenderSettings] =
    useState<LayoutRenderSettings>(defaultLayoutRenderSettings);
  const [renderSettingsDirty, setRenderSettingsDirty] = useState(false);
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [watermarkUploadError, setWatermarkUploadError] = useState('');

  projectRef.current = layout.project;
  saveRef.current = layout.save;

  const sourceSync = layout.project?.animationSyncBundle ?? null;
  const expectedOrigin = useMemo(() => {
    try {
      return layout.previewUrl
        ? new URL(layout.previewUrl).origin
        : '';
    } catch {
      return '';
    }
  }, [layout.previewUrl]);

  useEffect(() => {
    const initialDocument = layout.layoutState?.overrides;
    if (!initialDocument) return;
    const loadedLayoutKey = [
      projectId,
      layout.loadRevision,
      initialDocument.sourceAnimationSyncGenerationId,
      initialDocument.sourceAnimationSyncContentRevision,
      initialDocument.sourceAnimationSyncSourceHash,
    ].join(':');
    if (loadedLayoutKeyRef.current === loadedLayoutKey) {
      return;
    }
    loadedLayoutKeyRef.current = loadedLayoutKey;
    const persistedManifestSignature = JSON.stringify(
      layout.layoutState?.manifest ?? null,
    );
    persistedManifestSignatureRef.current = persistedManifestSignature;
    latestRuntimeManifestSignatureRef.current = persistedManifestSignature;
    manifestSaveRequiredRef.current = false;
    setManifestSaveRequired(false);
    setManifest((currentManifest) =>
      resolveLayoutEditorManifest(
        layout.layoutState?.manifest ?? null,
        currentManifest,
        initialDocument,
      ),
    );
    if (
      documentRef.current &&
      JSON.stringify(documentRef.current) ===
        JSON.stringify(initialDocument)
    ) {
      return;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    savingRevisionRef.current = null;
    savePendingAfterCurrentRef.current = false;
    manifestStoredRef.current = false;
    setManifestStored(false);
    documentRef.current = initialDocument;
    committedDocumentRef.current = initialDocument;
    setDocument(initialDocument);
    dirtyRevisionRef.current = 0;
    setDirtyRevision(0);
    lastRuntimeDirtyRevisionRef.current = 0;
    const bundle = layout.layoutState?.bundle;
    const initialRenderSettings =
      bundle?.renderSettings ?? defaultLayoutRenderSettings;
    renderSettingsRef.current = initialRenderSettings;
    renderSettingsDirtyRef.current = false;
    setRenderSettings(initialRenderSettings);
    setRenderSettingsDirty(false);
    const initialSaved =
      bundle &&
      bundle.sourceAnimationSyncGenerationId ===
        initialDocument.sourceAnimationSyncGenerationId &&
      bundle.sourceAnimationSyncContentRevision ===
        initialDocument.sourceAnimationSyncContentRevision &&
      bundle.sourceAnimationSyncSourceHash ===
        initialDocument.sourceAnimationSyncSourceHash
        ? 0
        : -1;
    savedRevisionRef.current = initialSaved;
    setSavedRevision(initialSaved);
    setSelection(null);
    setRuntimeVisibility(null);
    pendingSelectionRef.current = null;
    setPlayedRevision(-1);
    setReviewedRevision(-1);
  }, [layout.layoutState]);

  useEffect(() => {
    leavingPageRef.current = false;
    function preventUnsavedUnload(event: BeforeUnloadEvent) {
      if (
        activeSavePromiseRef.current ||
        renderSettingsDirtyRef.current ||
        (dirtyRevisionRef.current > 0 &&
          savedRevisionRef.current !== dirtyRevisionRef.current)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', preventUnsavedUnload);
    return () => {
      leavingPageRef.current = true;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (
        manifestStoredRef.current &&
        (savedRevisionRef.current !== dirtyRevisionRef.current ||
          renderSettingsDirtyRef.current)
      ) {
        const saveLatest = () => {
          const latestDocument = committedDocumentRef.current;
          return latestDocument
            ? saveRef.current(
                latestDocument.overrides,
                renderSettingsRef.current,
              )
            : Promise.resolve(null);
        };
        if (
          activeSavePromiseRef.current &&
          savingRevisionRef.current !== dirtyRevisionRef.current
        ) {
          void activeSavePromiseRef.current.then(saveLatest);
        } else if (!activeSavePromiseRef.current) {
          void saveLatest();
        }
      }
      window.removeEventListener('beforeunload', preventUnsavedUnload);
    };
  }, []);

  function sendCommand(type: string, payload: Record<string, unknown> = {}) {
    const target = frameRef.current?.contentWindow;
    if (
      !target ||
      !expectedOrigin ||
      !layout.previewGenerationId ||
      !layout.previewSessionNonce
    ) {
      return;
    }
    target.postMessage(
      {
        source: PROTOCOL_SOURCE,
        version: PROTOCOL_VERSION,
        generationId: layout.previewGenerationId,
        sessionId: layout.previewSessionNonce,
        type,
        payload,
      },
      expectedOrigin,
    );
  }

  function renderSettingsPayload(settings: LayoutRenderSettings) {
    return {
      renderSettings: settings,
      imageUrl:
        settings.watermark.type === 'image' &&
        settings.watermark.assetId
          ? new URL(
              watermarkAssetUrl(projectId, settings.watermark.assetId),
              window.location.origin,
            ).toString()
          : '',
    };
  }

  function updateRenderSettings(next: LayoutRenderSettings) {
    renderSettingsRef.current = next;
    renderSettingsDirtyRef.current = true;
    setRenderSettings(next);
    setRenderSettingsDirty(true);
    setPlayedRevision(-1);
    setReviewedRevision(-1);
    layout.clearActionError();
    sendCommand('setRenderSettings', renderSettingsPayload(next));
    if (LayoutRenderSettingsSchema.safeParse(next).success) {
      queueSave();
    }
  }

  function updateWatermark(watermark: RenderWatermark) {
    updateRenderSettings({...renderSettingsRef.current, watermark});
  }

  async function saveCurrentDocument(): Promise<boolean> {
    if (activeSavePromiseRef.current) {
      savePendingAfterCurrentRef.current = true;
      return activeSavePromiseRef.current;
    }
    const currentDocument = committedDocumentRef.current;
    if (
      !LayoutRenderSettingsSchema.safeParse(
        renderSettingsRef.current,
      ).success
    ) {
      return false;
    }
    if (
      !currentDocument ||
      !manifestStoredRef.current ||
      (!manifestSaveRequiredRef.current &&
        !renderSettingsDirtyRef.current &&
        savedRevisionRef.current === dirtyRevisionRef.current)
    ) {
      return (
        !manifestSaveRequiredRef.current &&
        !renderSettingsDirtyRef.current &&
        savedRevisionRef.current === dirtyRevisionRef.current
      );
    }

    const revisionToSave = dirtyRevisionRef.current;
    const manifestSignatureToSave =
      latestRuntimeManifestSignatureRef.current;
    const renderSettingsToSave = renderSettingsRef.current;
    const renderSettingsSignatureToSave = JSON.stringify(
      renderSettingsToSave,
    );
    savingRevisionRef.current = revisionToSave;
    let saveSucceeded = false;
    const operation = (async () => {
      const updatedProject = await saveRef.current(
        currentDocument.overrides,
        renderSettingsToSave,
      );
      if (!updatedProject) return false;
      saveSucceeded = true;
      savedRevisionRef.current = revisionToSave;
      setSavedRevision(revisionToSave);
      if (
        JSON.stringify(renderSettingsRef.current) ===
        renderSettingsSignatureToSave
      ) {
        renderSettingsDirtyRef.current = false;
        setRenderSettingsDirty(false);
      }
      if (
        latestRuntimeManifestSignatureRef.current ===
        manifestSignatureToSave
      ) {
        persistedManifestSignatureRef.current =
          manifestSignatureToSave;
        manifestSaveRequiredRef.current = false;
        setManifestSaveRequired(false);
      }
      return true;
    })();
    activeSavePromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (activeSavePromiseRef.current === operation) {
        activeSavePromiseRef.current = null;
      }
      if (savingRevisionRef.current === revisionToSave) {
        savingRevisionRef.current = null;
      }
      const saveWasQueued = savePendingAfterCurrentRef.current;
      savePendingAfterCurrentRef.current = false;
      if (
        saveSucceeded &&
        !leavingPageRef.current &&
        (saveWasQueued ||
          dirtyRevisionRef.current !== savedRevisionRef.current ||
          renderSettingsDirtyRef.current ||
          manifestSaveRequiredRef.current)
      ) {
        queueSave(120);
      }
    }
  }

  function queueSave(delay = 700) {
    if (leavingPageRef.current) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveCurrentDocument();
    }, delay);
  }

  async function flushPendingSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (activeSavePromiseRef.current) {
      await activeSavePromiseRef.current;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (
      savedRevisionRef.current !== dirtyRevisionRef.current ||
      renderSettingsDirtyRef.current
    ) {
      await saveCurrentDocument();
    }
    return (
      savedRevisionRef.current === dirtyRevisionRef.current &&
      !renderSettingsDirtyRef.current
    );
  }

  async function navigateAfterSaving(path: string) {
    const saved = await flushPendingSave();
    if (
      saved ||
      (dirtyRevisionRef.current === 0 && !renderSettingsDirtyRef.current)
    ) {
      navigate(path);
    }
  }

  useEffect(() => {
    const hasUnsavedChanges =
      activeSavePromiseRef.current !== null ||
      renderSettingsDirty ||
      (dirtyRevision > 0 && savedRevision !== dirtyRevision);
    if (!hasUnsavedChanges) return;
    return registerNavigationGuard(flushPendingSave);
  }, [dirtyRevision, renderSettingsDirty, savedRevision, layout.saveState]);

  useLayoutEffect(() => {
    const activeSourceGenerationId =
      sourceSync?.generation.generationId ?? '';
    const activeSourceContentRevision =
      sourceSync?.contentRevision ?? 0;
    const activeSourceHash = sourceSync?.validation.sourceHash ?? '';
    if (
      !expectedOrigin ||
      !layout.previewGenerationId ||
      !layout.previewSessionNonce ||
      !activeSourceGenerationId ||
      activeSourceContentRevision <= 0 ||
      !activeSourceHash
    ) {
      return;
    }

    function receiveRuntimeMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== expectedOrigin
      ) {
        return;
      }
      const message = event.data as RuntimeMessage;
      if (
        message?.source !== PROTOCOL_SOURCE ||
        message.version !== PROTOCOL_VERSION ||
        message.generationId !== layout.previewGenerationId ||
        message.sessionId !== layout.previewSessionNonce ||
        typeof message.type !== 'string'
      ) {
        return;
      }
      const payload = isRecord(message.payload)
        ? message.payload
        : {};

      if (message.type === 'ready') {
        if (runtimeFailedRef.current) return;
        runtimeReadyRef.current = true;
        setRuntimeReady(true);
        setRuntimeError('');
        sendCommand('loadDocument', {
          document: committedDocumentRef.current,
        });
        sendCommand(
          'setRenderSettings',
          renderSettingsPayload(renderSettingsRef.current),
        );
        const pendingSelection = pendingSelectionRef.current;
        if (pendingSelection) {
          pendingSelectionRef.current = null;
          sendCommand('setSelected', pendingSelection);
        }
        return;
      }

      if (message.type === 'selection') {
        const nextSelection = payload.selection;
        setSelection(
          nextSelection === null
            ? null
            : isRuntimeSelection(nextSelection)
              ? nextSelection
              : null,
        );
        return;
      }

      if (message.type === 'watermark-position-change') {
        const xPercent = Number(payload.xPercent);
        const yPercent = Number(payload.yPercent);
        const current = renderSettingsRef.current.watermark;
        if (
          current.type !== 'none' &&
          Number.isFinite(xPercent) &&
          Number.isFinite(yPercent)
        ) {
          updateWatermark({...current, xPercent, yPercent});
        }
        return;
      }

      if (message.type === 'state') {
        if (isRuntimeState(payload)) setRuntimeState(payload);
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
            detail: {
              action: payload.action,
              shiftKey: payload.shiftKey === true,
            },
          }),
        );
        return;
      }

      if (message.type === 'manifest') {
        const parsedManifest = LayoutEditorManifestSchema.safeParse(
          payload.manifest,
        );
        const manifestMatchesSource =
          parsedManifest.success &&
          parsedManifest.data.sourceAnimationSyncGenerationId ===
            activeSourceGenerationId &&
          parsedManifest.data.sourceAnimationSyncContentRevision ===
            activeSourceContentRevision &&
          parsedManifest.data.sourceAnimationSyncSourceHash ===
            activeSourceHash;
        if (manifestMatchesSource) {
          setManifest(parsedManifest.data);
        }
        if (payload.status === 'stored' && payload.complete === true) {
          if (!manifestMatchesSource) {
            runtimeFailedRef.current = true;
            setRuntimeReady(false);
            manifestStoredRef.current = false;
            setManifestStored(false);
            setRuntimeError(
              'Runtime trả về manifest không khớp chính xác nguồn Sync hiện hành.',
            );
            return;
          }
          manifestStoredRef.current = true;
          setManifestStored(true);
          const runtimeManifestSignature = JSON.stringify(
            parsedManifest.data,
          );
          latestRuntimeManifestSignatureRef.current =
            runtimeManifestSignature;
          if (
            runtimeManifestSignature !==
            persistedManifestSignatureRef.current
          ) {
            manifestSaveRequiredRef.current = true;
            setManifestSaveRequired(true);
          }
          if (
            manifestSaveRequiredRef.current ||
            !projectRef.current?.layoutBundle ||
            savedRevisionRef.current !== dirtyRevisionRef.current
          ) {
            queueSave(120);
          }
        } else if (payload.status === 'error') {
          runtimeFailedRef.current = true;
          setRuntimeReady(false);
          manifestStoredRef.current = false;
          setManifestStored(false);
          setRuntimeError(
            typeof payload.message === 'string'
              ? payload.message
              : 'Không thể xác nhận danh sách node có thể chỉnh.',
          );
        }
        return;
      }

      if (message.type === 'documentChanged') {
        const parsed = LayoutOverridesDocumentSchema.safeParse(
          payload.document,
        );
        if (
          !parsed.success ||
          parsed.data.sourceAnimationSyncGenerationId !==
            activeSourceGenerationId ||
          parsed.data.sourceAnimationSyncContentRevision !==
            activeSourceContentRevision ||
          parsed.data.sourceAnimationSyncSourceHash !==
            activeSourceHash
        ) {
          runtimeFailedRef.current = true;
          setRuntimeReady(false);
          manifestStoredRef.current = false;
          setManifestStored(false);
          setRuntimeError(
            'Runtime trả về layout không khớp generation nguồn.',
          );
          return;
        }
        documentRef.current = parsed.data;
        setDocument(parsed.data);
        if (payload.reason === 'load-document') {
          return;
        }
        if (payload.transient === true) {
          if (isRuntimeSelection(payload.selection)) {
            setSelection(payload.selection);
          }
          return;
        }
        committedDocumentRef.current = parsed.data;
        const runtimeRevision =
          typeof payload.dirtyRevision === 'number' &&
          Number.isInteger(payload.dirtyRevision) &&
          payload.dirtyRevision >= 0
            ? payload.dirtyRevision
            : null;
        if (
          runtimeRevision === null ||
          runtimeRevision !== lastRuntimeDirtyRevisionRef.current
        ) {
          if (runtimeRevision !== null) {
            lastRuntimeDirtyRevisionRef.current = runtimeRevision;
          }
          const nextRevision = dirtyRevisionRef.current + 1;
          dirtyRevisionRef.current = nextRevision;
          setDirtyRevision(nextRevision);
        }
        if (isRuntimeSelection(payload.selection)) {
          setSelection(payload.selection);
        }
        setPlayedRevision(-1);
        setReviewedRevision(-1);
        layout.clearActionError();
        queueSave();
        return;
      }

      if (message.type === 'played') {
        setPlayedRevision(dirtyRevisionRef.current);
        return;
      }

      if (message.type === 'reviewed') {
        const revision = dirtyRevisionRef.current;
        setPlayedRevision(revision);
        setReviewedRevision(revision);
        return;
      }

      if (message.type === 'error') {
        runtimeFailedRef.current = true;
        setRuntimeReady(false);
        manifestStoredRef.current = false;
        setManifestStored(false);
        setReviewedRevision(-1);
        layout.clearActionError();
        setRuntimeError(
          typeof payload.message === 'string'
            ? payload.message
            : 'Layout Editor runtime gặp lỗi.',
        );
      }
    }

    window.addEventListener('message', receiveRuntimeMessage);
    sendCommand('requestReady');
    const readyPoll = window.setInterval(() => {
      if (!runtimeReadyRef.current && !runtimeFailedRef.current) {
        sendCommand('requestReady');
      }
    }, RUNTIME_READY_POLL_MS);
    return () => {
      window.clearInterval(readyPoll);
      window.removeEventListener('message', receiveRuntimeMessage);
    };
  }, [
    expectedOrigin,
    layout.previewGenerationId,
    layout.previewSessionNonce,
    sourceSync?.generation.generationId,
    sourceSync?.contentRevision,
    sourceSync?.validation.sourceHash,
  ]);

  useEffect(() => {
    runtimeFailedRef.current = false;
    runtimeReadyRef.current = false;
    setRuntimeReady(false);
    setManifestStored(false);
    manifestStoredRef.current = false;
    setRuntimeError('');
    setSelection(null);
    setRuntimeState(null);
    setRuntimeVisibility(null);
    lastRuntimeDirtyRevisionRef.current = 0;
    setPlayedRevision(-1);
    setReviewedRevision(-1);
  }, [layout.previewSessionNonce]);

  useEffect(() => {
    runtimeReadyRef.current = runtimeReady;
  }, [runtimeReady]);

  useEffect(() => {
    automaticRecoveryCountRef.current = 0;
  }, [projectId, sourceSync?.generation.generationId]);

  useEffect(() => {
    if (
      layout.previewState !== 'ready' ||
      !layout.previewUrl ||
      runtimeReady ||
      runtimeError
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      if (runtimeReadyRef.current || runtimeFailedRef.current) return;
      if (automaticRecoveryCountRef.current === 0) {
        automaticRecoveryCountRef.current = 1;
        restartRuntime();
        return;
      }
      runtimeFailedRef.current = true;
      runtimeReadyRef.current = false;
      setRuntimeReady(false);
      manifestStoredRef.current = false;
      setManifestStored(false);
      setReviewedRevision(-1);
      setRuntimeError(
        'Canvas không phản hồi sau khi đã tự khởi động lại. Hãy nạp lại canvas.',
      );
    }, RUNTIME_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [
    frameReloadKey,
    layout.previewSessionNonce,
    layout.previewState,
    layout.previewUrl,
    runtimeError,
    runtimeReady,
  ]);

  useEffect(() => {
    const sceneId = selection?.sceneId || runtimeState?.sceneId;
    if (!sceneId) return;
    setNavigatorSceneId(sceneId);
  }, [runtimeState?.sceneId, selection?.sceneId]);

  const scenes = useMemo(() => {
    if (!sourceSync) return [];
    const manifestById = new Map(
      manifest?.scenes.map((scene) => [scene.sceneId, scene]),
    );
    return sourceSync.sections.map((section, index) => ({
      sceneId: section.sceneId,
      filePath: section.filePath,
      label: `Scene ${String(index + 1).padStart(2, '0')}`,
      nodes: editorFacingNodes(
        manifestById.get(section.sceneId)?.nodes ?? [],
      ),
    }));
  }, [manifest, sourceSync]);
  const hasKnownNodes = scenes.some((scene) => scene.nodes.length > 0);

  const visibleScenes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    if (!query) return scenes;
    return scenes
      .map((scene) => {
        const sceneMatches =
          scene.label.toLocaleLowerCase('vi').includes(query) ||
          scene.filePath.toLocaleLowerCase('vi').includes(query);
        return {
          ...scene,
          nodes: sceneMatches
            ? scene.nodes
            : scene.nodes.filter(
                (node) =>
                  node.label.toLocaleLowerCase('vi').includes(query) ||
                  node.key.toLocaleLowerCase('vi').includes(query) ||
                  node.nodeType.toLocaleLowerCase('vi').includes(query),
              ),
        };
      })
      .filter(
        (scene) =>
          scene.nodes.length > 0 ||
          scene.label.toLocaleLowerCase('vi').includes(query) ||
          scene.filePath.toLocaleLowerCase('vi').includes(query),
      );
  }, [scenes, search]);
  const activeScene =
    visibleScenes.find((scene) => scene.sceneId === navigatorSceneId) ??
    visibleScenes.find((scene) => scene.sceneId === selection?.sceneId) ??
    visibleScenes.find((scene) => scene.sceneId === runtimeState?.sceneId) ??
    visibleScenes[0] ??
    null;
  const activeSceneIndex = activeScene
    ? scenes.findIndex((scene) => scene.sceneId === activeScene.sceneId)
    : -1;
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
  const activeLayerGroups = groupEditorLayers(
    activeSceneNodes,
    scenes.find(scene => scene.sceneId === activeScene?.sceneId)?.nodes ??
      activeScene?.nodes ??
      [],
  );

  useEffect(() => {
    if (!activeScene) return;
    const activeButton = sceneRailRef.current?.querySelector<HTMLElement>(
      `[data-scene-id="${activeScene.sceneId}"]`,
    );
    activeButton?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeScene?.sceneId]);

  useEffect(() => {
    if (shortcutsOpen) shortcutCloseRef.current?.focus();
  }, [shortcutsOpen]);

  function canEdit(property: LayoutEditorNode['editableProperties'][number]) {
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

  function sendNumericPatch(
    property: NumericLayoutProperty,
    value: number,
  ) {
    sendPatch({
      [property]: value,
    } as LayoutNodePatch);
  }

  function selectNode(sceneId: string, nodeKey?: string) {
    setNavigatorSceneId(sceneId);
    const pendingSelection = {
      sceneId,
      nodeKey: nodeKey ?? null,
    };
    if (!runtimeReady) {
      pendingSelectionRef.current = pendingSelection;
      return;
    }
    pendingSelectionRef.current = null;
    sendCommand('setSelected', pendingSelection);
  }

  function scrollSceneRail(direction: -1 | 1) {
    sceneRailRef.current?.scrollBy({
      left: direction * 220,
      behavior: 'smooth',
    });
  }

  function copySelectedPatch() {
    if (!selection) return;
    setCopiedPatch(
      Object.fromEntries(
        Object.entries(selection.patch).filter(
          ([property]) => property !== 'editorLocked',
        ),
      ) as LayoutNodePatch,
    );
  }

  function pasteSelectedPatch() {
    if (!selection || selection.editorLocked || !copiedPatch) return;
    const editable = new Set(selection.editableProperties);
    const locked = new Set(selection.lockedProperties);
    const filtered = Object.fromEntries(
      Object.entries(copiedPatch).filter(
        ([property]) =>
          editable.has(
            property as LayoutEditorNode['editableProperties'][number],
          ) &&
            !locked.has(
              property as LayoutEditorNode['editableProperties'][number],
            ),
      ),
    ) as LayoutNodePatch;
    if (Object.keys(filtered).length > 0) sendPatch(filtered);
  }

  function restartRuntime() {
    runtimeFailedRef.current = false;
    runtimeReadyRef.current = false;
    setRuntimeReady(false);
    manifestStoredRef.current = false;
    setManifestStored(false);
    setRuntimeError('');
    setSelection(null);
    setRuntimeState(null);
    lastRuntimeDirtyRevisionRef.current = 0;
    setPlayedRevision(-1);
    setReviewedRevision(-1);
    layout.clearActionError();
    setFrameReloadKey((current) => current + 1);
    layout.retryPreview();
  }

  function reloadRuntime() {
    automaticRecoveryCountRef.current = 0;
    restartRuntime();
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    }

    function runShortcut(action: string, shiftKey = false) {
      const nudge = shiftKey ? 10 : 1;
      switch (action) {
        case 'undo':
          if (!runtimeState?.history.canUndo) return false;
          sendCommand('undo');
          return true;
        case 'redo':
          if (!runtimeState?.history.canRedo) return false;
          sendCommand('redo');
          return true;
        case 'copy':
          if (!selection) return false;
          copySelectedPatch();
          return true;
        case 'paste':
          if (!selection || selection.editorLocked || !copiedPatch) {
            return false;
          }
          pasteSelectedPatch();
          return true;
        case 'save':
          void flushPendingSave();
          return true;
        case 'help':
          setShortcutsOpen(true);
          return true;
        case 'escape':
          if (shortcutsOpen) {
            setShortcutsOpen(false);
          } else if (selection) {
            sendCommand('setSelected', {
              sceneId: selection.sceneId,
              nodeKey: null,
            });
          } else {
            return false;
          }
          return true;
        case 'toggle-play':
          if (!runtimeReady) return false;
          sendCommand('toggle');
          return true;
        case 'seek-back-five':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {seconds: -5});
          return true;
        case 'seek-forward-five':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {seconds: 5});
          return true;
        case 'seek-back-one':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {seconds: -1});
          return true;
        case 'seek-forward-one':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {seconds: 1});
          return true;
        case 'frame-back':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {frames: -1});
          return true;
        case 'frame-forward':
          if (!runtimeReady) return false;
          sendCommand('seekBy', {frames: 1});
          return true;
        case 'seek-start':
          if (!runtimeReady) return false;
          sendCommand('seek', {frame: 0});
          return true;
        case 'seek-end':
          if (!runtimeReady || !runtimeState) return false;
          sendCommand('seek', {frame: runtimeState.duration});
          return true;
        case 'delete':
          if (!canEdit('hidden')) return false;
          sendPatch({hidden: true});
          return true;
        case 'toggle-hidden':
          if (!selection || !canEdit('hidden')) return false;
          sendPatch({hidden: !selection.patch.hidden});
          return true;
        case 'reset':
          if (!selection || selection.editorLocked) return false;
          sendCommand('resetSelected');
          return true;
        case 'layer-up':
        case 'layer-down':
          if (!selection || !canEdit('zIndexDelta')) return false;
          sendPatch({
            zIndexDelta:
              (selection.patch.zIndexDelta ?? 0) +
              (action === 'layer-up' ? 1 : -1),
          });
          return true;
        case 'nudge-left':
        case 'nudge-right':
          if (!selection || !canEdit('x')) return false;
          sendNumericPatch(
            'x',
            (selection.patch.x ?? 0) +
              (action === 'nudge-right' ? nudge : -nudge),
          );
          return true;
        case 'nudge-up':
        case 'nudge-down':
          if (!selection || !canEdit('y')) return false;
          sendNumericPatch(
            'y',
            (selection.patch.y ?? 0) +
              (action === 'nudge-down' ? nudge : -nudge),
          );
          return true;
        default:
          if (/^scene-[1-9]$/.test(action)) {
            const index = Number(action.at(-1)) - 1;
            const scene = scenes[index];
            if (!scene) return false;
            selectNode(scene.sceneId);
            return true;
          }
          return false;
      }
    }

    function handleRuntimeShortcut(event: Event) {
      const detail = (
        event as CustomEvent<{action?: string; shiftKey?: boolean}>
      ).detail;
      if (!detail?.action) return;
      runShortcut(detail.action, detail.shiftKey === true);
    }

    function handleKeyboardShortcut(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      let action = '';
      if (modifier && event.code === 'KeyZ') {
        action = event.shiftKey ? 'redo' : 'undo';
      } else if (modifier && event.code === 'KeyY') {
        action = 'redo';
      } else if (modifier && event.code === 'KeyC') {
        action = 'copy';
      } else if (modifier && event.code === 'KeyV') {
        action = 'paste';
      } else if (modifier && event.code === 'KeyS') {
        action = 'save';
      } else if (!modifier && event.key === '?') {
        action = 'help';
      } else if (!modifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        action = 'delete';
      } else if (!modifier && event.code === 'Space') {
        action = 'toggle-play';
      } else if (!modifier && event.code === 'KeyJ') {
        action = 'seek-back-five';
      } else if (!modifier && event.code === 'KeyK') {
        action = 'toggle-play';
      } else if (!modifier && event.code === 'KeyL') {
        action = 'seek-forward-five';
      } else if (!modifier && event.code === 'Comma') {
        action = 'frame-back';
      } else if (!modifier && event.code === 'Period') {
        action = 'frame-forward';
      } else if (!modifier && event.code === 'Home') {
        action = 'seek-start';
      } else if (!modifier && event.code === 'End') {
        action = 'seek-end';
      } else if (!modifier && event.altKey && event.key === 'ArrowLeft') {
        action = event.shiftKey ? 'seek-back-five' : 'seek-back-one';
      } else if (!modifier && event.altKey && event.key === 'ArrowRight') {
        action = event.shiftKey ? 'seek-forward-five' : 'seek-forward-one';
      } else if (!modifier && event.key === 'Escape') {
        action = 'escape';
      } else if (!modifier && event.key === 'ArrowLeft') {
        action = 'nudge-left';
      } else if (!modifier && event.key === 'ArrowRight') {
        action = 'nudge-right';
      } else if (!modifier && event.key === 'ArrowUp') {
        action = 'nudge-up';
      } else if (!modifier && event.key === 'ArrowDown') {
        action = 'nudge-down';
      } else if (!modifier && event.code === 'BracketRight') {
        action = 'layer-up';
      } else if (!modifier && event.code === 'BracketLeft') {
        action = 'layer-down';
      } else if (!modifier && event.code === 'KeyH') {
        action = 'toggle-hidden';
      } else if (!modifier && event.code === 'KeyR') {
        action = 'reset';
      } else if (!modifier && /^Digit[1-9]$/.test(event.code)) {
        action = `scene-${event.code.at(-1)}`;
      }
      if (action && runShortcut(action, event.shiftKey)) {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcut);
    window.addEventListener('pad-layout-shortcut', handleRuntimeShortcut);
    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcut);
      window.removeEventListener('pad-layout-shortcut', handleRuntimeShortcut);
    };
  }, [
    copiedPatch,
    runtimeReady,
    runtimeState,
    scenes,
    selection,
    shortcutsOpen,
  ]);

  if (layout.loadState === 'loading') {
    return (
      <div className="page-state" role="status">
        <span className="spinner dark" />
        <strong>Đang mở workspace Layout Editor…</strong>
      </div>
    );
  }

  if (layout.loadState === 'error' || !layout.project) {
    return (
      <div className="page-state is-error" role="alert">
        <strong>Không thể mở Layout Editor</strong>
        <p>{layout.loadError}</p>
        <button type="button" onClick={() => navigate('/')}>
          Về danh sách project
        </button>
      </div>
    );
  }

  if (!layout.ready || !sourceSync) {
    return (
      <div className="layout-workspace">
        <header className="outline-heading">
          <div className="eyebrow">
            <span>Bước 07</span>
            <span className="eyebrow-line" />
            Layout Editor
          </div>
          <AdaptiveHeading as="h1">
            Cần chốt bản đồng bộ trước khi chỉnh bố cục.
          </AdaptiveHeading>
          <p>
            Layout luôn bám đúng một generation Sync để không sửa nhầm
            scene, timing hoặc narration.
          </p>
        </header>
        <section className="layout-blocked-card" role="alert">
          <LockIcon />
          <div>
            <strong>Nguồn chỉnh sửa chưa sẵn sàng</strong>
            <p>Hãy review và chốt animation đã đồng bộ trước.</p>
          </div>
          <button
            className="submit-button"
            type="button"
            onClick={() => navigate(projectSyncPath(projectId))}
          >
            <ArrowLeftIcon />
            Về bước đồng bộ
          </button>
        </section>
      </div>
    );
  }

  const selectedText =
    typeof selection?.patch.text === 'string'
      ? selection.patch.text
      : typeof selection?.base?.text === 'string'
        ? selection.base.text
        : '';
  const rawFontFamily =
    selection?.patch.fontFamily ?? selection?.base?.fontFamily;
  const selectedFontFamily =
    typeof rawFontFamily === 'string' &&
    layoutFontFamilyValues.some((font) => font === rawFontFamily)
      ? rawFontFamily
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
    selection?.patch.fontStyle === 'italic' ||
    selection?.base?.fontStyle === 'italic'
      ? 'italic'
      : 'normal';
  const watermark = renderSettings.watermark;
  const renderSettingsValid =
    LayoutRenderSettingsSchema.safeParse(renderSettings).success;

  const isSaved =
    savedRevision === dirtyRevision &&
    !renderSettingsDirty &&
    !manifestSaveRequired &&
    layout.saveState !== 'saving' &&
    Boolean(layout.project.layoutBundle);
  const approved =
    layout.project.layoutBundle?.status === 'approved' &&
    !layout.stale &&
    isSaved;
  const currentPlayed = playedRevision === dirtyRevision;
  const currentReviewed = reviewedRevision === dirtyRevision;
  const canApprove =
    !approved &&
    runtimeReady &&
    manifestStored &&
    isSaved &&
    currentPlayed &&
    currentReviewed &&
    !runtimeError &&
    !layout.approving &&
    !layout.conflict &&
    !layout.stale;

  return (
    <div className="layout-workspace">
      <header className="layout-page-heading">
        <div>
          <div className="eyebrow">
            <span>Bước 07</span>
            <span className="eyebrow-line" />
            Layout Editor
          </div>
          <AdaptiveHeading as="h1">
            Chỉnh trực tiếp trên khung hình, không chạm vào source.
          </AdaptiveHeading>
          <p>
            Chọn một node để kéo, đổi kích thước, xoay, đổi màu hoặc ẩn.
            Mọi thay đổi được lưu dưới dạng modifier có thể hoàn tác.
          </p>
        </div>
        <div className="layout-heading-status">
          <button
            className="layout-shortcut-trigger"
            type="button"
            onClick={() => setShortcutsOpen(true)}
          >
            <KeyboardIcon />
            Phím tắt
            <kbd>?</kbd>
          </button>
          <span className={`draft-status${isSaved ? ' is-saved' : ''}`}>
            <span />
            {layout.saveState === 'saving'
              ? 'Đang tự lưu…'
              : layout.saveState === 'error'
                ? 'Lưu chưa thành công'
                : isSaved
                  ? 'Đã lưu modifier'
                  : 'Có thay đổi chưa lưu'}
          </span>
          <code>{sourceSync.generation.generationId.slice(0, 8)}</code>
        </div>
      </header>

      {(layout.conflict || layout.stale || layout.actionError) && (
        <div
          className={`outline-alert${
            layout.conflict || layout.actionError ? ' is-error' : ''
          }`}
          role="alert"
        >
          <span>
            {layout.conflict
              ? 'Project vừa thay đổi ở nơi khác.'
              : layout.stale
                ? 'Nguồn Sync đã đổi; layout hiện tại chỉ còn để đối chiếu.'
                : layout.actionError}
          </span>
          <button
            type="button"
            disabled={
              layout.actionErrorKind === 'approve' && !canApprove
            }
            onClick={() => {
              if (
                layout.actionError &&
                !layout.conflict &&
                !layout.stale
              ) {
                if (layout.actionErrorKind === 'approve') {
                  if (canApprove) void layout.approve();
                } else {
                  void saveCurrentDocument();
                }
              } else {
                layout.reload();
              }
            }}
          >
            {layout.actionError && !layout.conflict && !layout.stale
              ? layout.actionErrorKind === 'approve'
                ? 'Thử chốt lại'
                : 'Thử lưu lại'
              : 'Tải lại'}
          </button>
        </div>
      )}

      <section className="layout-output-settings" aria-label="Watermark">
        <header>
          <div>
            <span className="preview-kicker">Xem trước bản xuất</span>
            <strong>Watermark</strong>
          </div>
          <small>
            Các lựa chọn này được lưu cùng Layout và áp dụng trực tiếp khi render.
          </small>
        </header>
        <div className="layout-watermark-settings">
          <label>
            <span>Watermark</span>
            <select
              value={watermark.type}
              onChange={event => {
                const type = event.currentTarget.value;
                setWatermarkUploadError('');
                updateWatermark(
                  type === 'text'
                    ? {
                        type: 'text',
                        text: '',
                        opacity: 0.3,
                        xPercent: 88,
                        yPercent: 92,
                        fontSize: 44,
                        color: '#ffffff',
                      }
                    : type === 'image'
                      ? {
                          type: 'image',
                          assetId: '',
                          opacity: 0.3,
                          xPercent: 88,
                          yPercent: 92,
                          widthPercent: 22,
                          tintColor: '#FFFFFF',
                          tintStrength: 0,
                        }
                      : {type: 'none'},
                );
              }}
            >
              <option value="none">Không dùng</option>
              <option value="text">Chèn chữ</option>
              <option value="image">Ảnh</option>
            </select>
          </label>
          {watermark.type === 'text' && (
            <>
              <label className="is-wide">
                <span>Nội dung</span>
                <input
                  type="text"
                  value={watermark.text}
                  placeholder="Tên kênh hoặc thương hiệu"
                  onChange={event =>
                    updateWatermark({
                      ...watermark,
                      text: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Cỡ chữ</span>
                <LayoutNumberInput
                  value={watermark.fontSize}
                  min={0.01}
                  step={1}
                  disabled={false}
                  onCommit={fontSize =>
                    updateWatermark({...watermark, fontSize})
                  }
                />
              </label>
              <label>
                <span>Màu</span>
                <input
                  type="color"
                  value={watermark.color}
                  onChange={event =>
                    updateWatermark({
                      ...watermark,
                      color: event.currentTarget.value,
                    })
                  }
                />
              </label>
            </>
          )}
          {watermark.type === 'image' && (
            <>
              <label className="is-wide layout-watermark-upload">
                <span>Ảnh PNG, JPEG hoặc WebP</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={watermarkUploading}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    event.currentTarget.value = '';
                    setWatermarkUploading(true);
                    setWatermarkUploadError('');
                    void uploadWatermarkImage(projectId, file)
                      .then(asset => {
                        const current = renderSettingsRef.current.watermark;
                        if (current.type === 'image') {
                          updateWatermark({...current, assetId: asset.assetId});
                        }
                      })
                      .catch(error =>
                        setWatermarkUploadError(
                          error instanceof ApiRequestError
                            ? error.message
                            : 'Không thể tải ảnh watermark.',
                        ),
                      )
                      .finally(() => setWatermarkUploading(false));
                  }}
                />
                <small>
                  {watermarkUploading
                    ? 'Đang tải và kiểm tra ảnh…'
                    : watermark.assetId
                      ? 'Ảnh đã sẵn sàng trong preview.'
                      : 'Chưa chọn ảnh.'}
                </small>
              </label>
              <label>
                <span>Màu ảnh</span>
                <input
                  type="color"
                  value={watermark.tintColor}
                  onChange={event =>
                    updateWatermark({
                      ...watermark,
                      tintColor: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <div className="layout-output-control is-tint-strength">
                <label htmlFor="layout-watermark-tint">Phủ màu</label>
                <input
                  id="layout-watermark-tint"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={watermark.tintStrength}
                  onChange={event =>
                    updateWatermark({
                      ...watermark,
                      tintStrength: Number(event.currentTarget.value),
                    })
                  }
                />
                <LayoutNumberInput
                  value={watermark.tintStrength * 100}
                  min={0}
                  max={100}
                  step={1}
                  disabled={false}
                  onCommit={tintStrength =>
                    updateWatermark({
                      ...watermark,
                      tintStrength: tintStrength / 100,
                    })
                  }
                />
                <span>%</span>
              </div>
            </>
          )}
          {watermark.type !== 'none' && (
            <>
              <label>
                <span>Vị trí X (%)</span>
                <LayoutNumberInput
                  value={watermark.xPercent}
                  step={0.1}
                  disabled={false}
                  onCommit={xPercent =>
                    updateWatermark({...watermark, xPercent})
                  }
                />
              </label>
              <label>
                <span>Vị trí Y (%)</span>
                <LayoutNumberInput
                  value={watermark.yPercent}
                  step={0.1}
                  disabled={false}
                  onCommit={yPercent =>
                    updateWatermark({...watermark, yPercent})
                  }
                />
              </label>
              <div className="layout-output-control is-opacity">
                <label htmlFor="layout-watermark-opacity">Opacity</label>
                <input
                  id="layout-watermark-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={watermark.opacity}
                  onChange={event =>
                    updateWatermark({
                      ...watermark,
                      opacity: Number(event.currentTarget.value),
                    })
                  }
                />
                <LayoutNumberInput
                  value={watermark.opacity * 100}
                  min={0}
                  max={100}
                  step={1}
                  disabled={false}
                  onCommit={opacity =>
                    updateWatermark({
                      ...watermark,
                      opacity: opacity / 100,
                    })
                  }
                />
                <span>%</span>
              </div>
            </>
          )}
          {watermark.type === 'image' && (
            <div className="layout-output-control is-watermark-width">
              <label htmlFor="layout-watermark-width">Chiều rộng</label>
              <input
                id="layout-watermark-width"
                type="range"
                min={0}
                max={Math.max(200, watermark.widthPercent * 1.5)}
                step={0.1}
                value={watermark.widthPercent}
                onChange={event =>
                  updateWatermark({
                    ...watermark,
                    widthPercent: Number(event.currentTarget.value),
                  })
                }
              />
              <LayoutNumberInput
                value={watermark.widthPercent}
                min={0}
                step={0.1}
                disabled={false}
                onCommit={widthPercent =>
                  updateWatermark({...watermark, widthPercent})
                }
              />
              <span>%</span>
            </div>
          )}
          {watermark.type !== 'none' && (
            <small className="layout-watermark-drag-hint">
              Kéo trực tiếp watermark trên khung preview; có thể nhập X/Y ngoài khung nếu cần.
            </small>
          )}
        </div>
        {watermarkUploadError && (
          <small className="watermark-upload-error">{watermarkUploadError}</small>
        )}
        {!renderSettingsValid && !watermarkUploadError && (
          <small className="watermark-upload-error">
            Hoàn thiện nội dung hoặc tải ảnh watermark trước khi lưu và chốt Layout.
          </small>
        )}
      </section>

      <section
        className={`layout-editor-shell${focusMode ? ' is-editor-focus' : ''}`}
        ref={editorRef}
        role={focusMode ? 'dialog' : undefined}
        aria-modal={focusMode || undefined}
        aria-label={focusMode ? 'Layout Editor toàn màn hình' : undefined}
        tabIndex={focusMode ? -1 : undefined}
      >
        <aside className="layout-tree-panel" aria-label="Danh sách scene và node">
          <header>
            <div>
              <span className="preview-kicker">
                <LayersIcon />
                Cấu trúc video
              </span>
              <strong>{document?.overrides.length ?? 0} modifier</strong>
            </div>
            <input
              type="search"
              value={search}
              placeholder="Tìm scene hoặc layer…"
              aria-label="Tìm scene hoặc layer"
              onChange={(event) => setSearch(event.target.value)}
            />
          </header>
          <div className="layout-scene-navigator">
            <div className="layout-panel-label">
              <span>Scene</span>
              <small>
                {activeSceneIndex >= 0 ? activeSceneIndex + 1 : 0}/{scenes.length}
              </small>
            </div>
            <div className="layout-scene-rail-wrap">
              <button
                className="layout-rail-arrow is-previous"
                type="button"
                aria-label="Cuộn scene về trước"
                onClick={() => scrollSceneRail(-1)}
              >
                <ArrowLeftIcon />
              </button>
              <div
                className="layout-scene-rail"
                ref={sceneRailRef}
                role="tablist"
                aria-label="Chọn scene"
              >
                {visibleScenes.map((scene) => {
                  const sceneIndex = scenes.findIndex(
                    (item) => item.sceneId === scene.sceneId,
                  );
                  const active = activeScene?.sceneId === scene.sceneId;
                  const modifierCount =
                    document?.overrides.filter(
                      (item) => item.sceneId === scene.sceneId,
                    ).length ?? 0;
                  return (
                    <button
                      className={`layout-scene-chip${active ? ' is-active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-scene-id={scene.sceneId}
                      key={scene.sceneId}
                      onClick={() => selectNode(scene.sceneId)}
                    >
                      <span>{String(sceneIndex + 1).padStart(2, '0')}</span>
                      <strong>{scene.label}</strong>
                      {modifierCount > 0 && <i>{modifierCount}</i>}
                    </button>
                  );
                })}
              </div>
              <button
                className="layout-rail-arrow is-next"
                type="button"
                aria-label="Cuộn scene tiếp theo"
                onClick={() => scrollSceneRail(1)}
              >
                <ArrowRightIcon />
              </button>
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
                <div className="layout-list-empty">
                  <strong>Không tìm thấy kết quả</strong>
                  <span>Thử một từ khóa khác.</span>
                </div>
              ) : timelineHiddenNodeCount > 0 && activeSceneNodes.length === 0 ? (
                <div className="layout-list-empty is-timeline-empty">
                  <strong>Chưa có layer nào xuất hiện</strong>
                  <span>Di chuyển playhead đến lúc hình bắt đầu hiện.</span>
                </div>
              ) : activeScene.nodes.length === 0 ? (
                <button
                  className="layout-empty-scene"
                  type="button"
                  onClick={() => selectNode(activeScene.sceneId)}
                >
                  <LayersIcon />
                  <span>
                    <strong>Mở scene để nhận diện layer</strong>
                    <small>Node map sẽ xuất hiện tại đây.</small>
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
                      return (
                        <button
                          className={`layout-node-row${
                            selected ? ' is-selected' : ''
                          }${nodeOverride?.patch.hidden ? ' is-hidden' : ''}`}
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
                            <small>
                              {patchSummary(nodeOverride?.patch ?? {})}
                            </small>
                          </span>
                          {(nodeOverride?.patch.hidden ||
                            node.identity === 'legacy') && (
                            <span className="layout-node-state">
                              {nodeOverride?.patch.hidden && (
                                <EyeOffIcon aria-label="Node đang ẩn" />
                              )}
                              {node.identity === 'legacy' && (
                                <i title="Node legacy được khóa theo fingerprint">
                                  L
                                </i>
                              )}
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
          <footer>
            <span className={manifestStored ? 'is-ready' : ''} />
            {manifestStored
              ? 'Node map đã được xác nhận'
              : hasKnownNodes
                ? 'Đã tải node map · đang kết nối canvas'
                : 'Đang nhận diện node trong scene'}
          </footer>
        </aside>

        <div className="layout-preview-column">
          <div className="layout-preview-frame">
            {layout.previewState === 'loading' && (
              <div className="layout-preview-state" role="status">
                <span className="spinner" />
                <strong>Đang khởi động canvas tương tác…</strong>
                <p>Runtime đang nạp đúng scene, audio và playhead đã chốt.</p>
              </div>
            )}
            {layout.previewState === 'error' && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Chưa mở được Layout Editor runtime</strong>
                <p>{layout.previewError}</p>
                <div className="layout-preview-error-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      navigate(projectSyncPath(projectId))
                    }
                  >
                    Về bước Đồng bộ
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={layout.retryPreview}
                  >
                    Thử mở lại
                  </button>
                </div>
              </div>
            )}
            {layout.previewState === 'ready' && layout.previewUrl && (
              <iframe
                ref={frameRef}
                key={`${layout.previewSessionNonce}:${frameReloadKey}`}
                title="Layout Editor Motion Canvas"
                src={layout.previewUrl}
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                allowFullScreen
                onLoad={() => sendCommand('requestReady')}
              />
            )}
            {layout.previewState === 'ready' &&
              layout.previewUrl &&
              !runtimeReady &&
              !runtimeError && (
                <div className="layout-preview-state" role="status">
                  <span className="spinner" />
                  <strong>Đang kết nối player…</strong>
                  <p>
                    Canvas đang xác nhận runtime và node map của đúng phiên
                    chỉnh sửa.
                  </p>
                </div>
              )}
            {layout.previewState === 'ready' && runtimeError && (
              <div className="layout-preview-state is-error" role="alert">
                <strong>Canvas chưa kết nối được</strong>
                <p>{runtimeError}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={reloadRuntime}
                >
                  Nạp lại canvas
                </button>
              </div>
            )}
          </div>
          <div className="layout-command-bar">
            <div className="layout-command-group">
              <button
                ref={shortcutCloseRef}
                type="button"
                title="Hoàn tác (Ctrl+Z)"
                aria-label="Hoàn tác"
                disabled={!runtimeState?.history.canUndo}
                onClick={() => sendCommand('undo')}
              >
                <UndoIcon />
                <kbd>Ctrl Z</kbd>
              </button>
              <button
                type="button"
                title="Làm lại (Ctrl+Shift+Z)"
                aria-label="Làm lại"
                disabled={!runtimeState?.history.canRedo}
                onClick={() => sendCommand('redo')}
              >
                <RedoIcon />
                <kbd>Ctrl ⇧ Z</kbd>
              </button>
            </div>
            <div className="layout-command-context">
              <span className="layout-selection-dot" />
              <span>
                {selection ? selection.label : activeScene?.label ?? 'Chưa chọn layer'}
              </span>
              <code>
                {runtimeState
                  ? `${formatTime(runtimeState.frame, runtimeState.fps)} / ${formatTime(
                      runtimeState.duration,
                      runtimeState.fps,
                    )}`
                  : runtimeError
                    ? 'Player chưa kết nối'
                    : 'Đang kết nối…'}
              </code>
            </div>
            <div className="layout-command-group is-secondary">
              {focusMode && (
                <span
                  className={`layout-focus-save-state${
                    isSaved
                      ? ' is-saved'
                      : layout.saveState === 'error'
                        ? ' is-error'
                        : ''
                  }`}
                  role="status"
                >
                  <i />
                  {layout.saveState === 'saving'
                    ? 'Đang lưu…'
                    : layout.saveState === 'error'
                      ? 'Lưu lỗi'
                      : isSaved
                        ? 'Đã lưu'
                        : 'Chưa lưu'}
                </span>
              )}
              <button
                type="button"
                title="Sao chép modifier (Ctrl+C)"
                aria-label="Sao chép modifier"
                disabled={!selection}
                onClick={copySelectedPatch}
              >
                Sao chép <kbd>Ctrl C</kbd>
              </button>
              <button
                type="button"
                title="Dán modifier (Ctrl+V)"
                aria-label="Dán modifier"
                disabled={
                  !selection || selection.editorLocked || !copiedPatch
                }
                onClick={pasteSelectedPatch}
              >
                Dán <kbd>Ctrl V</kbd>
              </button>
              <button
                className="layout-command-help"
                type="button"
                title="Xem toàn bộ phím tắt (?)"
                aria-label="Xem toàn bộ phím tắt"
                onClick={() => setShortcutsOpen(true)}
              >
                <KeyboardIcon />
                <kbd>?</kbd>
              </button>
              <button
                className={`layout-command-focus${focusMode ? ' is-active' : ''}`}
                type="button"
                title={
                  focusMode
                    ? 'Thoát chế độ toàn màn hình (Esc)'
                    : 'Chỉ hiển thị editor và video'
                }
                aria-label={
                  focusMode
                    ? 'Thoát chế độ toàn màn hình'
                    : 'Mở editor toàn màn hình'
                }
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

        <aside className="layout-inspector" aria-label="Thuộc tính node">
          {!selection ? (
            <div className="layout-inspector-empty">
              <span>
                <RotateIcon />
              </span>
              <strong>Chọn một node để chỉnh</strong>
              <p>
                Bấm trực tiếp trên canvas hoặc chọn từ danh sách layer.
              </p>
            </div>
          ) : (
            <>
              <header>
                <div>
                  <span>{selection.nodeType}</span>
                  <h2>{selection.label}</h2>
                  <code title={selection.nodeKey}>{selection.nodeKey}</code>
                </div>
                <button
                  type="button"
                  disabled={
                    !selection.editorLocked &&
                    !selection.editableProperties.some(
                      (property) =>
                        !selection.lockedProperties.includes(property),
                    )
                  }
                  title={
                    selection.editorLocked
                      ? 'Mở khóa chỉnh sửa'
                      : 'Khóa thao tác nhầm'
                  }
                  onClick={() =>
                    sendPatch({editorLocked: !selection.editorLocked})
                  }
                >
                  {selection.editorLocked ? <LockIcon /> : <UnlockIcon />}
                </button>
              </header>

              {selection.identity === 'legacy' && (
                <p className="layout-legacy-note">
                  Node cũ được ghim theo generation và fingerprint. Modifier
                  sẽ không tự chuyển sang source mới.
                </p>
              )}
              {selection.lockReason && (
                <p className="layout-legacy-note">
                  {selection.lockReason}
                </p>
              )}

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
                  ).map(
                    ([
                      property,
                      label,
                      fallback,
                      step,
                      min,
                      max,
                    ]) => (
                      <label key={property}>
                        <span>{label}</span>
                        <LayoutNumberInput
                          value={selection.patch[property] ?? fallback}
                          min={min}
                          max={max}
                          step={step}
                          disabled={!canEdit(property)}
                          onCommit={(value) =>
                            sendNumericPatch(property, value)
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              </section>

              {selection.editableProperties.includes('text') && (
                <section className="layout-property-section layout-typography-section">
                  <h3>Nội dung &amp; kiểu chữ</h3>
                  <LayoutTextEditor
                    value={selectedText}
                    disabled={!canEdit('text')}
                    onCommit={(text) => sendPatch({text})}
                  />

                  <div className="layout-type-grid">
                    <label className="layout-font-family-field">
                      <span>Font chữ</span>
                      <select
                        value={selectedFontFamily}
                        disabled={!canEdit('fontFamily')}
                        onChange={(event) => {
                          const fontFamily = event.currentTarget.value as
                            | LayoutNodePatch['fontFamily']
                            | '';
                          if (fontFamily) sendPatch({fontFamily});
                        }}
                      >
                        <option value="" disabled>
                          Font từ source
                        </option>
                        {layoutFontFamilyValues.map((font) => (
                          <option value={font} key={font} style={{fontFamily: font}}>
                            {font.split(',')[0]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Cỡ chữ</span>
                      <LayoutNumberInput
                        min={8}
                        max={500}
                        step={1}
                        value={selectedFontSize}
                        disabled={!canEdit('fontSize')}
                        onCommit={(value) => sendNumericPatch('fontSize', value)}
                      />
                    </label>
                    <label>
                      <span>Độ đậm</span>
                      <select
                        value={selectedFontWeight}
                        disabled={!canEdit('fontWeight')}
                        onChange={(event) =>
                          sendPatch({fontWeight: Number(event.currentTarget.value)})
                        }
                      >
                        {layoutFontWeightValues.map((weight) => (
                          <option value={weight} key={weight}>
                            {weight}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="layout-text-style-group" aria-label="Kiểu chữ">
                    <button
                      type="button"
                      className={selectedFontWeight >= 600 ? 'is-active' : ''}
                      aria-pressed={selectedFontWeight >= 600}
                      title="In đậm"
                      disabled={!canEdit('fontWeight')}
                      onClick={() =>
                        sendPatch({fontWeight: selectedFontWeight >= 600 ? 400 : 700})
                      }
                    >
                      <strong>B</strong>
                      <span>Đậm</span>
                    </button>
                    <button
                      type="button"
                      className={selectedFontStyle === 'italic' ? 'is-active' : ''}
                      aria-pressed={selectedFontStyle === 'italic'}
                      title="In nghiêng"
                      disabled={!canEdit('fontStyle')}
                      onClick={() =>
                        sendPatch({
                          fontStyle:
                            selectedFontStyle === 'italic' ? 'normal' : 'italic',
                        })
                      }
                    >
                      <i>I</i>
                      <span>Nghiêng</span>
                    </button>
                    <button
                      type="button"
                      className={selection.patch.underline ? 'is-active' : ''}
                      aria-pressed={selection.patch.underline === true}
                      title="Gạch chân"
                      disabled={!canEdit('underline')}
                      onClick={() =>
                        sendPatch({underline: !selection.patch.underline})
                      }
                    >
                      <u>U</u>
                      <span>Gạch chân</span>
                    </button>
                    <button
                      type="button"
                      className={selection.patch.strikethrough ? 'is-active' : ''}
                      aria-pressed={selection.patch.strikethrough === true}
                      title="Gạch bỏ"
                      disabled={!canEdit('strikethrough')}
                      onClick={() =>
                        sendPatch({
                          strikethrough: !selection.patch.strikethrough,
                        })
                      }
                    >
                      <s>S</s>
                      <span>Gạch bỏ</span>
                    </button>
                  </div>
                </section>
              )}

              <section className="layout-property-section">
                <h3>
                  <PaletteIcon />
                  Hiển thị
                </h3>
                <label className="layout-range-field">
                  <span>
                    Opacity
                    <strong>
                      {Math.round((selection.patch.opacity ?? 1) * 100)}%
                    </strong>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selection.patch.opacity ?? 1}
                    disabled={!canEdit('opacity')}
                    onChange={(event) =>
                      sendNumericPatch(
                        'opacity',
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <LayoutNumberInput
                    value={selection.patch.opacity ?? 1}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!canEdit('opacity')}
                    onCommit={(value) =>
                      sendNumericPatch('opacity', value)
                    }
                  />
                </label>

                {selection.editableProperties.includes('fill') && (
                  <div className="layout-color-field">
                    <label>
                      <span>Fill</span>
                      <input
                        type="color"
                        value={colorValue(
                          selection.patch.fill,
                          colorValue(selection.base?.fill, '#ffffff'),
                        )}
                        disabled={!canEdit('fill')}
                        onChange={(event) =>
                          sendPatch({fill: event.currentTarget.value})
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!canEdit('fill')}
                      onClick={() => sendPatch({fill: null})}
                    >
                      Bỏ fill
                    </button>
                  </div>
                )}

                {selection.editableProperties.includes('stroke') && (
                  <div className="layout-color-field">
                    <label>
                      <span>Viền</span>
                      <input
                        type="color"
                        value={colorValue(
                          selection.patch.stroke,
                          colorValue(selection.base?.stroke, '#18342c'),
                        )}
                        disabled={!canEdit('stroke')}
                        onChange={(event) =>
                          sendPatch({stroke: event.currentTarget.value})
                        }
                      />
                    </label>
                    <label>
                      <span>Độ dày</span>
                      <LayoutNumberInput
                        min={0}
                        max={200}
                        step={1}
                        value={
                          selection.patch.strokeWidth ??
                          (typeof selection.base?.strokeWidth === 'number'
                            ? selection.base.strokeWidth
                            : 0)
                        }
                        disabled={!canEdit('strokeWidth')}
                        onCommit={(value) =>
                          sendNumericPatch('strokeWidth', value)
                        }
                      />
                    </label>
                  </div>
                )}
              </section>

              <section className="layout-property-section">
                <h3>Layer &amp; trạng thái</h3>
                <div className="layout-layer-actions">
                  <button
                    type="button"
                    disabled={!canEdit('zIndexDelta')}
                    onClick={() =>
                      sendPatch({
                        zIndexDelta:
                          (selection.patch.zIndexDelta ?? 0) + 1,
                      })
                    }
                  >
                    <ChevronUpIcon />
                    Đưa lên
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit('zIndexDelta')}
                    onClick={() =>
                      sendPatch({
                        zIndexDelta:
                          (selection.patch.zIndexDelta ?? 0) - 1,
                      })
                    }
                  >
                    <ChevronDownIcon />
                    Đưa xuống
                  </button>
                </div>
                <button
                  className={`layout-visibility-button${
                    selection.patch.hidden ? ' is-hidden' : ''
                  }`}
                  type="button"
                  disabled={!canEdit('hidden')}
                  onClick={() =>
                    sendPatch({hidden: !selection.patch.hidden})
                  }
                >
                  {selection.patch.hidden ? <EyeIcon /> : <EyeOffIcon />}
                  {selection.patch.hidden
                    ? 'Khôi phục node'
                    : 'Ẩn node khỏi video'}
                </button>
              </section>

              <footer>
                <button
                  type="button"
                  disabled={selection.editorLocked}
                  onClick={() => sendCommand('resetSelected')}
                >
                  <ResetIcon />
                  Reset node
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={!canEdit('hidden')}
                  onClick={() => sendPatch({hidden: true})}
                >
                  <TrashIcon />
                  Delete (ẩn)
                </button>
              </footer>
            </>
          )}
        </aside>
      </section>

      {shortcutsOpen && (
        <div
          className="layout-shortcut-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShortcutsOpen(false);
          }}
        >
          <section
            className="layout-shortcut-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="layout-shortcut-title"
          >
            <header>
              <div>
                <span>
                  <KeyboardIcon />
                </span>
                <div>
                  <small>Layout Editor</small>
                  <h2 id="layout-shortcut-title">Phím tắt thao tác nhanh</h2>
                </div>
              </div>
              <button
                type="button"
                aria-label="Đóng bảng phím tắt"
                onClick={() => setShortcutsOpen(false)}
              >
                <XIcon />
              </button>
            </header>
            <p>
              Phím tắt hoạt động cả khi bạn đang thao tác trực tiếp trên canvas.
              Các phím di chuyển chỉ áp dụng cho node đang chọn.
            </p>
            <div className="layout-shortcut-grid">
              {LAYOUT_SHORTCUT_GROUPS.map((group) => (
                <section key={group.title}>
                  <h3>{group.title}</h3>
                  {group.shortcuts.map(([label, ...keys]) => (
                    <div className="layout-shortcut-row" key={label}>
                      <span>{label}</span>
                      <span>
                        {keys.map((key) => <kbd key={key}>{key}</kbd>)}
                      </span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </section>
        </div>
      )}

      <section className="layout-review-bar">
        <div
          className={`layout-review-step${runtimeReady ? ' is-done' : ''}`}
        >
          <span>{runtimeReady ? <CheckIcon /> : '1'}</span>
          <div>
            <strong>Runtime đúng generation</strong>
            <small>
              {runtimeReady ? 'Canvas tương tác đã sẵn sàng' : 'Đang tải canvas'}
            </small>
          </div>
        </div>
        <div
          className={`layout-review-step${isSaved ? ' is-done' : ''}`}
        >
          <span>{isSaved ? <CheckIcon /> : '2'}</span>
          <div>
            <strong>Modifier đã lưu</strong>
            <small>
              {isSaved ? 'Workspace bất biến đã validate' : 'Đang chờ tự lưu'}
            </small>
          </div>
        </div>
        <div
          className={`layout-review-step${
            currentReviewed ? ' is-done' : ''
          }`}
        >
          <span>{currentReviewed ? <CheckIcon /> : '3'}</span>
          <div>
            <strong>Đã xem bản hiện tại</strong>
            <small>
              {currentReviewed
                ? 'Review khớp đúng revision đang lưu'
                : currentPlayed
                  ? 'Xác nhận sau khi đã kiểm tra hình và tiếng'
                  : 'Bấm Phát trong editor trước'}
            </small>
          </div>
          {!currentReviewed && currentPlayed && (
            <button
              type="button"
              onClick={() => {
                setReviewedRevision(dirtyRevision);
                sendCommand('markReviewed');
              }}
            >
              Tôi đã kiểm tra
            </button>
          )}
        </div>
      </section>

      <footer className="outline-final-actions layout-final-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            void navigateAfterSaving(projectSyncPath(projectId))
          }
        >
          <ArrowLeftIcon />
          Xem lại đồng bộ
        </button>
        <div>
          <span>
            {approved
              ? 'Layout đã được chốt cho generation Sync này'
              : 'Chốt chỉ được mở sau khi lưu và review đúng revision'}
          </span>
          <button
            className="submit-button"
            type="button"
            disabled={!approved && !canApprove}
            onClick={() => {
              if (approved) {
                navigate(projectRenderPath(projectId));
                return;
              }
              void layout.approve().then(updatedProject => {
                if (updatedProject) {
                  navigate(projectRenderPath(projectId));
                }
              });
            }}
          >
            {layout.approving ? (
              <>
                <span className="spinner" />
                Đang chốt…
              </>
            ) : approved ? (
              <>
                Tiếp tục render
                <ArrowRightIcon />
              </>
            ) : (
              <>
                <CheckIcon />
                Chốt layout
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
