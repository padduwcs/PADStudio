const MAX_LOGS = 8;

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll('\u0000', '').trim();
  if (!normalized) return null;
  return normalized.slice(0, maximumLength);
}

function normalizeLevel(value) {
  return ['error', 'warn', 'info', 'debug'].includes(value)
    ? value
    : 'debug';
}

export function normalizeRenderLog(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const message = boundedText(payload.message, 1_000);
  const stack = boundedText(payload.stack, 4_000);
  if (!message && !stack) return null;
  return {
    level: normalizeLevel(payload.level),
    message: message ?? 'Motion Canvas phát sinh lỗi không có thông báo.',
    remarks: boundedText(payload.remarks, 2_000),
    stack,
  };
}

function errorLog(error) {
  if (error instanceof Error) {
    return {
      level: 'error',
      message: boundedText(error.message, 1_000) ?? error.name,
      remarks: null,
      stack: boundedText(error.stack, 4_000),
    };
  }
  const message = boundedText(String(error ?? ''), 1_000);
  return message
    ? {level: 'error', message, remarks: null, stack: null}
    : null;
}

export function createRenderDiagnosticTracker(fps) {
  const logs = [];
  let frame = null;
  let sceneFrame = null;
  let sceneName = null;

  return {
    record(payload) {
      const log = normalizeRenderLog(payload);
      if (!log) return;
      logs.push(log);
      if (logs.length > MAX_LOGS) logs.shift();
    },

    markFrame(nextFrame, nextSceneFrame, nextSceneName) {
      frame = Number.isSafeInteger(nextFrame) && nextFrame >= 0
        ? nextFrame
        : frame;
      sceneFrame = Number.isSafeInteger(nextSceneFrame) && nextSceneFrame >= 0
        ? nextSceneFrame
        : null;
      sceneName = boundedText(nextSceneName, 200);
    },

    build(error, stage = 'motion-canvas') {
      const directError = errorLog(error);
      const recentLogs = directError
        ? [...logs, directError].slice(-MAX_LOGS)
        : [...logs];
      return {
        stage,
        frame,
        sceneFrame,
        sceneName,
        timeSeconds:
          frame !== null && Number.isFinite(fps) && fps > 0
            ? frame / fps
            : null,
        logs: recentLogs,
      };
    },
  };
}

export function diagnosticMessage(diagnostic, fallback) {
  const error = [...(diagnostic?.logs ?? [])]
    .reverse()
    .find(log => log.level === 'error');
  return boundedText(error?.message, 500) ?? fallback;
}

export function rendererRangeFromFrames(rangeFrames, fps) {
  if (
    !Array.isArray(rangeFrames) ||
    rangeFrames.length !== 2 ||
    !rangeFrames.every(frame => Number.isSafeInteger(frame) && frame >= 0) ||
    rangeFrames[1] < rangeFrames[0] ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    throw new Error('Khoảng frame render không hợp lệ.');
  }
  return rangeFrames.map((frame, index) =>
    index === 0 && frame === 0 ? 0 : (frame - 0.25) / fps,
  );
}
