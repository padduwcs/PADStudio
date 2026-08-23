import {randomUUID} from 'node:crypto';
import {createAppContext} from '../src/backend/appContext.ts';
import {hashMotionCanvasBundle} from '../src/backend/motionCanvasHistoryStore.ts';
import {
  compileMotionCanvasSceneSpecV3,
  extractMotionCanvasSceneSpecV3,
} from '../src/backend/motionCanvasSceneSpecV3.ts';
import {buildMotionCanvasSemanticValidation} from '../src/backend/motionCanvasVisualQuality.ts';
import {MotionCanvasBundleSchema} from '../src/shared/topic.ts';

const projectId = process.argv
  .find(argument => argument.startsWith('--project='))
  ?.slice('--project='.length);
const allowWrite = process.argv.includes('--allow-write');

if (!projectId || !allowWrite) {
  console.info(`PAD Studio local Scene Graph recompiler

Usage:
  npm run motion:recompile -- --project=<project-id> --allow-write

This spends no AI or voice quota. It recompiles the current Scene Graph v3
with the current safe compiler, reruns rendered and semantic quality gates,
creates an immutable Motion workspace, and invalidates downstream sync/layout/
render through the normal project state transition.`);
  process.exit(projectId || allowWrite ? 1 : 0);
}
if (!/^[a-z0-9][a-z0-9-]{0,100}$/u.test(projectId)) {
  throw new Error('Project ID is not valid.');
}

const context = createAppContext();
const generationId = randomUUID();
let prepared = null;

try {
  const project = await context.repository.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} does not exist.`);
  const current = project.motionCanvasBundle;
  const outline = project.outline;
  const plan = project.voiceVisualPlan;
  if (!current || !outline || !plan) {
    throw new Error('Project does not have a current Motion/outline/visual plan.');
  }
  if (current.sourceVoiceVisualContentRevision !== plan.contentRevision) {
    throw new Error('Motion bundle is stale relative to the current Visual Intent.');
  }

  const sourceScenes = await context.motionCanvasWorkspace.readSceneSources(
    project.id,
    current,
  );
  const recompiledScenes = sourceScenes.map(scene => {
    const spec = extractMotionCanvasSceneSpecV3(scene.source);
    const section = plan.sections.find(
      candidate => candidate.outlineSectionId === scene.outlineSectionId,
    );
    const outlineSection = outline.sections.find(
      candidate => candidate.id === scene.outlineSectionId,
    );
    if (!spec || !section || !outlineSection) {
      throw new Error(
        `Scene ${scene.name} is not a current compiler-owned Scene Graph v3.`,
      );
    }
    return {
      ...scene,
      source: `${compileMotionCanvasSceneSpecV3({
        spec,
        beats: section.beats,
        outlineTitle: outlineSection.title,
        frame: project.topicInput.videoFrame,
        backgroundColor: project.topicInput.background.color,
        visualBible: plan.visualBible,
      }).trim()}\n`,
    };
  });

  prepared = await context.motionCanvasWorkspace.prepare(
    project.id,
    generationId,
    recompiledScenes,
    project.topicInput.videoFrame,
  );
  const lifecycle = new Map(
    recompiledScenes.flatMap(scene => {
      const section = plan.sections.find(
        candidate => candidate.outlineSectionId === scene.outlineSectionId,
      );
      return (section?.beats ?? []).map(beat => [beat.id, {
        stay: beat.visualLifecycle.stay,
        primaryBlock: beat.primaryBlock,
        compositionContract: beat.compositionContract,
        visualDescription: beat.visualDescription,
        visualPurpose: beat.visualPurpose,
        animationDescription: beat.animationDescription,
        visualIntent: beat.visualIntent,
      }]);
    }),
  );
  const sceneHandoff = new Map(
    recompiledScenes.map(scene => {
      const section = plan.sections.find(
        candidate => candidate.outlineSectionId === scene.outlineSectionId,
      );
      return [scene.id, {
        incoming: section?.stateHandoff?.incoming ?? null,
        outgoing: section?.stateHandoff?.outgoing ?? null,
      }];
    }),
  );
  const qualityOptions = {
    scenes: prepared.sourceScenes,
    lifecycle,
    frame: project.topicInput.videoFrame,
    backgroundColor: project.topicInput.background.color,
    visualBible: plan.visualBible,
    sceneHandoff,
    workspaceDirectory: prepared.workspaceDirectory,
    projectFile: prepared.projectFilePath,
  };
  if (context.motionCanvasVisualQualityGate.supportsSmokeMode) {
    await context.motionCanvasVisualQualityGate.validate({
      ...qualityOptions,
      mode: 'smoke',
    });
  }
  const visualValidation = await context.motionCanvasVisualQualityGate.validate({
    ...qualityOptions,
    mode: 'full',
  });
  const semanticValidation = buildMotionCanvasSemanticValidation(
    prepared.sourceScenes,
    plan,
  );
  if (semanticValidation.status !== 'passed') {
    throw new Error(
      `Recompiled semantic validation is ${semanticValidation.status}.`,
    );
  }

  const bundle = MotionCanvasBundleSchema.parse({
    ...current,
    status: 'draft',
    technicalReadyAt: new Date().toISOString(),
    contentRevision: current.contentRevision + 1,
    workspacePath: prepared.workspacePath,
    projectFile: prepared.projectFile,
    scenes: prepared.scenes,
    validation: prepared.validation,
    visualValidation,
    semanticValidation,
    generationDiagnostics: [
      ...(current.generationDiagnostics ?? []),
      {
        stage: 'generate',
        attempt: 0,
        reason:
          'Existing Scene Graph v3 was recompiled locally with the current safe geometry/compiler contract; no AI or voice provider was called.',
        outcome: 'passed',
      },
    ].slice(-32),
    generation: {
      ...current.generation,
      generationId,
      model: `${current.generation.model}, local-recompile-v3`.slice(0, 160),
      promptVersion: 'local-recompile-v3',
      generatedAt: new Date().toISOString(),
    },
  });

  await context.motionCanvasHistoryStore.ensureVersion({
    projectId: project.id,
    origin: 'baseline',
    label: 'Trước khi compiler recompile cục bộ',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: project.revision,
    contentHash: hashMotionCanvasBundle(current),
    artifact: current,
  });
  const updated = await context.repository.updateProject(
    project.id,
    {motionCanvasBundle: bundle},
    project.revision,
  );
  if (!updated) throw new Error('Project disappeared during local recompile.');
  prepared = null;
  await context.motionCanvasHistoryStore.ensureVersion({
    projectId: project.id,
    origin: 'baseline',
    label: 'Scene Graph được compiler recompile cục bộ',
    parentVersionId: null,
    restoredFromVersionId: null,
    candidateId: null,
    projectRevision: updated.revision,
    contentHash: hashMotionCanvasBundle(bundle),
    artifact: bundle,
  });
  console.info(JSON.stringify({
    ok: true,
    projectId,
    revision: updated.revision,
    generationId,
    visual: visualValidation.status,
    semantic: semanticValidation.status,
    downstreamInvalidated: {
      sync: updated.animationSyncBundle?.status ?? null,
      layout: updated.layoutBundle,
      render: updated.renderBundle,
    },
  }));
} finally {
  if (prepared) {
    await context.motionCanvasWorkspace
      .discard(projectId, generationId)
      .catch(() => undefined);
  }
  context.codexConnection.close();
}
