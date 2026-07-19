import {useEffect, useId, useState, type ReactNode} from 'react';
import {ArrowLeftIcon, XIcon} from './icons.tsx';

export function ResponsiveAside({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `context-panel-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        className="context-panel-toggle"
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Mở ${label}`}
        onClick={() => setOpen(true)}
      >
        <ArrowLeftIcon />
        <span>Tổng quan</span>
      </button>
      <button
        className={`context-panel-backdrop${open ? ' is-open' : ''}`}
        type="button"
        aria-label={`Đóng ${label}`}
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside
        id={panelId}
        className={`responsive-aside ${className}${open ? ' is-open' : ''}`}
        aria-label={label}
      >
        <header className="responsive-aside-header">
          <div>
            <span>Panel nhanh</span>
            <strong>{label}</strong>
          </div>
          <button
            type="button"
            aria-label={`Đóng ${label}`}
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
