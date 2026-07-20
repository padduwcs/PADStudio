import {Player, Stage} from '@motion-canvas/core';
import {applySceneOverrides} from '../layout-editor/modifier-model.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(frame, fps) {
  const totalSeconds = Math.max(0, frame / Math.max(1, fps));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds % 1) * 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function previewMessage(type, details = {}) {
  const generationId =
    new URLSearchParams(window.location.search).get('generation') ?? '';
  window.parent.postMessage(
    {
      source: 'pad-studio-sync-preview',
      type,
      generationId,
      ...details,
    },
    '*',
  );
}

async function startPreview(project) {
  const root = document.querySelector('#root');
  if (!root) throw new Error('Không tìm thấy preview root.');

  const overridesUrl = new URLSearchParams(window.location.search).get(
    'overrides',
  );
  let visualDesign = {sections: [], overrides: []};
  if (overridesUrl) {
    const response = await fetch(overridesUrl, {cache: 'no-store'});
    if (!response.ok) {
      throw new Error('Không thể tải các chỉnh sửa scene của bản đồng bộ.');
    }
    const value = await response.json();
    if (value && typeof value === 'object') {
      visualDesign = {
        sections: Array.isArray(value.sections) ? value.sections : [],
        overrides: Array.isArray(value.overrides) ? value.overrides : [],
      };
    }
  }

  const shell = element('section', 'preview-shell');
  const heading = element('header', 'preview-heading');
  const headingCopy = element('div');
  const projectName =
    project.name && project.name !== 'project'
      ? project.name
      : 'Animation đã đồng bộ';
  headingCopy.append(
    element('span', 'preview-kicker', 'Bản nháp audio–animation'),
    element('strong', '', projectName),
  );
  const liveStatus = element('span', 'preview-status', 'Đang dựng khung hình…');
  heading.append(headingCopy, liveStatus);

  const viewport = element('div', 'preview-viewport');
  const stageHost = element('div', 'preview-stage');
  const loading = element('div', 'preview-loading');
  loading.append(element('span', 'preview-spinner'));
  loading.append(element('strong', '', 'Đang tải animation và narration…'));
  viewport.append(stageHost, loading);

  const controls = element('div', 'preview-controls');
  const playButton = element('button', 'preview-play', 'Phát');
  playButton.type = 'button';
  playButton.setAttribute('aria-label', 'Phát bản nháp');

  const timeCurrent = element('time', 'preview-time', '0:00.0');
  const seek = element('input', 'preview-seek');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1';
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Vị trí phát bản nháp');
  const timeDuration = element('time', 'preview-time', '0:00.0');

  const muteButton = element('button', 'preview-icon-button', 'Âm thanh');
  muteButton.type = 'button';
  muteButton.setAttribute('aria-label', 'Bật hoặc tắt âm thanh');
  const fullscreenButton = element(
    'button',
    'preview-icon-button',
    'Toàn màn hình',
  );
  fullscreenButton.type = 'button';
  fullscreenButton.setAttribute('aria-label', 'Xem toàn màn hình');
  controls.append(
    playButton,
    timeCurrent,
    seek,
    timeDuration,
    muteButton,
    fullscreenButton,
  );

  const errorPanel = element('div', 'preview-error');
  errorPanel.hidden = true;
  shell.append(heading, viewport, controls, errorPanel);
  root.replaceChildren(shell);

  const settings = project.meta.getFullPreviewSettings();
  const stage = new Stage();
  stage.configure(settings);
  stageHost.append(stage.finalBuffer);

  const player = new Player(
    project,
    settings,
    {
      loop: false,
      muted: false,
      paused: true,
      speed: 1,
      volume: 1,
    },
    0,
  );
  for (const plugin of project.plugins) {
    plugin.player?.(player);
  }
  player.deactivate();

  let duration = 0;
  let ready = false;
  let disposed = false;
  const disposers = [];
  const sceneIds = new WeakMap();

  disposers.push(
    player.playback.onScenesRecalculated.subscribe(scenes => {
      scenes.forEach((scene, index) => {
        const source = visualDesign.sections[index];
        if (source?.sceneId) sceneIds.set(scene, source.sceneId);
      });
    }),
  );

  function reportError(payload) {
    if (payload?.level !== 'error') return;
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : 'Không thể phát bản nháp.';
    errorPanel.hidden = false;
    errorPanel.textContent = message;
    liveStatus.textContent = 'Preview có lỗi';
    liveStatus.classList.add('is-error');
    previewMessage('error', {message});
  }

  disposers.push(project.logger.onLogged.subscribe(reportError));
  disposers.push(
    player.onRender.subscribe(async () => {
      const currentScene = player.playback.currentScene;
      const previousScene = player.playback.previousScene;
      const restorePrevious = previousScene
        ? applySceneOverrides(previousScene, visualDesign, {
            sceneId: sceneIds.get(previousScene) ?? previousScene.name,
          })
        : () => {};
      const restoreCurrent = applySceneOverrides(currentScene, visualDesign, {
        sceneId: sceneIds.get(currentScene) ?? currentScene.name,
      });
      try {
        await stage.render(currentScene, previousScene);
      } finally {
        try {
          restoreCurrent();
        } finally {
          restorePrevious();
        }
      }
      if (!ready) {
        ready = true;
        loading.hidden = true;
        liveStatus.textContent = 'Sẵn sàng phát';
        shell.dataset.ready = 'true';
        previewMessage('ready');
      }
    }),
  );
  disposers.push(
    player.onDurationChanged.subscribe((value) => {
      duration = Math.max(0, value);
      shell.dataset.durationFrames = String(duration);
      seek.max = String(Math.max(1, duration));
      timeDuration.textContent = formatTime(duration, player.status.fps);
    }),
  );
  disposers.push(
    player.onFrameChanged.subscribe((frame) => {
      seek.value = String(Math.min(duration, Math.max(0, frame)));
      timeCurrent.textContent = formatTime(frame, player.status.fps);
    }),
  );
  disposers.push(
    player.onStateChanged.subscribe((state) => {
      playButton.textContent = state.paused ? 'Phát' : 'Tạm dừng';
      playButton.setAttribute(
        'aria-label',
        state.paused ? 'Phát bản nháp' : 'Tạm dừng bản nháp',
      );
      muteButton.textContent = state.muted ? 'Bật tiếng' : 'Âm thanh';
      muteButton.classList.toggle('is-muted', state.muted);
      liveStatus.textContent = state.paused
        ? ready
          ? 'Đang tạm dừng'
          : 'Đang dựng khung hình…'
        : 'Đang phát đồng bộ';
    }),
  );

  playButton.addEventListener('click', () => {
    const wasPaused = player.onStateChanged.current.paused;
    player.togglePlayback();
    if (wasPaused) previewMessage('played');
  });
  stage.finalBuffer.addEventListener('click', () => {
    const wasPaused = player.onStateChanged.current.paused;
    player.togglePlayback();
    if (wasPaused) previewMessage('played');
  });
  seek.addEventListener('input', () => {
    player.requestSeek(Number(seek.value));
  });
  muteButton.addEventListener('click', () => player.toggleAudio());
  fullscreenButton.addEventListener('click', async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await viewport.requestFullscreen();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.target === seek) return;
    if (event.code === 'Space') {
      event.preventDefault();
      const wasPaused = player.onStateChanged.current.paused;
      player.togglePlayback();
      if (wasPaused) previewMessage('played');
    } else if (event.code === 'ArrowLeft') {
      player.requestSeek(player.onFrameChanged.current - player.status.fps * 5);
    } else if (event.code === 'ArrowRight') {
      player.requestSeek(player.onFrameChanged.current + player.status.fps * 5);
    }
  });

  window.addEventListener(
    'beforeunload',
    () => {
      for (const dispose of disposers) dispose();
      disposed = true;
      player.deactivate();
    },
    {once: true},
  );
  player.requestRender();
  void player
    .run()
    .then(() => {
      if (!disposed) player.activate();
    })
    .catch((error) => project.logger.error(error));
}

export function editor(project) {
  void startPreview(project).catch(error => {
    const root = document.querySelector('#root');
    if (root) {
      root.textContent = error instanceof Error ? error.message : String(error);
    }
    project.logger.error(error);
  });
}

export function index() {
  const root = document.querySelector('#root');
  if (root) {
    root.textContent = 'Không tìm thấy project đồng bộ để phát.';
  }
}
