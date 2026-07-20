import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useEditorFocusMode<T extends HTMLElement>(): {
  editorRef: RefObject<T | null>;
  focusMode: boolean;
  toggleFocusMode: () => Promise<void>;
} {
  const editorRef = useRef<T | null>(null);
  const nativeFullscreenRef = useRef(false);
  const [focusMode, setFocusMode] = useState(false);

  const leaveFocusMode = useCallback(async () => {
    const editor = editorRef.current;
    if (editor && document.fullscreenElement === editor) {
      try {
        await document.exitFullscreen();
      } catch {
        // CSS focus mode can still be closed even if the browser refuses the
        // native fullscreen transition.
      }
    }
    nativeFullscreenRef.current = false;
    setFocusMode(false);
  }, []);

  const toggleFocusMode = useCallback(async () => {
    if (focusMode) {
      await leaveFocusMode();
      return;
    }

    const editor = editorRef.current;
    if (!editor) return;
    setFocusMode(true);
    try {
      await editor.requestFullscreen();
      nativeFullscreenRef.current = document.fullscreenElement === editor;
    } catch {
      // Browsers without element fullscreen support keep the same focused
      // editor through the fixed-position CSS fallback.
      nativeFullscreenRef.current = false;
    }
  }, [focusMode, leaveFocusMode]);

  useEffect(() => {
    function handleFullscreenChange() {
      const ownsFullscreen =
        document.fullscreenElement === editorRef.current;
      if (ownsFullscreen) {
        nativeFullscreenRef.current = true;
        setFocusMode(true);
      } else if (nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        setFocusMode(false);
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (document.fullscreenElement === editorRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusMode) return;

    document.body.classList.add('has-editor-focus');

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const editor = editorRef.current;
      if (!editor) return;

      if (event.key === 'Escape' && document.fullscreenElement !== editor) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void leaveFocusMode();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = [...editor.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        editor.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.classList.remove('has-editor-focus');
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [focusMode, leaveFocusMode]);

  return {editorRef, focusMode, toggleFocusMode};
}
