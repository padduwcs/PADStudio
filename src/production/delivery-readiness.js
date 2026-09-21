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

export function deliveryProfileMismatches(media, profile, { expectedDurationSeconds = null } = {}) {
  const { raw, video, audio, durationSeconds, fps } = media;
  const mismatches = [];
  if (!String(raw.format?.format_name ?? "").split(",").includes(profile.container)) mismatches.push("container");
  if (video?.codec_name !== profile.videoCodec) mismatches.push("video_codec");
  if (video?.pix_fmt !== profile.pixelFormat) mismatches.push("pixel_format");
  if (video?.width !== profile.width || video?.height !== profile.height) mismatches.push("dimensions");
  if (fps === null || Math.abs(fps - profile.fps) > 0.001) mismatches.push("fps");
  if (audio?.codec_name !== profile.audioCodec) mismatches.push("audio_codec");
  if (Number(audio?.sample_rate) !== profile.sampleRate) mismatches.push("sample_rate");
  if (audio?.channels !== profile.channels) mismatches.push("channels");
  if (durationSeconds === null || durationSeconds <= 0) mismatches.push("duration");
  if (expectedDurationSeconds !== null && durationSeconds !== null &&
      Math.abs(durationSeconds - expectedDurationSeconds) > Math.max(0.15, 2 / profile.fps)) {
    mismatches.push("expected_duration");
  }
  return mismatches;
}

export function matchingDeliveryProfiles(media, profiles, options = {}) {
  return profiles.filter((profile) => deliveryProfileMismatches(media, profile, options).length === 0);
}

export function describeDeliveryMedia(media) {
  return [
    `${media.video?.width ?? "?"}x${media.video?.height ?? "?"}`,
    media.fps === null ? "? fps" : `${Math.round(media.fps * 1000) / 1000} fps`,
    media.video?.codec_name ?? "no video codec",
    media.video?.pix_fmt ?? "no pixel format",
    media.audio?.codec_name ?? "no audio codec",
    media.audio?.sample_rate ? `${media.audio.sample_rate} Hz` : "no sample rate",
    media.audio?.channels ? `${media.audio.channels} ch` : "no channels"
  ].join(", ");
}
