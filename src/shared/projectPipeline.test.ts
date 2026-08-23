import assert from 'node:assert/strict';
import test from 'node:test';
import {
  animationSyncIsStale,
  animationSyncMatchesSourcesStructure,
  animationSyncPrerequisitesAreReady,
  finalRenderIsCurrent,
  finalRenderIsReady,
  finalRenderIsStale,
  finalRenderMatchesLayout,
  finalRenderPrerequisitesAreReady,
  layoutIsCurrent,
  layoutIsReady,
  layoutIsStale,
  layoutMatchesAnimationSync,
  layoutPrerequisitesAreReady,
  motionCanvasIsReady,
  motionCanvasIsStale,
  outlineIsCurrent,
  outlineIsReady,
  outlineIsStale,
  sameValue,
  voiceIsStale,
  voiceMatchesPlanStructure,
  voicePrerequisitesAreReady,
  voiceVisualIsReady,
  voiceVisualIsStale,
  voiceVisualMatchesOutline,
} from './projectPipeline.ts';
import type {TopicProject} from './topic.ts';

const OUTLINE_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
] as const;
const BEAT_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
] as const;
const SCENE_IDS = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
] as const;
const NARRATION_HASH = 'f'.repeat(64);

function event(beatId: string, edge: 'start' | 'end') {
  return `beat:${beatId}:${edge}`;
}

function createReadyProject(): TopicProject {
  const topicInput = {
    topic: 'Binary search from first principles',
    learningGoal: 'Understand the invariant.',
    audience: 'beginner' as const,
    duration: 'concise' as const,
  };
  const sections = OUTLINE_IDS.map((id, index) => ({
    id,
    title: `Section ${index + 1}`,
    goal: `Goal for section ${index + 1}`,
    content: `Detailed content for section ${index + 1}.`,
    estimatedSeconds: 30,
  }));
  const planSections = OUTLINE_IDS.map((outlineSectionId, index) => ({
    outlineSectionId,
    beats: [
      {
        id: BEAT_IDS[index]!,
        voiceover: `Narration for beat ${index + 1}.`,
        visualDescription: `Visual for beat ${index + 1}.`,
        animationDescription: `Animation ${index + 1}.`,
        visualHoldSeconds: 0,
        durationSeconds: 10,
      },
    ],
  }));
  const scenes = OUTLINE_IDS.map((outlineSectionId, index) => {
    const beatId = BEAT_IDS[index]!;
    return {
      id: SCENE_IDS[index]!,
      outlineSectionId,
      name: `Scene ${index + 1}`,
      filePath: `src/scenes/scene-${index + 1}.tsx`,
      durationSeconds: 10,
      timingEvents: [
        {
          beatId,
          startEvent: event(beatId, 'start'),
          endEvent: event(beatId, 'end'),
          plannedDurationSeconds: 10,
        },
      ],
    };
  });
  const voiceSections = OUTLINE_IDS.map((outlineSectionId, index) => ({
    outlineSectionId,
    textStartIndex: index * 20,
    textEndIndex: (index + 1) * 20,
    startSeconds: index * 10,
    endSeconds: (index + 1) * 10,
    durationSeconds: 10,
    sourceTextHash: `${index + 1}`.repeat(64),
    beats: [
      {
        beatId: BEAT_IDS[index]!,
        textStartIndex: index * 20,
        textEndIndex: (index + 1) * 20,
        startSeconds: index * 10,
        endSeconds: (index + 1) * 10,
      },
    ],
  }));
  const syncSections = OUTLINE_IDS.map((outlineSectionId, index) => {
    const beatId = BEAT_IDS[index]!;
    return {
      outlineSectionId,
      sceneId: SCENE_IDS[index]!,
      filePath: `src/scenes/scene-${index + 1}.tsx`,
      plannedDurationSeconds: 10,
      synchronizedDurationSeconds: 10,
      driftSeconds: 0,
      beats: [
        {
          beatId,
          startEvent: event(beatId, 'start'),
          endEvent: event(beatId, 'end'),
          plannedDurationSeconds: 10,
          voiceStartSeconds: index * 10,
          voiceEndSeconds: (index + 1) * 10,
          synchronizedDurationSeconds: 10,
        },
      ],
    };
  });

  return {
    topicInput,
    narration: {
      sourceText: 'Narration for beat 1. Narration for beat 2.',
      projectRules: [],
      review: {
        sourceText: 'Narration for beat 1. Narration for beat 2.',
        normalizedText: 'Narration for beat 1. Narration for beat 2.',
        rules: [],
        aiPatches: [],
        sourceHash: NARRATION_HASH,
        rulesHash: 'e'.repeat(64),
        reviewedAt: '2026-08-18T00:00:00.000Z',
      },
      approvedSourceHash: NARRATION_HASH,
      approvedAt: '2026-08-18T00:00:00.000Z',
    },
    outline: {
      status: 'approved',
      contentRevision: 2,
      sourceInput: structuredClone(topicInput),
      sections,
    },
    voiceVisualPlan: {
      status: 'approved',
      contentRevision: 3,
      narrationRevision: 4,
      sourceNarrationHash: NARRATION_HASH,
      sourceOutlineContentRevision: 2,
      sections: planSections,
    },
    motionCanvasBundle: {
      status: 'approved',
      contentRevision: 5,
      sourceVoiceVisualContentRevision: 3,
      timingContractVersion: 1,
      scenes,
    },
    voiceBundle: {
      status: 'approved',
      contentRevision: 6,
      sourceNarrationRevision: 4,
      sections: voiceSections,
    },
    animationSyncBundle: {
      status: 'approved',
      contentRevision: 7,
      sourceMotionCanvasContentRevision: 5,
      sourceVoiceContentRevision: 6,
      totalDurationSeconds: 20,
      sections: syncSections,
      validation: {
        sourceHash: 'a'.repeat(64),
      },
      generation: {
        generationId: '60000000-0000-4000-8000-000000000001',
      },
    },
    layoutBundle: {
      status: 'approved',
      contentRevision: 8,
      sourceAnimationSyncContentRevision: 7,
      sourceAnimationSyncGenerationId:
        '60000000-0000-4000-8000-000000000001',
      sourceAnimationSyncSourceHash: 'a'.repeat(64),
      renderSettings: {
        watermark: {type: 'none'},
      },
      totalDurationSeconds: 20,
      scenes: syncSections.map((section) => ({
        sceneId: section.sceneId,
        filePath: section.filePath,
      })),
    },
  } as unknown as TopicProject;
}

