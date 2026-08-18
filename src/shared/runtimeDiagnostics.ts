import type {CodexConnectionStatus} from './codex.ts';
import type {ElevenLabsConnectionStatus} from './elevenLabs.ts';

export type RuntimeToolDiagnostic = {
  available: boolean;
  message: string;
  executablePath?: string;
};

export type RuntimeDiagnostics = {
  checkedAt: string;
  tools: {
    ffmpeg: RuntimeToolDiagnostic;
    ffprobe: RuntimeToolDiagnostic;
    browser: RuntimeToolDiagnostic;
  };
  providers: {
    codex: CodexConnectionStatus;
    elevenLabs: ElevenLabsConnectionStatus;
  };
};
