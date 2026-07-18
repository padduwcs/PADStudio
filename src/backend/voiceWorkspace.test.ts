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
} from './voiceWorkspace.ts';

test('Voice workspace lưu audio, alignment và timing beat bất biến', async (context) => {
  const projectsDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'pad-studio-voice-workspace-'),
  );
  context.after(() =>
    rm(projectsDirectory, {recursive: true, force: true}),
  );
  const projectId = 'voice-workspace-test';
  const generationId = randomUUID();
  const outlineIds = [randomUUID(), randomUUID()];
  const beatIds = [randomUUID(), randomUUID()];
  const workspace = createVoiceWorkspace(projectsDirectory);
  const sections = outlineIds.map((outlineSectionId, index) => {
    const text = index === 0 ? 'Xin chào.' : 'Bắt đầu nhé.';
    const characters = Array.from(text);
    return {
      outlineSectionId,
      outputFormat: 'mp3_44100_128',
      text,
      beats: [
        {
          beatId: beatIds[index]!,
          textStartIndex: 0,
          textEndIndex: characters.length,
        },
      ],
      generated: {
        audio: Buffer.from(`audio-${index}`),
        alignment: {
          characters,
          characterStartTimesSeconds: characters.map(
            (_character, characterIndex) => characterIndex * 0.1,
          ),
          characterEndTimesSeconds: characters.map(
            (_character, characterIndex) => (characterIndex + 1) * 0.1,
          ),
        },
        normalizedAlignment: null,
        requestId: `request-${index}`,
        characterCost: characters.length,
      },
    };
  });

  const prepared = await workspace.prepare(
    projectId,
    generationId,
    sections,
  );
  assert.equal(prepared.sections.length, 2);
  assert.equal(prepared.sections[0]?.beats[0]?.startSeconds, 0);
  assert.ok((prepared.sections[0]?.beats[0]?.endSeconds ?? 0) > 0);
  assert.equal(prepared.requestIds.length, 2);

  const bundle: VoiceBundle = {
    status: 'draft',
    contentRevision: 1,
    sourceVoiceVisualContentRevision: 1,
    workspacePath: prepared.workspacePath,
    configuration: {
      voiceId: 'voice-test',
      voiceName: 'Giọng thử',
      voiceCategory: 'premade',
      modelId: 'eleven_multilingual_v2',
      modelName: 'Multilingual v2',
      languageCode: 'vi',
      outputFormat: 'mp3_44100_128',
      settings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
        speed: 1,
      },
      seed: null,
    },
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
    outlineIds[0]!,
  );
  assert.equal(audio.contentType, 'audio/mpeg');
  assert.equal(audio.audio.toString(), 'audio-0');

  const alignment = JSON.parse(
    await readFile(
      path.join(
        projectsDirectory,
        projectId,
        prepared.workspacePath,
        prepared.sections[0]!.alignmentPath,
      ),
      'utf8',
    ),
  );
  assert.equal(alignment.text, sections[0]!.text);

  const invalidSections = sections.map((section, index) => ({
    ...section,
    generated: {
      ...section.generated,
      alignment:
        index === 0
          ? {
              ...section.generated.alignment,
              characters: [
                'Y',
                ...section.generated.alignment.characters.slice(1),
              ],
            }
          : section.generated.alignment,
    },
  }));
  await assert.rejects(
    () =>
      workspace.prepare(
        projectId,
        randomUUID(),
        invalidSections,
      ),
    (error) =>
      error instanceof VoiceWorkspaceError &&
      error.code === 'VOICE_ALIGNMENT_INVALID',
  );
});
