import { createFfprobeMediaInspector } from "../tools/ffprobe-media-inspector.js";
import { createFfmpegVideoTrimmer } from "../tools/ffmpeg-video-trimmer.js";
import { createFfmpegVideoConcatenator } from "../tools/ffmpeg-video-concatenator.js";
import { createFfmpegVideoReformatter } from "../tools/ffmpeg-video-reformatter.js";
import { createFfmpegVideoThumbnailer } from "../tools/ffmpeg-video-thumbnailer.js";
import { createFfmpegAudioOverlay } from "../tools/ffmpeg-audio-overlay.js";
import { createFfmpegSubtitleBurner } from "../tools/ffmpeg-subtitle-burner.js";
import { createFfmpegImageToVideo } from "../tools/ffmpeg-image-to-video.js";
import { ToolRegistry } from "./tool-registry.js";
import { createFfmpegSequenceRenderer } from "../tools/ffmpeg-sequence-renderer.js";
import { createFfprobeSource } from "../tools/ffprobe-source.js";
import { createPyscenedetectScenes } from "../tools/pyscenedetect-scenes.js";
import { createFfmpegSourceFrames } from "../tools/ffmpeg-source-frames.js";
import { createFfmpegAudioAnalysis } from "../tools/ffmpeg-audio-analysis.js";
import { createFasterWhisperTranscribe } from "../tools/faster-whisper-transcribe.js";
import { createFfmpegSourcePreview } from "../tools/ffmpeg-source-preview.js";

import { createFfmpegAudioPreparer } from "../tools/ffmpeg-audio-preparer.js";
import { createBrowserGraphicRenderer } from "../tools/browser-graphic-renderer.js";
import { createUrlMediaAcquirer } from "../tools/url-media-acquirer.js";
import { createPiperTts } from "../tools/piper-tts.js";
import { createElevenLabsTts } from "../tools/elevenlabs-tts.js";

export function createDefaultToolRegistry(options = {}) {
  return new ToolRegistry([
    createFfprobeMediaInspector(options.ffprobe),
    createFfmpegVideoTrimmer(options.ffmpegTrim),
    createFfmpegVideoConcatenator(options.ffmpegConcat),
    createFfmpegVideoReformatter(options.ffmpegReformat),
    createFfmpegVideoThumbnailer(options.ffmpegThumbnail),
    createFfmpegAudioOverlay(options.ffmpegAudioOverlay),
    createFfmpegSubtitleBurner(options.ffmpegSubtitleBurn),
    createFfmpegImageToVideo(options.ffmpegImageToVideo),
    createFfmpegSequenceRenderer(options.ffmpegSequence),
    createFfprobeSource(options.sourceProbe),
    createPyscenedetectScenes(options.sceneDetection),
    createFfmpegSourceFrames(options.sourceFrames),
    createFfmpegAudioAnalysis(options.audioAnalysis),
    createFasterWhisperTranscribe(options.transcription),
    createFfmpegSourcePreview(options.sourcePreview),
    createFfmpegAudioPreparer(options.audioPrepare),
    createBrowserGraphicRenderer(options.graphicRender),
    createUrlMediaAcquirer(options.mediaAcquire),
    createPiperTts(options.piperTts),
    createElevenLabsTts(options.elevenLabsTts)
  ]);
}
