import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMediaPlaybackAbort,
  playMediaSegment,
} from './mediaPlayback.ts';

class FakeMediaElement extends EventTarget {
  readyState = 1;
  duration = 30;
  seeking = false;
  paused = true;
  error: MediaError | null = null;
  playedAt: number | null = null;
  private position = 0;

  get currentTime() {
    return this.position;
  }

  set currentTime(value: number) {
    this.seeking = true;
    this.position = value;
    queueMicrotask(() => {
      this.seeking = false;
      this.dispatchEvent(new Event('seeked'));
    });
  }

  pause() {
    this.paused = true;
  }

  async play() {
    this.paused = false;
    this.playedAt = this.currentTime;
  }
}

test('playMediaSegment waits for seek and starts at the requested section', async () => {
  const media = new FakeMediaElement();

  const segment = await playMediaSegment(
    media as unknown as HTMLMediaElement,
    8.25,
    12.5,
  );

  assert.deepEqual(segment, {startSeconds: 8.25, endSeconds: 12.5});
  assert.equal(media.playedAt, 8.25);
  assert.equal(media.paused, false);
});

test('playMediaSegment waits for metadata before seeking', async () => {
  const media = new FakeMediaElement();
  media.readyState = 0;

  const playback = playMediaSegment(
    media as unknown as HTMLMediaElement,
    4,
    7,
  );
  assert.equal(media.playedAt, null);

  media.readyState = 1;
  media.dispatchEvent(new Event('loadedmetadata'));
  await playback;

  assert.equal(media.playedAt, 4);
});

test('playMediaSegment can cancel a pending request', async () => {
  const media = new FakeMediaElement();
  media.readyState = 0;
  const controller = new AbortController();

  const playback = playMediaSegment(
    media as unknown as HTMLMediaElement,
    4,
    7,
    controller.signal,
  );
  controller.abort();

  await assert.rejects(playback, isMediaPlaybackAbort);
  assert.equal(media.playedAt, null);
});

test('playMediaSegment rejects invalid or out-of-bounds sections', async () => {
  const media = new FakeMediaElement();
  media.duration = 5;

  await assert.rejects(
    playMediaSegment(media as unknown as HTMLMediaElement, 5, 8),
    /ngoài thời lượng/u,
  );
  await assert.rejects(
    playMediaSegment(media as unknown as HTMLMediaElement, 4, 4),
    /không hợp lệ/u,
  );
});
