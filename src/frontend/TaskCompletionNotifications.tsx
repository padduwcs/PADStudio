import {useEffect, useState} from 'react';
import {
  dismissTaskCompletionNotice,
  playTaskNotificationSound,
  taskCompletionDismissEventName,
  taskCompletionEventName,
  taskCompletionModeEventName,
  type TaskCompletionMode,
  type TaskCompletionOutcome,
  type TaskCompletionNotice,
} from './taskCompletionNotifications.ts';

const noticeLifetimeMs = 10_000;
const persistentChimeIntervalMs = 3_500;

export function TaskCompletionNotifications() {
  const [notices, setNotices] = useState<TaskCompletionNotice[]>([]);

  useEffect(() => {
    const handleCompletion = (event: Event) => {
      const notice = (event as CustomEvent<TaskCompletionNotice>).detail;
      setNotices(current => [...current.slice(-2), notice]);
      if (notice.mode === 'persistent') return;
      window.setTimeout(() => {
        setNotices(current => current.filter(item => item.id !== notice.id));
      }, noticeLifetimeMs);
    };
    const handleDismiss = (event: Event) => {
      const noticeId = (event as CustomEvent<string>).detail;
      setNotices(current => current.filter(item => item.id !== noticeId));
    };
    const handleModeChange = (event: Event) => {
      const mode = (event as CustomEvent<TaskCompletionMode>).detail;
      if (mode === 'off') setNotices([]);
      else if (mode !== 'persistent') {
        setNotices(current => current.filter(notice => notice.mode !== 'persistent'));
      }
    };
    window.addEventListener(taskCompletionEventName, handleCompletion);
    window.addEventListener(taskCompletionDismissEventName, handleDismiss);
    window.addEventListener(taskCompletionModeEventName, handleModeChange);
    return () => {
      window.removeEventListener(taskCompletionEventName, handleCompletion);
      window.removeEventListener(taskCompletionDismissEventName, handleDismiss);
      window.removeEventListener(taskCompletionModeEventName, handleModeChange);
    };
  }, []);

  const ringingOutcome: TaskCompletionOutcome | null = notices.some(
    notice => notice.mode === 'persistent' && notice.outcome === 'error',
  )
    ? 'error'
    : notices.some(notice => notice.mode === 'persistent')
      ? 'success'
      : null;
  useEffect(() => {
    if (!ringingOutcome) return;
    const timer = window.setInterval(
      () => playTaskNotificationSound(ringingOutcome),
      persistentChimeIntervalMs,
    );
    return () => window.clearInterval(timer);
  }, [ringingOutcome]);

  if (!notices.length) return null;

  return (
    <aside className="completion-notice-stack" aria-live="polite" aria-label="Thông báo tác vụ">
      {notices.map(notice => (
        <section
          className={`completion-notice is-${notice.outcome}${notice.mode === 'persistent' ? ' is-ringing' : ''}`}
          role={notice.outcome === 'error' || notice.mode === 'persistent' ? 'alert' : 'status'}
          key={notice.id}
        >
          <span className="completion-notice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              {notice.outcome === 'error'
                ? <><path d="M12 7.5v5.3" /><path d="M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></>
                : <path d="m6.5 12.5 3.3 3.3 7.7-8" />}
            </svg>
          </span>
          <div className="completion-notice-content">
            <small>
              {notice.outcome === 'error'
                ? notice.mode === 'persistent' ? 'Gặp lỗi · Đang nhắc' : 'Tác vụ gặp lỗi'
                : notice.mode === 'persistent' ? 'Đã hoàn tất · Đang nhắc' : 'Đã hoàn tất'}
            </small>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
            {notice.mode === 'persistent' && (
              <button type="button" onClick={() => dismissTaskCompletionNotice(notice.id)}>
                Tắt chuông
              </button>
            )}
          </div>
          <button
            className="completion-notice-dismiss"
            type="button"
            aria-label={`Đóng thông báo ${notice.title}`}
            onClick={() => dismissTaskCompletionNotice(notice.id)}
          >
            ×
          </button>
        </section>
      ))}
    </aside>
  );
}
