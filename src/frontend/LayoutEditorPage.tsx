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
  type LayoutEditorManifest,
  type LayoutEditorNode,
  type LayoutNodePatch,
  type LayoutOverridesDocument,
} from '../shared/layout.ts';
import {AdaptiveHeading} from './AdaptiveText.tsx';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  LockIcon,
  PaletteIcon,
  RedoIcon,
  ResetIcon,
  RotateIcon,
  TrashIcon,
  UndoIcon,
  UnlockIcon,
} from './icons.tsx';
import {resolveLayoutEditorManifest} from './layoutEditorState.ts';
import {
  navigate,
  projectSyncPath,
  registerNavigationGuard,
} from './router.ts';
import {useLayoutEditor} from './useLayoutEditor.ts';

const PROTOCOL_SOURCE = 'pad-studio-layout-editor';
const PROTOCOL_VERSION = 1;
const RUNTIME_READY_TIMEOUT_MS = 20_000;
const RUNTIME_READY_POLL_MS = 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NumericLayoutProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'strokeWidth';

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

interface LayoutNumberInputProps {
  value: number;
  min: number;
  max: number;
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
    const normalized = Math.min(max, Math.max(min, parsed));
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

export function LayoutEditorPage({projectId}: {projectId: string}) {
  const layout = useLayoutEditor(projectId);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
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
  const leavingPageRef = useRef(false);
  const lastRuntimeDirtyRevisionRef = useRef(0);
  const manifestStoredRef = useRef(false);
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
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [frameReloadKey, setFrameReloadKey] = useState(0);
  const [manifestStored, setManifestStored] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(-1);
  const [playedRevision, setPlayedRevision] = useState(-1);
  const [reviewedRevision, setReviewedRevision] = useState(-1);
  const [search, setSearch] = useState('');
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
    () => new Set(),
  );
  const [copiedPatch, setCopiedPatch] =
    useState<LayoutNodePatch | null>(null);

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
    pendingSelectionRef.current = null;
    setPlayedRevision(-1);
    setReviewedRevision(-1);
  }, [layout.layoutState]);

  useEffect(() => {
    leavingPageRef.current = false;
    function preventUnsavedUnload(event: BeforeUnloadEvent) {
      if (
        activeSavePromiseRef.current ||
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
        savedRevisionRef.current !== dirtyRevisionRef.current
      ) {
        const saveLatest = () => {
          const latestDocument = committedDocumentRef.current;
          return latestDocument
            ? saveRef.current(latestDocument.overrides)
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

  async function saveCurrentDocument(): Promise<boolean> {
    if (activeSavePromiseRef.current) {
      savePendingAfterCurrentRef.current = true;
      return activeSavePromiseRef.current;
    }
    const currentDocument = committedDocumentRef.current;
    if (
      !currentDocument ||
      !manifestStoredRef.current ||
      savedRevisionRef.current === dirtyRevisionRef.current
    ) {
      return savedRevisionRef.current === dirtyRevisionRef.current;
    }

    const revisionToSave = dirtyRevisionRef.current;
    savingRevisionRef.current = revisionToSave;
    let saveSucceeded = false;
    const operation = (async () => {
      const updatedProject = await saveRef.current(
        currentDocument.overrides,
      );
      if (!updatedProject) return false;
      saveSucceeded = true;
      savedRevisionRef.current = revisionToSave;
      setSavedRevision(revisionToSave);
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
          dirtyRevisionRef.current !== savedRevisionRef.current) &&
        savedRevisionRef.current !== dirtyRevisionRef.current
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
    if (savedRevisionRef.current !== dirtyRevisionRef.current) {
      await saveCurrentDocument();
    }
    return savedRevisionRef.current === dirtyRevisionRef.current;
  }

  async function navigateAfterSaving(path: string) {
    const saved = await flushPendingSave();
    if (saved || dirtyRevisionRef.current === 0) {
      navigate(path);
    }
  }

  useEffect(() => {
    const hasUnsavedChanges =
      activeSavePromiseRef.current !== null ||
      (dirtyRevision > 0 && savedRevision !== dirtyRevision);
    if (!hasUnsavedChanges) return;
    return registerNavigationGuard(flushPendingSave);
  }, [dirtyRevision, savedRevision, layout.saveState]);

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

      if (message.type === 'state') {
        if (isRuntimeState(payload)) setRuntimeState(payload);
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
          if (
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
    const sceneId = runtimeState?.sceneId;
    if (!sceneId) return;
    setExpandedScenes((current) => {
      if (current.has(sceneId)) return current;
      const next = new Set(current);
      next.add(sceneId);
      return next;
    });
  }, [runtimeState?.sceneId]);

  const scenes = useMemo(() => {
    if (!sourceSync) return [];
    const manifestById = new Map(
      manifest?.scenes.map((scene) => [scene.sceneId, scene]),
    );
    return sourceSync.sections.map((section, index) => ({
      sceneId: section.sceneId,
      filePath: section.filePath,
      label: `Scene ${String(index + 1).padStart(2, '0')}`,
      nodes: manifestById.get(section.sceneId)?.nodes ?? [],
    }));
  }, [manifest, sourceSync]);
  const hasKnownNodes = scenes.some((scene) => scene.nodes.length > 0);

  const visibleScenes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    if (!query) return scenes;
    return scenes
      .map((scene) => ({
        ...scene,
        nodes: scene.nodes.filter(
          (node) =>
            node.label.toLocaleLowerCase('vi').includes(query) ||
            node.key.toLocaleLowerCase('vi').includes(query) ||
            node.nodeType.toLocaleLowerCase('vi').includes(query),
        ),
      }))
      .filter(
        (scene) =>
          scene.nodes.length > 0 ||
          scene.label.toLocaleLowerCase('vi').includes(query) ||
          scene.filePath.toLocaleLowerCase('vi').includes(query),
      );
  }, [scenes, search]);

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

  const isSaved =
    savedRevision === dirtyRevision &&
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

      <section className="layout-editor-shell">
        <aside className="layout-tree-panel" aria-label="Danh sách scene và node">
          <header>
            <div>
              <span className="preview-kicker">
                <LayersIcon />
                Scene &amp; layer
              </span>
              <strong>{document?.overrides.length ?? 0} modifier</strong>
            </div>
            <input
              type="search"
              value={search}
              placeholder="Tìm node…"
              aria-label="Tìm node"
              onChange={(event) => setSearch(event.target.value)}
            />
          </header>
          <div className="layout-scene-tree">
            {visibleScenes.map((scene) => (
              <details
                key={scene.sceneId}
                open={
                  Boolean(search) ||
                  expandedScenes.has(scene.sceneId)
                }
                onToggle={(event) => {
                  if (search) return;
                  const open = event.currentTarget.open;
                  setExpandedScenes((current) => {
                    const next = new Set(current);
                    if (open) next.add(scene.sceneId);
                    else next.delete(scene.sceneId);
                    return next;
                  });
                }}
              >
                <summary
                  onClick={(event) => {
                    if (!(event.target instanceof HTMLButtonElement)) {
                      selectNode(scene.sceneId);
                    }
                  }}
                >
                  <span>
                    <strong>{scene.label}</strong>
                    <small>{scene.nodes.length} node</small>
                  </span>
                  <code>{scene.filePath.split('/').at(-1)}</code>
                </summary>
                <div>
                  {scene.nodes.length === 0 ? (
                    <button
                      className="layout-empty-scene"
                      type="button"
                      onClick={() => selectNode(scene.sceneId)}
                    >
                      Mở scene để nhận diện node
                    </button>
                  ) : (
                    scene.nodes.map((node) => {
                      const nodeOverride = document?.overrides.find(
                        (item) =>
                          item.sceneId === scene.sceneId &&
                          item.nodeKey === node.key,
                      );
                      const selected =
                        selection?.sceneId === scene.sceneId &&
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
                          onClick={() => selectNode(scene.sceneId, node.key)}
                        >
                          <span className="layout-node-type">
                            {node.nodeType.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>{node.label}</strong>
                            <small>{patchSummary(nodeOverride?.patch ?? {})}</small>
                          </span>
                          {node.identity === 'legacy' && (
                            <i title="Node legacy được khóa theo fingerprint">
                              L
                            </i>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </details>
            ))}
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
            <div>
              <button
                type="button"
                title="Hoàn tác (Ctrl+Z)"
                disabled={!runtimeState?.history.canUndo}
                onClick={() => sendCommand('undo')}
              >
                <UndoIcon />
                Hoàn tác
              </button>
              <button
                type="button"
                title="Làm lại (Ctrl+Shift+Z)"
                disabled={!runtimeState?.history.canRedo}
                onClick={() => sendCommand('redo')}
              >
                <RedoIcon />
                Làm lại
              </button>
            </div>
            <span>
              {runtimeState
                ? `${formatTime(runtimeState.frame, runtimeState.fps)} / ${formatTime(
                    runtimeState.duration,
                    runtimeState.fps,
                  )}`
                : runtimeError
                  ? 'Player chưa kết nối'
                  : 'Đang kết nối player…'}
            </span>
            <div>
              <button
                type="button"
                disabled={!selection}
                onClick={copySelectedPatch}
              >
                Sao chép
              </button>
              <button
                type="button"
                disabled={
                  !selection || selection.editorLocked || !copiedPatch
                }
                onClick={pasteSelectedPatch}
              >
                Dán chỉnh sửa
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
            disabled={approved || !canApprove}
            onClick={() => void layout.approve()}
          >
            {layout.approving ? (
              <>
                <span className="spinner" />
                Đang chốt…
              </>
            ) : approved ? (
              <>
                <CheckIcon />
                Layout đã chốt
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
