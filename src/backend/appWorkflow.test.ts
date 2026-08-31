import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MotionCanvasCandidateRecordSchema,
  MotionCanvasVersionRecordSchema,
  type MotionCanvasCandidateRecord,
} from '../shared/motionCanvasHistory.ts';
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
import {
  createFileMotionCanvasHistoryStore,
  hashJson,
  hashMotionCanvasBundle,
} from './motionCanvasHistoryStore.ts';
import {createFileProjectRepository} from './projectRepository.ts';
import type {GeneratedVoiceNarration} from './voiceWorkspace.ts';
import {closePadStudioServerServices, createPadStudioServer} from './app.ts';
import {MotionCanvasVisualQualityError, VISUAL_QUALITY_GATE_VERSION, motionCanvasSceneSourceHash} from './motionCanvasVisualQuality.ts';
import {MotionCanvasGenerationError} from './motionCanvasGenerator.ts';
import {LayoutPreviewError} from './layoutPreviewService.ts';
import type {MotionCanvasSourceScene} from './motionCanvasGenerator.ts';
import type {
  MotionCanvasFailureCheckpoint,
  MotionCanvasFailureRecord,
  MotionCanvasFailureSummary,
} from './motionCanvasWorkspace.ts';

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
  let motionDiscards = 0;
  let workspacePrepareCalls = 0;
  let workspaceReadSceneSourcesCalls = 0;
  let workspaceVerifyCalls = 0;
  let workspaceDiscardCalls = 0;
  let visualQualityValidationCalls = 0;
  let layoutWaitForManifestCalls = 0;
  let layoutWorkspacePrepareCalls = 0;
  let layoutFailureRecordCalls = 0;
  let projectUpdateCalls = 0;
  let historyEnsureVersionCalls = 0;
  let historySaveCandidateCalls = 0;
  let historyDecisionCalls = 0;
  let fallbackCandidateGeneration = false;
  let fallbackSceneIndexes: Set<number> | null = null;
  let motionGenerationGate: Promise<void> | null = null;
  let motionGenerationError: Error | null = null;
  let currentRender: ReturnType<typeof FinalRenderBundleSchema.parse> | null = null;
  let renderGeneration: string | null = null;
  const videoPath = path.join(root, 'fake-render.mp4');
  const nodeFingerprint = digest('fake-layout-node');
  const manifests = new Map<string, ReturnType<typeof LayoutEditorManifestSchema.parse>>();
  const pendingLayoutManifests = new Map<string, ReturnType<typeof LayoutEditorManifestSchema.parse>>();
  const layoutManifestWaiters = new Map<string, Set<() => void>>();
  let autoPublishLayoutManifest = true;
  let layoutManifestError: Error | null = null;
  let latestMotionFailure: MotionCanvasFailureSummary | null = null;
  const motionFailureCheckpoints = new Map<string, MotionCanvasFailureCheckpoint>();
  const sceneSourceOverrides = new Map<string, string>();
  const baseRepository = createFileProjectRepository(root);
  const repository = {
    ...baseRepository,
    async updateProject(...args: Parameters<typeof baseRepository.updateProject>) {
      projectUpdateCalls += 1;
      return baseRepository.updateProject(...args);
    },
  };
  const baseHistoryStore = createFileMotionCanvasHistoryStore(root);
  const motionCanvasHistoryStore = {
    ...baseHistoryStore,
    async ensureVersion(...args: Parameters<typeof baseHistoryStore.ensureVersion>) {
      historyEnsureVersionCalls += 1;
      return baseHistoryStore.ensureVersion(...args);
    },
    async saveCandidate(...args: Parameters<typeof baseHistoryStore.saveCandidate>) {
      historySaveCandidateCalls += 1;
      return baseHistoryStore.saveCandidate(...args);
    },
    async setCandidateDecision(...args: Parameters<typeof baseHistoryStore.setCandidateDecision>) {
      historyDecisionCalls += 1;
      return baseHistoryStore.setCandidateDecision(...args);
    },
  };
  const motionCanvasRequests: Array<{
    model?: string;
    reasoningEffort?: string;
    guidance?: string;
    regenerateFromScratch?: boolean;
    sectionIndexes?: number[];
    currentSceneIds?: string[];
    hasCurrentScenes: boolean;
  }> = [];
  const plannerRequests: Array<{
    model?: string;
    reasoningEffort?: string;
    semanticSourceText: string;
    units: Array<{text: string; semanticText: string}>;
  }> = [];

  const motionCanvasGenerator = {
    async generate(request: {
      generationId: string;
      model?: string;
      reasoningEffort?: string;
      voiceVisualPlan: TopicProject['voiceVisualPlan'];
      sectionIndexes?: number[];
      guidance?: string;
      regenerateFromScratch?: boolean;
      currentScenes?: Array<{id: string}>;
      onProgress?: (progress: {
        completedScenes: number;
        failedScenes: number;
        totalScenes: number;
        sectionIndex: number | null;
        outcome: 'started' | 'completed' | 'failed';
      }) => void;
    }) {
      motionCalls += 1;
      motionCanvasRequests.push({
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        guidance: request.guidance,
        regenerateFromScratch: request.regenerateFromScratch,
        sectionIndexes: request.sectionIndexes,
        currentSceneIds: request.currentScenes?.map(scene => scene.id),
        hasCurrentScenes: Boolean(request.currentScenes?.length),
      });
      if (motionGenerationGate) await motionGenerationGate;
      const plan = request.voiceVisualPlan!;
      const indexes = request.sectionIndexes ?? plan.sections.map((_section, index) => index);
      if (motionGenerationError) {
        request.onProgress?.({
          completedScenes: 0,
          failedScenes: indexes.length,
          totalScenes: indexes.length,
          sectionIndex: indexes[0] ?? null,
          outcome: 'failed',
        });
        throw motionGenerationError;
      }
      const scenes = indexes.map(index => {
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
      });
      return {
        model: 'fake-codex', usage: null,
        scenes: fallbackCandidateGeneration || fallbackSceneIndexes
          ? scenes.map((scene, resultIndex) => {
            const sectionIndex = indexes[resultIndex]!;
            return fallbackCandidateGeneration || fallbackSceneIndexes?.has(sectionIndex)
              ? {
                  ...scene,
                  name: `${scene.name} safe fallback`,
                  source: `// pad-semantic:unverified-fallback\n${scene.source}`,
                }
              : scene;
          })
          : scenes,
      };
    },
    discardGeneration() { motionDiscards += 1; },
  };

  const narrationVisualPlanner = {
    async plan(request: {units: Array<{id: string; text: string; semanticText: string}>; semanticSourceText: string; model?: string; reasoningEffort?: string}) {
      plannerRequests.push({model: request.model, reasoningEffort: request.reasoningEffort, semanticSourceText: request.semanticSourceText, units: request.units});
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
              primaryBlock: 'block-concept-card' as const,
              visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card', 'concept-label'], exit: ['block-concept-card']},
              compositionContract: {
                visualFocus: 'Khối khái niệm trung tâm giữ toàn bộ sự chú ý của beat này.',
                hierarchy: ['block-concept-card', 'concept-label'],
                semanticRole: 'claim' as const,
                layout: 'center-focus' as const,
                density: 'balanced' as const,
                spacingNotes: 'Giữ khoảng thở rộng quanh khối trung tâm và giữa các nhãn.',
              },
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

  // The real workspace round-trips sources through disk, so the fake must too:
  // rendered-frame evidence is hashed over exactly what a reader gets back.
  const preparedSceneSources = new Map<string, string>();
  const motionCanvasWorkspace = {
    async prepare(_projectId: string, generationId: string, scenes: Awaited<ReturnType<typeof motionCanvasGenerator.generate>>['scenes']) {
      workspacePrepareCalls += 1;
      const result = {
        workspacePath: `motion-canvas/generations/${generationId}`,
        projectFile: 'src/project.ts' as const,
        workspaceDirectory: root,
        projectFilePath: path.join(root, 'src/project.ts'),
        scenes: scenes.map(({source: _source, ...scene}) => scene),
        sourceScenes: scenes,
        validation: {validatedAt: now, sourceHash: digest(scenes.map(scene => scene.source)), motionCanvasVersion: 'fake-motion'},
      };
      for (const scene of scenes) preparedSceneSources.set(scene.id, scene.source);
      return result;
    },
    async readFiles(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      return bundle.scenes.map(scene => ({path: scene.filePath, source: `// ${scene.id}`}));
    },
    async readSceneSources(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      workspaceReadSceneSourcesCalls += 1;
      return bundle.scenes.map(scene => ({...scene, source: sceneSourceOverrides.get(scene.id) ?? preparedSceneSources.get(scene.id) ?? `// source for ${scene.id}\n`.repeat(20)}));
    },
    async verify(_projectId: string, bundle: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      workspaceVerifyCalls += 1;
      return {projectDirectory: root, workspaceDirectory: root, projectFile: path.join(root, bundle.projectFile), sourceHash: bundle.validation.sourceHash};
    },
    async discard() { workspaceDiscardCalls += 1; },
    async recordFailure(
      _projectId: string,
      generationId: string,
      failure: MotionCanvasFailureRecord,
    ) {
      const firstIssue = failure.issues?.find(
        issue =>
          typeof issue === 'object' &&
          issue !== null &&
          'reason' in issue &&
          typeof issue.reason === 'string',
      ) as {reason: string} | undefined;
      latestMotionFailure = {
        generationId,
        failedAt: now,
        stage: failure.stage,
        code: failure.code,
        message: failure.message,
        firstIssueReason: firstIssue?.reason ?? null,
        rootCause: failure.rootCause ?? null,
        recoveryGuidance: failure.recoveryGuidance ?? null,
      };
      if (failure.scenes?.length) {
        const issueSceneIds = (failure.issues ?? [])
          .flatMap(issue => {
            if (!issue || typeof issue !== 'object') return [];
            const sceneId = (issue as {sceneId?: unknown}).sceneId;
            return typeof sceneId === 'string' ? [sceneId] : [];
          });
        motionFailureCheckpoints.set(generationId, {
          scenes: failure.scenes,
          failedSceneIds: [
            ...new Set([
              ...(failure.failedSceneIds ?? []),
              ...issueSceneIds,
              ...failure.scenes
                .filter(scene => scene.name.includes('safe fallback'))
                .map(scene => scene.id),
            ]),
          ],
          ...(failure.sourceVoiceVisualContentRevision !== undefined
            ? {sourceVoiceVisualContentRevision: failure.sourceVoiceVisualContentRevision}
            : {}),
        });
      }
      return path.join(root, 'motion-canvas', 'failures', generationId);
    },
    async readLatestFailure() {
      return latestMotionFailure;
    },
    async readFailureCheckpoint(_projectId: string, generationId: string) {
      return motionFailureCheckpoints.get(generationId) ?? null;
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
      layoutWorkspacePrepareCalls += 1;
      manifests.set(`${generationId}:layout`, manifest);
      return {workspacePath: `layout/generations/${generationId}` as const, sourceWorkspacePath: sync.workspacePath as `sync/generations/${string}`, projectFile: 'src/project.ts' as const, audioFile: 'audio/narration.wav' as const, overridesFile: 'overrides.json' as const, manifestFile: 'editor-manifest.json' as const, overrideContractVersion: 1 as const, totalDurationSeconds: sync.totalDurationSeconds, scenes: sync.sections.map(section => ({sceneId: section.sceneId, filePath: section.filePath, editableNodeCount: 1, overrideCount: overrides.filter(override => override.sceneId === section.sceneId).length})), validation: {validatedAt: now, sourceHash: digest(sync.validation.sourceHash), overridesHash: digest(overrides), manifestHash: digest(manifest), motionCanvasVersion: 'fake-motion', audioDurationSeconds: sync.totalDurationSeconds}};
    },
    async readFiles() { return [{path: 'src/project.ts', source: '// fake layout'}]; },
    async readOverrides(_projectId: string, bundle: ReturnType<typeof LayoutBundleSchema.parse>) { return {version: 1 as const, sourceAnimationSyncGenerationId: bundle.sourceAnimationSyncGenerationId, sourceAnimationSyncContentRevision: bundle.sourceAnimationSyncContentRevision, sourceAnimationSyncSourceHash: bundle.sourceAnimationSyncSourceHash, overrides: []}; },
    async readEditorManifest() { throw new Error('not used by this HTTP flow'); },
    async recordFailure(_projectId: string, generationId: string) {
      layoutFailureRecordCalls += 1;
      return path.join(root, 'layout', 'failures', generationId);
    },
    async verify(_projectId: string, sync: ReturnType<typeof AnimationSyncBundleSchema.parse>) { return {projectDirectory: root, sourceWorkspaceDirectory: root, projectFile: path.join(root, 'src/project.ts'), sourceWorkspaceHash: digest(sync.workspacePath), layoutWorkspaceDirectory: root, overrides: {version: 1 as const, sourceAnimationSyncGenerationId: sync.generation.generationId, sourceAnimationSyncContentRevision: sync.contentRevision, sourceAnimationSyncSourceHash: sync.validation.sourceHash, overrides: []}, editorManifest: null}; },
  };

  const layoutPreviewService = {
    async start(
      _projectId: string,
      sync: ReturnType<typeof AnimationSyncBundleSchema.parse>,
      layout: ReturnType<typeof LayoutBundleSchema.parse> | null,
    ) {
      const sessionNonce = 'x'.repeat(32);
      const generationId =
        layout?.generation.generationId ?? sync.generation.generationId;
      const manifest = LayoutEditorManifestSchema.parse({version: 1, sourceAnimationSyncGenerationId: sync.generation.generationId, sourceAnimationSyncContentRevision: sync.contentRevision, sourceAnimationSyncSourceHash: sync.validation.sourceHash, scenes: sync.sections.map(section => ({sceneId: section.sceneId, filePath: section.filePath, nodes: [{key: 'root', fingerprint: nodeFingerprint, label: 'Root', nodeType: 'Layout', parentKey: null, identity: 'semantic', editableProperties: ['x'], lockedProperties: [], lockReason: null}]}))});
       const manifestKey = `${sessionNonce}:${sync.generation.generationId}`;
       pendingLayoutManifests.set(manifestKey, manifest);
       if (autoPublishLayoutManifest) manifests.set(manifestKey, manifest);
       return {generationId, sourceSyncGenerationId: sync.generation.generationId, sessionNonce, url: 'http://fake.preview/'};
    },
    async startMotion(_projectId: string, motion: ReturnType<typeof MotionCanvasBundleSchema.parse>) {
      const sessionNonce = 'x'.repeat(32);
      const manifest = LayoutEditorManifestSchema.parse({version: 1, sourceAnimationSyncGenerationId: motion.generation.generationId, sourceAnimationSyncContentRevision: motion.contentRevision, sourceAnimationSyncSourceHash: motion.validation.sourceHash, scenes: motion.scenes.map(scene => ({sceneId: scene.id, filePath: scene.filePath, nodes: [{key: 'root', fingerprint: nodeFingerprint, label: 'Root', nodeType: 'Layout', parentKey: null, identity: 'semantic', editableProperties: ['x'], lockedProperties: [], lockReason: null}]}))});
       const manifestKey = `${sessionNonce}:${motion.generation.generationId}`;
       pendingLayoutManifests.set(manifestKey, manifest);
       if (autoPublishLayoutManifest) manifests.set(manifestKey, manifest);
       return {generationId: motion.generation.generationId, sourceSyncGenerationId: motion.generation.generationId, sessionNonce, url: 'http://fake.preview/'};
      },
    async waitForManifest(_projectId: string, sessionNonce: string, generationId: string) {
      layoutWaitForManifestCalls += 1;
      if (layoutManifestError) throw layoutManifestError;
      const key = `${sessionNonce}:${generationId}`;
      const existing = manifests.get(key);
      if (existing) return existing;
      await new Promise<void>(resolve => {
        const waiters = layoutManifestWaiters.get(key) ?? new Set<() => void>();
        waiters.add(resolve);
        layoutManifestWaiters.set(key, waiters);
      });
      const manifest = manifests.get(key);
      assert.ok(manifest, 'fake runtime must publish a manifest before design continues');
      return manifest;
    },
    getManifest(_projectId: string, sessionNonce: string, generationId: string) { const manifest = manifests.get(`${sessionNonce}:${generationId}`); assert.ok(manifest); return manifest; },
    getSourceWorkspaceHash() { return digest('fake-preview'); },
    async close() {},
  };

  const motionCanvasRevisionReviewService = {async review() { return {coherence: {verdict: 'coherent' as const, summary: 'Fake review confirms the scoped scene stays coherent.', issues: []}, model: 'fake-codex', usage: null}; }};
  const motionCanvasVisualQualityGate = {async validate(input: {scenes: Array<{id: string; source: string}>}) { visualQualityValidationCalls += 1; return {version: VISUAL_QUALITY_GATE_VERSION as typeof VISUAL_QUALITY_GATE_VERSION, status: 'passed' as const, validatedAt: now, sourceHash: motionCanvasSceneSourceHash(input.scenes as MotionCanvasSourceScene[]), scenes: [], issues: []}; }};
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
  return {
    deps: {
      repository,
      motionCanvasHistoryStore,
      motionCanvasGenerator,
      motionCanvasWorkspace,
      motionCanvasVisualQualityGate,
      narrationVisualPlanner,
      elevenLabsVoiceService,
      voiceWorkspace,
      animationSyncWorkspace,
      layoutWorkspace,
      layoutPreviewService,
      motionCanvasRevisionReviewService,
      finalRenderService,
      logger: {info() {}, error() {}},
    },
    controls: {
      setFallbackCandidateGeneration(enabled: boolean) {
        fallbackCandidateGeneration = enabled;
      },
      setFallbackSceneIndexes(indexes: number[] | null) {
        fallbackSceneIndexes = indexes ? new Set(indexes) : null;
      },
      setSceneSourceOverride(sceneId: string, source: string) {
        sceneSourceOverrides.set(sceneId, source);
      },
      clearSceneSourceOverride(sceneId: string) {
        sceneSourceOverrides.delete(sceneId);
      },
      setMotionGenerationGate(gate: Promise<void> | null) {
        motionGenerationGate = gate;
      },
      setMotionGenerationError(error: Error | null) {
        motionGenerationError = error;
      },
      setAutoPublishLayoutManifest(enabled: boolean) {
        autoPublishLayoutManifest = enabled;
      },
      setLayoutManifestError(error: Error | null) {
        layoutManifestError = error;
      },
      publishPendingLayoutManifests() {
        for (const [key, manifest] of pendingLayoutManifests) {
          manifests.set(key, manifest);
          for (const resolve of layoutManifestWaiters.get(key) ?? []) resolve();
          layoutManifestWaiters.delete(key);
        }
      },
    },
    historyStore: motionCanvasHistoryStore,
    metrics: {
      ttsCalls: () => ttsCalls,
      motionCalls: () => motionCalls,
      motionDiscards: () => motionDiscards,
      workspacePrepareCalls: () => workspacePrepareCalls,
      workspaceReadSceneSourcesCalls: () => workspaceReadSceneSourcesCalls,
      workspaceVerifyCalls: () => workspaceVerifyCalls,
      workspaceDiscardCalls: () => workspaceDiscardCalls,
      visualQualityValidationCalls: () => visualQualityValidationCalls,
      layoutWaitForManifestCalls: () => layoutWaitForManifestCalls,
      layoutWorkspacePrepareCalls: () => layoutWorkspacePrepareCalls,
      layoutFailureRecordCalls: () => layoutFailureRecordCalls,
      projectUpdateCalls: () => projectUpdateCalls,
      historyEnsureVersionCalls: () => historyEnsureVersionCalls,
      historySaveCandidateCalls: () => historySaveCandidateCalls,
      historyDecisionCalls: () => historyDecisionCalls,
      nodeFingerprint,
      motionCanvasRequests,
      plannerRequests,
    },
  };
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
async function projectFrom(response: Response) {
  if (!response.ok) assert.fail(`${response.status}: ${await response.text()}`);
  if (response.status !== 202) return (await response.json() as ProjectReply).project;
  const accepted = await response.json() as {progress?: {state: string; error?: string | null; message?: string}};
  const generateUrl = new URL(response.url);
  const match = generateUrl.pathname.match(/^(.*)\/motion-canvas\/generate$/);
  assert.ok(match, `unexpected generation URL: ${generateUrl.pathname}`);
  const projectPath = match![1];
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const statusResponse = await fetch(`${generateUrl.origin}${projectPath}/motion-canvas/status`, {cache: 'no-store'});
    const statusPayload = await statusResponse.json() as {progress?: {state: string; error?: string | null; message?: string}};
    assert.equal(statusResponse.status, 200);
    const progress = statusPayload.progress;
    assert.ok(progress);
    if (progress!.state === 'completed') {
      const projectResponse = await fetch(`${generateUrl.origin}${projectPath}`);
      assert.equal(projectResponse.status, 200);
      return (await projectResponse.json() as ProjectReply).project;
    }
    if (progress!.state === 'failed' || progress!.state === 'interrupted') {
      assert.fail(progress!.error || progress!.message || `generation ${progress!.state}`);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail('generation did not reach a terminal state');
}
async function waitForMotionProgress(baseUrl: string, projectId: string) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/motion-canvas/status`, {cache: 'no-store'});
    assert.equal(response.status, 200);
    const payload = await response.json() as {progress: {state: string; generationId: string; error?: string | null; message?: string} | null};
    assert.ok(payload.progress);
    if (payload.progress!.state !== 'running') return payload.progress!;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail('generation progress did not reach a terminal state');
}
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
  if (project.motionCanvasBundle!.semanticValidation?.status === 'degraded') {
    const unconfirmed = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {});
    assert.equal(unconfirmed.status, 409, 'degraded semantic output requires explicit user acceptance');
  }
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {acceptDegradedSemantic: true}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/generate`, {generationId: randomUUID()}));
  return projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/sync/approve`, {}));
}

test('fresh scene regeneration sends optional recovery guidance without supplying existing scene source', async t => {
  const {baseUrl, metrics} = await start(t);
  let project = await toScenes(baseUrl);
  const previousGeneration = project.motionCanvasBundle!.generation.generationId;
  project = await projectFrom(await request(
    baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {
      generationId: randomUUID(),
      regenerateFromScratch: true,
      guidance: 'Repair the previous contrast and overlap failures.',
    },
  ));
  assert.notEqual(project.motionCanvasBundle!.generation.generationId, previousGeneration);
  const requestToGenerator = metrics.motionCanvasRequests.at(-1);
  assert.equal(requestToGenerator?.regenerateFromScratch, true);
  assert.equal(requestToGenerator?.hasCurrentScenes, false);
  assert.equal(
    requestToGenerator?.guidance,
    'Repair the previous contrast and overlap failures.',
  );
});

test('layout design waits for the runtime manifest before preparing a workspace', async t => {
  const {baseUrl, metrics, controls} = await start(t);
  let project = await toScenes(baseUrl);
  controls.setAutoPublishLayoutManifest(false);
  const beforePrepare = metrics.layoutWorkspacePrepareCalls();
  const previewResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/preview`,
    {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}},
  );
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json() as {
    preview: {sessionNonce: string; sourceSyncGenerationId: string};
  };
  const designRequest = request(
    baseUrl,
    project,
    'PUT',
    `/api/projects/${project.id}/layout/design`,
    {
      generationId: randomUUID(),
      baseGenerationId: null,
      sourceAnimationSyncGenerationId:
        previewBody.preview.sourceSyncGenerationId,
      sessionNonce: previewBody.preview.sessionNonce,
      overrides: [],
      renderSettings: defaultLayoutRenderSettings,
    },
  );
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  assert.equal(
    metrics.layoutWaitForManifestCalls(),
    1,
    'the design route must wait on the runtime readiness contract',
  );
  assert.equal(
    metrics.layoutWorkspacePrepareCalls(),
    beforePrepare,
    'layout workspace preparation must not run before manifest capture',
  );
  controls.publishPendingLayoutManifests();
  project = await projectFrom(await designRequest);
  assert.equal(project.layoutBundle?.status, 'draft');
  assert.equal(
    metrics.layoutWorkspacePrepareCalls(),
    beforePrepare + 1,
  );
});

