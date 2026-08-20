export const taskCompletionEventName = 'pad-studio:task-completed';

export type TaskCompletionNotice = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
};

type TaskCompletionInput = Omit<TaskCompletionNotice, 'createdAt'>;

const deliveredNoticeIds = new Set<string>();
let audioContext: AudioContext | null = null;
let notificationPermissionRequested = false;

function getAudioContext() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try {
    audioContext ??= new AudioContext();
  } catch {
    return null;
  }
  return audioContext;
}

function playCompletionChime() {
  const context = getAudioContext();
  if (!context) return;

  void context.resume().then(() => {
    const startedAt = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startedAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.48);
    gain.connect(context.destination);

    const notes = [659.25, 987.77];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      const noteStart = startedAt + index * 0.11;
      oscillator.type = 'sine';
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
    const notification = new Notification(`PAD Studio · ${notice.title}`, {
      body: notice.message,
      tag: notice.id,
    });
    notification.onclick = () => {
      window.focus();
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
  if (typeof window === 'undefined') return;

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

export function notifyTaskCompleted(input: TaskCompletionInput) {
  if (typeof window === 'undefined' || deliveredNoticeIds.has(input.id)) return;
  deliveredNoticeIds.add(input.id);

  const notice: TaskCompletionNotice = {...input, createdAt: Date.now()};
  window.dispatchEvent(
    new CustomEvent<TaskCompletionNotice>(taskCompletionEventName, {
      detail: notice,
    }),
  );
  playCompletionChime();
  showDesktopNotification(notice);

  // Keep the retry-deduplication set bounded during long editing sessions.
  if (deliveredNoticeIds.size > 100) {
    const oldestId = deliveredNoticeIds.values().next().value;
    if (oldestId) deliveredNoticeIds.delete(oldestId);
  }
}
