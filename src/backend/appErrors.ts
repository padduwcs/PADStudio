import type {ServerResponse} from 'node:http';
import type {ApiErrorPayload} from '../shared/topic.ts';
import {AnimationSyncPreviewError} from './animationSyncPreviewService.ts';
import {AnimationSyncWorkspaceError} from './animationSyncWorkspace.ts';
import {CodexConnectionError} from './codexConnection.ts';
import {ElevenLabsVoiceError} from './elevenLabsVoiceService.ts';
import {FinalRenderError} from './finalRenderService.ts';
import {sendJson} from './httpTransport.ts';
import {LayoutPreviewError} from './layoutPreviewService.ts';
import {LayoutWorkspaceError} from './layoutWorkspace.ts';
import {MotionCanvasGenerationError} from './motionCanvasGenerator.ts';
import {MotionCanvasHistoryStoreError} from './motionCanvasHistoryStore.ts';
import {MotionCanvasRevisionReviewError} from './motionCanvasRevisionReview.ts';
import {MotionCanvasWorkspaceError} from './motionCanvasWorkspace.ts';
import {NarrationDraftGenerationError} from './narrationDraftGenerator.ts';
import {ProjectConflictError, ProjectDataError} from './projectRepository.ts';
import {VoiceWorkspaceError} from './voiceWorkspace.ts';
import {WatermarkAssetError} from './watermarkAssetStore.ts';
export class RequestBodyError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sendApiError(
  response: ServerResponse,
  statusCode: number,
  error: ApiErrorPayload['error'],
) {
  sendJson(response, statusCode, {error} satisfies ApiErrorPayload);
}