test('sameValue compares JSON-shaped values without sharing references', () => {
  const left = {items: [{id: 'a', enabled: true}]};
  const right = structuredClone(left);

  assert.equal(sameValue(left, right), true);
  right.items[0]!.enabled = false;
  assert.equal(sameValue(left, right), false);
});

test('outline current, ready and stale states form a complete matrix', () => {
  const cases: Array<{
    name: string;
    mutate?: (project: TopicProject) => void;
    expected: [current: boolean, ready: boolean, stale: boolean];
  }> = [
    {name: 'approved current outline', expected: [true, true, false]},
    {
      name: 'current draft outline',
      mutate: (project) => {
        project.outline!.status = 'draft';
      },
      expected: [true, false, false],
    },
    {
      name: 'topic changed after outline',
      mutate: (project) => {
        project.topicInput.topic = 'A changed topic invalidates the outline';
      },
      expected: [false, false, true],
    },
    {
      name: 'outline is absent',
      mutate: (project) => {
        project.outline = null;
      },
      expected: [false, false, false],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate?.(project);
    assert.deepEqual(
      [
        outlineIsCurrent(project),
        outlineIsReady(project),
        outlineIsStale(project),
      ],
      scenario.expected,
      scenario.name,
    );
  }
});

test('voice-visual readiness and staleness include revision and section mapping', () => {
  const base = createReadyProject();
  assert.equal(
    voiceVisualMatchesOutline(base.voiceVisualPlan!, base.outline!),
    true,
  );

  const cases: Array<{
    name: string;
    mutate: (project: TopicProject) => void;
    expected: [ready: boolean, stale: boolean];
  }> = [
    {
      name: 'current draft plan is editable, not stale',
      mutate: (project) => {
        project.voiceVisualPlan!.status = 'draft';
      },
      expected: [false, false],
    },
    {
      name: 'plan points at an old outline revision',
      mutate: (project) => {
        project.voiceVisualPlan!.sourceOutlineContentRevision -= 1;
      },
      expected: [false, true],
    },
    {
      name: 'plan section order no longer matches outline',
      mutate: (project) => {
        project.voiceVisualPlan!.sections.reverse();
      },
      expected: [false, true],
    },
    {
      name: 'outline is no longer approved',
      mutate: (project) => {
        project.outline!.status = 'draft';
      },
      expected: [false, true],
    },
    {
      name: 'narration approval is pending without changing its source',
      mutate: (project) => {
        project.narration!.approvedSourceHash = null;
        project.narration!.approvedAt = null;
      },
      expected: [false, true],
    },
    {
      name: 'plan is absent',
      mutate: (project) => {
        project.voiceVisualPlan = null;
      },
      expected: [false, false],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate(project);
    assert.deepEqual(
      [voiceVisualIsReady(project), voiceVisualIsStale(project)],
      scenario.expected,
      scenario.name,
    );
  }
});

test('Motion Canvas predicates separate usable inputs from a stale bundle', () => {
  const cases: Array<{
    name: string;
    mutate?: (project: TopicProject) => void;
    expected: [ready: boolean, stale: boolean];
  }> = [
    {name: 'current inputs and bundle', expected: [true, false]},
    {
      name: 'voice-visual still needs approval',
      mutate: (project) => {
        project.voiceVisualPlan!.status = 'draft';
      },
      expected: [false, true],
    },
    {
      name: 'bundle points at an old plan revision',
      mutate: (project) => {
        project.motionCanvasBundle!.sourceVoiceVisualContentRevision -= 1;
      },
      expected: [true, true],
    },
    {
      name: 'scene mapping changed',
      mutate: (project) => {
        project.motionCanvasBundle!.scenes[0]!.outlineSectionId =
          OUTLINE_IDS[1];
      },
      expected: [true, true],
    },
    {
      name: 'bundle is absent but inputs can generate it',
      mutate: (project) => {
        project.motionCanvasBundle = null;
      },
      expected: [true, false],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate?.(project);
    assert.deepEqual(
      [motionCanvasIsReady(project), motionCanvasIsStale(project)],
      scenario.expected,
      scenario.name,
    );
  }
});

test('voice predicates preserve reuse across visual-only changes', () => {
  const base = createReadyProject();
  assert.equal(
    voiceMatchesPlanStructure(base.voiceBundle!, base.voiceVisualPlan!),
    true,
  );

  const cases: Array<{
    name: string;
    mutate: (project: TopicProject) => void;
    expected: [prerequisites: boolean, stale: boolean];
  }> = [
    {
      name: 'Motion Canvas still needs approval',
      mutate: (project) => {
        project.motionCanvasBundle!.status = 'draft';
      },
      expected: [false, false],
    },
    {
      name: 'visual-only plan revision keeps narration reusable',
      mutate: (project) => {
        project.voiceVisualPlan!.contentRevision += 1;
      },
      expected: [false, false],
    },
    {
      name: 'narration revision changed',
      mutate: (project) => {
        project.voiceVisualPlan!.narrationRevision += 1;
      },
      expected: [true, true],
    },
    {
      name: 'voice beat mapping changed',
      mutate: (project) => {
        project.voiceBundle!.sections[0]!.beats[0]!.beatId = BEAT_IDS[1];
      },
      expected: [true, true],
    },
    {
      name: 'voice is absent',
      mutate: (project) => {
        project.voiceBundle = null;
      },
      expected: [true, false],
    },
    {
      name: 'plan is absent while voice exists',
      mutate: (project) => {
        project.voiceVisualPlan = null;
      },
      expected: [false, true],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate(project);
    assert.deepEqual(
      [voicePrerequisitesAreReady(project), voiceIsStale(project)],
      scenario.expected,
      scenario.name,
    );
  }
});

test('sync predicates compare every revision, section, event and voice time', () => {
  const base = createReadyProject();
  assert.equal(
    animationSyncMatchesSourcesStructure(
      base.animationSyncBundle!,
      base.motionCanvasBundle!,
      base.voiceBundle!,
    ),
    true,
  );

  const cases: Array<{
    name: string;
    mutate?: (project: TopicProject) => void;
    expected: [prerequisites: boolean, stale: boolean];
  }> = [
    {name: 'current sync inputs and bundle', expected: [true, false]},
    {
      name: 'legacy scene timing contract',
      mutate: (project) => {
        project.motionCanvasBundle!.timingContractVersion = undefined;
      },
      expected: [true, true],
    },
    {
      name: 'voice still needs approval',
      mutate: (project) => {
        project.voiceBundle!.status = 'draft';
      },
      expected: [false, true],
    },
    {
      name: 'voice structure no longer matches the plan',
      mutate: (project) => {
        project.voiceBundle!.sections[0]!.beats[0]!.beatId = BEAT_IDS[1];
      },
      expected: [false, true],
    },
    {
      name: 'sync points at an old motion revision',
      mutate: (project) => {
        project.animationSyncBundle!
          .sourceMotionCanvasContentRevision -= 1;
      },
      expected: [true, true],
    },
    {
      name: 'sync event no longer matches the scene',
      mutate: (project) => {
        project.animationSyncBundle!.sections[0]!.beats[0]!.endEvent =
          'changed:end';
      },
      expected: [true, true],
    },
    {
      name: 'sub-millisecond rounding remains equivalent',
      mutate: (project) => {
        project.animationSyncBundle!.sections[0]!.beats[0]!
          .voiceEndSeconds += 0.0009;
      },
      expected: [true, false],
    },
    {
      name: 'material voice timing drift is stale',
      mutate: (project) => {
        project.animationSyncBundle!.sections[0]!.beats[0]!
          .voiceStartSeconds += 0.01;
      },
      expected: [true, true],
    },
    {
      name: 'sync is absent but inputs remain usable',
      mutate: (project) => {
        project.animationSyncBundle = null;
      },
      expected: [true, false],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate?.(project);
    assert.deepEqual(
      [
        animationSyncPrerequisitesAreReady(project),
        animationSyncIsStale(project),
      ],
      scenario.expected,
      scenario.name,
    );
  }
});

test('layout predicates lock drafts and approvals to the exact current sync source', () => {
  const base = createReadyProject();
  assert.equal(
    layoutMatchesAnimationSync(
      base.layoutBundle!,
      base.animationSyncBundle!,
    ),
    true,
  );

  const cases: Array<{
    name: string;
    mutate?: (project: TopicProject) => void;
    expected: [
      prerequisites: boolean,
      current: boolean,
      ready: boolean,
      stale: boolean,
    ];
  }> = [
    {
      name: 'approved layout matches the approved sync source',
      expected: [true, true, true, false],
    },
    {
      name: 'current draft remains editable without being stale',
      mutate: (project) => {
        project.layoutBundle!.status = 'draft';
      },
      expected: [true, true, false, false],
    },
    {
      name: 'sync still needs approval',
      mutate: (project) => {
        project.animationSyncBundle!.status = 'draft';
      },
      expected: [false, false, false, true],
    },
    {
      name: 'layout points at an old sync revision',
      mutate: (project) => {
        project.layoutBundle!.sourceAnimationSyncContentRevision -= 1;
      },
      expected: [true, false, false, true],
    },
    {
      name: 'layout points at another sync generation',
      mutate: (project) => {
        project.layoutBundle!.sourceAnimationSyncGenerationId =
          '60000000-0000-4000-8000-000000000002';
      },
      expected: [true, false, false, true],
    },
    {
      name: 'sync workspace hash changed',
      mutate: (project) => {
        project.animationSyncBundle!.validation.sourceHash = 'b'.repeat(64);
      },
      expected: [true, false, false, true],
    },
    {
      name: 'sync workspace path changed',
      mutate: (project) => {
        project.animationSyncBundle!.workspacePath =
          'sync/generations/60000000-0000-4000-8000-000000000002';
      },
      expected: [true, false, false, true],
    },
    {
      name: 'scene mapping changed',
      mutate: (project) => {
        project.layoutBundle!.scenes.reverse();
      },
      expected: [true, false, false, true],
    },
    {
      name: 'sub-millisecond duration rounding remains current',
      mutate: (project) => {
        project.layoutBundle!.totalDurationSeconds += 0.0009;
      },
      expected: [true, true, true, false],
    },
    {
      name: 'material duration mismatch is stale',
      mutate: (project) => {
        project.layoutBundle!.totalDurationSeconds += 0.01;
      },
      expected: [true, false, false, true],
    },
    {
      name: 'layout is absent while sync inputs remain usable',
      mutate: (project) => {
        project.layoutBundle = null;
      },
      expected: [true, false, false, false],
    },
    {
      name: 'upstream voice is no longer approved',
      mutate: (project) => {
        project.voiceBundle!.status = 'draft';
      },
      expected: [false, false, false, true],
    },
  ];

  for (const scenario of cases) {
    const project = createReadyProject();
    scenario.mutate?.(project);
    assert.deepEqual(
      [
        layoutPrerequisitesAreReady(project),
        layoutIsCurrent(project),
        layoutIsReady(project),
        layoutIsStale(project),
      ],
      scenario.expected,
      scenario.name,
    );
  }
});

test('final render stays locked to the exact approved Layout generation', () => {
  const project = createReadyProject();
  Object.assign(project.layoutBundle!, {
    generation: {
      generationId: '70000000-0000-4000-8000-000000000001',
    },
    validation: {sourceHash: 'c'.repeat(64)},
  });
  project.renderBundle = {
    status: 'completed',
    contentRevision: 9,
    sourceLayoutContentRevision: 8,
    sourceLayoutGenerationId:
      '70000000-0000-4000-8000-000000000001',
    sourceLayoutSourceHash: 'c'.repeat(64),
    watermark: {type: 'none'},
    durationSeconds: 20,
    fps: 30,
  } as unknown as TopicProject['renderBundle'];

  assert.equal(
    finalRenderMatchesLayout(project.renderBundle!, project.layoutBundle!),
    true,
  );
  assert.deepEqual(
    [
      finalRenderPrerequisitesAreReady(project),
      finalRenderIsCurrent(project),
      finalRenderIsReady(project),
      finalRenderIsStale(project),
    ],
    [true, true, true, false],
  );

  project.narration!.approvedSourceHash = null;
  project.narration!.approvedAt = null;
  assert.deepEqual(
    [
      finalRenderPrerequisitesAreReady(project),
      finalRenderIsCurrent(project),
      finalRenderIsReady(project),
      finalRenderIsStale(project),
    ],
    [false, false, false, true],
  );
  project.narration!.approvedSourceHash = NARRATION_HASH;
  project.narration!.approvedAt = '2026-08-18T00:00:00.000Z';

  project.layoutBundle!.renderSettings.watermark = {
    type: 'text',
    text: 'PAD Studio',
    opacity: 0.3,
    xPercent: 88,
    yPercent: 92,
    fontSize: 44,
    color: '#ffffff',
  };
  assert.deepEqual(
    [finalRenderIsCurrent(project), finalRenderIsReady(project), finalRenderIsStale(project)],
    [false, false, true],
  );
  project.layoutBundle!.renderSettings.watermark = {type: 'none'};

  project.layoutBundle!.validation.sourceHash = 'd'.repeat(64);
  assert.deepEqual(
    [finalRenderIsCurrent(project), finalRenderIsReady(project), finalRenderIsStale(project)],
    [false, false, true],
  );
});