test('missing runtime manifest returns structured downstream failure context', async t => {
  const {baseUrl, metrics, controls} = await start(t);
  let project = await toScenes(baseUrl);
  const sourceSyncGenerationId = project.animationSyncBundle!.generation.generationId;
  const beforeRevision = project.revision;
  const previewResponse = await fetch(
    `${baseUrl}/api/projects/${project.id}/layout/preview`,
    {headers: {'X-Pad-Parent-Origin': 'http://127.0.0.1'}},
  );
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json() as {
    preview: {sessionNonce: string; sourceSyncGenerationId: string};
  };
  controls.setLayoutManifestError(
    new LayoutPreviewError(
      'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE',
      'Runtime chưa gửi node manifest.',
      {
        diagnostic: {
          stage: 'layout-design',
          status: 'blocked',
          artifactPath: null,
          artifactStatus: 'not-created',
          sourceSyncGenerationId,
          details: {manifestStatus: 'missing', runtimeWorkspacePrepared: true},
        },
      },
    ),
  );
  const failureResponse = await request(
    baseUrl,
    project,
    'PUT',
    `/api/projects/${project.id}/layout/design`,
    {
      generationId: randomUUID(),
      baseGenerationId: null,
      sourceAnimationSyncGenerationId: previewBody.preview.sourceSyncGenerationId,
      sessionNonce: previewBody.preview.sessionNonce,
      overrides: [],
      renderSettings: defaultLayoutRenderSettings,
    },
  );
  assert.equal(failureResponse.status, 409);
  const payload = await failureResponse.json() as {
    error: {
      code: string;
      stage: string;
      status: string;
      artifactPath: string | null;
      diagnostic: {details: {manifestStatus: string}};
    };
  };
  assert.equal(payload.error.code, 'LAYOUT_PREVIEW_MANIFEST_UNAVAILABLE');
  assert.equal(payload.error.stage, 'layout-design');
  assert.equal(payload.error.status, 'blocked');
  assert.match(payload.error.artifactPath ?? '', /layout[\\/]failures[\\/]/);
  assert.equal(payload.error.diagnostic.details.manifestStatus, 'missing');
  assert.equal(metrics.layoutFailureRecordCalls(), 1);
  project = await projectFrom(await fetch(`${baseUrl}/api/projects/${project.id}`));
  assert.equal(project.revision, beforeRevision);
  assert.equal(project.currentStep, 'scenes');
  assert.equal(project.layoutBundle, null);
});

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
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {acceptDegradedSemantic: true}));
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
  const secondPreviewBody = await secondPreview.json() as {preview: {generationId: string; sessionNonce: string; sourceSyncGenerationId: string}};
  const approvedGenerationId = project.layoutBundle!.generation.generationId;
  assert.equal(secondPreviewBody.preview.generationId, approvedGenerationId);
  assert.equal(
    secondPreviewBody.preview.sourceSyncGenerationId,
    project.animationSyncBundle!.generation.generationId,
  );
  assert.notEqual(
    secondPreviewBody.preview.generationId,
    secondPreviewBody.preview.sourceSyncGenerationId,
  );
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
  // Opening scene generation calls prepare again. A current persisted plan is
  // reused even when the installed planner implementation has moved forward.
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {
    generationId: randomUUID(),
    plannerModel: 'newer-planner-model',
    plannerReasoningEffort: 'low',
  }));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/generate`, {
    generationId: randomUUID(),
    model: 'scene-model',
    reasoningEffort: 'low',
  }));

  assert.equal(metrics.plannerRequests.length, 1);
  assert.equal(metrics.plannerRequests[0]?.model, 'planner-model');
  assert.equal(metrics.plannerRequests[0]?.reasoningEffort, 'high');
  assert.equal(metrics.plannerRequests[0]?.semanticSourceText, narrationSourceText);
  assert.ok(metrics.plannerRequests[0]?.units.every(unit => unit.semanticText.length > 0));
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

test('visual replan preserves generated voice files, alignment identities, and timestamps', async t => {
  const {baseUrl, metrics} = await start(t);
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));

  const voiceBefore = structuredClone(project.voiceBundle!);
  const outlineBefore = structuredClone(project.outline!);
  const beatIdsBefore = project.voiceVisualPlan!.sections.flatMap(section => section.beats.map(beat => beat.id));
  const planRevisionBefore = project.voiceVisualPlan!.contentRevision;
  const plannerCallsBefore = metrics.plannerRequests.length;

  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {
    generationId: randomUUID(),
    forceVisualReplan: true,
    plannerModel: 'planner-model',
    plannerReasoningEffort: 'high',
  }));

  assert.equal(metrics.plannerRequests.length, plannerCallsBefore + 1);
  assert.deepEqual(project.voiceBundle, voiceBefore, 'visual-only planning must not mutate audio paths, alignment, or timestamps');
  assert.deepEqual(project.outline, outlineBefore, 'the section skeleton consumed by VoiceBundle must stay byte-for-byte stable');
  assert.deepEqual(project.voiceVisualPlan!.sections.flatMap(section => section.beats.map(beat => beat.id)), beatIdsBefore);
  assert.equal(project.voiceVisualPlan!.narrationRevision, voiceBefore.sourceNarrationRevision);
  assert.equal(project.voiceVisualPlan!.contentRevision, planRevisionBefore + 1);
  assert.ok(project.voiceVisualPlan!.sections.every(section => section.beats.every(beat => beat.visualIntent)));
  assert.equal(project.voiceBundle!.status, 'approved');
});

test('editing visual input preserves voice and replans against the new current input', async t => {
  const {baseUrl} = await start(t);
  let project = await create(baseUrl);
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: narrationSourceText, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
  const voiceBefore = structuredClone(project.voiceBundle!);

  const changedTopicInput = {
    ...project.topicInput,
    background: {mode: 'dark' as const, color: '#223344'},
    videoFrame: {...project.topicInput.videoFrame!, fps: 24 as const},
  };
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}`, {topicInput: changedTopicInput}));
  assert.deepEqual(project.voiceBundle, voiceBefore);
  assert.equal(project.voiceBundle!.status, 'approved');
  assert.equal(project.outline!.status, 'draft');
  assert.equal(project.voiceVisualPlan!.status, 'draft');

  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {
    generationId: randomUUID(),
    forceVisualReplan: true,
  }));
  assert.deepEqual(project.voiceBundle, voiceBefore);
  assert.deepEqual(project.outline!.sourceInput, changedTopicInput);
  assert.equal(project.outline!.status, 'approved');
  assert.equal(project.voiceVisualPlan!.status, 'approved');
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

