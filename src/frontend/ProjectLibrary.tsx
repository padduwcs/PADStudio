import {useEffect, useState} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {ApiRequestError, deleteProject, listProjects} from './api.ts';
import {
  ArrowRightIcon,
  ClockIcon,
  FolderIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from './icons.tsx';

const durationLabels: Record<TopicProject['topicInput']['duration'], string> = {
  concise: '1–2 phút',
  standard: '3–5 phút',
  deep: '6–8 phút',
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ProjectLibrary({
  open,
  activeProjectId,
  onClose,
  onCreate,
  onOpenProject,
  onEditProject,
  onDeleted,
}: {
  open: boolean;
  activeProjectId?: string;
  onClose: () => void;
  onCreate: () => void;
  onOpenProject: (project: TopicProject) => void;
  onEditProject: (project: TopicProject) => void;
  onDeleted: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<TopicProject[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setState('loading');
    setError('');
    setConfirmingId(null);

    void listProjects()
      .then((projectList) => {
        if (!active) return;
        setProjects(projectList);
        setState('idle');
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          requestError instanceof ApiRequestError
            ? requestError.message
            : 'Không thể tải danh sách project.',
        );
        setState('error');
      });

    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  async function handleDelete(projectId: string) {
    setDeletingId(projectId);
    setError('');

    try {
      await deleteProject(projectId);
      setProjects((current) =>
        current.filter((project) => project.id !== projectId),
      );
      setConfirmingId(null);
      onDeleted(projectId);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : 'Không thể xóa project.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className={`library-layer${open ? ' is-open' : ''}`}
      aria-hidden={!open}
    >
      <button
        className="library-backdrop"
        type="button"
        aria-label="Đóng danh sách project"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className="project-library"
        role="dialog"
        aria-modal="true"
        aria-label="Danh sách project"
      >
        <header className="library-header">
          <div>
            <span className="library-kicker">
              <FolderIcon />
              Thư viện cục bộ
            </span>
            <h2>Project của bạn</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Đóng"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </header>

        <button
          className="new-project-button"
          type="button"
          onClick={onCreate}
        >
          <PlusIcon />
          Tạo project mới
        </button>

        {error && (
          <div className="library-error" role="alert">
            {error}
          </div>
        )}

        <div className="project-list">
          {state === 'loading' && (
            <div className="library-loading" role="status">
              <span className="spinner dark" />
              Đang đọc project cục bộ…
            </div>
          )}

          {state !== 'loading' && projects.length === 0 && (
            <div className="empty-library">
              <FolderIcon />
              <strong>Chưa có project nào</strong>
              <p>Project đầu tiên sẽ xuất hiện tại đây sau khi bạn lưu chủ đề.</p>
            </div>
          )}

          {projects.map((project) => {
            const isConfirming = confirmingId === project.id;
            const isDeleting = deletingId === project.id;

            return (
              <article
                className={`project-card${
                  activeProjectId === project.id ? ' is-active' : ''
                }`}
                key={project.id}
              >
                <button
                  className="project-card-main"
                  type="button"
                  onClick={() => onOpenProject(project)}
                >
                  <span className="project-step">
                    {project.currentStep === 'outline'
                      ? 'Bước 02 · Mạch giảng'
                      : 'Bước 01 · Chủ đề'}
                  </span>
                  <strong>{project.topicInput.topic}</strong>
                  <span className="project-meta">
                    <span>
                      <ClockIcon />
                      {durationLabels[project.topicInput.duration]}
                    </span>
                    <time dateTime={project.updatedAt}>
                      {formatUpdatedAt(project.updatedAt)}
                    </time>
                  </span>
                  <ArrowRightIcon className="project-open-arrow" />
                </button>

                {isConfirming ? (
                  <div className="delete-confirmation">
                    <span>Xóa project và toàn bộ dữ liệu?</span>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void handleDelete(project.id)}
                    >
                      {isDeleting ? 'Đang xóa…' : 'Xóa'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setConfirmingId(null)}
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <div className="project-card-actions">
                    <button
                      type="button"
                      onClick={() => onEditProject(project)}
                    >
                      Chỉnh đầu vào
                    </button>
                    <button
                      className="danger-action"
                      type="button"
                      aria-label={`Xóa ${project.topicInput.topic}`}
                      onClick={() => setConfirmingId(project.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
