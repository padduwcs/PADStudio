import { createFfprobeMediaInspector } from "../tools/ffprobe-media-inspector.js";
import { createFfmpegVideoTrimmer } from "../tools/ffmpeg-video-trimmer.js";
import { createFfmpegVideoConcatenator } from "../tools/ffmpeg-video-concatenator.js";
import { createFfmpegVideoReformatter } from "../tools/ffmpeg-video-reformatter.js";
import { createFfmpegVideoThumbnailer } from "../tools/ffmpeg-video-thumbnailer.js";
import { ToolRegistry } from "./tool-registry.js";

export function createDefaultToolRegistry(options = {}) {
  return new ToolRegistry([
    createFfprobeMediaInspector(options.ffprobe),
    createFfmpegVideoTrimmer(options.ffmpegTrim),
    createFfmpegVideoConcatenator(options.ffmpegConcat),
    createFfmpegVideoReformatter(options.ffmpegReformat),
    createFfmpegVideoThumbnailer(options.ffmpegThumbnail)
  ]);
}
