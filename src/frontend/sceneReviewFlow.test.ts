import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSceneReviewPhase,
  sceneReviewMutationIsRunning,
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
      name: 'Motion draft is prepared automatically',
      input: {motion: {status: 'draft' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'preparing-sync',
      action: 'wait-for-sync',
    },
    {
      name: 'Motion approved without Sync is prepared automatically',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'preparing-sync',
      action: 'wait-for-sync',
    },
    {
      name: 'stale Sync',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: true, layoutReady: false},
      phase: 'preparing-sync',
      action: 'wait-for-sync',
    },
    {
      name: 'current Sync draft is prepared before editing',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'draft' as const}, syncStale: false, layoutReady: false},
      phase: 'preparing-sync',
      action: 'wait-for-sync',
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
  assert.equal(sceneReviewMutationIsRunning(idle), false);
  assert.equal(sceneReviewOperationIsBusy({...idle, layoutSaveState: 'saving'}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, candidatePending: true}), true);
  assert.equal(sceneReviewMutationIsRunning({...idle, candidatePending: true}), false);
  assert.equal(sceneReviewMutationIsRunning({...idle, candidateGenerating: true}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, historyBusy: true}), true);
});
