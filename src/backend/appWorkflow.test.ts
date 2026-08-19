import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AnimationSyncBundleSchema,
  LayoutBundleSchema,
  MotionCanvasBundleSchema,
  type TopicProject,
  TopicProjectSchema,
  VoiceBundleSchema,
} from '../shared/topic.ts';
import {FinalRenderBundleSchema} from '../shared/render.ts';
import {defaultLayoutRenderSettings, LayoutEditorManifestSchema} from '../shared/layout.ts';
import {hashJson} from './motionCanvasHistoryStore.ts';
import type {GeneratedVoiceNarration} from './voiceWorkspace.ts';
import {closePadStudioServerServices, createPadStudioServer} from './app.ts';

const now = '2026-08-18T00:00:00.000Z';
const digest = (value: unknown) => hashJson(value);
const textHash = (value: string) => createHash('sha256').update(value).digest('hex');
const topicInput = {
  topic: 'Tìm kiếm nhị phân',
  background: {mode: 'dark' as const, color: '#10231D'},
  videoFrame: {aspectRatio: 'portrait' as const, width: 1080, height: 1920, fps: 30 as const},
  audience: 'beginner' as const,
  duration: 'standard' as const,
};
const narrationSourceText = 'Tìm kiếm nhị phân liên tục thu hẹp khoảng tìm kiếm đã được sắp xếp để tìm đúng đáp án nhanh hơn.';

type ProjectReply = {project: TopicProject};

