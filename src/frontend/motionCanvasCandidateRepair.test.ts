import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {MotionCanvasCandidateRecord} from '../shared/motionCanvasHistory.ts';
import {motionCanvasReviewerRepair} from './motionCanvasCandidateRepair.ts';

function candidateWithIssues(): MotionCanvasCandidateRecord {
  const selectedSceneIds = [randomUUID(), randomUUID()];
  const outsideSceneId = randomUUID();
  return {
    candidateId: randomUUID(),
    projectId: 'motion-review-repair',
    createdAt: new Date().toISOString(),
    status: 'coherence_blocked',
    decision: 'pending',
    decidedAt: null,
    appliedVersionId: null,
    baseVersionId: randomUUID(),
    parentCandidateId: null,
    rootBaseContentHash: 'a'.repeat(64),
    baseContentHash: 'a'.repeat(64),
    rootBaseContextHash: 'b'.repeat(64),
    baseContextHash: 'b'.repeat(64),
    baseProjectRevision: 1,
    candidateContentHash: 'c'.repeat(64),
    requestFingerprint: 'd'.repeat(64),
    guidance: 'Chỉnh scene cho đúng và rõ hơn.',
    scope: {sceneIds: selectedSceneIds},
    coherence: {
      verdict: 'warning',
      summary: 'Còn lỗi trong scene đã chọn.',
      issues: [
        {
          severity: 'error',
          category: 'voice_visual_alignment',
          message: 'Phép so sánh trong scene chưa đúng.',
          suggestedFix: 'Bổ sung phép so sánh dừng trước khi chèn key.',
          affectedSceneIds: [selectedSceneIds[0]!],
          requiresScopeExpansion: false,
        },
        {
          severity: 'warning',
          category: 'narrative_continuity',
          message: 'Câu kết trong scene bị cụt.',
          suggestedFix: 'Hoàn thiện câu kết theo đúng lời thoại.',
          affectedSceneIds: [selectedSceneIds[1]!],
          requiresScopeExpansion: false,
        },
        {
          severity: 'error',
          category: 'scope',
          message: 'Scene ngoài phạm vi cũng cần thay đổi.',
          suggestedFix: 'Mở rộng sang scene kế tiếp.',
          affectedSceneIds: [outsideSceneId],
          requiresScopeExpansion: true,
        },
      ],
    },
    bundle: {
      status: 'draft',
      contentRevision: 2,
      sourceVoiceVisualContentRevision: 1,
      workspacePath: `motion-canvas/generations/${randomUUID()}`,
      projectFile: 'src/project.ts',
      width: 1080,
      height: 1920,
      fps: 30,
      timingContractVersion: 1,
      scenes: [...selectedSceneIds, outsideSceneId].map((id, index) => {
        const beatId = randomUUID();
        return {
          id,
          outlineSectionId: randomUUID(),
          name: `Scene ${index + 1}`,
          filePath: `src/scenes/0${index + 1}-scene.tsx`,
          durationSeconds: 10,
          timingEvents: [
            {
              beatId,
              startEvent: `beat:${beatId}:start`,
              endEvent: `beat:${beatId}:end`,
              plannedDurationSeconds: 10,
            },
          ],
        };
      }),
      validation: {
        validatedAt: new Date().toISOString(),
        sourceHash: 'e'.repeat(64),
        motionCanvasVersion: '3.17.2',
      },
      generation: {
        generationId: randomUUID(),
        provider: 'codex',
        model: 'test-model',
        promptVersion: 'motion-canvas-test',
        generatedAt: new Date().toISOString(),
        usage: null,
      },
    },
    generation: {
      provider: 'codex',
      model: 'test-model',
      requestedModel: 'test-model',
      reasoningEffort: 'high',
      promptVersion: 'motion-canvas-test',
      generatedAt: new Date().toISOString(),
      generationUsage: null,
      reviewerUsage: null,
    },
  };
}

test('reviewer repair chỉ dùng lại scene đã được người dùng cho phép', () => {
  const candidate = candidateWithIssues();
  const repair = motionCanvasReviewerRepair(candidate);

  assert.deepEqual(repair?.scope.sceneIds, candidate.scope.sceneIds);
  assert.match(repair?.guidance ?? '', /Bổ sung phép so sánh/);
  assert.match(repair?.guidance ?? '', /Hoàn thiện câu kết/);
  assert.doesNotMatch(repair?.guidance ?? '', /Mở rộng sang scene kế tiếp/);
});

test('reviewer repair không tự chạy cho warning hoặc mở rộng scope', () => {
  const warning = candidateWithIssues();
  warning.status = 'coherence_warning';
  assert.equal(motionCanvasReviewerRepair(warning), null);

  const expansion = candidateWithIssues();
  expansion.status = 'scope_expansion_required';
  assert.equal(motionCanvasReviewerRepair(expansion), null);
});
