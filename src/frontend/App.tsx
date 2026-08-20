import {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';
import type {TopicProject} from '../shared/topic.ts';
import {
  FolderIcon,
  LightbulbIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
  XIcon,
} from './icons.tsx';
import {ContentPage} from './ContentPage.tsx';
import {NarrationPage} from './NarrationPage.tsx';
import {ProductionPage} from './ProductionPage.tsx';
import {ProjectLibrary} from './ProjectLibrary.tsx';
import {TaskCompletionNotifications} from './TaskCompletionNotifications.tsx';
import {RouteErrorBoundary} from './RouteErrorBoundary.tsx';
import {
  navigate,
  navigateDiscardingPendingChanges,
  projectContentPath,
  projectResumePath,
  projectWorkflowPath,
  useAppRoute,
  workflowStepIndex,
} from './router.ts';
import {useTheme, type PadTheme} from './useTheme.ts';

const SceneReviewPage = lazy(async () => {
  const module = await import('./SceneReviewPage.tsx');
  return {default: module.SceneReviewPage};
});
const FinalRenderPage = lazy(async () => {
  const module = await import('./FinalRenderPage.tsx');
  return {default: module.FinalRenderPage};
});

const workflowSteps = [
  'Nội dung',
  'Cách đọc',
  'Giọng đọc & scene',
  'Chỉnh scene',
  'Xuất video',
] as const;

function Brand() {
  return (
    <a
      className="brand"
      href="/"
      aria-label="PAD Studio — Trang chủ"
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate('/');
      }}
    >
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span className="brand-name">PAD <strong>Studio</strong></span>
    </a>
  );
}