function fakeDependencies(root: string) {
  let ttsCalls = 0;
  let motionCalls = 0;
  let currentRender: ReturnType<typeof FinalRenderBundleSchema.parse> | null = null;
  let renderGeneration: string | null = null;
  const videoPath = path.join(root, 'fake-render.mp4');
  const nodeFingerprint = digest('fake-layout-node');
  const manifests = new Map<string, ReturnType<typeof LayoutEditorManifestSchema.parse>>();
  const motionCanvasRequests: Array<{model?: string; reasoningEffort?: string}> = [];
  const plannerRequests: Array<{model?: string; reasoningEffort?: string}> = [];

  const motionCanvasGenerator = {
    async generate(request: {
      generationId: string;
      model?: string;
      reasoningEffort?: string;
      voiceVisualPlan: TopicProject['voiceVisualPlan'];
      sectionIndexes?: number[];
    }) {
      motionCalls += 1;
      motionCanvasRequests.push({model: request.model, reasoningEffort: request.reasoningEffort});
      const plan = request.voiceVisualPlan!;
      const indexes = request.sectionIndexes ?? plan.sections.map((_section, index) => index);
      return {
        model: 'fake-codex', usage: null,
        scenes: indexes.map(index => {
          const section = plan.sections[index]!;
          return {
            id: randomUUID(), outlineSectionId: section.outlineSectionId,
            name: `Scene ${index + 1}`,
            filePath: `src/scenes/scene-${index + 1}.tsx`,
            durationSeconds: section.beats.length * 4,
            timingEvents: section.beats.map(beat => ({
              beatId: beat.id, startEvent: `beat:${beat.id}:start`, endEvent: `beat:${beat.id}:end`, plannedDurationSeconds: 4,
            })),
            source: "import {makeScene2D} from '@motion-canvas/2d';\n".repeat(5) + `export default makeScene2D(function*(){ yield* 0; }); // ${request.generationId}`,
          };
        }),
      };
    },
    discardGeneration() {},
  };

  const narrationVisualPlanner = {
    async plan(request: {units: Array<{id: string; text: string}>; model?: string; reasoningEffort?: string}) {
      plannerRequests.push({model: request.model, reasoningEffort: request.reasoningEffort});
      return {
        model: 'fake-codex',
        usage: null,
        output: {
          scenes: [{
            title: 'Fake scene',
            goal: 'Giải thích nội dung chính bằng hình ảnh.',
            stateHandoffIncoming: null,
            stateHandoffOutgoing: null,
            units: request.units.map(unit => ({
              unitId: unit.id,
              visualPurpose: 'Biến ý chính của câu thành một quan hệ nhìn thấy được.',
              visualDescription: 'Một sơ đồ trung tâm minh họa quan hệ được nhắc tới.',
              animationDescription: 'Phần tử chính di chuyển vào vị trí rồi giữ hình.',
            })),
          }],
          visualBible: {
            palette: {surface: '#173B31', primary: '#51B68E', accent: '#F5C451', text: '#F7FBF8'},
            typographyScale: {title: 88, label: 42, body: 34},
            shapeLanguage: 'Thẻ bo góc nhất quán, tránh trang trí không mang nghĩa.',
            diagramLanguage: 'Sơ đồ trung tâm với nhãn ngắn và quan hệ rõ ràng.',
            motionTempo: 'Nhịp vừa, mỗi beat một chuyển động có chủ đích.',
            transitionConvention: 'Giữ anchor giữa các scene bằng fade ngắn.',
            visualAnchor: 'Khối trung tâm đại diện chủ đề video.',
          },
        },
      };
    },
  };

  const motionCanvasWorkspace = {
    async prepare(_projectId: string, generationId: string, scenes: Awaited<ReturnType<typeof motionCanvasGenerator.generate>>['scenes']) {
      const result = {
        workspacePath: `motion-canvas/generations/${generationId}`,
        projectFile: 'src/project.ts' as const,
        scenes: scenes.map(({source: _source, ...scene}) => scene),
        validation: {validatedAt: now, sourceHash: digest(scenes.map(scene => scene.source)), motionCanvasVersion: 'fake-motion'},
      };
      return result;
    },
    async readFiles(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      return bundle.scenes.map(scene => ({path: scene.filePath, source: `// ${scene.id}`}));
    },
    async readSceneSources(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      return bundle.scenes.map(scene => ({...scene, source: `// source for ${scene.id}\n`.repeat(20)}));
    },
    async verify(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      return {projectDirectory: root, workspaceDirectory: root, projectFile: path.join(root, bundle.projectFile), sourceHash: bundle.validation.sourceHash};
    },
  };

  const elevenLabsVoiceService = {
    withApiKey() { return elevenLabsVoiceService; },
    async getCatalog() { return {voices: [], models: [], recentPresets: [], history: {available: true, message: null}}; },
    async searchSharedVoices() { return {available: true, message: null, voices: []}; },
    async resolveConfiguration(input: {voiceId: string; modelId: string; outputFormat: string; settings: {stability: number; similarityBoost: number; style: number; useSpeakerBoost: boolean; speed: number}; seed: number | null}) {
      return {configuration: {
        voiceId: input.voiceId, voiceName: 'Fake Vietnamese', voiceCategory: null,
        modelId: input.modelId, modelName: 'Fake model', languageCode: 'vi' as const,
        outputFormat: input.outputFormat, settings: input.settings, seed: input.seed,
      }, model: {modelId: input.modelId, name: 'Fake model', description: null, languages: ['vi'], costMultiplier: 1, canUseStyle: true, canUseSpeakerBoost: true, maximumTextLengthPerRequest: 20_000}};
    },
    async generateSection(input: {text: string}) {
      ttsCalls += 1;
      const characters = Array.from(input.text);
      return {audio: Buffer.from('fake-audio'), alignment: {
        characters, characterStartTimesSeconds: characters.map((_char, index) => index * 0.02), characterEndTimesSeconds: characters.map((_char, index) => (index + 1) * 0.02),
      }, normalizedAlignment: null, requestId: `fake-tts-${ttsCalls}`, characterCost: characters.length};
    },
  };

  const voiceWorkspace = {
    async verifyDependencies() {},
    async prepare(_projectId: string, generationId: string, narration: GeneratedVoiceNarration) {
      let cursor = 0;
      const sections = narration.sections.map(section => {
        const startSeconds = cursor;
        const beats = section.beats.map(beat => {
          const start = cursor;
          cursor += 4;
          return {beatId: beat.beatId, textStartIndex: beat.textStartIndex, textEndIndex: beat.textEndIndex, startSeconds: start, endSeconds: cursor};
        });
        const sectionText = Array.from(narration.text).slice(section.textStartIndex, section.textEndIndex).join('');
        return {outlineSectionId: section.outlineSectionId, textStartIndex: section.textStartIndex, textEndIndex: section.textEndIndex, startSeconds, endSeconds: cursor, durationSeconds: cursor - startSeconds, sourceTextHash: textHash(sectionText), beats};
      });
      const prepared = {
        workspacePath: `voice/generations/${generationId}`,
        track: {audioPath: 'audio/narration.wav' as const, alignmentPath: 'alignments/narration.json' as const, sourceTextHash: textHash(narration.text), durationSeconds: cursor, characterCost: narration.text.length, strategy: 'single-request' as const, chunkCount: narration.chunks.length, calibration: {whitespaceTokenCount: 10, characterCount: narration.text.length, whitespaceTokensPerMinute: 120, charactersPerSecond: 12}},
        sections, totalDurationSeconds: cursor, characterCost: narration.text.length, requestIds: narration.chunks.map((_chunk, index) => `fake-tts-${index + 1}`),
      };
      const {characterCost, requestIds, ...bundleFields} = prepared;
      VoiceBundleSchema.parse({status: 'approved', contentRevision: 1, sourceNarrationRevision: 1, ...bundleFields, configuration: {voiceId: 'fake-voice', voiceName: 'Fake Vietnamese', voiceCategory: null, modelId: 'fake-model', modelName: 'Fake model', languageCode: 'vi', outputFormat: 'mp3_44100_128', settings: {stability: 0.5, similarityBoost: 0.5, style: 0, useSpeakerBoost: true, speed: 1}, seed: 1}, generation: {generationId, provider: 'elevenlabs', generatedAt: now, characterCost, requestIds}});
      return prepared;
    },
    async readAudio() { return {audio: Buffer.from('fake-audio'), contentType: 'audio/wav'}; },
  };

  const animationSyncWorkspace = {
    async prepare(_projectId: string, generationId: string, motion: ReturnType<typeof MotionCanvasBundleSchema.parse>, voice: ReturnType<typeof VoiceBundleSchema.parse>) {
      const sections = motion.scenes.map((scene, index) => {
        const voiceSection = voice.sections[index]!;
        const beats = scene.timingEvents!.map((timing, beatIndex) => {
          const voiceBeat = voiceSection.beats[beatIndex]!;
          return {...timing, voiceStartSeconds: voiceBeat.startSeconds, voiceEndSeconds: voiceBeat.endSeconds, synchronizedDurationSeconds: voiceBeat.endSeconds - voiceBeat.startSeconds};
        });
        return {outlineSectionId: scene.outlineSectionId, sceneId: scene.id, filePath: scene.filePath, plannedDurationSeconds: scene.durationSeconds, synchronizedDurationSeconds: voiceSection.endSeconds, driftSeconds: voiceSection.endSeconds - scene.durationSeconds, beats};
      });
      return {workspacePath: `sync/generations/${generationId}`, projectFile: 'src/project.ts' as const, audioFile: 'audio/narration.wav' as const, totalDurationSeconds: voice.totalDurationSeconds, sections, validation: {validatedAt: now, sourceHash: digest({motion: motion.validation.sourceHash, voice: voice.generation.generationId}), motionCanvasVersion: 'fake-motion', audioDurationSeconds: voice.totalDurationSeconds}};
    },
    async readFiles() { return [{path: 'src/project.ts', source: '// fake sync'}]; },
    async readAudio() { return Buffer.from('fake-audio'); },
  };

  const layoutWorkspace = {
    async prepare(_projectId: string, generationId: string, sync: ReturnType<typeof AnimationSyncBundleSchema.parse>, overrides: Array<{sceneId: string}>, manifest: ReturnType<typeof LayoutEditorManifestSchema.parse>) {
      manifests.set(`${generationId}:layout`, manifest);
      return {workspacePath: `layout/generations/${generationId}` as const, sourceWorkspacePath: sync.workspacePath as `sync/generations/${string}`, projectFile: 'src/project.ts' as const, audioFile: 'audio/narration.wav' as const, overridesFile: 'overrides.json' as const, manifestFile: 'editor-manifest.json' as const, overrideContractVersion: 1 as const, totalDurationSeconds: sync.totalDurationSeconds, scenes: sync.sections.map(section => ({sceneId: section.sceneId, filePath: section.filePath, editableNodeCount: 1, overrideCount: overrides.filter(override => override.sceneId === section.sceneId).length})), validation: {validatedAt: now, sourceHash: digest(sync.validation.sourceHash), overridesHash: digest(overrides), manifestHash: digest(manifest), motionCanvasVersion: 'fake-motion', audioDurationSeconds: sync.totalDurationSeconds}};
    },
    async readFiles() { return [{path: 'src/project.ts', source: '// fake layout'}]; },
    async readOverrides(_projectId: string, bundle: ReturnType<typeof LayoutBundleSchema.parse>) { return {version: 1 as const, sourceAnimationSyncGenerationId: bundle.sourceAnimationSyncGenerationId, sourceAnimationSyncContentRevision: bundle.sourceAnimationSyncContentRevision, sourceAnimationSyncSourceHash: bundle.sourceAnimationSyncSourceHash, overrides: []}; },
    async readEditorManifest() { throw new Error('not used by this HTTP flow'); },
    async verify(_projectId: string, sync: ReturnType<typeof AnimationSyncBundleSchema.parse>) { return {projectDirectory: root, sourceWorkspaceDirectory: root, projectFile: path.join(root, 'src/project.ts'), sourceWorkspaceHash: digest(sync.workspacePath), layoutWorkspaceDirectory: root, overrides: {version: 1 as const, sourceAnimationSyncGenerationId: sync.generation.generationId, sourceAnimationSyncContentRevision: sync.contentRevision, sourceAnimationSyncSourceHash: sync.validation.sourceHash, overrides: []}, editorManifest: null}; },
  };

  const layoutPreviewService = {
    async start(_projectId: string, sync: ReturnType<typeof AnimationSyncBundleSchema.parse>) {
      const sessionNonce = 'x'.repeat(32);
      const manifest = LayoutEditorManifestSchema.parse({version: 1, sourceAnimationSyncGenerationId: sync.generation.generationId, sourceAnimationSyncContentRevision: sync.contentRevision, sourceAnimationSyncSourceHash: sync.validation.sourceHash, scenes: sync.sections.map(section => ({sceneId: section.sceneId, filePath: section.filePath, nodes: [{key: 'root', fingerprint: nodeFingerprint, label: 'Root', nodeType: 'Layout', parentKey: null, identity: 'semantic', editableProperties: ['x'], lockedProperties: [], lockReason: null}]}))});
      manifests.set(`${sessionNonce}:${sync.generation.generationId}`, manifest);
      return {generationId: sync.generation.generationId, sourceSyncGenerationId: sync.generation.generationId, sessionNonce, url: 'http://fake.preview/'};
    },
    async startMotion(_projectId: string, motion: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      const sessionNonce = 'x'.repeat(32);
      const manifest = LayoutEditorManifestSchema.parse({version: 1, sourceAnimationSyncGenerationId: motion.generation.generationId, sourceAnimationSyncContentRevision: motion.contentRevision, sourceAnimationSyncSourceHash: motion.validation.sourceHash, scenes: motion.scenes.map(scene => ({sceneId: scene.id, filePath: scene.filePath, nodes: [{key: 'root', fingerprint: nodeFingerprint, label: 'Root', nodeType: 'Layout', parentKey: null, identity: 'semantic', editableProperties: ['x'], lockedProperties: [], lockReason: null}]}))});
      manifests.set(`${sessionNonce}:${motion.generation.generationId}`, manifest);
      return {generationId: motion.generation.generationId, sourceSyncGenerationId: motion.generation.generationId, sessionNonce, url: 'http://fake.preview/'};
    },
    getManifest(_projectId: string, sessionNonce: string, generationId: string) { const manifest = manifests.get(`${sessionNonce}:${generationId}`); assert.ok(manifest); return manifest; },
    getSourceWorkspaceHash() { return digest('fake-preview'); },
    async close() {},
  };

  const motionCanvasRevisionReviewService = {async review() { return {coherence: {verdict: 'coherent' as const, summary: 'Fake review confirms the scoped scene stays coherent.', issues: []}, model: 'fake-codex', usage: null}; }};
  const finalRenderService = {
    async render(_projectId: string, generationId: string, contentRevision: number, _sync: ReturnType<typeof AnimationSyncBundleSchema.parse>, layout: ReturnType<typeof LayoutBundleSchema.parse>, profile?: {frame: {width: number; height: number; fps: number}}) {
      renderGeneration = generationId;
      await writeFile(videoPath, Buffer.from('fake-mp4'));
      currentRender = FinalRenderBundleSchema.parse({status: 'completed', contentRevision, sourceLayoutContentRevision: layout.contentRevision, sourceLayoutGenerationId: layout.generation.generationId, sourceLayoutSourceHash: layout.validation.sourceHash, workspacePath: `renders/generations/${generationId}`, videoFile: 'video.mp4', width: profile!.frame.width, height: profile!.frame.height, fps: profile!.frame.fps, watermark: layout.renderSettings.watermark, durationSeconds: layout.totalDurationSeconds, fileSizeBytes: 8, encoding: {container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', crf: 23, preset: 'medium'}, validation: {validatedAt: now, sourceHash: digest(layout.validation.sourceHash), videoHash: digest('fake-video'), renderedFrameCount: 60, probedDurationSeconds: layout.totalDurationSeconds}, generation: {generationId, provider: 'local', tool: 'motion-canvas-ffmpeg', generatedAt: now}});
      return currentRender;
    },
    async getStatus(_projectId: string, generationId?: string) { return generationId && generationId === renderGeneration ? currentRender ? {generationId, state: 'completed' as const, progress: 1, renderedFrames: 60, totalFrames: 60, startedAt: now, updatedAt: now, message: 'fake render complete', errorCode: null, diagnostic: null} : {generationId, state: 'rendering' as const, progress: 0.1, renderedFrames: 0, totalFrames: 60, startedAt: now, updatedAt: now, message: 'fake render started', errorCode: null, diagnostic: null} : null; },
    async getCompletedBundle(_projectId: string, generationId: string) { return generationId === renderGeneration ? currentRender : null; },
    async resolveVideo() { return {filePath: videoPath, size: 8}; },
    async close() {},
  };
  return {deps: {motionCanvasGenerator, motionCanvasWorkspace, narrationVisualPlanner, elevenLabsVoiceService, voiceWorkspace, animationSyncWorkspace, layoutWorkspace, layoutPreviewService, motionCanvasRevisionReviewService, finalRenderService, logger: {info() {}, error() {}}}, metrics: {ttsCalls: () => ttsCalls, motionCalls: () => motionCalls, nodeFingerprint, motionCanvasRequests, plannerRequests}};
}

async function start(t: test.TestContext, overrides: Record<string, unknown> = {}) {
  const projectsDirectory = await mkdtemp(path.join(os.tmpdir(), 'pad-workflow-'));
  const fake = fakeDependencies(projectsDirectory);
  const server = createPadStudioServer({projectsDirectory, ...fake.deps, ...overrides});
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await closePadStudioServerServices(server); await rm(projectsDirectory, {recursive: true, force: true}); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, projectsDirectory, ...fake};
}

async function request(baseUrl: string, project: TopicProject | null, method: string, suffix: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${suffix}`, {method, headers: {'Content-Type': 'application/json', ...(project ? {'If-Match': `"${project.revision}"`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return response;
}
async function projectFrom(response: Response) { if (!response.ok) assert.fail(`${response.status}: ${await response.text()}`); return (await response.json() as ProjectReply).project; }
async function create(baseUrl: string) { return projectFrom(await request(baseUrl, null, 'POST', '/api/projects', {creationId: randomUUID(), topicInput, narrationSourceText})); }
const voiceRequest = (generationId: string) => ({generationId, voiceId: 'fake-voice', modelId: 'fake-model', outputFormat: 'mp3_44100_128', settings: {stability: 0.5, similarityBoost: 0.5, style: 0, useSpeakerBoost: true, speed: 1}, seed: 1});

async function prepare(baseUrl: string) {
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  return project;
}

async function toScenes(baseUrl: string) {
  let project = await prepare(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/generate`, {generationId: randomUUID()}));
  assert.equal(project.motionCanvasBundle!.status, 'draft');
  assert.ok(project.motionCanvasBundle!.technicalReadyAt);
  const generationDiagnostic = project.motionCanvasBundle!.generationDiagnostics?.find(
    diagnostic => diagnostic.stage === 'generate',
  );
  assert.ok(generationDiagnostic);
  assert.doesNotMatch(generationDiagnostic!.reason, /pixel|layout/iu);
  assert.equal('visual' in project.motionCanvasBundle!.validation, false);
  const blockedSync = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()});
  assert.equal(blockedSync.status, 409);
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()}));
  return projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/approve`, {}));
}

test('golden HTTP workflow runs all five steps with schema-valid fake providers', async t => {
  const {baseUrl, metrics, projectsDirectory} = await start(t);
  let project = await create(baseUrl);
  assert.equal(project.version, 17); assert.equal(project.currentStep, 'pronunciation'); assert.equal(project.narration!.approvedAt, null);
  const blockedPrepare = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}); assert.equal(blockedPrepare.status, 409, await blockedPrepare.text());
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  assert.equal(project.currentStep, 'production');
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  const stored = TopicProjectSchema.safeParse(JSON.parse(await readFile(path.join(projectsDirectory, project.id, 'project.json'), 'utf8')));
  assert.ok(stored.success, stored.success ? '' : JSON.stringify(stored.error.issues));
  assert.equal(project.outline!.sourceNarrationHash, project.narration!.approvedSourceHash); assert.equal(project.voiceVisualPlan!.sourceNarrationRevision, project.outline!.sourceNarrationRevision);
  const stale = await request(baseUrl, {...project, revision: project.revision - 1}, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())); assert.equal(stale.status, 409, await stale.text());
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
  assert.equal(project.voiceBundle!.status, 'approved'); assert.equal(metrics.ttsCalls(), 1); assert.equal(project.currentStep, 'production');
  const reusedVoiceGeneration = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, {...voiceRequest(project.voiceBundle!.generation.generationId), seed: 2});
  assert.equal(reusedVoiceGeneration.status, 409, await reusedVoiceGeneration.text());
  const audio = await fetch(`${baseUrl}/api/projects/${project.id}/voice/audio/${project.voiceBundle!.sections[0]!.outlineSectionId}`); assert.equal(audio.status, 200); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), Buffer.from('fake-audio'));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/generate`, {generationId: randomUUID()}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()}));
  assert.equal(project.animationSyncBundle!.status, 'draft'); assert.equal(project.currentStep, 'production');
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/approve`, {})); assert.equal(project.currentStep, 'scenes');
  const blockedRender = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/render/generate`, {generationId: randomUUID()}); assert.equal(blockedRender.status, 409);
  const layoutPreview = await fetch(`${baseUrl}/api/projects/${project.id}/layout/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}});
  assert.equal(layoutPreview.status, 200);
  const layoutPreviewBody = await layoutPreview.json() as {preview: {sessionNonce: string; sourceSyncGenerationId: string}};
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/layout/design`, {
    generationId: randomUUID(),
    baseGenerationId: null,
    sourceAnimationSyncGenerationId: layoutPreviewBody.preview.sourceSyncGenerationId,
    sessionNonce: layoutPreviewBody.preview.sessionNonce,
    overrides: [{sceneId: project.animationSyncBundle!.sections[0]!.sceneId, nodeKey: 'root', nodeFingerprint: metrics.nodeFingerprint, patch: {x: 12}}],
    renderSettings: defaultLayoutRenderSettings,
  }));
  assert.equal(project.layoutBundle!.status, 'draft'); assert.equal(project.layoutBundle!.scenes[0]!.overrideCount, 1);
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/layout/approve`, {generationId: project.layoutBundle!.generation.generationId}));
  assert.equal(project.layoutBundle!.status, 'approved'); assert.equal(project.currentStep, 'render');
  // A further edit after approval must re-draft the layout instead of being silently
  // dropped — this is the regression guard for the "edits lost after output" bug.
  const secondPreview = await fetch(`${baseUrl}/api/projects/${project.id}/layout/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}});
  const secondPreviewBody = await secondPreview.json() as {preview: {sessionNonce: string; sourceSyncGenerationId: string}};
  const approvedGenerationId = project.layoutBundle!.generation.generationId;
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/layout/design`, {
    generationId: randomUUID(),
    baseGenerationId: approvedGenerationId,
    sourceAnimationSyncGenerationId: secondPreviewBody.preview.sourceSyncGenerationId,
    sessionNonce: secondPreviewBody.preview.sessionNonce,
    overrides: [{sceneId: project.animationSyncBundle!.sections[0]!.sceneId, nodeKey: 'root', nodeFingerprint: metrics.nodeFingerprint, patch: {x: 24}}],
    renderSettings: defaultLayoutRenderSettings,
  }));
  assert.notEqual(project.layoutBundle!.generation.generationId, approvedGenerationId);
  assert.equal(project.layoutBundle!.status, 'draft', 'a post-approval edit must reopen the layout for review, not vanish');
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/layout/approve`, {generationId: project.layoutBundle!.generation.generationId}));
  assert.equal(project.layoutBundle!.status, 'approved'); assert.equal(project.currentStep, 'render');
  const renderId = randomUUID(); const started = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/render/generate`, {generationId: renderId}); assert.equal(started.status, 202);
  const status = await fetch(`${baseUrl}/api/projects/${project.id}/render/status?generationId=${renderId}`); assert.equal(status.status, 200);
  project = (await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json() as ProjectReply).project;
  assert.equal(project.renderBundle!.status, 'completed'); assert.equal(project.renderBundle!.sourceLayoutGenerationId, project.layoutBundle!.generation.generationId); assert.equal(project.currentStep, 'render');
  const video = await fetch(`${baseUrl}/api/projects/${project.id}/render/video`); assert.equal(video.status, 200); assert.equal(metrics.motionCalls(), 1);
});

test('AI Visual Planner và Motion Canvas scene generation nhận model/reasoning độc lập trong cùng một production flow', async t => {
  const {baseUrl, metrics} = await start(t);
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {
    generationId: randomUUID(),
    plannerModel: 'planner-model',
    plannerReasoningEffort: 'high',
  }));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/generate`, {
    generationId: randomUUID(),
    model: 'scene-model',
    reasoningEffort: 'low',
  }));

  assert.equal(metrics.plannerRequests.length, 1);
  assert.equal(metrics.plannerRequests[0]?.model, 'planner-model');
  assert.equal(metrics.plannerRequests[0]?.reasoningEffort, 'high');
  assert.ok(metrics.motionCanvasRequests.length >= 1);
  for (const sceneRequest of metrics.motionCanvasRequests) {
    assert.equal(sceneRequest.model, 'scene-model');
    assert.equal(sceneRequest.reasoningEffort, 'low');
  }
  // The two stages received distinct selections — neither leaked into the other.
  assert.notEqual(metrics.plannerRequests[0]?.model, metrics.motionCanvasRequests[0]?.model);
  assert.equal(project.voiceVisualPlan!.generation.provider, 'codex');
  assert.equal(project.voiceVisualPlan!.plannerDiagnostics?.[0]?.outcome, 'used_ai');
});

