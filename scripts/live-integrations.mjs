import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {
  createCodexConnectionService,
  StdioCodexAppServerClient,
} from '../src/backend/codexConnection.ts';
import {createElevenLabsConnectionService} from '../src/backend/elevenLabsConnection.ts';
import {createElevenLabsVoiceService} from '../src/backend/elevenLabsVoiceService.ts';
import {createCodexNarrationDraftGenerator} from '../src/backend/narrationDraftGenerator.ts';
import {createCodexNarrationVisualPlanner} from '../src/backend/narrationVisualPlanner.ts';
import {createCodexMotionCanvasGenerator} from '../src/backend/motionCanvasGenerator.ts';
import {createCodexMotionCanvasRevisionReviewService} from '../src/backend/motionCanvasRevisionReview.ts';
import {createDefaultCredentialStore} from '../src/backend/credentialStore.ts';
import {defaultVideoFrame} from '../src/shared/videoFormat.ts';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const credentialStore = createDefaultCredentialStore(repositoryRoot);
const elevenLabsApiKey = async () =>
  (await credentialStore.get('elevenlabs')) ?? process.env.ELEVENLABS_API_KEY;

const allowCodex = process.argv.includes('--allow-codex');
const allowCodexVisualPlanner = process.argv.includes(
  '--allow-codex-visual-planner',
);
const allowCodexMotionRevision = process.argv.includes(
  '--allow-codex-motion-revision',
);
const allowElevenLabs = process.argv.includes('--allow-elevenlabs');
const ambiguousCreditsFlag = process.argv.includes('--allow-credits');
const helpRequested =
  process.argv.includes('--help') || process.argv.includes('-h');
const smokeCodexModel = process.env.PAD_SMOKE_CODEX_MODEL?.trim() || undefined;
const smokeReasoningEffort =
  process.env.PAD_SMOKE_CODEX_REASONING?.trim() || 'low';

