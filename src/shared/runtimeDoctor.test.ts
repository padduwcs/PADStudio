import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDoctorReport,
  parseVersion,
  versionAtLeast,
} from '../../scripts/doctor.mjs';

test('runtime doctor parses and compares Node versions', () => {
  assert.deepEqual(parseVersion('v24.12.0'), [24, 12, 0]);
  assert.equal(parseVersion('unknown'), null);
  assert.equal(versionAtLeast([24, 12, 0]), true);
  assert.equal(versionAtLeast([24, 11, 99]), false);
});

test('runtime doctor separates required runtime from optional credentials', () => {
  const report = createDoctorReport({
    nodeVersion: 'v24.12.0',
    environment: {PAD_RENDER_BROWSER_PATH: 'missing-browser'},
    repositoryRoot: 'missing-runtime-root',
    probe: () => ({available: false, detail: 'missing'}),
    isAccessible: () => false,
    storedCredentialConfigured: false,
  });
  assert.equal(report.requiredUnavailable.length, 5);
  assert.equal(
    report.items.find(item => item.name === 'ElevenLabs credential')?.state,
    'not configured',
  );
});

test('runtime doctor reports a protected credential without reading its value', () => {
  const report = createDoctorReport({
    environment: {},
    storedCredentialConfigured: true,
    probe: () => ({available: true}),
    isAccessible: () => true,
  });
  const credential = report.items.find(
    item => item.name === 'ElevenLabs credential',
  );
  assert.equal(credential?.state, 'configured');
  assert.equal(credential?.detail, 'protected local store');
});