test('AI Visual Planner fallback về deterministic khi không có planner selection', async t => {
  const {baseUrl} = await start(t);
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  // No plannerModel/plannerReasoningEffort at all — the fake planner still
  // succeeds here (it does not require a model), proving the request shape
  // stays valid with no selection. Fallback-on-failure itself is covered at
  // the narrationPlan.ts unit level.
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  assert.equal(project.voiceVisualPlan!.status, 'approved');
  assert.equal(project.outline!.status, 'approved');
});

test('voice regeneration invalidates only downstream sync, layout, and render', async t => {
  const {baseUrl, metrics} = await start(t);
  let project = await toScenes(baseUrl);
  const preview = await fetch(`${baseUrl}/api/projects/${project.id}/layout/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}});
  const previewBody = await preview.json() as {preview: {sessionNonce: string; sourceSyncGenerationId: string}};
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/layout/design`, {
    generationId: randomUUID(),
    baseGenerationId: null,
    sourceAnimationSyncGenerationId: previewBody.preview.sourceSyncGenerationId,
    sessionNonce: previewBody.preview.sessionNonce,
    overrides: [],
  }));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/layout/approve`, {generationId: project.layoutBundle!.generation.generationId}));
  const renderId = randomUUID(); await request(baseUrl, project, 'POST', `/api/projects/${project.id}/render/generate`, {generationId: renderId}); await fetch(`${baseUrl}/api/projects/${project.id}/render/status?generationId=${renderId}`);
  project = (await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json() as ProjectReply).project;
  const previousVoice = project.voiceBundle!.generation.generationId; const previousMotion = project.motionCanvasBundle!.generation.generationId; const calls = metrics.motionCalls();
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, {...voiceRequest(randomUUID()), seed: 2}));
  assert.notEqual(project.voiceBundle!.generation.generationId, previousVoice); assert.equal(project.motionCanvasBundle!.generation.generationId, previousMotion); assert.equal(project.animationSyncBundle!.status, 'draft'); assert.equal(project.layoutBundle, null); assert.equal(project.renderBundle, null); assert.equal(project.currentStep, 'production'); assert.equal(metrics.motionCalls(), calls); assert.equal(metrics.ttsCalls(), 2);
  const staleDesign = await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/layout/design`, {generationId: randomUUID(), baseGenerationId: null, sourceAnimationSyncGenerationId: project.animationSyncBundle!.generation.generationId, sessionNonce: 'x'.repeat(32), overrides: []});
  assert.equal(staleDesign.status, 409, await staleDesign.text());
});

