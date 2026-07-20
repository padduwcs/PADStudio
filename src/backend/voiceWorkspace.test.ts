import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {VoiceBundle} from '../shared/topic.ts';
import {
  createVoiceWorkspace,
  VoiceWorkspaceError,
  type GeneratedVoiceNarration,
} from './voiceWorkspace.ts';

function rawPcm(durationSeconds: number, sampleRate = 44_100) {
  return Buffer.alloc(Math.ceil(durationSeconds * sampleRate) * 2);
}

function narrationFixture(audioTailSeconds = 0): GeneratedVoiceNarration {
  const firstText = 'Xin chào.';
  const secondText = 'Bắt đầu nhé.';
  const text = `${firstText}\n\n${secondText}`;
  const characters = Array.from(text);
  const firstLength = Array.from(firstText).length;
  const secondStart = firstLength + 2;
  const durationSeconds = characters.length * 0.05;
  return {
    text,
    sections: [
      {
        outlineSectionId: randomUUID(),
        textStartIndex: 0,
        textEndIndex: firstLength,
        beats: [
          {
            beatId: randomUUID(),
            textStartIndex: 0,
            textEndIndex: firstLength,
          },
        ],
      },
      {
        outlineSectionId: randomUUID(),
        textStartIndex: secondStart,
        textEndIndex: characters.length,
        beats: [
          {
            beatId: randomUUID(),
            textStartIndex: secondStart,
            textEndIndex: characters.length,
          },
        ],
      },
    ],
    chunks: [
      {
        outputFormat: 'pcm_44100',
        text,
        textStartIndex: 0,
        textEndIndex: characters.length,
        generated: {
          audio: rawPcm(durationSeconds + audioTailSeconds),
          alignment: {
            characters,
            characterStartTimesSeconds: characters.map(
              (_character, index) => index * 0.05,
            ),
            characterEndTimesSeconds: characters.map(
              (_character, index) => (index + 1) * 0.05,
            ),
          },
          normalizedAlignment: null,
          requestId: 'request-master',
          characterCost: characters.length,
        },
      },
    ],
  };
}

test('Voice workspace lưu master narration, alignment global và timing section bất biến', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-voice-workspace-'),
  );
  context.after(() =>
    rm(projectsDirectory, {recursive: true, force: true}),
  );
  const projectId = 'voice-workspace-test';
  const generationId = randomUUID();
  const workspace = createVoiceWorkspace(projectsDirectory);
  const narration = narrationFixture();

  const prepared = await workspace.prepare(
    projectId,
    generationId,
    narration,
  );
  assert.equal(prepared.sections.length, 2);
  assert.equal(prepared.track.strategy, 'single-request');
  assert.equal(prepared.track.chunkCount, 1);
  assert.equal(prepared.sections[0]?.startSeconds, 0);
  assert.equal(
    prepared.sections[0]?.endSeconds,
    prepared.sections[1]?.startSeconds,
  );
  assert.equal(prepared.sections[1]?.endSeconds, prepared.totalDurationSeconds);
  assert.equal(prepared.requestIds[0], 'request-master');
  assert.ok(prepared.track.calibration.whitespaceTokensPerMinute > 0);

  const bundle: VoiceBundle = {
    status: 'draft',
    contentRevision: 1,
    sourceNarrationRevision: 1,
    workspacePath: prepared.workspacePath,
    configuration: {
      voiceId: 'voice-test',
      voiceName: 'Giọng thử',
      voiceCategory: 'premade',
      modelId: 'eleven_multilingual_v2',
      modelName: 'Multilingual v2',
      languageCode: 'vi',
      outputFormat: 'pcm_44100',
      settings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
        speed: 1,
      },
      seed: null,
    },
    track: prepared.track,
    sections: prepared.sections,
    totalDurationSeconds: prepared.totalDurationSeconds,
    generation: {
      generationId,
      provider: 'elevenlabs',
      generatedAt: new Date().toISOString(),
      characterCost: prepared.characterCost,
      requestIds: prepared.requestIds,
    },
  };
  const audio = await workspace.readAudio(
    projectId,
    bundle,
    narration.sections[0]!.outlineSectionId,
  );
  assert.equal(audio.contentType, 'audio/wav');
  assert.equal(audio.audio.toString('ascii', 0, 4), 'RIFF');

  const alignment = JSON.parse(
    await readFile(
      path.join(
        projectsDirectory,
        projectId,
        prepared.workspacePath,
        prepared.track.alignmentPath,
      ),
      'utf8',
    ),
  );
  assert.equal(alignment.text, narration.text);
  assert.equal(alignment.sections.length, 2);

  const invalidNarration = narrationFixture();
  invalidNarration.chunks[0]!.generated.alignment.characters[0] = 'Y';
  await assert.rejects(
    () =>
      workspace.prepare(
        projectId,
        randomUUID(),
        invalidNarration,
      ),
    (error) =>
      error instanceof VoiceWorkspaceError &&
      error.code === 'VOICE_ALIGNMENT_INVALID',
  );
});

test('Voice workspace keeps audio after the final character timestamp', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-voice-tail-'),
  );
  context.after(() =>
    rm(projectsDirectory, {recursive: true, force: true}),
  );
  const narration = narrationFixture(0.8);
  const alignmentDuration =
    narration.chunks[0]!.generated.alignment.characterEndTimesSeconds.at(-1)!;
  const prepared = await createVoiceWorkspace(projectsDirectory).prepare(
    'voice-tail-test',
    randomUUID(),
    narration,
  );

  assert.ok(prepared.totalDurationSeconds > alignmentDuration + 0.75);
  assert.equal(
    prepared.sections.at(-1)?.endSeconds,
    prepared.totalDurationSeconds,
  );
  assert.equal(
    prepared.sections.at(-1)?.beats.at(-1)?.endSeconds,
    prepared.sections.at(-1)?.durationSeconds,
  );
  assert.equal(prepared.track.durationSeconds, prepared.totalDurationSeconds);
});
