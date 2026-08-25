import {useEffect, useRef, useState} from 'react';
import {BellIcon, CheckIcon, ChevronDownIcon} from './icons.tsx';
import {
  getTaskCompletionMode,
  prepareTaskCompletionNotifications,
  setTaskCompletionMode,
  taskCompletionModeEventName,
  taskCompletionModeStorageKey,
  type TaskCompletionMode,
} from './taskCompletionNotifications.ts';

const options: Array<{
  mode: TaskCompletionMode;
  label: string;
  description: string;
}> = [
  {
    mode: 'off',
    label: 'Không thông báo',
    description: 'Không hiện nhắc nhở hay phát âm thanh.',
  },
  {
    mode: 'normal',
    label: 'Thông báo thường',
    description: 'Báo một lần; tác vụ lỗi dùng một âm báo riêng.',
  },
  {
    mode: 'persistent',
    label: 'Reo đến khi tắt',
    description: 'Nhắc lại âm hoàn tất hoặc âm lỗi đến khi bạn quay lại tắt.',
  },
];

export function TaskNotificationModeControl() {
  const [mode, setMode] = useState(getTaskCompletionMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.mode === mode) ?? options[1]!;

  useEffect(() => {
    const handleModeChange = (event: Event) => {
      setMode((event as CustomEvent<TaskCompletionMode>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === taskCompletionModeStorageKey) setMode(getTaskCompletionMode());
    };
    window.addEventListener(taskCompletionModeEventName, handleModeChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(taskCompletionModeEventName, handleModeChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function selectMode(nextMode: TaskCompletionMode) {
    setTaskCompletionMode(nextMode);
    prepareTaskCompletionNotifications();
    setOpen(false);
  }

  return (
    <div className={`notification-mode-control${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        className="notification-mode-trigger"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <BellIcon />
        <span>
          <small>Khi chạy xong</small>
          <strong>{selected.label}</strong>
        </span>
        <ChevronDownIcon className="notification-mode-chevron" />
      </button>
      {open && (
        <div className="notification-mode-menu" role="radiogroup" aria-label="Chế độ thông báo khi tác vụ hoàn tất">
          {options.map(option => (
            <button
              className={option.mode === mode ? 'is-selected' : ''}
              type="button"
              role="radio"
              aria-checked={option.mode === mode}
              key={option.mode}
              onClick={() => selectMode(option.mode)}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <i aria-hidden="true">{option.mode === mode && <CheckIcon />}</i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
