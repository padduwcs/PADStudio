import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApproveLayoutSchema,
  CommitLayoutSchema,
  CreateTopicProjectSchema,
  currentProjectVersion,
  GenerateMotionCanvasSchema,
  LayoutBundleSchema,
  LayoutEditorManifestSchema,
  LayoutOverridesDocumentSchema,
  parseTopicProject,
  ProjectStepSchema,
  TopicInputSchema,
  TopicProjectSchema,
  UpdateProjectSchema,
} from './topic.ts';

test('TopicInputSchema chuẩn hóa khoảng trắng ở đầu và cuối', () => {
  const result = TopicInputSchema.parse({
    topic: '  Tìm kiếm nhị phân  ',
    learningGoal: '  Hiểu vì sao mỗi bước loại được một nửa dữ liệu.  ',
    audience: 'beginner',
    duration: 'standard',
  });

  assert.equal(result.topic, 'Tìm kiếm nhị phân');
  assert.equal(
    result.learningGoal,
    'Hiểu vì sao mỗi bước loại được một nửa dữ liệu.',
  );
});

test('TopicInputSchema từ chối chủ đề quá mơ hồ', () => {
  const result = TopicInputSchema.safeParse({
    topic: 'Sort',
    audience: 'beginner',
    duration: 'concise',
  });

  assert.equal(result.success, false);
});

test('TopicInputSchema hỗ trợ thời lượng mục tiêu tùy chỉnh có cầu chì an toàn', () => {
  const custom = TopicInputSchema.parse({
    topic: 'Giải thích kiến trúc pipeline video dài một cách trực quan',
    audience: 'familiar',
    duration: 'custom',
    targetDurationMinutes: 27.5,
  });

  assert.equal(custom.targetDurationMinutes, 27.5);
  assert.equal(
    TopicInputSchema.safeParse({
      ...custom,
      targetDurationMinutes: undefined,
    }).success,
    false,
  );
  assert.equal(
    TopicInputSchema.safeParse({
      ...custom,
      targetDurationMinutes: 181,
    }).success,
    false,
  );
});

test('CreateTopicProjectSchema chỉ khởi tạo project ở bước outline', () => {
  const request = {
    creationId: '00000000-0000-4000-8000-000000000001',
    topicInput: {
      topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'standard',
    },
  };

  assert.equal(
    CreateTopicProjectSchema.safeParse({
      ...request,
      currentStep: 'outline',
    }).success,
    true,
  );
  assert.equal(
    CreateTopicProjectSchema.safeParse({
      ...request,
      currentStep: 'sync',
    }).success,
    false,
  );
});

test('Codex generation chỉ nhận reasoning effort dạng capability identifier', () => {
  const generationId = '00000000-0000-4000-8000-000000000009';
  assert.equal(
    GenerateMotionCanvasSchema.safeParse({
      generationId,
      model: 'gpt-model',
      reasoningEffort: 'xhigh',
    }).success,
    true,
  );
  assert.equal(
    GenerateMotionCanvasSchema.safeParse({
      generationId,
      reasoningEffort: 'HIGH<script>',
    }).success,
    false,
  );
});

test('UpdateProjectSchema chỉ cho phép dữ liệu của trang topic', () => {
  assert.equal(UpdateProjectSchema.safeParse({}).success, false);
  assert.equal(
    UpdateProjectSchema.safeParse({currentStep: 'outline'}).success,
    true,
  );
  assert.equal(
    UpdateProjectSchema.safeParse({currentStep: 'sync'}).success,
    false,
  );
  assert.equal(
    UpdateProjectSchema.safeParse({
      topicInput: {
        topic: 'Tìm kiếm nhị phân hoạt động như thế nào?',
        audience: 'beginner',
        duration: 'standard',
      },
    }).success,
    true,
  );

  for (const forbiddenField of [
    'status',
    'outline',
    'voiceVisualPlan',
    'motionCanvasBundle',
    'voiceBundle',
    'animationSyncBundle',
    'layoutBundle',
  ]) {
    assert.equal(
      UpdateProjectSchema.safeParse({
        [forbiddenField]: {status: 'approved'},
      }).success,
      false,
      forbiddenField,
    );
  }
});

