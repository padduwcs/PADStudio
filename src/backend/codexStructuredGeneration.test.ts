import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codexGenerationTimeoutMs,
  DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
  strictCodexOutputSchema,
} from './codexStructuredGeneration.ts';

test('schema structured output luôn strict ở mọi object lồng nhau', () => {
  const source = {
    type: 'object',
    properties: {
      beats: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            voiceover: {type: 'string'},
            spokenVoiceover: {
              anyOf: [{type: 'string'}, {type: 'null'}],
            },
          },
          required: ['voiceover'],
        },
      },
    },
    required: [],
  };

  const normalized = strictCodexOutputSchema(source) as typeof source & {
    additionalProperties: boolean;
  };
  const beatSchema = normalized.properties.beats.items as typeof source.properties.beats.items & {
    additionalProperties: boolean;
  };

  assert.deepEqual(normalized.required, ['beats']);
  assert.equal(normalized.additionalProperties, false);
  assert.deepEqual(beatSchema.required, [
    'voiceover',
    'spokenVoiceover',
  ]);
  assert.equal(beatSchema.additionalProperties, false);
  assert.deepEqual(source.required, []);
  assert.deepEqual(source.properties.beats.items.required, ['voiceover']);
});

test('timeout Codex tăng theo mức reasoning cao', {
  skip: Boolean(process.env.PAD_CODEX_GENERATION_TIMEOUT_MS?.trim()),
}, () => {
  const low = codexGenerationTimeoutMs('low');
  const medium = codexGenerationTimeoutMs('medium');
  const high = codexGenerationTimeoutMs('high');
  const ultra = codexGenerationTimeoutMs('ultra');
  const futureEffort = codexGenerationTimeoutMs('future-level');

  assert.ok(low >= DEFAULT_CODEX_GENERATION_TIMEOUT_MS);
  assert.ok(medium >= low);
  assert.ok(high > medium);
  assert.ok(ultra > high);
  assert.ok(futureEffort >= high);
  assert.ok(ultra <= 120 * 60 * 1000);
});
