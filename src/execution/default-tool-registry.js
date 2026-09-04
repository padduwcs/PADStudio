import { createFfprobeMediaInspector } from "../tools/ffprobe-media-inspector.js";
import { createFfmpegVideoTrimmer } from "../tools/ffmpeg-video-trimmer.js";
import { ToolRegistry } from "./tool-registry.js";

export function createDefaultToolRegistry(options = {}) {
  return new ToolRegistry([
    createFfprobeMediaInspector(options.ffprobe),
    createFfmpegVideoTrimmer(options.ffmpegTrim)
  ]);
}
