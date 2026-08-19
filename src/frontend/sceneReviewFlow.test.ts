import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSceneReviewPhase,
  sceneReviewOperationIsBusy,
  sceneReviewOutputIsReady,
  sceneReviewPrimaryAction,
  sceneReviewPhaseHasSynchronizedPreview,
  synchronizedPreviewKey,
} from './sceneReviewFlow.ts';

test('Scene Review phase only exposes synchronized playback for a current Sync', () => {
  const cases = [
    {
      name: 'stale Motion',
      input: {motion: {status: 'draft' as const}, motionStale: true, sync: null, syncStale: false, layoutReady: false},
      phase: 'motion-stale',
      synchronized: false,
    },
    {
      name: 'Motion draft',
      input: {motion: {status: 'draft' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'motion-draft',
      synchronized: false,
    },
    {
      name: 'Motion approved without Sync',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: null, syncStale: false, layoutReady: false},
      phase: 'sync-required',
      synchronized: false,
    },
    {
      name: 'stale Sync',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: true, layoutReady: false},
      phase: 'sync-required',
      synchronized: false,
    },
    {
      name: 'current Sync draft',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'draft' as const}, syncStale: false, layoutReady: false},
      phase: 'sync-draft',
      synchronized: true,
    },
    {
      name: 'approved Sync without Layout',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: false, layoutReady: false},
      phase: 'sync-approved',
      synchronized: true,
    },
    {
      name: 'current Layout',
      input: {motion: {status: 'approved' as const}, motionStale: false, sync: {status: 'approved' as const}, syncStale: false, layoutReady: true},
      phase: 'layout-ready',
      synchronized: true,
    },
  ] as const;

  for (const scenario of cases) {
    const phase = deriveSceneReviewPhase(scenario.input);
    assert.equal(phase, scenario.phase, scenario.name);
    assert.equal(
      sceneReviewPhaseHasSynchronizedPreview(phase),
      scenario.synchronized,
      scenario.name,
    );
  }
});

test('layout reuse requires the selected watermark before navigation', () => {
  const layout = {
    status: 'approved' as const,
    renderSettings: {watermark: {type: 'none' as const}},
  };
  const unchanged = sceneReviewOutputIsReady(layout, true, {type: 'none'});
  const changed = sceneReviewOutputIsReady(layout, true, {
    type: 'text', text: 'PAD', opacity: 0.35, xPercent: 88, yPercent: 92,
    fontSize: 42, color: '#ffffff',
  });

  assert.equal(unchanged, true);
  assert.equal(
    sceneReviewPrimaryAction(deriveSceneReviewPhase({
      motion: {status: 'approved'}, motionStale: false,
      sync: {status: 'approved'}, syncStale: false, layoutReady: unchanged,
    })),
    'navigate-to-render',
  );
  assert.equal(changed, false);
  assert.equal(
    sceneReviewPrimaryAction(deriveSceneReviewPhase({
      motion: {status: 'approved'}, motionStale: false,
      sync: {status: 'approved'}, syncStale: false, layoutReady: changed,
    })),
    'approve-sync-and-prepare-output',
  );
});

test('source-changing scene operations block approval and output', () => {
  const idle = {
    syncing: false, designSaveState: 'saved' as const,
    candidateGenerating: false, candidateRepairing: false,
    candidateApplying: false, candidatePending: false, historyBusy: false,
  };
  assert.equal(sceneReviewOperationIsBusy(idle), false);
  assert.equal(sceneReviewOperationIsBusy({...idle, designSaveState: 'saving'}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, candidatePending: true}), true);
  assert.equal(sceneReviewOperationIsBusy({...idle, historyBusy: true}), true);
});

test('saved visual override revisions create a new Sync preview key', () => {
  const syncGenerationId = '60000000-0000-4000-8000-000000000001';
  const before = synchronizedPreviewKey(syncGenerationId, {
    contentRevision: 1,
    overrides: [],
  });
  const afterRevision = synchronizedPreviewKey(syncGenerationId, {
    contentRevision: 2,
    overrides: [],
  });
  const afterOverride = synchronizedPreviewKey(syncGenerationId, {
    contentRevision: 1,
    overrides: [{sceneId: '30000000-0000-4000-8000-000000000001', nodeKey: 'root', nodeFingerprint: 'a'.repeat(64), patch: {x: 12}}],
  });

  assert.notEqual(before, afterRevision);
  assert.notEqual(before, afterOverride);
});