test('candidate generation rejects deterministic fallback before workspace preparation or persistence', async t => {
  const app = await start(t);
  let project = await toScenes(app.baseUrl);
  const beforeProject = structuredClone(project);
  const beforePrepareCalls = app.metrics.workspacePrepareCalls();
  const beforeQualityCalls = app.metrics.visualQualityValidationCalls();
  const beforeProjectUpdates = app.metrics.projectUpdateCalls();
  const beforeCandidateSaves = app.metrics.historySaveCandidateCalls();
  app.controls.setFallbackCandidateGeneration(true);

  const failed = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/candidates`,
    {
      generationId: randomUUID(),
      guidance: 'Tạo lại cảnh đã chọn bằng TSX trực tiếp.',
      scope: {sceneIds: [project.motionCanvasBundle!.scenes[0]!.id]},
    },
  );
  const body = await failed.json() as {error?: {code?: string}};
  assert.equal(failed.status, 503, JSON.stringify(body));
  assert.equal(body.error?.code, 'CODEX_MOTION_CANVAS_INVALID_RESPONSE');
  assert.equal(app.metrics.workspacePrepareCalls(), beforePrepareCalls);
  assert.equal(app.metrics.visualQualityValidationCalls(), beforeQualityCalls);
  assert.equal(app.metrics.projectUpdateCalls(), beforeProjectUpdates);
  assert.equal(app.metrics.historySaveCandidateCalls(), beforeCandidateSaves);
  assert.deepEqual(
    await projectFrom(await request(app.baseUrl, null, 'GET', `/api/projects/${project.id}`)),
    beforeProject,
  );
});

test('applying a legacy fallback candidate rejects before project or history mutation', async t => {
  const app = await start(t);
  let project = await toScenes(app.baseUrl);
  const original = project.motionCanvasBundle!;
  const candidateResponse = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/candidates`,
    {
      generationId: randomUUID(),
      guidance: 'Làm cảnh rõ ràng hơn.',
      scope: {sceneIds: [original.scenes[0]!.id]},
    },
  );
  const candidateBody = await candidateResponse.json() as {candidate?: MotionCanvasCandidateRecord; error?: unknown};
  assert.equal(candidateResponse.status, 201, JSON.stringify(candidateBody));
  const candidate = candidateBody.candidate!;
  const legacyBundle = {
    ...candidate.bundle,
    scenes: candidate.bundle.scenes.map((scene, index) =>
      index === 0 ? {...scene, name: `${scene.name} safe fallback`} : scene,
    ),
  };
  const legacyCandidate = MotionCanvasCandidateRecordSchema.parse({
    ...candidate,
    candidateId: randomUUID(),
    candidateContentHash: hashMotionCanvasBundle(legacyBundle),
    requestFingerprint: hashJson({legacy: randomUUID()}),
    bundle: legacyBundle,
  });
  await app.historyStore.saveCandidate(legacyCandidate);

  const beforeProject = structuredClone(project);
  const beforeReadCalls = app.metrics.workspaceReadSceneSourcesCalls();
  const beforePrepareCalls = app.metrics.workspacePrepareCalls();
  const beforeQualityCalls = app.metrics.visualQualityValidationCalls();
  const beforeProjectUpdates = app.metrics.projectUpdateCalls();
  const beforeEnsureCalls = app.metrics.historyEnsureVersionCalls();
  const beforeDecisionCalls = app.metrics.historyDecisionCalls();
  const failed = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/candidates/${legacyCandidate.candidateId}/apply`,
    {},
  );
  const body = await failed.json() as {error?: {code?: string}};
  assert.equal(failed.status, 503, JSON.stringify(body));
  assert.equal(body.error?.code, 'CODEX_MOTION_CANVAS_INVALID_RESPONSE');
  assert.equal(app.metrics.workspaceReadSceneSourcesCalls(), beforeReadCalls);
  assert.equal(app.metrics.workspacePrepareCalls(), beforePrepareCalls);
  assert.equal(app.metrics.visualQualityValidationCalls(), beforeQualityCalls);
  assert.equal(app.metrics.projectUpdateCalls(), beforeProjectUpdates);
  assert.equal(app.metrics.historyEnsureVersionCalls(), beforeEnsureCalls);
  assert.equal(app.metrics.historyDecisionCalls(), beforeDecisionCalls);
  assert.deepEqual(
    await projectFrom(await request(app.baseUrl, null, 'GET', `/api/projects/${project.id}`)),
    beforeProject,
  );
});

test('applying a pending candidate rejects workspace fallback before visual or history mutation', async t => {
  const app = await start(t);
  const project = await toScenes(app.baseUrl);
  const original = project.motionCanvasBundle!;
  const candidateResponse = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/candidates`,
    {
      generationId: randomUUID(),
      guidance: 'Làm cảnh rõ ràng hơn.',
      scope: {sceneIds: [original.scenes[0]!.id]},
    },
  );
  const candidateBody = await candidateResponse.json() as {candidate?: MotionCanvasCandidateRecord; error?: unknown};
  assert.equal(candidateResponse.status, 201, JSON.stringify(candidateBody));
  const candidate = candidateBody.candidate!;
  app.controls.setSceneSourceOverride(
    candidate.bundle.scenes[0]!.id,
    '// pad-semantic:unverified-fallback\n' + 'direct TSX source '.repeat(20),
  );

  const beforeProject = structuredClone(project);
  const beforeReadCalls = app.metrics.workspaceReadSceneSourcesCalls();
  const beforeQualityCalls = app.metrics.visualQualityValidationCalls();
  const beforeProjectUpdates = app.metrics.projectUpdateCalls();
  const beforeEnsureCalls = app.metrics.historyEnsureVersionCalls();
  const beforeDecisionCalls = app.metrics.historyDecisionCalls();
  const failed = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/candidates/${candidate.candidateId}/apply`,
    {},
  );
  const body = await failed.json() as {error?: {code?: string}};
  assert.equal(failed.status, 503, JSON.stringify(body));
  assert.equal(body.error?.code, 'CODEX_MOTION_CANVAS_INVALID_RESPONSE');
  assert.equal(app.metrics.workspaceReadSceneSourcesCalls(), beforeReadCalls + 1);
  assert.equal(app.metrics.visualQualityValidationCalls(), beforeQualityCalls);
  assert.equal(app.metrics.historyDecisionCalls(), beforeDecisionCalls);
  assert.equal(app.metrics.historyEnsureVersionCalls(), beforeEnsureCalls);
  assert.equal(app.metrics.projectUpdateCalls(), beforeProjectUpdates);
  assert.deepEqual(
    await projectFrom(await request(app.baseUrl, null, 'GET', `/api/projects/${project.id}`)),
    beforeProject,
  );
});

test('restoring a fallback version rejects after source read but before preparation or transition', async t => {
  const app = await start(t);
  const project = await toScenes(app.baseUrl);
  const artifact = structuredClone(project.motionCanvasBundle!);
  const sourceVersion = MotionCanvasVersionRecordSchema.parse({
    versionId: randomUUID(),
    projectId: project.id,
    createdAt: now,
    origin: 'manual_checkpoint',
    label: 'Legacy direct-TSX checkpoint',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: project.revision,
    contentHash: hashMotionCanvasBundle(artifact),
    artifact,
  });
  await app.historyStore.ensureVersion(sourceVersion, {force: true});
  app.controls.setSceneSourceOverride(
    artifact.scenes[0]!.id,
    '// pad-semantic:unverified-fallback\n' + 'direct TSX source '.repeat(20),
  );

  const beforeProject = structuredClone(project);
  const beforeReadCalls = app.metrics.workspaceReadSceneSourcesCalls();
  const beforePrepareCalls = app.metrics.workspacePrepareCalls();
  const beforeQualityCalls = app.metrics.visualQualityValidationCalls();
  const beforeProjectUpdates = app.metrics.projectUpdateCalls();
  const beforeEnsureCalls = app.metrics.historyEnsureVersionCalls();
  const failed = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/versions/${sourceVersion.versionId}/restore`,
    {},
  );
  const body = await failed.json() as {error?: {code?: string}};
  assert.equal(failed.status, 503, JSON.stringify(body));
  assert.equal(body.error?.code, 'CODEX_MOTION_CANVAS_INVALID_RESPONSE');
  assert.equal(app.metrics.workspaceReadSceneSourcesCalls(), beforeReadCalls + 1);
  assert.equal(app.metrics.workspacePrepareCalls(), beforePrepareCalls);
  assert.equal(app.metrics.visualQualityValidationCalls(), beforeQualityCalls);
  assert.equal(app.metrics.projectUpdateCalls(), beforeProjectUpdates);
  assert.equal(app.metrics.historyEnsureVersionCalls(), beforeEnsureCalls);
  assert.deepEqual(
    await projectFrom(await request(app.baseUrl, null, 'GET', `/api/projects/${project.id}`)),
    beforeProject,
  );
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
  const beforeIdempotentVerifyCalls = metrics.workspaceVerifyCalls();
  const beforeIdempotentReadCalls = metrics.workspaceReadSceneSourcesCalls();
  const beforeIdempotentProjectUpdates = metrics.projectUpdateCalls();
  const beforeIdempotentEnsureCalls = metrics.historyEnsureVersionCalls();
  const beforeIdempotentDecisionCalls = metrics.historyDecisionCalls();
  const idempotentResponse = await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/candidates/${candidate.candidateId}/apply`, {});
  const idempotentBody = await idempotentResponse.json() as ProjectReply;
  assert.equal(idempotentResponse.status, 200, JSON.stringify(idempotentBody));
  assert.deepEqual(idempotentBody.project, project);
  assert.equal(metrics.workspaceVerifyCalls(), beforeIdempotentVerifyCalls);
  assert.equal(metrics.workspaceReadSceneSourcesCalls(), beforeIdempotentReadCalls);
  assert.equal(metrics.projectUpdateCalls(), beforeIdempotentProjectUpdates);
  assert.equal(metrics.historyEnsureVersionCalls(), beforeIdempotentEnsureCalls);
  assert.equal(metrics.historyDecisionCalls(), beforeIdempotentDecisionCalls);
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
    project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {acceptDegradedSemantic: true}));
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

const twoUnitNarration = 'Tìm kiếm nhị phân liên tục thu hẹp khoảng tìm kiếm đã được sắp xếp. Nhờ vậy nó tìm đúng đáp án nhanh hơn duyệt tuần tự.';

function twoScenePlanner() {
  return {
    async plan(request: {units: Array<{id: string; text: string}>}) {
      const blueprint = (unitId: string) => ({
        unitId,
        primaryBlock: 'block-concept-card' as const,
        visualLifecycle: {enter: ['block-concept-card'], stay: ['block-concept-card', 'concept-label'], exit: ['block-concept-card']},
        compositionContract: {
          visualFocus: 'Khối khái niệm trung tâm giữ toàn bộ sự chú ý của beat này.',
          hierarchy: ['block-concept-card', 'concept-label'],
          semanticRole: 'claim' as const,
          layout: 'center-focus' as const,
          density: 'balanced' as const,
          spacingNotes: 'Giữ khoảng thở rộng quanh khối trung tâm và giữa các nhãn.',
        },
        visualPurpose: 'Biến ý chính của câu thành một quan hệ nhìn thấy được.',
        visualDescription: 'Một sơ đồ trung tâm minh họa quan hệ được nhắc tới.',
        animationDescription: 'Phần tử chính di chuyển vào vị trí rồi giữ hình.',
      });
      const middle = Math.max(1, Math.floor(request.units.length / 2));
      return {
        model: 'fake-codex',
        usage: null,
        output: {
          scenes: [request.units.slice(0, middle), request.units.slice(middle)].map((units, index) => ({
            title: `Fake scene ${index + 1}`,
            goal: 'Giải thích nội dung chính bằng hình ảnh.',
            stateHandoffIncoming: index === 0 ? null : 'Kế thừa anchor từ scene trước.',
            stateHandoffOutgoing: index === 0 ? 'Giữ anchor cho scene sau.' : null,
            units: units.map(unit => blueprint(unit.id)),
          })),
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
}

async function prepareTwoScenes(baseUrl: string) {
  let project = await projectFrom(await request(baseUrl, null, 'POST', '/api/projects', {creationId: randomUUID(), topicInput, narrationSourceText: twoUnitNarration}));
  project = await projectFrom(await request(baseUrl, project, 'PUT', `/api/projects/${project.id}/narration`, {sourceText: twoUnitNarration, projectRules: []}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/narration/approve`, {sourceHash: project.narration!.review!.sourceHash, rulesHash: project.narration!.review!.rulesHash}));
  project = await projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/production/prepare`, {generationId: randomUUID()}));
  return projectFrom(await request(baseUrl, project, 'POST', `/api/projects/${project.id}/voice/generate`, voiceRequest(randomUUID())));
}

test('motion scene generation returns 202, continues after disconnect, and joins duplicate requests', async t => {
  const app = await start(t);
  let project = await prepareTwoScenes(app.baseUrl);
  let release!: () => void;
  const generationGate = new Promise<void>(resolve => { release = resolve; });
  app.controls.setMotionGenerationGate(generationGate);
  const generationId = randomUUID();
  const body = {generationId};

  const [accepted, duplicate] = await Promise.all([
    request(
      app.baseUrl,
      project,
      'POST',
      `/api/projects/${project.id}/motion-canvas/generate`,
      body,
    ),
    request(
      app.baseUrl,
      project,
      'POST',
      `/api/projects/${project.id}/motion-canvas/generate`,
      body,
    ),
  ]);
  assert.equal(accepted.status, 202);
  const acceptedPayload = await accepted.json() as {progress: {state: string; generationId: string}};
  assert.equal(acceptedPayload.progress.state, 'running');
  assert.equal(acceptedPayload.progress.generationId, generationId);
  assert.equal(duplicate.status, 202);
  await duplicate.body?.cancel();

  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(app.metrics.motionCalls(), 1);
  assert.equal(app.metrics.motionCalls(), 1);

  const otherGeneration = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId: randomUUID()},
  );
  assert.equal(otherGeneration.status, 409);
  const otherGenerationPayload = await otherGeneration.json() as {error: {code: string}};
  assert.equal(otherGenerationPayload.error.code, 'MOTION_CANVAS_GENERATION_IN_PROGRESS');

  const staleRevision = await request(
    app.baseUrl,
    {...project, revision: project.revision + 1},
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    body,
  );
  assert.equal(staleRevision.status, 409);

  release();
  const completed = await waitForMotionProgress(app.baseUrl, project.id);
  assert.equal(completed.state, 'completed');
  assert.equal(app.metrics.motionCalls(), 1);
  project = await projectFrom(await request(app.baseUrl, project, 'GET', `/api/projects/${project.id}`));
  assert.equal(project.motionCanvasBundle?.generation.generationId, generationId);
  const completedRepeat = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    body,
  );
  assert.equal(completedRepeat.status, 200);
  await completedRepeat.body?.cancel();
  assert.equal(app.metrics.motionCalls(), 1);
});

test('background generation records the structured root cause and reaches failed terminal state', async t => {
  const app = await start(t);
  const project = await prepareTwoScenes(app.baseUrl);
  const failure = new MotionCanvasGenerationError(
    'CODEX_MOTION_CANVAS_TURN_FAILED',
    'Scene 1: Codex failed to generate the scene.',
    {
      rootCause: {
        reason: 'turn_failed',
        code: 'CODEX_TURN_FAILED',
        operation: 'turn/completed',
        message: 'Codex turn failed.',
        providerMessage: 'The provider refused this turn.',
        providerCode: 'provider_failed',
      },
    },
  );
  app.controls.setMotionGenerationError(failure);
  const generationId = randomUUID();
  const response = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId},
  );

  assert.equal(response.status, 202);
  await response.body?.cancel();
  const progress = await waitForMotionProgress(app.baseUrl, project.id);
  assert.equal(progress.state, 'failed');
  assert.equal(progress.generationId, generationId);
  assert.equal((progress as {completedScenes?: number}).completedScenes, 0);
  assert.equal((progress as {failedScenes?: number}).failedScenes, 1);
  assert.equal(app.metrics.motionCalls(), 1);

  const failureResponse = await fetch(
    `${app.baseUrl}/api/projects/${project.id}/motion-canvas/failure`,
  );
  assert.equal(failureResponse.status, 200);
  const payload = await failureResponse.json() as {
    failure: MotionCanvasFailureSummary | null;
  };
  assert.equal(payload.failure?.generationId, generationId);
  assert.equal(payload.failure?.rootCause?.reason, 'turn_failed');
  assert.equal(payload.failure?.rootCause?.operation, 'turn/completed');
});

test('unresolved deterministic fallback is recorded as generation response-invalid before compile', async t => {
  const app = await start(t);
  const project = await prepareTwoScenes(app.baseUrl);
  app.controls.setFallbackCandidateGeneration(true);
  const beforePrepareCalls = app.metrics.workspacePrepareCalls();
  const beforeQualityCalls = app.metrics.visualQualityValidationCalls();
  const generationId = randomUUID();

  const response = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId},
  );
  assert.equal(response.status, 202);
  await response.body?.cancel();

  const progress = await waitForMotionProgress(app.baseUrl, project.id);
  assert.equal(progress.state, 'failed');
  assert.equal(progress.generationId, generationId);
  assert.equal(app.metrics.workspacePrepareCalls(), beforePrepareCalls);
  assert.equal(app.metrics.visualQualityValidationCalls(), beforeQualityCalls);

  const failureResponse = await fetch(
    `${app.baseUrl}/api/projects/${project.id}/motion-canvas/failure`,
  );
  assert.equal(failureResponse.status, 200);
  const payload = await failureResponse.json() as {
    failure: MotionCanvasFailureSummary | null;
  };
  assert.equal(payload.failure?.stage, 'generation');
  assert.equal(payload.failure?.code, 'CODEX_MOTION_CANVAS_INVALID_RESPONSE');
  assert.match(payload.failure?.message ?? '', /source-validation\/response-invalid/u);
  assert.equal(payload.failure?.rootCause, null);
  assert.match(payload.failure?.firstIssueReason ?? '', /Deterministic fallback is not publishable/u);
});

test('user-decided scene recovery reuses the checkpoint and regenerates only failed scenes', async t => {
  const app = await start(t, {narrationVisualPlanner: twoScenePlanner()});
  const project = await prepareTwoScenes(app.baseUrl);
  app.controls.setFallbackSceneIndexes([0]);
  const failedGenerationId = randomUUID();
  const failedResponse = await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId: failedGenerationId},
  );
  assert.equal(failedResponse.status, 202);
  await failedResponse.body?.cancel();
  const failedProgress = await waitForMotionProgress(app.baseUrl, project.id);
  assert.equal(failedProgress.state, 'failed');

  app.controls.setFallbackSceneIndexes([]);
  const beforeRecoveryCalls = app.metrics.motionCalls();
  const recovered = await projectFrom(await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {
      generationId: randomUUID(),
      resumeFromGenerationId: failedGenerationId,
      guidance: 'Regenerate only the failed scene from the retained checkpoint.',
    },
  ));

  assert.equal(app.metrics.motionCalls() - beforeRecoveryCalls, 1);
  const recoveryRequest = app.metrics.motionCanvasRequests.at(-1)!;
  assert.deepEqual(recoveryRequest.sectionIndexes, [0]);
  assert.equal(recoveryRequest.hasCurrentScenes, true);
  assert.equal(recoveryRequest.currentSceneIds?.length, 2);
  assert.equal(recoveryRequest.regenerateFromScratch, false);
  assert.equal(recovered.motionCanvasBundle?.scenes.length, 2);
  assert.equal(recovered.motionCanvasBundle?.scenes[1]?.name, 'Scene 2');
});

test('rendered-quality failures use bounded retries, re-validate the whole bundle, and never approve a failed bundle', async t => {
  const validatedSceneCounts: number[] = [];
  const failedAt = '2026-01-01T00:00:00.000Z';
  let validations = 0;
  const failFirstSceneOnce = {
    async validate(input: {scenes: MotionCanvasSourceScene[]}) {
      validations += 1;
      validatedSceneCounts.push(input.scenes.length);
      if (validations === 1) {
        throw new MotionCanvasVisualQualityError({version: VISUAL_QUALITY_GATE_VERSION, status: 'failed', validatedAt: failedAt, sourceHash: 'a'.repeat(64), scenes: [], issues: [{code: 'frame-too-sparse', sceneId: input.scenes[0]!.id, beatId: null, timeSeconds: 0, semanticKey: null, bounds: null, reason: 'Visible content covers too little of the frame.'}]});
      }
      return {version: VISUAL_QUALITY_GATE_VERSION as typeof VISUAL_QUALITY_GATE_VERSION, status: 'passed' as const, validatedAt: failedAt, sourceHash: motionCanvasSceneSourceHash(input.scenes), scenes: [], issues: []};
    },
  };
  const retried = await start(t, {narrationVisualPlanner: twoScenePlanner(), motionCanvasVisualQualityGate: failFirstSceneOnce});
  let project = await prepareTwoScenes(retried.baseUrl);
  const beforeRetryCalls = retried.metrics.motionCalls();
  project = await projectFrom(await request(retried.baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/generate`, {generationId: randomUUID()}));

  assert.equal(project.motionCanvasBundle!.scenes.length, 2);
  assert.equal(validations, 2);
  // The retry regenerates only the failed section, but the second validation
  // must cover every scene in the merged bundle.
  assert.deepEqual(validatedSceneCounts, [2, 2]);
  assert.equal(retried.metrics.motionCalls() - beforeRetryCalls, 2);
  assert.equal(retried.metrics.motionDiscards(), 2, 'quality retry releases the stale internal fingerprint, then successful persistence clears the retry cache');
  const retryDiagnostics = project.motionCanvasBundle!.generationDiagnostics!.filter(diagnostic => diagnostic.stage === 'quality-retry');
  assert.deepEqual(retryDiagnostics.map(diagnostic => diagnostic.outcome), ['failed', 'passed']);
  assert.match(retryDiagnostics[1]!.reason, /Re-rendered 1 failed scene/);
  assert.equal(project.motionCanvasBundle!.visualValidation!.version, VISUAL_QUALITY_GATE_VERSION);
  assert.equal(project.motionCanvasBundle!.visualValidation!.status, 'passed');
  // The retry must tell the model why the previous attempt failed, not just re-roll blind.
  const retryRequest = retried.metrics.motionCanvasRequests.at(-1);
  assert.match(retryRequest?.guidance ?? '', /Visible content covers too little of the frame/);
  // Approve only passes because the stored hash covers the whole merged bundle.
  project = await projectFrom(await request(retried.baseUrl, project, 'POST', `/api/projects/${project.id}/motion-canvas/approve`, {acceptDegradedSemantic: true}));
  assert.equal(project.motionCanvasBundle!.status, 'approved');

  const alwaysFail = {
    async validate(input: {scenes: MotionCanvasSourceScene[]}) {
      throw new MotionCanvasVisualQualityError({version: VISUAL_QUALITY_GATE_VERSION, status: 'failed', validatedAt: failedAt, sourceHash: 'a'.repeat(64), scenes: [], issues: [{code: 'frame-too-dense', sceneId: input.scenes[0]!.id, beatId: null, timeSeconds: 0, semanticKey: null, bounds: null, reason: 'Visible content covers too much of the frame.'}]});
    },
  };
  const blocked = await start(t, {narrationVisualPlanner: twoScenePlanner(), motionCanvasVisualQualityGate: alwaysFail});
  const stuck = await prepareTwoScenes(blocked.baseUrl);
  const beforeBlockedCalls = blocked.metrics.motionCalls();
  const failedResponse = await request(blocked.baseUrl, stuck, 'POST', `/api/projects/${stuck.id}/motion-canvas/generate`, {generationId: randomUUID()});
  assert.equal(failedResponse.status, 202);
  const failedProgress = await waitForMotionProgress(blocked.baseUrl, stuck.id);
  assert.equal(failedProgress.state, 'failed');
  // One initial bundle turn plus six bounded visual-quality retries; the
  // seventh failed validation is terminal and must not trigger another turn.
  assert.equal(blocked.metrics.motionCalls() - beforeBlockedCalls, 7);
  const failureStatus = await fetch(
    `${blocked.baseUrl}/api/projects/${stuck.id}/motion-canvas/failure`,
  );
  assert.equal(failureStatus.status, 200);
  const failurePayload = await failureStatus.json() as {
    failure: MotionCanvasFailureSummary | null;
  };
  assert.match(
    failurePayload.failure?.recoveryGuidance ?? '',
    /Visible content covers too much of the frame/,
  );
  assert.match(failurePayload.failure?.recoveryGuidance ?? '', /issue=frame-too-dense/);
  const reloaded = await projectFrom(await request(blocked.baseUrl, null, 'GET', `/api/projects/${stuck.id}`));
  assert.ok(!reloaded.motionCanvasBundle);
  const approveWithoutBundle = await request(blocked.baseUrl, reloaded, 'POST', `/api/projects/${reloaded.id}/motion-canvas/approve`, {});
  assert.equal(approveWithoutBundle.status, 409);
});