function PipelineSidebar({
  activeStep,
  hasProject,
  open,
  onClose,
  onOpenProjects,
  onSelectStep,
  theme,
  onToggleTheme,
}: {
  activeStep: number;
  hasProject: boolean;
  open: boolean;
  onClose: () => void;
  onOpenProjects: () => void;
  onSelectStep: (stepIndex: number) => void;
  theme: PadTheme;
  onToggleTheme: () => void;
}) {
  return (
    <aside id="pipeline-navigation" className={`pipeline-sidebar${open ? ' is-open' : ''}`}>
      <div className="sidebar-mobile-heading">
        <Brand />
        <button type="button" aria-label="Đóng quy trình sản xuất" onClick={onClose}><XIcon /></button>
      </div>
      <button className="projects-nav-button" type="button" onClick={() => { onClose(); onOpenProjects(); }}>
        <FolderIcon />
        Project của bạn
      </button>
      <button
        className="theme-toggle"
        type="button"
        aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </button>
      <div className="sidebar-heading">
        <span>Quy trình sản xuất</span>
        <strong>{String(activeStep + 1).padStart(2, '0')} / 05</strong>
      </div>
      <nav aria-label="Các bước sản xuất video">
        <ol className="pipeline-list">
          {workflowSteps.map((label, index) => (
            <li className={index === activeStep ? 'is-active' : ''} key={label}>
              <button
                className="pipeline-step-button"
                type="button"
                aria-current={index === activeStep ? 'step' : undefined}
                disabled={!hasProject}
                title={!hasProject ? 'Hãy tạo project trước khi mở các bước sản xuất.' : `Mở ${label}`}
                onClick={() => {
                  if (index === activeStep) {
                    onClose();
                    return;
                  }
                  onSelectStep(index);
                }}
              >
                <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="step-name">{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="sidebar-note">
        <LightbulbIcon />
        <p>Chọn bất kỳ bước nào để mở trực tiếp. Bước chưa đủ dữ liệu sẽ hiển thị điều kiện cần hoàn tất.</p>
      </div>
    </aside>
  );
}

function MobileHeader({
  activeStep,
  sidebarOpen,
  onToggleSidebar,
  onOpenProjects,
  theme,
  onToggleTheme,
}: {
  activeStep: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenProjects: () => void;
  theme: PadTheme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="mobile-header">
      <div className="mobile-brand-group">
        <button className="mobile-sidebar-button" type="button" aria-label="Mở quy trình sản xuất" aria-controls="pipeline-navigation" aria-expanded={sidebarOpen} onClick={onToggleSidebar}>
          <MenuIcon />
        </button>
        <Brand />
      </div>
      <div className="mobile-progress">
        <button className="mobile-projects-button" type="button" aria-label="Mở danh sách project" onClick={onOpenProjects}><FolderIcon /></button>
        <button className="mobile-theme-button" type="button" aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} onClick={onToggleTheme}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <span>Bước {activeStep + 1} / 5</span>
        <span className="mobile-progress-track"><span style={{width: `${((activeStep + 1) / workflowSteps.length) * 100}%`}} /></span>
      </div>
    </header>
  );
}

export default function App() {
  const route = useAppRoute();
  const {theme, toggleTheme} = useTheme();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newProjectKey, setNewProjectKey] = useState(0);
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const activeStep = workflowStepIndex(route);
  const activeProjectId = route.name === 'new-project' ? undefined : route.projectId;
  const routeIdentity = activeProjectId
    ? `${route.name}-${activeProjectId}-${projectReloadKey}`
    : `new-project-${newProjectKey}`;
  const navigationRef = useRef({
    activeStep,
    routeIdentity,
    transition: 'fade' as 'backward' | 'fade' | 'forward',
  });
  if (navigationRef.current.routeIdentity !== routeIdentity) {
    navigationRef.current = {
      activeStep,
      routeIdentity,
      transition: activeStep > navigationRef.current.activeStep
        ? 'forward'
        : activeStep < navigationRef.current.activeStep
          ? 'backward'
          : 'fade',
    };
  }
  const previousPath = activeProjectId && activeStep > 0
    ? projectWorkflowPath(activeProjectId, (activeStep - 1) as 0 | 1 | 2 | 3)
    : null;
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const openLibrary = useCallback(() => setLibraryOpen(true), []);

  useEffect(() => setSidebarOpen(false), [routeIdentity]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  function handleCreateProject() {
    setNewProjectKey(current => current + 1);
    closeLibrary();
    navigate('/');
  }

  function handleOpenProject(project: TopicProject) {
    setProjectReloadKey(current => current + 1);
    closeLibrary();
    navigate(projectResumePath(project));
  }

  function handleEditProject(project: TopicProject) {
    setProjectReloadKey(current => current + 1);
    closeLibrary();
    navigate(projectContentPath(project.id));
  }

  function handleDeleted(projectId: string) {
    if (activeProjectId === projectId) navigateDiscardingPendingChanges('/', true);
  }

  return (
    <div className="app-shell">
      <PipelineSidebar
        activeStep={activeStep}
        hasProject={Boolean(activeProjectId)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenProjects={openLibrary}
        onSelectStep={(stepIndex) => {
          if (activeProjectId) navigate(projectWorkflowPath(activeProjectId, stepIndex as 0 | 1 | 2 | 3 | 4));
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <button className={`sidebar-backdrop${sidebarOpen ? ' is-open' : ''}`} type="button" aria-label="Đóng quy trình sản xuất" tabIndex={sidebarOpen ? 0 : -1} onClick={() => setSidebarOpen(false)} />
      <MobileHeader activeStep={activeStep} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(current => !current)} onOpenProjects={openLibrary} theme={theme} onToggleTheme={toggleTheme} />
      <main className="workspace">
        <div className={`workspace-page is-${navigationRef.current.transition}`} key={routeIdentity}>
          <RouteErrorBoundary
            key={routeIdentity}
            onRetry={() => setProjectReloadKey(current => current + 1)}
            onBack={() => previousPath ? navigate(previousPath, true) : navigate('/', true)}
          >
            <Suspense fallback={<div className="page-state" role="status"><span className="spinner dark" /><strong>Đang mở công cụ của bước này…</strong></div>}>
              {route.name === 'new-project' && <ContentPage />}
              {route.name === 'project-content' && <ContentPage projectId={route.projectId} />}
              {route.name === 'project-pronunciation' && <NarrationPage projectId={route.projectId} />}
              {route.name === 'project-production' && <ProductionPage projectId={route.projectId} />}
              {route.name === 'project-scenes' && <SceneReviewPage projectId={route.projectId} />}
              {route.name === 'project-render' && <FinalRenderPage projectId={route.projectId} />}
            </Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
      <ProjectLibrary
        open={libraryOpen}
        activeProjectId={activeProjectId}
        onClose={closeLibrary}
        onCreate={handleCreateProject}
        onOpenProject={handleOpenProject}
        onEditProject={handleEditProject}
        onDeleted={handleDeleted}
      />
      <TaskCompletionNotifications />
    </div>
  );
}
