import assert from 'node:assert/strict';
import test from 'node:test';
import {median, preferredNarrationCalibration} from './appRouteSupport.ts';
import type {ProjectRepository} from './projectRepository.ts';
import type {TopicProject} from '../shared/topic.ts';

function fakeVoiceBundle(overrides: {
  voiceId: string;
  modelId: string;
  speed: number;
  voiceName: string;
  generatedAt: string;
  whitespaceTokensPerMinute: number;
  charactersPerSecond: number;
}) {
  return {
    configuration: {
      voiceId: overrides.voiceId,
      modelId: overrides.modelId,
      voiceName: overrides.voiceName,
      settings: {speed: overrides.speed},
    },
    generation: {generatedAt: overrides.generatedAt},
    track: {
      calibration: {
        whitespaceTokensPerMinute: overrides.whitespaceTokensPerMinute,
        charactersPerSecond: overrides.charactersPerSecond,
      },
    },
  };
}

function fakeRepository(voiceBundles: Array<ReturnType<typeof fakeVoiceBundle> | null>): ProjectRepository {
  const projects = voiceBundles.map(voiceBundle => ({voiceBundle}) as unknown as TopicProject);
  return {
    async listProjects() { return {projects, issues: []}; },
    async createTopicProject() { throw new Error('not used'); },
    async getProject() { throw new Error('not used'); },
    async updateProject() { throw new Error('not used'); },
    async deleteProject() { throw new Error('not used'); },
  };
}

test('median computes midpoint for even and odd length arrays', () => {
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([7]), 7);
});

test('preferredNarrationCalibration trả về undefined khi chưa có voice bundle nào', async () => {
  const repository = fakeRepository([null, null]);
  const calibration = await preferredNarrationCalibration(repository);
  assert.equal(calibration, undefined);
});

test('preferredNarrationCalibration lấy median của các bundle cùng voice/model/speed với bundle mới nhất', async () => {
  const repository = fakeRepository([
    fakeVoiceBundle({voiceId: 'voice-a', modelId: 'model-a', speed: 1, voiceName: 'Voice A', generatedAt: '2026-01-01T00:00:00.000Z', whitespaceTokensPerMinute: 200, charactersPerSecond: 14}),
    fakeVoiceBundle({voiceId: 'voice-a', modelId: 'model-a', speed: 1, voiceName: 'Voice A', generatedAt: '2026-01-03T00:00:00.000Z', whitespaceTokensPerMinute: 240, charactersPerSecond: 18}),
    // Different voice/model/speed: must be excluded from the matching group.
    fakeVoiceBundle({voiceId: 'voice-b', modelId: 'model-b', speed: 1.2, voiceName: 'Voice B', generatedAt: '2026-01-02T00:00:00.000Z', whitespaceTokensPerMinute: 400, charactersPerSecond: 40}),
  ]);

  const calibration = await preferredNarrationCalibration(repository);
  assert.ok(calibration);
  // The most recently generated bundle overall is voice-a (2026-01-03), so
  // its voice/model/speed anchors the matching group; voice-b is excluded
  // even though it is chronologically between the two voice-a bundles.
  assert.equal(calibration!.source, 'voice-history');
  assert.equal(calibration!.voiceId, 'voice-a');
  assert.equal(calibration!.modelId, 'model-a');
  assert.equal(calibration!.sampleCount, 2);
  assert.equal(calibration!.whitespaceTokensPerMinute, median([200, 240]));
  assert.equal(calibration!.charactersPerSecond, median([14, 18]));
});
