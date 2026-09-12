import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { sequenceDuration } from "../production/sequence-composition.js";

const number = (v) => Number(v).toFixed(6);
const fit = (w, h, mode) => mode === "crop"
  ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
  : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
const clock = (seconds) => {
  const cs = Math.round(seconds * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const assColor = (hex) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
function wrapped(text, style, width) {
  const max = Math.max(1, Math.floor(width * (1 - 2 * style.margin) / (style.fontSize)));
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (word.length > max) throw new Error("Caption contains a word too wide for the safe area.");
      if (line && line.length + word.length + 1 > max) { lines.push(line); line = ""; }
      line += (line ? " " : "") + word;
    }
    lines.push(line);
  }
  return lines;
}
export function createStyledAss(captions, format) {
  let text = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${format.width}\nPlayResY: ${format.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  const events = [];
  captions.forEach((cue, index) => {
    const s = cue.style, margin = Math.round(format.width * s.margin);
    text += `Style: s${index},${s.font},${s.fontSize},${assColor(s.color)},&H00FFFFFF,${s.background ? assColor(s.background) : "&H00000000"},${s.background ? assColor(s.background) : "&H80000000"},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.background ? 3 : 1},${s.outline},0,5,${margin},${margin},0,1\n`;
    const lines = wrapped(cue.text, s, format.width);
    const block = lines.length * s.fontSize * s.lineSpacing;
    if (block > format.height * (1 - 2 * s.margin)) throw new Error("Caption exceeds vertical safe area.");
    const first = s.position === "top" ? format.height * s.margin + s.fontSize / 2 : s.position === "center" ? (format.height - block) / 2 + s.fontSize / 2 : format.height * (1 - s.margin) - block + s.fontSize / 2;
    lines.forEach((line, i) => {
      const x = format.width / 2, y = first + i * s.fontSize * s.lineSpacing;
      const a = cue.animation, ms = Math.round((a?.durationSeconds ?? 0) * 1000);
      const position = a?.enter === "slideLeft" ? `\\move(${-format.width},${y},${x},${y},0,${ms})` : a?.enter === "slideUp" ? `\\move(${x},${format.height + s.fontSize},${x},${y},0,${ms})` : `\\pos(${x},${y})`;
      const fade = `\\fad(${a?.enter === "fade" ? ms : 0},${a?.exit === "fade" ? ms : 0})`;
      const safe = line.replaceAll("\\", "＼").replaceAll("{", "｛").replaceAll("}", "｝");
      events.push(`Dialogue: 0,${clock(cue.startSeconds)},${clock(cue.endSeconds)},s${index},,0,0,0,,{${position}${fade}}${safe}`);
    });
  });
  return text + "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + events.join("\n") + "\n";
}
function fades(track, duration) {
  return (track.fadeInSeconds ? `,afade=t=in:st=0:d=${track.fadeInSeconds}` : "") +
    (track.fadeOutSeconds ? `,afade=t=out:st=${number(duration - track.fadeOutSeconds)}:d=${track.fadeOutSeconds}` : "");
}
export async function renderComposedSegment({ entry, sequence, directory, outputPath, command, probe, ffmpegCommand }) {
  const { segment: s, visual, narration, overlays, index } = entry;
  const { width: w, height: h, fps } = sequence.format, d = s.durationSeconds;
  const args = ["-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1"];
  let inputCount = 0;
  function input(media, start = 0) {
    const id = inputCount++;
    if (media.mediaType === "image") args.push("-loop", "1", "-framerate", String(fps));
    else args.push("-ss", String(start));
    args.push("-i", media.filePath); return id;
  }
  const vp = await probe(visual.filePath);
  if (!vp.video || (visual.mediaType !== "image" && (!Number.isFinite(vp.duration) || s.visual.startSeconds + d > vp.duration + 0.03))) throw new Error("Visual range exceeds source.");
  input(visual, s.visual.startSeconds);
  const filters = [];
  let visualFilter = fit(w, h, s.visual.fit) + `,setsar=1,fps=${fps},trim=duration=${d},setpts=PTS-STARTPTS`;
  if (s.visual.motion !== "none") {
    if (visual.mediaType !== "image") throw new Error("Motion presets require a still image.");
    const frames = Math.round(d * fps), denominator = Math.max(1, frames - 1);
    const z = s.visual.motion === "zoomIn" ? `1+0.12*on/${denominator}` : s.visual.motion === "zoomOut" ? `1.12-0.12*on/${denominator}` : "1.12";
    const x = s.visual.motion === "panLeft" ? `(iw-iw/zoom)*(1-on/${denominator})` : s.visual.motion === "panRight" ? `(iw-iw/zoom)*on/${denominator}` : "iw/2-iw/zoom/2";
    visualFilter += `,zoompan=z='${z}':x='${x}':y='ih/2-ih/zoom/2':d=1:s=${w}x${h}:fps=${fps}`;
  }
  filters.push(`[0:v]${visualFilter},format=yuv420p[v0]`);
  let volume = String(s.visual.volume);
  for (const r of [...s.visual.volumeRanges].reverse()) volume = `if(gte(t,${r.startSeconds})*lt(t,${r.endSeconds}),${r.volume},${volume})`;
  if (vp.audio) filters.push(`[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume='${volume}':eval=frame${fades(s.visual, d)},apad,atrim=duration=${d}[base]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[base]`);
  let audio = "base";
  if (narration) {
    const np = await probe(narration.filePath), n = s.narration;
    const duration = n.durationSeconds ?? np.duration - n.startSeconds;
    if (!np.audio || !Number.isFinite(duration) || duration <= 0 || n.startSeconds + duration > np.duration + 0.03 || n.offsetSeconds + duration > d + 0.03) throw new Error("Narration exceeds segment duration or source range.");
    if (n.fadeInSeconds + n.fadeOutSeconds > duration) throw new Error("Narration fades exceed actual audio duration.");
    const ni = input(narration, n.startSeconds);
    filters.push(`[${ni}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${number(duration)},asetpts=PTS-STARTPTS,volume=${n.volume}${fades(n, duration)},adelay=${Math.round(n.offsetSeconds * 1000)}:all=1,apad,atrim=duration=${d}[voice]`);
    filters.push("[base][voice]amix=inputs=2:normalize=0:duration=first[audio]"); audio = "audio";
  }
  let video = "v0";
  for (let i = 0; i < overlays.length; i++) {
    const { spec: o, media } = overlays[i], p = await probe(media.filePath), length = o.endSeconds - o.startSeconds;
    if (!p.video || (media.mediaType !== "image" && (!Number.isFinite(p.duration) || o.sourceStartSeconds + length > p.duration + 0.03)) || (media.mediaType === "image" && o.sourceStartSeconds !== 0)) throw new Error("Overlay range exceeds source.");
    const oi = input(media, o.sourceStartSeconds), ow = Math.max(2, Math.round(o.width * w / 2) * 2), oh = Math.max(2, Math.round(o.height * h / 2) * 2);
    const a = o.animation;
    let f = `[${oi}:v]format=rgba,${fit(ow, oh, o.fit)},setsar=1,fps=${fps},format=rgba,trim=duration=${length},setpts=PTS-STARTPTS`;
    if (a?.enter === "fade") f += `,fade=t=in:st=0:d=${a.durationSeconds}:alpha=1`;
    if (a?.exit === "fade") f += `,fade=t=out:st=${length - a.durationSeconds}:d=${a.durationSeconds}:alpha=1`;
    filters.push(f + `,setpts=PTS+${o.startSeconds}/TB[ov${i}]`);
    const progress = a ? `min(1,max(0,(t-${o.startSeconds})/${a.durationSeconds}))` : "1";
    const x = a?.enter === "slideLeft" ? `-${ow}+(${w * o.x}+${ow})*${progress}` : String(w * o.x);
    const y = a?.enter === "slideUp" ? `${h}+(${h * o.y}-${h})*${progress}` : String(h * o.y);
    filters.push(`[${video}][ov${i}]overlay=x='${x}':y='${y}':enable='gte(t,${o.startSeconds})*lt(t,${o.endSeconds})':eof_action=pass[v${i + 1}]`);
    video = `v${i + 1}`;
  }
  let subtitleName = null;
  if (s.captions.length) {
    subtitleName = `styled-${index}.ass`;
    await writeFile(join(directory, subtitleName), createStyledAss(s.captions, sequence.format), "utf8");
    filters.push(`[${video}]ass=filename=${subtitleName}[captioned]`); video = "captioned";
  }
  args.push("-filter_complex", filters.join(";"), "-map", `[${video}]`, "-map", `[${audio}]`, "-t", String(d), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-y", outputPath);
  await command(ffmpegCommand, args, { cwd: directory });
  if (subtitleName) await unlink(join(directory, subtitleName));
}
export async function finishComposition({ sequence, segments, music, directory, finalPath, command, probe, ffmpegCommand }) {
  const duration = sequenceDuration(sequence), fps = sequence.format.fps;
  const args = ["-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1"], filters = [];
  segments.forEach((_, i) => args.push("-i", join(directory, `segment-${i}.mp4`)));
  segments.forEach((_, i) => filters.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`, `[${i}:a]atrim=duration=${sequence.segments[i].durationSeconds},asetpts=PTS-STARTPTS[a${i}]`));
  let v = "v0", a = "a0", elapsed = sequence.segments[0].durationSeconds;
  for (let i = 1; i < segments.length; i++) {
    const transition = sequence.segments[i - 1].transition;
    if (transition.type === "cut") {
      filters.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[jv${i}][ja${i}]`);
    } else {
      filters.push(`[${v}][v${i}]xfade=transition=${transition.type === "crossfade" ? "fade" : "fadeblack"}:duration=${transition.durationSeconds}:offset=${number(elapsed - transition.durationSeconds)}[jv${i}]`);
      filters.push(`[${a}][a${i}]acrossfade=d=${transition.durationSeconds}:c1=tri:c2=tri[ja${i}]`);
    }
    elapsed += sequence.segments[i].durationSeconds - transition.durationSeconds;
    v = `jv${i}`; a = `ja${i}`;
  }
  // Every ducking track observes the foreground mix, never another music track.
  const duckCount = music.filter((m) => m.spec.ducking).length;
  if (duckCount) filters.push(`[${a}]asplit=${duckCount + 1}[foreground]${Array.from({ length: duckCount }, (_, i) => `[key${i}]`).join("")}`);
  const audioLabels = [duckCount ? "foreground" : a];
  let keyIndex = 0;
  for (let i = 0; i < music.length; i++) {
    const { spec: m, media } = music[i], p = await probe(media.filePath);
    if (!p.audio || !Number.isFinite(p.duration) || m.sourceStartSeconds >= p.duration || (!m.loop && m.sourceStartSeconds + m.durationSeconds > p.duration + 0.03)) throw new Error("Music range exceeds source; enable loop explicitly if intended.");
    if (m.loop) args.push("-stream_loop", "-1");
    args.push("-ss", String(m.sourceStartSeconds), "-i", media.filePath);
    filters.push(`[${segments.length + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${m.durationSeconds},asetpts=PTS-STARTPTS,volume=${m.volume}${fades(m, m.durationSeconds)},adelay=${Math.round(m.startSeconds * 1000)}:all=1,apad,atrim=duration=${number(duration)}[music${i}]`);
    if (m.ducking) { filters.push(`[music${i}][key${keyIndex++}]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=300[duck${i}]`); audioLabels.push(`duck${i}`); }
    else audioLabels.push(`music${i}`);
  }
  filters.push(audioLabels.map((x) => `[${x}]`).join("") + `amix=inputs=${audioLabels.length}:normalize=0:duration=first[mixed]`);
  let mix = "mixed";
  if (sequence.audio.loudnessTargetLufs !== null) {
    filters.push(`[mixed]loudnorm=I=${sequence.audio.loudnessTargetLufs}:TP=-1.5:LRA=11,aresample=48000[normalized]`); mix = "normalized";
  }
  filters.push(`[${v}]fps=${fps},tpad=stop_mode=clone:stop_duration=${1 / fps},trim=end_frame=${Math.round(duration * fps)},setpts=PTS-STARTPTS[finalvideo]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[finalvideo]", "-map", `[${mix}]`, "-t", number(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-y", finalPath);
  await command(ffmpegCommand, args, { cwd: directory });
  return duration;
}