test('parseTopicProject nâng project v1 lên model hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'legacy-project',
    version: 1,
    status: 'draft',
    currentStep: 'topic',
    topicInput: {
      topic: 'Tìm kiếm nhị phân',
      audience: 'beginner',
      duration: 'standard',
    },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 1);
  assert.equal(project.creationId, null);
  assert.equal(project.outline, null);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject nâng project v2 và giữ revision hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-two-project',
    version: 2,
    revision: 7,
    creationId: null,
    status: 'draft',
    currentStep: 'outline',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 7);
  assert.equal(project.outline, null);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject nâng project v3 và giữ outline hiện tại', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-three-project',
    version: 3,
    revision: 4,
    creationId: null,
    status: 'draft',
    currentStep: 'outline',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    outline: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 4);
  assert.equal(project.voiceVisualPlan, null);
  assert.equal(project.motionCanvasBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject nâng project v4 và giữ kế hoạch voice–visual', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-four-project',
    version: 4,
    revision: 5,
    creationId: null,
    status: 'draft',
    currentStep: 'voiceVisual',
    topicInput: {
      topic: 'Cây tìm kiếm nhị phân',
      audience: 'familiar',
      duration: 'deep',
    },
    outline: null,
    voiceVisualPlan: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 5);
  assert.equal(project.motionCanvasBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject nâng project v6 và bổ sung workspace đồng bộ', () => {
  const now = new Date().toISOString();
  const project = parseTopicProject({
    id: 'version-six-project',
    version: 6,
    revision: 10,
    creationId: null,
    status: 'draft',
    currentStep: 'voice',
    topicInput: {
      topic: 'Đệ quy hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'standard',
    },
    outline: null,
    voiceVisualPlan: null,
    motionCanvasBundle: null,
    voiceBundle: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.revision, 10);
  assert.equal(project.currentStep, 'voice');
  assert.equal(project.animationSyncBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject nâng v7, bổ sung timing profile và buộc tạo lại voice section-based', () => {
  const now = new Date().toISOString();
  const outlineSectionIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const project = parseTopicProject({
    id: 'version-seven-project',
    version: 7,
    revision: 12,
    creationId: null,
    status: 'draft',
    currentStep: 'sync',
    topicInput: {
      topic: 'Ngăn xếp hoạt động như thế nào?',
      audience: 'beginner',
      duration: 'concise',
    },
    outline: null,
    voiceVisualPlan: {
      voiceDirection: 'Giọng rõ ràng và gần gũi với người mới.',
      visualDirection: 'Hình khối tối giản mô tả thao tác vào và ra.',
      sections: outlineSectionIds.map((outlineSectionId, index) => ({
        outlineSectionId,
        beats: [
          {
            id:
              index === 0
                ? '33333333-3333-4333-8333-333333333333'
                : '44444444-4444-4444-8444-444444444444',
            voiceover:
              index === 0
                ? 'Ta đặt phần tử đầu tiên lên trên cùng của ngăn xếp.'
                : 'Sau đó, phần tử trên cùng sẽ được lấy ra trước.',
            visualDescription:
              'Một khối chữ nhật nằm trên đỉnh của chồng phần tử.',
            animationDescription:
              'Khối di chuyển theo chiều dọc để thể hiện thao tác.',
            durationSeconds: 12,
          },
        ],
      })),
      status: 'approved',
      contentRevision: 2,
      sourceOutlineContentRevision: 1,
      generation: {
        generationId: '55555555-5555-4555-8555-555555555555',
        provider: 'codex',
        model: 'legacy-model',
        promptVersion: 'voice-visual-v1',
        generatedAt: now,
        usage: null,
      },
    },
    motionCanvasBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(project.version, currentProjectVersion);
  assert.equal(project.currentStep, 'voice');
  assert.equal(project.voiceVisualPlan?.narrationRevision, 1);
  assert.equal(
    project.voiceVisualPlan?.timingCalibration.source,
    'default',
  );
  assert.equal(
    project.voiceVisualPlan?.sections[0]?.beats[0]?.visualHoldSeconds,
    0,
  );
  assert.equal(project.voiceBundle, null);
  assert.equal(project.animationSyncBundle, null);
  assert.equal(project.layoutBundle, null);
});

test('parseTopicProject không âm thầm bỏ field lạ', () => {
  const now = new Date().toISOString();

  assert.throws(() =>
    parseTopicProject({
      id: 'future-project',
      version: 3,
      revision: 1,
      creationId: null,
      status: 'draft',
      currentStep: 'topic',
      topicInput: {
        topic: 'Tìm kiếm nhị phân',
        audience: 'beginner',
        duration: 'standard',
      },
      outline: null,
      createdAt: now,
      updatedAt: now,
      futureField: true,
    }),
  );
});

test('parseTopicProject migrates v8 and v9 without widening historical step enums', () => {
  const now = new Date().toISOString();
  const versionEight = {
    id: 'version-eight-project',
    version: 8,
    revision: 14,
    creationId: null,
    status: 'draft',
    currentStep: 'sync',
    topicInput: {
      topic: 'Explain a stable cache eviction policy',
      audience: 'familiar',
      duration: 'standard',
    },
    outline: null,
    voiceVisualPlan: null,
    motionCanvasBundle: null,
    voiceBundle: null,
    animationSyncBundle: null,
    createdAt: now,
    updatedAt: now,
  };

  const migrated = parseTopicProject(versionEight);
  assert.equal(migrated.version, currentProjectVersion);
  assert.equal(migrated.currentStep, 'sync');
  assert.equal(migrated.revision, 14);
  assert.equal(migrated.layoutBundle, null);
  assert.equal(migrated.renderBundle, null);
  assert.equal(migrated.visualDesignBundle, null);

  assert.equal(ProjectStepSchema.safeParse('layout').success, true);
  assert.equal(
    TopicProjectSchema.safeParse({
      ...versionEight,
      version: currentProjectVersion,
      currentStep: 'layout',
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    }).success,
    true,
  );
  const migratedVersionNine = parseTopicProject({
    ...versionEight,
    version: 9,
    currentStep: 'layout',
    layoutBundle: null,
  });
  assert.equal(migratedVersionNine.version, currentProjectVersion);
  assert.equal(migratedVersionNine.currentStep, 'layout');
  assert.equal(migratedVersionNine.visualDesignBundle, null);
  assert.equal(migratedVersionNine.renderBundle, null);
  assert.equal(ProjectStepSchema.safeParse('render').success, true);
  const migratedVersionEleven = parseTopicProject({
    ...versionEight,
    version: 11,
    currentStep: 'render',
    layoutBundle: null,
    renderBundle: null,
    visualDesignBundle: null,
  });
  assert.equal(migratedVersionEleven.version, currentProjectVersion);
  assert.equal(migratedVersionEleven.currentStep, 'render');
  assert.throws(() =>
    parseTopicProject({...versionEight, currentStep: 'layout'}),
  );
});

test('layout override and manifest schemas enforce stable targets and locks', () => {
  const syncGenerationId = '60000000-0000-4000-8000-000000000001';
  const sourceHash = 'a'.repeat(64);
  const nodeFingerprint = 'b'.repeat(64);
  const overrides = [
    {
      sceneId: '30000000-0000-4000-8000-000000000001',
      nodeKey: 'CacheScene/Rect[1]',
      nodeFingerprint,
      patch: {
        x: 48,
        y: -24,
        scale: 1.1,
        rotation: 12,
        opacity: 0.85,
        hidden: false,
        fill: '#12AB34',
        stroke: null,
        strokeWidth: 3,
        zIndexDelta: 2,
        text: 'Tiêu đề đã chỉnh',
        fontFamily: 'Georgia, Times New Roman, serif',
        fontSize: 72,
        fontWeight: 700,
        fontStyle: 'italic',
        underline: true,
        strikethrough: true,
      },
    },
  ];
  const document = {
    version: 1,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sourceAnimationSyncContentRevision: 7,
    sourceAnimationSyncSourceHash: sourceHash,
    overrides,
  };

  assert.equal(
    LayoutOverridesDocumentSchema.safeParse(document).success,
    true,
  );
  assert.equal(
    LayoutOverridesDocumentSchema.safeParse({
      ...document,
      overrides: [...overrides, structuredClone(overrides[0])],
    }).success,
    false,
  );
  assert.equal(
    LayoutOverridesDocumentSchema.safeParse({
      ...document,
      overrides: [{...overrides[0], patch: {}}],
    }).success,
    false,
  );
  assert.equal(
    LayoutOverridesDocumentSchema.safeParse({
      ...document,
      overrides: [{...overrides[0], patch: {fill: 'rgb(1, 2, 3)'}}],
    }).success,
    false,
  );
  assert.equal(
    LayoutOverridesDocumentSchema.safeParse({
      ...document,
      overrides: [{...overrides[0], patch: {fontFamily: 'url(evil-font)'}}],
    }).success,
    false,
  );
  assert.equal(
    LayoutOverridesDocumentSchema.safeParse({
      ...document,
      overrides: [
        {
          ...overrides[0],
          nodeKey: 'cache-card-lock-only',
          patch: {editorLocked: true},
        },
      ],
    }).success,
    true,
  );

  const manifest = {
    version: 1,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sourceAnimationSyncContentRevision: 7,
    sourceAnimationSyncSourceHash: sourceHash,
    scenes: [
      {
        sceneId: '30000000-0000-4000-8000-000000000001',
        filePath: 'src/scenes/cache-hit.tsx',
        nodes: [
          {
            key: 'CacheScene/Rect[1]',
            fingerprint: nodeFingerprint,
            label: 'Cache card',
            nodeType: 'Rect',
            parentKey: null,
            identity: 'legacy',
            editableProperties: [
              'x',
              'y',
              'scale',
              'hidden',
              'fill',
              'zIndexDelta',
            ],
            lockedProperties: ['zIndexDelta'],
            lockReason: 'Preserve the teaching layer order.',
          },
        ],
      },
      {
        sceneId: '30000000-0000-4000-8000-000000000002',
        filePath: 'src/scenes/cache-miss.tsx',
        nodes: [],
      },
    ],
  };

  assert.equal(LayoutEditorManifestSchema.safeParse(manifest).success, true);
  assert.equal(
    LayoutEditorManifestSchema.safeParse({
      ...manifest,
      scenes: [
        {
          ...manifest.scenes[0],
          nodes: [
            {
              ...manifest.scenes[0]!.nodes[0],
              editableProperties: ['x'],
              lockedProperties: ['fill'],
            },
          ],
        },
        manifest.scenes[1],
      ],
    }).success,
    false,
  );
  assert.equal(
    LayoutEditorManifestSchema.safeParse({
      ...manifest,
      unexpected: true,
    }).success,
    false,
  );
});

test('layout bundle and commands lock every write to a sync generation', () => {
  const now = new Date().toISOString();
  const syncGenerationId = '60000000-0000-4000-8000-000000000001';
  const layoutGenerationId = '70000000-0000-4000-8000-000000000001';
  const sceneIds = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
  ];
  const bundle = {
    status: 'draft',
    contentRevision: 1,
    sourceAnimationSyncContentRevision: 7,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sourceAnimationSyncSourceHash: 'a'.repeat(64),
    workspacePath: `layout/generations/${layoutGenerationId}`,
    sourceWorkspacePath: `sync/generations/${syncGenerationId}`,
    projectFile: 'src/project.ts',
    audioFile: 'audio/narration.wav',
    overridesFile: 'overrides.json',
    manifestFile: 'editor-manifest.json',
    overrideContractVersion: 1,
    totalDurationSeconds: 20,
    scenes: sceneIds.map((sceneId, index) => ({
      sceneId,
      filePath: `src/scenes/scene-${index + 1}.tsx`,
      editableNodeCount: 4,
      overrideCount: index,
    })),
    validation: {
      validatedAt: now,
      sourceHash: 'c'.repeat(64),
      overridesHash: 'd'.repeat(64),
      manifestHash: 'e'.repeat(64),
      motionCanvasVersion: '3.17.2',
      audioDurationSeconds: 20.02,
    },
    generation: {
      generationId: layoutGenerationId,
      provider: 'local',
      tool: 'layout-editor',
      generatedAt: now,
    },
  };

  assert.equal(LayoutBundleSchema.safeParse(bundle).success, true);
  assert.equal(
    LayoutBundleSchema.safeParse({
      ...bundle,
      workspacePath:
        'layout/generations/70000000-0000-4000-8000-000000000002',
    }).success,
    false,
  );
  assert.equal(
    LayoutBundleSchema.safeParse({
      ...bundle,
      sourceWorkspacePath:
        'sync/generations/60000000-0000-4000-8000-000000000002',
    }).success,
    false,
  );
  assert.equal(
    LayoutBundleSchema.safeParse({
      ...bundle,
      validation: {...bundle.validation, audioDurationSeconds: 20.05},
    }).success,
    false,
  );

  const command = {
    generationId: layoutGenerationId,
    baseGenerationId: null,
    sourceAnimationSyncGenerationId: syncGenerationId,
    sessionNonce: 'n'.repeat(32),
    overrides: [
      {
        sceneId: sceneIds[0],
        nodeKey: 'cache-card',
        nodeFingerprint: 'f'.repeat(64),
        patch: {hidden: true},
      },
    ],
  };
  assert.equal(CommitLayoutSchema.safeParse(command).success, true);
  assert.equal(
    CommitLayoutSchema.safeParse({...command, sessionNonce: 'short'}).success,
    false,
  );
  assert.equal(
    CommitLayoutSchema.safeParse({...command, extra: true}).success,
    false,
  );
  assert.equal(
    ApproveLayoutSchema.safeParse({generationId: layoutGenerationId})
      .success,
    true,
  );
  assert.equal(
    ApproveLayoutSchema.safeParse({
      generationId: layoutGenerationId,
      status: 'approved',
    }).success,
    false,
  );
});