test('renderer infrastructure retry stays local and never spends another Codex scene turn', async t => {
  const failedAt = '2026-01-01T00:00:00.000Z';
  let validations = 0;
  const flakyRenderer = {
    async validate(input: {scenes: MotionCanvasSourceScene[]}) {
      validations += 1;
      if (validations === 1) {
        throw new MotionCanvasVisualQualityError({
          version: VISUAL_QUALITY_GATE_VERSION,
          status: 'failed',
          validatedAt: failedAt,
          sourceHash: 'a'.repeat(64),
          scenes: [],
          issues: [{
            code: 'renderer-error',
            sceneId: input.scenes[0]!.id,
            beatId: null,
            timeSeconds: 0,
            semanticKey: null,
            bounds: null,
            reason: 'Headless browser timed out.',
          }],
        });
      }
      return {
        version: VISUAL_QUALITY_GATE_VERSION as typeof VISUAL_QUALITY_GATE_VERSION,
        status: 'passed' as const,
        validatedAt: failedAt,
        sourceHash: motionCanvasSceneSourceHash(input.scenes),
        scenes: [],
        issues: [],
      };
    },
  };
  const app = await start(t, {
    narrationVisualPlanner: twoScenePlanner(),
    motionCanvasVisualQualityGate: flakyRenderer,
  });
  let project = await prepareTwoScenes(app.baseUrl);
  const generationId = randomUUID();
  const beforeCalls = app.metrics.motionCalls();
  project = await projectFrom(await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId},
  ));

  assert.equal(validations, 2);
  assert.equal(app.metrics.motionCalls() - beforeCalls, 1);
  assert.ok(project.motionCanvasBundle);
  const progressResponse = await fetch(
    `${app.baseUrl}/api/projects/${project.id}/motion-canvas/status`,
  );
  assert.equal(progressResponse.status, 200);
  const progressBody = await progressResponse.json() as {
    progress: {generationId: string; state: string};
  };
  assert.equal(progressBody.progress.generationId, generationId);
  assert.equal(progressBody.progress.state, 'completed');
});

