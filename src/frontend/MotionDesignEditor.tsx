import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {LayoutOverridesDocumentSchema} from '../shared/layout.ts';
import type {useMotionCanvasDraft} from './useMotionCanvasDraft.ts';

const PROTOCOL_SOURCE = 'pad-studio-layout-editor';
const PROTOCOL_VERSION = 1;

type MotionCanvasController = ReturnType<typeof useMotionCanvasDraft>;

export function MotionDesignEditor({
  motionCanvas,
}: {
  motionCanvas: MotionCanvasController;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const manifestStoredRef = useRef(false);
  const pendingOverridesRef = useRef<
    ReturnType<typeof LayoutOverridesDocumentSchema.parse>['overrides'] | null
  >(null);
  const saveChainRef = useRef(Promise.resolve());
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const motion = motionCanvas.project?.motionCanvasBundle;
  const expectedOrigin = useMemo(() => {
    try {
      return motionCanvas.previewUrl
        ? new URL(motionCanvas.previewUrl).origin
        : '';
    } catch {
      return '';
    }
  }, [motionCanvas.previewUrl]);

  useEffect(() => {
    manifestStoredRef.current = false;
    pendingOverridesRef.current = null;
    setRuntimeReady(false);
    setRuntimeError('');
  }, [motionCanvas.previewSessionNonce]);

  useEffect(() => {
    if (motionCanvas.previewState !== 'loading') return;
    setRuntimeReady(false);
    setRuntimeError('');
  }, [motionCanvas.previewState]);

  useEffect(() => {
    if (
      !motion ||
      !expectedOrigin ||
      !motionCanvas.previewSessionNonce
    ) return;
    const activeMotion = motion;

    function persistPending() {
      const overrides = pendingOverridesRef.current;
      if (!overrides || !manifestStoredRef.current) return;
      pendingOverridesRef.current = null;
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await motionCanvas.saveDesign(
            overrides,
            motionCanvas.previewSessionNonce,
          );
          if (pendingOverridesRef.current) persistPending();
        });
    }

    function receiveMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== expectedOrigin
      ) return;
      const message = event.data as Record<string, unknown>;
      if (
        message.source !== PROTOCOL_SOURCE ||
        message.version !== PROTOCOL_VERSION ||
        message.generationId !== activeMotion.generation.generationId ||
        message.sessionId !== motionCanvas.previewSessionNonce ||
        typeof message.type !== 'string'
      ) return;
      const payload =
        message.payload && typeof message.payload === 'object'
          ? message.payload as Record<string, unknown>
          : {};

      if (message.type === 'ready') {
        setRuntimeReady(true);
        setRuntimeError('');
        return;
      }
      if (message.type === 'error') {
        setRuntimeError(
          typeof payload.message === 'string'
            ? payload.message
            : 'Visual editor gặp lỗi runtime.',
        );
        return;
      }
      if (
        message.type === 'manifest' &&
        payload.status === 'stored' &&
        payload.complete === true
      ) {
        manifestStoredRef.current = true;
        persistPending();
        return;
      }
      if (
        message.type === 'documentChanged' &&
        payload.transient !== true
      ) {
        const parsed = LayoutOverridesDocumentSchema.safeParse(
          payload.document,
        );
        if (
          !parsed.success ||
          parsed.data.sourceAnimationSyncGenerationId !==
            activeMotion.generation.generationId ||
          parsed.data.sourceAnimationSyncContentRevision !==
            activeMotion.contentRevision ||
          parsed.data.sourceAnimationSyncSourceHash !==
            activeMotion.validation.sourceHash
        ) {
          setRuntimeError(
            'Visual editor trả về dữ liệu không khớp scene hiện hành.',
          );
          return;
        }
        if (payload.reason !== 'load-document') {
          pendingOverridesRef.current = parsed.data.overrides;
          persistPending();
        }
      }
    }

    window.addEventListener('message', receiveMessage);
    return () => window.removeEventListener('message', receiveMessage);
  }, [expectedOrigin, motion, motionCanvas.previewSessionNonce]);

  const requestReady = useCallback(() => {
    if (!expectedOrigin || !frameRef.current?.contentWindow || !motion) return;
    frameRef.current.contentWindow.postMessage(
      {
        source: PROTOCOL_SOURCE,
        version: PROTOCOL_VERSION,
        generationId: motion.generation.generationId,
        sessionId: motionCanvas.previewSessionNonce,
        type: 'requestReady',
        payload: {},
      },
      expectedOrigin,
    );
  }, [expectedOrigin, motion, motionCanvas.previewSessionNonce]);

  useEffect(() => {
    if (
      motionCanvas.previewState !== 'ready' ||
      !motionCanvas.previewUrl ||
      runtimeReady ||
      runtimeError
    ) return;
    requestReady();
    const retryTimer = window.setInterval(requestReady, 1_000);
    const timeout = window.setTimeout(() => {
      setRuntimeError(
        'Visual editor chưa phản hồi sau 30 giây. Hãy mở lại; scene và các bước đã chốt vẫn được giữ nguyên.',
      );
    }, 30_000);
    return () => {
      window.clearInterval(retryTimer);
      window.clearTimeout(timeout);
    };
  }, [
    motionCanvas.previewState,
    motionCanvas.previewUrl,
    requestReady,
    runtimeError,
    runtimeReady,
  ]);

  return (
    <section className="motion-design-card">
      <header>
        <div>
          <span className="preview-kicker">Tự chạy ngay trong PAD Studio</span>
          <h2>Xem và chỉnh visual scene</h2>
          <p>Kéo trực tiếp các phần tử, dùng toolbar để hoàn tác, căn lưới, ẩn hoặc đổi lớp. Mọi thay đổi được tự lưu và sẽ chuyển tiếp sang Layout Editor sau đồng bộ.</p>
        </div>
        <span className={`draft-status${motionCanvas.designSaveState === 'saved' ? ' is-saved' : ''}`}>
          <span />
          {motionCanvas.designSaveState === 'saving'
            ? 'Đang lưu…'
            : motionCanvas.designSaveState === 'saved'
              ? 'Đã tự lưu'
              : 'Visual draft'}
        </span>
      </header>
      <div className="motion-design-frame">
        {motionCanvas.previewState === 'loading' && (
          <div className="motion-design-state" role="status">
            <span className="spinner" />
            <strong>Đang khởi động Motion Canvas…</strong>
          </div>
        )}
        {motionCanvas.previewState === 'error' && (
          <div className="motion-design-state is-error" role="alert">
            <strong>Chưa mở được visual editor</strong>
            <p>{motionCanvas.previewError}</p>
            <button type="button" onClick={motionCanvas.retryPreview}>Thử lại</button>
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
            onError={() => setRuntimeError(
              'Trình duyệt không tải được visual editor. Hãy mở lại.',
            )}
          />
        )}
        {motionCanvas.previewState === 'ready' && !runtimeReady && !runtimeError && (
          <div className="motion-design-state" role="status">
            <span className="spinner" />
            <strong>Đang nối với visual editor…</strong>
          </div>
        )}
        {runtimeError && (
          <div className="motion-design-state is-error" role="alert">
            <strong>Visual editor cần tải lại</strong>
            <p>{runtimeError}</p>
            <button type="button" onClick={motionCanvas.retryPreview}>Mở lại</button>
          </div>
        )}
      </div>
    </section>
  );
}
