import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSceneReviewPhase,
  sceneReviewOperationIsBusy,
  sceneReviewPrimaryAction,
} from './sceneReviewFlow.ts';

test('Scene Review phase reflects Motion/Sync/Layout readiness', () => {
  const cases = [
    {
      name: 'stale Motion',
      input: {motion: {status: 'draft' as const}, motionStale: true, sync: null, syncStale: false, layoutReady: false},
      phase: 'motion-stale',
      action: 'back-to-production',
    },
    {
      name: 'Motion draft',
      input: {motion: {status: 'draft' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'motion-draft',
      action: 'approve-motion-and-generate-sync',
    },
    {
      name: 'Motion approved without Sync',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'sync-required',
      action: 'approve-motion-and-generate-sync',
    },
    {
      name: 'stale Sync',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: true, layoutReady: false},
      phase: 'sync-required',
      action: 'approve-motion-and-generate-sync',
    },
    {
      name: 'current Sync still draft, must be approved before editing',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'draft' as const}, syncStale: false, layoutReady: false},
      phase: 'sync-draft',
      action: 'approve-motion-and-generate-sync',
    },
    {
      name: 'approved Sync without an approved Layout draft',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: false, layoutReady: false},
      phase: 'editing',
      action: 'approve-layout-and-continue',
    },
    {
      name: 'current Layout ready to render',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: false, layoutReady: true},
      phase: 'layout-ready',
      action: 'navigate-to-render',
    },
  ] as const;

  for (const scenario of cases) {
    const phase = deriveSceneReviewPhase(scenario.input);
    assert.equal(phase, scenario.phase, scenario.name);
    assert.equal(sceneReviewPrimaryAction(phase), scenario.action, scenario.name);
  }
});

test('source-changing scene operations block approval and output', () => {
  const idle = {
    syncing: false, layoutSaveState: 'saved' as const,
    candidateGenerating: false, candidateRepairing: false,
    candidateApplying: false, candidatePending: false, historyBusy: false,
  };
  assert.equal(sceneReviewOperationIsBusy(idle), false);
  assert.equal(sceneReviewOperationIsBusy({...idle, layoutSaveState: 'saving'}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, candidatePending: true}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, historyBusy: true}), true);
});