test('sync generation rejects missing production prerequisites', async t => {
  const {baseUrl} = await start(t);
  let project = await prepare(baseUrl);
  const withoutVoiceOrMotion = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()});
  assert.equal(withoutVoiceOrMotion.status, 409, await withoutVoiceOrMotion.text());
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
  const withoutMotion = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()});
  assert.equal(withoutMotion.status, 409, await withoutMotion.text());
});

test('candidate apply and visual design HTTP transitions stay in scenes and invalidate downstream', async t => {
  const {baseUrl, metrics} = await start(t);
  let project = await toScenes(baseUrl);
  const original = project.motionCanvasBundle!;
  const candidateId = randomUUID();
  const candidateResponse = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/candidates`, {generationId: candidateId, guidance: 'Làm cảnh rõ ràng hơn.', scope: {sceneIds: [original.scenes[0]!.id]}});
  assert.equal(candidateResponse.status, 201); const candidate = (await candidateResponse.json() as {candidate: {candidateId: string; decision: string; bundle: TopicProject['motionCanvasBundle']}}).candidate;
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/candidates/${candidate.candidateId}/apply`, {}));
  assert.equal(project.currentStep, 'scenes'); assert.equal(project.animationSyncBundle!.status, 'draft'); assert.equal(project.motionCanvasBundle!.scenes[0]!.id, original.scenes[0]!.id); assert.equal(project.motionCanvasBundle!.contentRevision, original.contentRevision + 1); assert.notEqual(project.motionCanvasBundle!.validation.sourceHash, original.validation.sourceHash);
  const staleLayoutPreview = await fetch(`${baseUrl}/api/projects/${project.id}/layout/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}});
  assert.equal(staleLayoutPreview.status, 409, await staleLayoutPreview.text());
  const history = await fetch(`${baseUrl}/api/projects/${project.id}/motion-canvas/history`);
  assert.equal(history.status, 200);
  const historyBody = await history.json() as {candidates: Array<{candidateId: string; decision: string}>; versions: Array<{versionId: string}>};
  assert.equal(historyBody.candidates.find(item => item.candidateId === candidateId)?.decision, 'accepted');
  const restore = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/versions/${historyBody.versions[0]!.versionId}/restore`, {});
  project = await projectFrom(restore);
  assert.equal(project.currentStep, 'scenes');
  // The raw Motion Canvas preview stays reachable for reviewing the (silent)
  // AI-authored draft before it is approved and synced.
  const rawPreview = await fetch(`${baseUrl}/api/projects/${project.id}/motion-canvas/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}}); assert.equal(rawPreview.status, 200);
  if (project.motionCanvasBundle!.status !== 'approved') {
    project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {}));
  }
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/approve`, {}));
  const preview = await fetch(`${baseUrl}/api/projects/${project.id}/layout/preview`, {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}}); assert.equal(preview.status, 200);
  const previewBody = await preview.json() as {preview: {sessionNonce: string; sourceSyncGenerationId: string}};
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/layout/design`, {
    generationId: randomUUID(),
    baseGenerationId: null,
    sourceAnimationSyncGenerationId: previewBody.preview.sourceSyncGenerationId,
    sessionNonce: previewBody.preview.sessionNonce,
    overrides: [{sceneId: project.animationSyncBundle!.sections[0]!.sceneId, nodeKey: 'root', nodeFingerprint: metrics.nodeFingerprint, patch: {x: 12}}],
  }));
  assert.equal(project.currentStep, 'scenes'); assert.equal(project.layoutBundle!.scenes[0]!.overrideCount, 1); assert.equal(project.layoutBundle!.status, 'draft'); assert.equal(project.animationSyncBundle!.status, 'approved');
});

function fakePronunciationAuditService() {
  let calls = 0;
  return {
    service: {
      async audit(_request: unknown) {
        calls += 1;
        return {patches: [], model: 'fake-audit-model', usage: null};
      },
    },
    calls: () => calls,
  };
}

test('narration audit joins concurrent requests sharing a generation id and rejects reuse with different input', async t => {
  const audit = fakePronunciationAuditService();
  const {baseUrl} = await start(t, {pronunciationAuditService: audit.service});
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));

  const generationId = randomUUID();
  const [first, second] = await Promise.all([
    request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/audit`, {generationId}),
    request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/audit`, {generationId}),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 200], `expected both duplicate requests to resolve to the same applied result, got ${statuses.join(',')}`);
  assert.equal(audit.calls(), 1, 'duplicate concurrent requests with the same generation id and content must call the AI provider once');

  project = await projectFrom(first);

  const otherText = `${narrationSourceText} Một câu khác để đổi fingerprint.`;
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: otherText, projectRules: []}));
  const reused = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/audit`, {generationId});
  const reusedBody = await reused.json() as {error?: {code: string}};
  assert.equal(reused.status, 409, JSON.stringify(reusedBody));
  assert.equal(reusedBody.error?.code, 'GENERATION_ID_REUSED');
  assert.equal(audit.calls(), 1, 'reusing a generation id with different content must not call the AI provider again');
});