if (helpRequested) {
  console.info(`PAD Studio live integration smoke

Usage:
  npm run smoke:live
  npm run smoke:live -- --allow-codex
  npm run smoke:live -- --allow-codex-visual-planner
  npm run smoke:live -- --allow-codex-motion-revision
  npm run smoke:live -- --allow-elevenlabs

Without an allow flag, the script only verifies Codex and ElevenLabs.
--allow-codex runs one concise narration draft through the production Codex
path (createCodexNarrationDraftGenerator).
--allow-codex-visual-planner runs the AI visual planner over a fixed set of
reviewed narration units (createCodexNarrationVisualPlanner) and checks that
every unit is covered, in order, exactly once.
--allow-codex-motion-revision regenerates one selected scene and reviews the
merged two-scene sequence.
--allow-elevenlabs creates one short ElevenLabs TTS sample. These flags are
separate so a Codex smoke test can never spend ElevenLabs credits accidentally.
Credentials and generated audio are never printed or written to the repository.

Outline and voice-visual-plan revision are no longer separate AI services:
the current pipeline generates a narration draft, the user edits it directly,
then the AI visual planner plans over the approved text once. There is no
scoped-revision Codex path left to smoke-test for either stage.`);
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

function scopedStageFixture() {
  const topicInput = {
    topic: 'Tìm kiếm nhị phân hoạt động như thế nào',
    learningGoal: 'Hiểu trực giác chia đôi vùng tìm kiếm.',
    videoDirection: 'Smoke test ngắn, ưu tiên hình khối thay vì caption.',
    background: {mode: 'dark', color: '#10231D'},
    videoFrame: defaultVideoFrame,
    audience: 'beginner',
    duration: 'concise',
  };
  const sectionIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const beatIds = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const sceneIds = [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ];
  const outline = {
    brief: {
      summary: 'Video ngắn giải thích trực giác tìm kiếm nhị phân.',
      assumptions: ['Danh sách đầu vào đã được sắp xếp.'],
    },
    centralMessage: 'Mỗi phép so sánh loại bỏ một nửa vùng tìm kiếm.',
    sections: [
      {
        id: sectionIds[0],
        title: 'Vì sao tìm lần lượt chậm',
        goal: 'Nhìn thấy chi phí của việc xem từng phần tử.',
        content: 'Một danh sách dài cho thấy cách tìm tuần tự tốn nhiều bước.',
        estimatedSeconds: 40,
      },
      {
        id: sectionIds[1],
        title: 'Chia đôi vùng tìm kiếm',
        goal: 'Hiểu vai trò của phần tử giữa.',
        content: 'So sánh phần tử giữa rồi giữ lại đúng nửa có thể chứa đáp án.',
        estimatedSeconds: 50,
      },
    ],
    status: 'approved',
    contentRevision: 1,
    sourceInput: topicInput,
    generation: {
      generationId: '77777777-7777-4777-8777-777777777777',
      provider: 'codex',
      model: 'smoke-fixture',
      promptVersion: 'outline-v3',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const voiceVisualPlan = {
    voiceDirection: 'Kể gần gũi, rõ ràng và nối hai ý tự nhiên.',
    visualDirection: 'Dùng dãy số, vùng tô sáng xanh và điểm giữa màu cam.',
    timingCalibration: {
      source: 'default',
      whitespaceTokensPerMinute: 195,
      charactersPerSecond: 14.5,
      voiceId: null,
      modelId: null,
      voiceName: null,
      sampleCount: 0,
    },
    sections: [
      {
        outlineSectionId: sectionIds[0],
        beats: [
          {
            id: beatIds[0],
            voiceover:
              'Nếu xem lần lượt, một danh sách dài có thể buộc ta đi qua gần như mọi phần tử.',
            visualDescription:
              'Một dãy số dài trải ngang, con trỏ quét chậm từ trái sang phải.',
            animationDescription:
              'Con trỏ đi từng ô và bộ đếm số lần so sánh tăng dần.',
            visualHoldSeconds: 0,
            durationSeconds: 12,
          },
        ],
      },
      {
        outlineSectionId: sectionIds[1],
        beats: [
          {
            id: beatIds[1],
            voiceover:
              'Với tìm kiếm nhị phân, phần tử giữa giúp loại bỏ ngay một nửa không thể chứa đáp án.',
            visualDescription:
              'Điểm giữa sáng màu cam, một nửa dãy số mờ đi và vùng còn lại co lại.',
            animationDescription:
              'Điểm giữa bật sáng, nửa sai mờ dần rồi hai biên khép vào vùng đúng.',
            visualHoldSeconds: 0,
            durationSeconds: 12,
          },
        ],
      },
    ],
    status: 'approved',
    contentRevision: 1,
    narrationRevision: 1,
    sourceOutlineContentRevision: 1,
    generation: {
      generationId: '88888888-8888-4888-8888-888888888888',
      provider: 'codex',
      model: 'smoke-fixture',
      promptVersion: 'voice-visual-v3',
      generatedAt: new Date().toISOString(),
      usage: null,
    },
  };
  const sceneSource = (beatId, label) => `import {makeScene2D, Rect, Txt} from '@motion-canvas/2d';
import {createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const card = createRef<Rect>();
  view.add(<Rect key="scene-background" width={1080} height={1920} fill={'#10231D'}><Rect key="concept-card" ref={card} width={760} height={360} fill={'#51B68E'}><Txt key="concept-label" text={${JSON.stringify(label)}} fill={'#10231D'} fontSize={52} /></Rect></Rect>);
  yield* waitUntil('beat:${beatId}:start');
  const duration = useDuration('beat:${beatId}:end');
  const endTime = useThread().time() + duration;
  yield* card().scale(1.08, Math.min(0.5, duration * 0.2));
  yield* waitFor(Math.max(0, endTime - useThread().time()));
});
`;
  const currentScenes = sectionIds.map((outlineSectionId, index) => ({
    id: sceneIds[index],
    outlineSectionId,
    name: `Scene smoke ${index + 1}`,
    filePath: `src/scenes/0${index + 1}-smoke-scene-${index + 1}.tsx`,
    durationSeconds: 12,
    timingEvents: [
      {
        beatId: beatIds[index],
        startEvent: `beat:${beatIds[index]}:start`,
        endEvent: `beat:${beatIds[index]}:end`,
        plannedDurationSeconds: 12,
      },
    ],
    source: sceneSource(beatIds[index], `Ý ${index + 1}`),
  }));
  return {topicInput, outline, voiceVisualPlan, currentScenes};
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

  if (
    !allowCodex &&
    !allowCodexVisualPlanner &&
    !allowCodexMotionRevision &&
    !allowElevenLabs
  ) {
    console.info(
      'Billable generation skipped. Use an explicit allow flag to test generation.',
    );
  }

  if (allowCodex) {
    const result = await createCodexNarrationDraftGenerator(
      codexClient,
    ).generate({
      topicInput: {
        topic: 'Ngăn xếp hoạt động như thế nào',
        learningGoal: 'Hiểu trực giác vào sau ra trước.',
        videoDirection: 'Một phép thử integration thật ngắn.',
        background: {mode: 'dark', color: '#10231D'},
        videoFrame: defaultVideoFrame,
        audience: 'beginner',
        duration: 'concise',
      },
    });
    if (result.draft.text.trim().length < 40) {
      throw new Error('Codex trả về lời thoại quá ngắn.');
    }
    console.info(
      `Codex narration draft generation: OK (${result.model}, ` +
        `${result.usage?.totalTokens ?? 'unknown'} tokens)`,
    );
  }

  if (allowCodexVisualPlanner) {
    const fixture = scopedStageFixture();
    const units = fixture.voiceVisualPlan.sections.flatMap((section) =>
      section.beats.map((beat) => beat.voiceover),
    ).map((text, index) => ({id: `unit-${index + 1}`, text}));
    const planned = await createCodexNarrationVisualPlanner(
      codexClient,
    ).plan({
      topicInput: fixture.topicInput,
      units,
      model: smokeCodexModel,
      reasoningEffort: smokeReasoningEffort,
    });
    const actualUnitIds = planned.output.scenes.flatMap((scene) =>
      scene.units.map((unit) => unit.unitId),
    );
    const expectedUnitIds = units.map((unit) => unit.id);
    if (
      actualUnitIds.length !== expectedUnitIds.length ||
      actualUnitIds.some((id, index) => id !== expectedUnitIds[index])
    ) {
      throw new Error(
        'AI visual planner đã bỏ sót, lặp lại hoặc đổi thứ tự unit đã duyệt.',
      );
    }
    console.info(
      `Codex visual planner: OK (${planned.model}, ` +
        `${planned.usage?.totalTokens ?? 'unknown'} tokens, ` +
        `${planned.output.scenes.length} scene)`,
    );
  }

  if (allowCodexMotionRevision) {
    const fixture = scopedStageFixture();
    const smokeProjectId = randomUUID();
    const generator = createCodexMotionCanvasGenerator(codexClient, {
      concurrency: 1,
    });
    const generated = await generator.generate({
      projectId: smokeProjectId,
      generationId: '99999999-9999-4999-8999-999999999999',
      topicInput: fixture.topicInput,
      outline: fixture.outline,
      voiceVisualPlan: fixture.voiceVisualPlan,
      currentScenes: fixture.currentScenes,
      sectionIndexes: [0],
      guidance:
        'Làm cảnh quét tuần tự trực quan hơn nhưng giữ palette và chuyển tiếp tự nhiên sang cảnh chia đôi.',
      model: smokeCodexModel,
      reasoningEffort: smokeReasoningEffort,
    });
    if (
      generated.scenes.length !== 1 ||
      generated.scenes[0].id !== fixture.currentScenes[0].id ||
      generated.scenes[0].filePath !== fixture.currentScenes[0].filePath
    ) {
      throw new Error('Scoped Motion generation không giữ đúng scene identity.');
    }
    const mergedScenes = [generated.scenes[0], fixture.currentScenes[1]];
    const review = await createCodexMotionCanvasRevisionReviewService(
      codexClient,
    ).review({
      topicInput: fixture.topicInput,
      outline: fixture.outline,
      voiceVisualPlan: fixture.voiceVisualPlan,
      scope: {sceneIds: [fixture.currentScenes[0].id]},
      guidance:
        'Làm cảnh quét tuần tự trực quan hơn nhưng giữ palette và chuyển tiếp tự nhiên sang cảnh chia đôi.',
      scenes: mergedScenes.map((scene, index) => ({
        sceneId: scene.id,
        outlineSectionId: scene.outlineSectionId,
        name: scene.name,
        changed: index === 0,
        sourceExcerpt: scene.source,
      })),
      model: smokeCodexModel,
      reasoningEffort: smokeReasoningEffort,
    });
    console.info(
      `Codex scoped Motion revision: OK (${generated.model}, ` +
        `${(generated.usage?.totalTokens ?? 0) +
          (review.usage?.totalTokens ?? 0)} tokens, ` +
        `coherence=${review.coherence.verdict})`,
    );
    generator.discardGeneration?.(
      smokeProjectId,
      '99999999-9999-4999-8999-999999999999',
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
