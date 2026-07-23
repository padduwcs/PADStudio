import type {
  MotionCanvasCandidateRecord,
  MotionCanvasEditScope,
} from '../shared/motionCanvasHistory.ts';

export interface MotionCanvasReviewerRepair {
  guidance: string;
  scope: MotionCanvasEditScope;
}

/**
 * Builds one bounded follow-up pass for semantic errors that the reviewer
 * found inside the scope the user already authorized. Issues outside that
 * scope still require an explicit scope expansion.
 */
export function motionCanvasReviewerRepair(
  candidate: MotionCanvasCandidateRecord,
): MotionCanvasReviewerRepair | null {
  if (
    candidate.decision !== 'pending' ||
    candidate.status !== 'coherence_blocked'
  ) {
    return null;
  }

  const authorizedSceneIds = new Set(candidate.scope.sceneIds);
  const fixableIssues = candidate.coherence.issues.filter(
    issue =>
      !issue.requiresScopeExpansion &&
      issue.affectedSceneIds.some(sceneId =>
        authorizedSceneIds.has(sceneId),
      ),
  );
  if (!fixableIssues.some(issue => issue.severity === 'error')) return null;

  const affectedSceneIds = new Set(
    fixableIssues.flatMap(issue =>
      issue.affectedSceneIds.filter(sceneId =>
        authorizedSceneIds.has(sceneId),
      ),
    ),
  );
  const orderedSceneIds = candidate.bundle.scenes
    .map(scene => scene.id)
    .filter(sceneId => affectedSceneIds.has(sceneId));
  if (orderedSceneIds.length === 0) return null;

  const fixes = fixableIssues
    .map(issue => issue.suggestedFix.trim())
    .filter(Boolean);
  return {
    scope: {sceneIds: orderedSceneIds},
    guidance: [
      'Tiếp tục từ candidate hiện tại. Giữ nguyên mọi phần đã đúng và chỉ sửa các lỗi reviewer phát hiện trong phạm vi scene đã được cho phép.',
      ...new Set(fixes),
      'Sau khi sửa, tự kiểm tra lại tính đúng đắn, câu chữ, timing và sự nối mạch trước khi trả source.',
    ].join('\n'),
  };
}
