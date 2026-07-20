import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {
  createCodexConnectionService,
  StdioCodexAppServerClient,
} from '../src/backend/codexConnection.ts';
import {createElevenLabsConnectionService} from '../src/backend/elevenLabsConnection.ts';
import {createElevenLabsVoiceService} from '../src/backend/elevenLabsVoiceService.ts';
import {createCodexOutlineGenerator} from '../src/backend/outlineGenerator.ts';
import {createDefaultCredentialStore} from '../src/backend/credentialStore.ts';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const credentialStore = createDefaultCredentialStore(repositoryRoot);
const elevenLabsApiKey = async () =>
  (await credentialStore.get('elevenlabs')) ?? process.env.ELEVENLABS_API_KEY;

const allowCodex = process.argv.includes('--allow-codex');
const allowElevenLabs = process.argv.includes('--allow-elevenlabs');
const ambiguousCreditsFlag = process.argv.includes('--allow-credits');
const helpRequested =
  process.argv.includes('--help') || process.argv.includes('-h');

if (helpRequested) {
  console.info(`PAD Studio live integration smoke

Usage:
  npm run smoke:live
  npm run smoke:live -- --allow-codex
  npm run smoke:live -- --allow-elevenlabs

Without an allow flag, the script only verifies Codex and ElevenLabs.
--allow-codex runs one concise outline through the production Codex path.
--allow-elevenlabs creates one short ElevenLabs TTS sample. These flags are
separate so a Codex smoke test can never spend ElevenLabs credits accidentally.
Credentials and generated audio are never printed or written to the repository.`);
  process.exit(0);
}

if (ambiguousCreditsFlag) {
  throw new Error(
    'The ambiguous --allow-credits flag is no longer supported. Use --allow-codex or --allow-elevenlabs explicitly.',
  );
}

function assertConnected(name, status) {
  if (status.state !== 'connected') {
    throw new Error(`${name}: ${status.message ?? `state=${status.state}`}`);
  }
}

function selectVoiceAndModel(catalog) {
  const availableVoices = catalog.voices.filter(
    (voice) => !voice.requiresPaidApiOnFreeTier,
  );

  for (const voice of availableVoices) {
    const model = voice.highQualityBaseModelIds
      .map((modelId) =>
        catalog.models.find(
          (candidate) =>
            candidate.modelId === modelId &&
            candidate.languages.includes('vi'),
        ),
      )
      .find((candidate) => candidate !== undefined);
    if (model) return {voice, model};
  }

  const model =
    catalog.models.find(
      (candidate) =>
        candidate.modelId === 'eleven_v3' &&
        candidate.languages.includes('vi'),
    ) ??
    catalog.models.find((candidate) =>
      candidate.languages.includes('vi'),
    );
  const voice = availableVoices[0];
  if (!voice || !model) {
    throw new Error(
      'ElevenLabs không có cặp voice/model tiếng Việt phù hợp với gói hiện tại.',
    );
  }
  return {voice, model};
}

const codexClient = new StdioCodexAppServerClient();
const codexConnection = createCodexConnectionService(codexClient);

try {
  const [codexStatus, elevenLabsStatus] = await Promise.all([
    codexConnection.verifyConnection(),
    createElevenLabsConnectionService({
      apiKeyProvider: elevenLabsApiKey,
    }).verifyConnection(),
  ]);
  assertConnected('Codex', codexStatus);
  assertConnected('ElevenLabs', elevenLabsStatus);

  console.info(
    `Codex connection: OK (${codexStatus.account.type}${
      codexStatus.account.type === 'chatgpt'
        ? `, ${codexStatus.account.planType}`
        : ''
    })`,
  );
  console.info(
    `ElevenLabs connection: OK (${elevenLabsStatus.subscription.tier}, ` +
      `${elevenLabsStatus.subscription.characterCount}/` +
      `${elevenLabsStatus.subscription.characterLimit} characters)`,
  );

  if (!allowCodex && !allowElevenLabs) {
    console.info(
      'Billable generation skipped. Use an explicit allow flag to test generation.',
    );
  }

  if (allowCodex) {
    const outline = await createCodexOutlineGenerator(codexClient).generate({
      topicInput: {
        topic: 'Ngăn xếp hoạt động như thế nào',
        learningGoal: 'Hiểu trực giác vào sau ra trước.',
        videoDirection: 'Một phép thử integration thật ngắn.',
        audience: 'beginner',
        duration: 'concise',
      },
    });
    if (outline.content.sections.length < 2) {
      throw new Error('Codex trả về outline không đủ section.');
    }
    console.info(
      `Codex structured generation: OK (${outline.model}, ` +
        `${outline.usage?.totalTokens ?? 'unknown'} tokens)`,
    );
  }

  if (allowElevenLabs) {
    const voiceService = createElevenLabsVoiceService({
      apiKeyProvider: elevenLabsApiKey,
    });
    const catalog = await voiceService.getCatalog('');
    const {voice, model} = selectVoiceAndModel(catalog);
    const settings = {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: model.canUseSpeakerBoost,
      speed: 1,
    };
    const resolved = await voiceService.resolveConfiguration({
      voiceId: voice.voiceId,
      modelId: model.modelId,
      outputFormat: 'mp3_44100_128',
      settings,
      seed: null,
    });
    const text = 'Đây là phép thử ngắn của PAD Studio.';
    const voiceSample = await voiceService.generateSection({
      voiceId: resolved.configuration.voiceId,
      modelId: resolved.configuration.modelId,
      outputFormat: resolved.configuration.outputFormat,
      text,
      settings: resolved.configuration.settings,
      seed: resolved.configuration.seed,
      canUseStyle: resolved.model.canUseStyle,
      canUseSpeakerBoost: resolved.model.canUseSpeakerBoost,
    });
    if (
      voiceSample.audio.byteLength < 100 ||
      voiceSample.alignment.characters.length === 0
    ) {
      throw new Error('ElevenLabs trả về audio/alignment rỗng.');
    }
    console.info(
      `ElevenLabs TTS: OK (${resolved.configuration.voiceName}, ` +
        `${resolved.configuration.modelName}, ` +
        `${voiceSample.characterCost} characters)`,
    );
  }
} finally {
  codexConnection.close();
}