test('timeline mismatch renderer failure repairs the scene instead of retrying only the renderer', async t => {
  const failedAt = '2026-01-01T00:00:00.000Z';
  let validations = 0;
  const timelineGate = {
    async validate(input: {scenes: MotionCanvasSourceScene[]}) {
      validations += 1;
      if (validations === 1) {
        const actual = input.scenes[0]!;
        const expected = input.scenes[1]!;
        const actualName = path.posix.basename(actual.filePath.replaceAll('\\', '/'), '.tsx');
        const expectedName = path.posix.basename(expected.filePath.replaceAll('\\', '/'), '.tsx');
        throw new MotionCanvasVisualQualityError({
          version: VISUAL_QUALITY_GATE_VERSION,
          status: 'failed',
          validatedAt: failedAt,
          sourceHash: 'a'.repeat(64),
          scenes: [],
          issues: [{
            code: 'renderer-error',
            sceneId: actual.id,
            beatId: null,
            timeSeconds: 0,
            semanticKey: null,
            bounds: null,
            reason: `Quality sample synthetic-sample rendered scene ${actualName}, expected ${expectedName}.`,
          }],
        });
      }
      return {
        version: VISUAL_QUALITY_GATE_VERSION as typeof VISUAL_QUALITY_GATE_VERSION,
        status: 'passed' as const,
        validatedAt: failedAt,
        sourceHash: motionCanvasSceneSourceHash(input.scenes),
        scenes: [],
        issues: [],
      };
    },
  };
  const app = await start(t, {
    narrationVisualPlanner: twoScenePlanner(),
    motionCanvasVisualQualityGate: timelineGate,
  });
  let project = await prepareTwoScenes(app.baseUrl);
  const beforeCalls = app.metrics.motionCalls();
  project = await projectFrom(await request(
    app.baseUrl,
    project,
    'POST',
    `/api/projects/${project.id}/motion-canvas/generate`,
    {generationId: randomUUID()},
  ));

  assert.equal(validations, 2);
  assert.equal(app.metrics.motionCalls() - beforeCalls, 2);
  assert.deepEqual(app.metrics.motionCanvasRequests.at(-1)?.sectionIndexes, [0]);
  assert.match(app.metrics.motionCanvasRequests.at(-1)?.guidance ?? '', /timeline mismatch/u);
  assert.ok(project.motionCanvasBundle);
});
