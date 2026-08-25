export const taskCompletionEventName = 'pad-studio:task-completed';
export const taskCompletionDismissEventName = 'pad-studio:task-completion-dismissed';
export const taskCompletionModeEventName = 'pad-studio:task-completion-mode-changed';
export const taskCompletionModeStorageKey = 'pad-studio:task-completion-mode';

export const taskCompletionModes = ['off', 'normal', 'persistent'] as const;
export type TaskCompletionMode = (typeof taskCompletionModes)[number];
export type TaskCompletionOutcome = 'success' | 'error';

export type TaskCompletionNotice = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  mode: Exclude<TaskCompletionMode, 'off'>;
  outcome: TaskCompletionOutcome;
};

type TaskCompletionInput = Omit<
  TaskCompletionNotice,
  'createdAt' | 'mode' | 'outcome'
>;
type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const deliveredNoticeIds = new Set<string>();
let audioContext: AudioContext | null = null;
let notificationPermissionRequested = false;
let fallbackTaskCompletionMode: TaskCompletionMode = 'normal';

function browserStorage() {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function getTaskCompletionMode(
  storage: StorageReader | undefined = browserStorage(),
): TaskCompletionMode {
  try {
    if (!storage) return fallbackTaskCompletionMode;
    const saved = storage?.getItem(taskCompletionModeStorageKey);
    if (saved === null) return fallbackTaskCompletionMode;
    return taskCompletionModes.includes(saved as TaskCompletionMode)
      ? saved as TaskCompletionMode
      : 'normal';
  } catch {
    return fallbackTaskCompletionMode;
  }
}

export function setTaskCompletionMode(
  mode: TaskCompletionMode,
  storage: StorageWriter | undefined = browserStorage(),
) {
  fallbackTaskCompletionMode = mode;
  try {
    storage?.setItem(taskCompletionModeStorageKey, mode);
  } catch {
    // The selection still applies for this tab when storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<TaskCompletionMode>(taskCompletionModeEventName, {
      detail: mode,
    }));
  }
}

function getAudioContext() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try {
    audioContext ??= new AudioContext();
  } catch {
    return null;
  }
  return audioContext;
}

export function playTaskNotificationSound(
  outcome: TaskCompletionOutcome = 'success',
) {
  const context = getAudioContext();
  if (!context) return;

  void context.resume().then(() => {
    const startedAt = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(
      outcome === 'error' ? 0.095 : 0.12,
      startedAt + 0.025,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.52);
    gain.connect(context.destination);

    const notes = outcome === 'error'
      ? [392, 293.66]
      : [659.25, 987.77];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      const noteStart = startedAt + index * (outcome === 'error' ? 0.16 : 0.11);
      oscillator.type = outcome === 'error' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      noteGain.gain.setValueAtTime(index === 0 ? 0.72 : 1, noteStart);
      oscillator.connect(noteGain);
      noteGain.connect(gain);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.28);
    });
  }).catch(() => {
    // The in-app notice still works when the browser blocks audio playback.
  });
}

function showDesktopNotification(notice: TaskCompletionNotice) {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted' ||
    (!document.hidden && document.hasFocus())
  ) return;

  try {
    const notification = new Notification(
      `PAD Studio · ${notice.outcome === 'error' ? 'Cần kiểm tra · ' : ''}${notice.title}`,
      {
        body: notice.message,
        tag: notice.id,
        requireInteraction: notice.mode === 'persistent',
      },
    );
    notification.onclick = () => {
      window.focus();
      dismissTaskCompletionNotice(notice.id);
      notification.close();
    };
  } catch {
    // Some browsers expose Notification but still block it in this context.
  }
}

/**
 * Call synchronously from a user action, before its first await. This unlocks
 * audio and lets the browser ask once for desktop-notification permission.
 */
export function prepareTaskCompletionNotifications() {
  if (typeof window === 'undefined' || getTaskCompletionMode() === 'off') return;

  const context = getAudioContext();
  if (context?.state === 'suspended') void context.resume().catch(() => undefined);

  if (
    !notificationPermissionRequested &&
    'Notification' in window &&
    Notification.permission === 'default'
  ) {
    notificationPermissionRequested = true;
    try {
      void Notification.requestPermission().catch(() => undefined);
    } catch {
      // A denied prompt must never interrupt the task the user just started.
    }
  }
}

export function dismissTaskCompletionNotice(id: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(taskCompletionDismissEventName, {
    detail: id,
  }));
}

function notifyTaskOutcome(
  input: TaskCompletionInput,
  outcome: TaskCompletionOutcome,
) {
  if (typeof window === 'undefined' || deliveredNoticeIds.has(input.id)) return;
  deliveredNoticeIds.add(input.id);

  const mode = getTaskCompletionMode();
  if (mode === 'off') return;

  const notice: TaskCompletionNotice = {
    ...input,
    createdAt: Date.now(),
    mode,
    outcome,
  };
  window.dispatchEvent(
    new CustomEvent<TaskCompletionNotice>(taskCompletionEventName, {
      detail: notice,
    }),
  );
  playTaskNotificationSound(outcome);
  showDesktopNotification(notice);

  // Keep the retry-deduplication set bounded during long editing sessions.
  if (deliveredNoticeIds.size > 100) {
    const oldestId = deliveredNoticeIds.values().next().value;
    if (oldestId) deliveredNoticeIds.delete(oldestId);
  }
}

export function notifyTaskCompleted(input: TaskCompletionInput) {
  notifyTaskOutcome(input, 'success');
}

export function notifyTaskFailed(input: TaskCompletionInput) {
  notifyTaskOutcome(input, 'error');
}