export function handleAppError(error: unknown, response: ServerResponse, logger: Pick<Console, 'error' | 'info'>): boolean {
  if (error instanceof RequestBodyError) {
    sendApiError(response, error.statusCode, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof ProjectConflictError) {
    sendApiError(response, 409, {
      code: 'PROJECT_CONFLICT',
      message:
        'Project vừa được thay đổi ở nơi khác. Hãy kiểm tra dữ liệu mới trước khi thử lại.',
      currentProject: error.currentProject,
    });
    return true;
  }

  if (error instanceof ProjectDataError) {
    sendApiError(response, 422, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof CodexConnectionError) {
    sendApiError(response, 503, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof NarrationDraftGenerationError) {
    sendApiError(response, 503, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof MotionCanvasGenerationError) {
    sendApiError(response, 503, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof MotionCanvasRevisionReviewError) {
    sendApiError(
      response,
      error.code === 'CODEX_MOTION_CANVAS_COHERENCE_INVALID_RESPONSE'
        ? 422
        : 503,
      {code: error.code, message: error.message},
    );
    return true;
  }

  if (error instanceof MotionCanvasHistoryStoreError) {
    const conflictCodes = new Set([
      'MOTION_CANVAS_CANDIDATE_ID_REUSED',
      'MOTION_CANVAS_CANDIDATE_ALREADY_DECIDED',
      'MOTION_CANVAS_HISTORY_IMMUTABLE_CONFLICT',
    ]);
    sendApiError(
      response,
      error.code === 'MOTION_CANVAS_CANDIDATE_NOT_FOUND'
        ? 404
        : conflictCodes.has(error.code)
          ? 409
          : 422,
      {code: error.code, message: error.message},
    );
    return true;
  }

  if (error instanceof MotionCanvasWorkspaceError) {
    sendApiError(
      response,
      error.code === 'MOTION_CANVAS_WORKSPACE_CONFLICT'
        ? 409
        : error.code === 'MOTION_CANVAS_VALIDATION_FAILED'
          ? 422
          : 500,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof ElevenLabsVoiceError) {
    sendApiError(response, error.statusCode, {
      code: error.code,
      message: error.message,
    });
    return true;
  }

  if (error instanceof VoiceWorkspaceError) {
    sendApiError(
      response,
      error.code === 'VOICE_WORKSPACE_CONFLICT' ||
        error.code === 'VOICE_GENERATION_CHECKPOINT_CONFLICT'
        ? 409
        : error.code === 'VOICE_ALIGNMENT_INVALID'
          ? 422
          : error.code === 'VOICE_AUDIO_NOT_FOUND'
            ? 404
            : error.code === 'FFMPEG_NOT_AVAILABLE' ||
              error.code === 'FFPROBE_NOT_AVAILABLE'
              ? 503
              : 500,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof AnimationSyncWorkspaceError) {
    sendApiError(
      response,
      error.code === 'ANIMATION_SYNC_WORKSPACE_CONFLICT' ||
        error.code === 'ANIMATION_SYNC_TIMING_CONTRACT_REQUIRED' ||
        error.code === 'ANIMATION_SYNC_SOURCE_MISMATCH'
        ? 409
        : error.code === 'ANIMATION_SYNC_VALIDATION_FAILED' ||
          error.code === 'ANIMATION_SYNC_AUDIO_INVALID' ||
          error.code === 'ANIMATION_SYNC_AUDIO_DURATION_MISMATCH'
          ? 422
          : error.code === 'FFMPEG_NOT_AVAILABLE'
            ? 503
            : 500,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof AnimationSyncPreviewError) {
    sendApiError(
      response,
      error.code === 'ANIMATION_SYNC_PREVIEW_INVALID'
        ? 422
        : 503,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof LayoutWorkspaceError) {
    const conflictCodes = new Set([
      'LAYOUT_WORKSPACE_CONFLICT',
      'LAYOUT_SOURCE_NOT_APPROVED',
      'LAYOUT_SOURCE_MANIFEST_MISMATCH',
      'LAYOUT_MANIFEST_SOURCE_MISMATCH',
      'LAYOUT_OVERRIDE_TARGET_MISMATCH',
      'LAYOUT_OVERRIDE_PROPERTY_LOCKED',
    ]);
    const validationCodes = new Set([
      'LAYOUT_WORKSPACE_INVALID',
      'LAYOUT_SOURCE_INVALID',
      'LAYOUT_MANIFEST_INVALID',
      'LAYOUT_OVERRIDES_INVALID',
    ]);
    sendApiError(
      response,
      conflictCodes.has(error.code)
        ? 409
        : validationCodes.has(error.code)
          ? 422
          : 500,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof LayoutPreviewError) {
    const conflictCodes = new Set([
      'LAYOUT_PREVIEW_SOURCE_NOT_APPROVED',
      'LAYOUT_PREVIEW_SOURCE_MISMATCH',
      'LAYOUT_PREVIEW_LAYOUT_STALE',
      'LAYOUT_PREVIEW_SESSION_MISMATCH',
      'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
      'LAYOUT_PREVIEW_MANIFEST_CHANGED',
      'LAYOUT_PREVIEW_MANIFEST_SOURCE_MISMATCH',
    ]);
    const validationCodes = new Set([
      'LAYOUT_PREVIEW_INVALID',
      'LAYOUT_PREVIEW_PARENT_ORIGIN_INVALID',
      'LAYOUT_PREVIEW_MANIFEST_INVALID',
      'LAYOUT_PREVIEW_MANIFEST_TOO_LARGE',
    ]);
    sendApiError(
      response,
      conflictCodes.has(error.code)
        ? 409
        : validationCodes.has(error.code)
          ? 422
          : 503,
      {
        code: error.code,
        message: error.message,
      },
    );
    return true;
  }

  if (error instanceof WatermarkAssetError) {
    sendApiError(
      response,
      error.code === 'WATERMARK_ASSET_NOT_FOUND' ? 404 : 422,
      {code: error.code, message: error.message},
    );
    return true;
  }

  if (error instanceof FinalRenderError) {
    const conflictCodes = new Set([
      'FINAL_RENDER_SOURCE_INVALID',
      'FINAL_RENDER_GENERATION_CONFLICT',
      'FINAL_RENDER_FRAME_COUNT_MISMATCH',
      'FINAL_RENDER_DURATION_MISMATCH',
    ]);
    const validationCodes = new Set([
      'FINAL_RENDER_INVALID',
      'FINAL_RENDER_FRAME_TOO_LARGE',
      'FINAL_RENDER_FRAME_SEQUENCE_INVALID',
    ]);
    sendApiError(
      response,
      error.code === 'FINAL_RENDER_VIDEO_MISSING'
        ? 404
        : conflictCodes.has(error.code)
          ? 409
          : validationCodes.has(error.code)
            ? 422
            : 503,
      {code: error.code, message: error.message},
    );
    return true;
  }

  logger.error(error);
  sendApiError(response, 500, {
    code: 'INTERNAL_ERROR',
    message: 'Không thể lưu dự án lúc này. Hãy thử lại.',
  });
  return true;
}


