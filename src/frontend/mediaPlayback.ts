const HAVE_METADATA = 1;
const SEEK_TOLERANCE_SECONDS = 0.015;
const MEDIA_EVENT_TIMEOUT_MS = 10_000;

function abortError() {
  return new DOMException('Media playback was cancelled.', 'AbortError');
}

function mediaError(media: HTMLMediaElement, fallback: string) {
  return new Error(media.error?.message || fallback);
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: 'loadedmetadata' | 'seeked',
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    function cleanup() {
      media.removeEventListener(eventName, handleSuccess);
      media.removeEventListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
      if (timeout) clearTimeout(timeout);
    }

    function handleSuccess() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(mediaError(media, 'Không thể tải audio để phát.'));
    }

    function handleAbort() {
      cleanup();
      reject(abortError());
    }

    media.addEventListener(eventName, handleSuccess, {once: true});
    media.addEventListener('error', handleError, {once: true});
    signal?.addEventListener('abort', handleAbort, {once: true});
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Audio phản hồi quá chậm. Hãy thử phát lại.'));
    }, MEDIA_EVENT_TIMEOUT_MS);
  });
}

async function seekMedia(
  media: HTMLMediaElement,
  targetSeconds: number,
  signal?: AbortSignal,
) {
  if (
    Math.abs(media.currentTime - targetSeconds) <= SEEK_TOLERANCE_SECONDS &&
    !media.seeking
  ) {
    return;
  }

  const seeked = waitForMediaEvent(media, 'seeked', signal);
  media.currentTime = targetSeconds;
  await seeked;
}

export interface PlayedMediaSegment {
  startSeconds: number;
  endSeconds: number;
}

export async function playMediaSegment(
  media: HTMLMediaElement,
  startSeconds: number,
  endSeconds: number,
  signal?: AbortSignal,
): Promise<PlayedMediaSegment> {
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds <= startSeconds
  ) {
    throw new Error('Khoảng thời gian section không hợp lệ.');
  }

  if (media.readyState < HAVE_METADATA) {
    await waitForMediaEvent(media, 'loadedmetadata', signal);
  }
  if (signal?.aborted) throw abortError();

  const duration = media.duration;
  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
  if (hasFiniteDuration && startSeconds >= duration) {
    throw new Error('Section nằm ngoài thời lượng audio hiện có.');
  }
  const boundedStart = hasFiniteDuration
    ? Math.min(startSeconds, Math.max(0, duration - SEEK_TOLERANCE_SECONDS))
    : startSeconds;
  const boundedEnd = hasFiniteDuration
    ? Math.min(endSeconds, duration)
    : endSeconds;

  if (boundedEnd <= boundedStart) {
    throw new Error('Section nằm ngoài thời lượng audio hiện có.');
  }

  media.pause();
  await seekMedia(media, boundedStart, signal);
  if (signal?.aborted) throw abortError();

  await media.play();
  return {startSeconds: boundedStart, endSeconds: boundedEnd};
}

export function isMediaPlaybackAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
