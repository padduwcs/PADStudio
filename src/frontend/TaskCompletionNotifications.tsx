import {useEffect, useState} from 'react';
import {
  taskCompletionEventName,
  type TaskCompletionNotice,
} from './taskCompletionNotifications.ts';

const noticeLifetimeMs = 10_000;

export function TaskCompletionNotifications() {
  const [notices, setNotices] = useState<TaskCompletionNotice[]>([]);

  useEffect(() => {
    const handleCompletion = (event: Event) => {
      const notice = (event as CustomEvent<TaskCompletionNotice>).detail;
      setNotices(current => [...current.slice(-2), notice]);
      window.setTimeout(() => {
        setNotices(current => current.filter(item => item.id !== notice.id));
      }, noticeLifetimeMs);
    };
    window.addEventListener(taskCompletionEventName, handleCompletion);
    return () => window.removeEventListener(taskCompletionEventName, handleCompletion);
  }, []);

  if (!notices.length) return null;

  return (
    <aside className="completion-notice-stack" aria-live="polite" aria-label="Thông báo hoàn tất">
      {notices.map(notice => (
        <section className="completion-notice" role="status" key={notice.id}>
          <span className="completion-notice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m6.5 12.5 3.3 3.3 7.7-8" />
            </svg>
          </span>
          <div>
            <small>Đã hoàn tất</small>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
          <button
            type="button"
            aria-label={`Đóng thông báo ${notice.title}`}
            onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))}
          >
            ×
          </button>
        </section>
      ))}
    </aside>
  );
}
