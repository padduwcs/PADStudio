function ratio(value) {
  const [numerator, denominator] = String(value ?? "").split("/").map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Normalize ffprobe JSON (object or text) into the video/audio streams and duration delivery records. */
export function parseDeliveryProbe(value) {
  const probe = typeof value === "string" ? JSON.parse(value) : value;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    throw new Error("ffprobe returned an invalid media description.");
  }
  const video = probe.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  return {
    raw: probe,
    video,
    audio,
    durationSeconds: finite(probe.format?.duration),
    fps: ratio(video?.avg_frame_rate)
  };
}
