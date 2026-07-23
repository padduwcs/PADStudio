import {z} from 'zod';
import {pipelineSafetyLimits} from './pipelineLimits.ts';
import {RenderWatermarkSchema} from './render.ts';

export const LayoutRenderSettingsSchema = z
  .object({
    watermark: RenderWatermarkSchema.default({type: 'none'}),
  })
  .strict();

export type LayoutRenderSettings = z.infer<
  typeof LayoutRenderSettingsSchema
>;

export const defaultLayoutRenderSettings: LayoutRenderSettings = {
  watermark: {type: 'none'},
};

export const layoutStatusValues = ['draft', 'approved'] as const;
export const layoutFontFamilyValues = [
  'Arial, sans-serif',
  'Segoe UI, Arial, sans-serif',
  'Verdana, Arial, sans-serif',
  'Tahoma, Arial, sans-serif',
  'Trebuchet MS, Arial, sans-serif',
  'Georgia, Times New Roman, serif',
  'Times New Roman, Times, serif',
  'Courier New, Consolas, monospace',
  'Cascadia Code, Consolas, monospace',
  'Consolas, Courier New, monospace',
  'Impact, Arial Black, sans-serif',
  'Arial Black, Arial, sans-serif',
] as const;
export const layoutFontWeightValues = [
  100,
  200,
  300,
  400,
  500,
  600,
  700,
  800,
  900,
] as const;
export const layoutFontStyleValues = ['normal', 'italic'] as const;
export const layoutOverridePropertyValues = [
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'hidden',
  'fill',
  'stroke',
  'strokeWidth',
  'zIndexDelta',
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'underline',
  'strikethrough',
] as const;
export const layoutNodeIdentityValues = ['semantic', 'legacy'] as const;

export const LayoutStatusSchema = z.enum(layoutStatusValues);
export const LayoutOverridePropertySchema = z.enum(
  layoutOverridePropertyValues,
);
export const LayoutNodeIdentitySchema = z.enum(layoutNodeIdentityValues);

const CreationIdSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SceneFilePathSchema = z
  .string()
  .regex(/^src\/scenes\/[a-z0-9][a-z0-9-]{0,80}\.tsx$/);
const LayoutNodeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]*$/);
const HexColorSchema = z
  .string()
  .regex(/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/);

export const LayoutNodePatchSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000).optional(),
    y: z.number().finite().min(-100_000).max(100_000).optional(),
    scale: z.number().finite().min(0.05).max(20).optional(),
    rotation: z.number().finite().min(-3_600).max(3_600).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    hidden: z.boolean().optional(),
    fill: HexColorSchema.nullable().optional(),
    stroke: HexColorSchema.nullable().optional(),
    strokeWidth: z.number().finite().min(0).max(200).optional(),
    zIndexDelta: z.number().int().min(-1_000).max(1_000).optional(),
    text: z.string().optional(),
    fontFamily: z.enum(layoutFontFamilyValues).optional(),
    fontSize: z.number().finite().min(8).max(500).optional(),
    fontWeight: z
      .number()
      .int()
      .refine(
        (value) => layoutFontWeightValues.includes(
          value as (typeof layoutFontWeightValues)[number],
        ),
        'Font weight không được hỗ trợ.',
      )
      .optional(),
    fontStyle: z.enum(layoutFontStyleValues).optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    editorLocked: z.boolean().optional(),
  })
  .strict()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Layout patch cần có ít nhất một thay đổi.',
  );

export type LayoutNodePatch = z.infer<typeof LayoutNodePatchSchema>;

export const LayoutNodeOverrideSchema = z
  .object({
    sceneId: z.string().uuid(),
    nodeKey: LayoutNodeKeySchema,
    nodeFingerprint: Sha256Schema,
    patch: LayoutNodePatchSchema,
  })
  .strict();

export type LayoutNodeOverride = z.infer<typeof LayoutNodeOverrideSchema>;

export const LayoutOverridesArraySchema = z
  .array(LayoutNodeOverrideSchema)
  .max(20_000)
  .superRefine((overrides, context) => {
    const targets = new Set<string>();
    for (const [index, override] of overrides.entries()) {
      const target = `${override.sceneId}:${override.nodeKey}`;
      if (targets.has(target)) {
        context.addIssue({
          code: 'custom',
          message: 'Mỗi node chỉ được có một layout override.',
          path: [index, 'nodeKey'],
        });
      }
      targets.add(target);
    }
  });

export const LayoutOverridesDocumentSchema = z
  .object({
    version: z.literal(1),
    sourceAnimationSyncGenerationId: CreationIdSchema,
    sourceAnimationSyncContentRevision: z.number().int().positive(),
    sourceAnimationSyncSourceHash: Sha256Schema,
    overrides: LayoutOverridesArraySchema,
  })
  .strict();

export type LayoutOverridesDocument = z.infer<
  typeof LayoutOverridesDocumentSchema
>;

export const VisualDesignBundleSchema = z
  .object({
    contentRevision: z.number().int().positive(),
    sourceMotionCanvasGenerationId: CreationIdSchema,
    sourceMotionCanvasContentRevision: z.number().int().positive(),
    sourceMotionCanvasSourceHash: Sha256Schema,
    overrides: LayoutOverridesArraySchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export type VisualDesignBundle = z.infer<
  typeof VisualDesignBundleSchema
>;

export const CommitVisualDesignSchema = z
  .object({
    sourceMotionCanvasGenerationId: CreationIdSchema,
    sessionNonce: z.string().min(32).max(128),
    overrides: LayoutOverridesArraySchema,
  })
  .strict();

export type CommitVisualDesign = z.infer<
  typeof CommitVisualDesignSchema
>;

export const LayoutEditorNodeSchema = z
  .object({
    key: LayoutNodeKeySchema,
    fingerprint: Sha256Schema,
    label: z.string().trim().min(1).max(120),
    nodeType: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z][A-Za-z0-9]*$/),
    parentKey: LayoutNodeKeySchema.nullable(),
    identity: LayoutNodeIdentitySchema,
    editableProperties: z
      .array(LayoutOverridePropertySchema)
      .min(1)
      .max(layoutOverridePropertyValues.length),
    lockedProperties: z
      .array(LayoutOverridePropertySchema)
      .max(layoutOverridePropertyValues.length),
    lockReason: z.string().trim().min(3).max(240).nullable(),
  })
  .strict()
  .superRefine((node, context) => {
    const editable = new Set(node.editableProperties);
    if (editable.size !== node.editableProperties.length) {
      context.addIssue({
        code: 'custom',
        message: 'Danh sách thuộc tính chỉnh sửa không được trùng.',
        path: ['editableProperties'],
      });
    }

    const locked = new Set(node.lockedProperties);
    if (locked.size !== node.lockedProperties.length) {
      context.addIssue({
        code: 'custom',
        message: 'Danh sách thuộc tính khóa không được trùng.',
        path: ['lockedProperties'],
      });
    }
    for (const property of locked) {
      if (!editable.has(property)) {
        context.addIssue({
          code: 'custom',
          message: 'Chỉ có thể khóa thuộc tính mà node hỗ trợ.',
          path: ['lockedProperties'],
        });
      }
    }

    if ((locked.size > 0) !== (node.lockReason !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Node có thuộc tính khóa phải kèm lý do khóa.',
        path: ['lockReason'],
      });
    }
  });

export type LayoutEditorNode = z.infer<typeof LayoutEditorNodeSchema>;

export const LayoutEditorSceneSchema = z
  .object({
    sceneId: z.string().uuid(),
    filePath: SceneFilePathSchema,
    nodes: z.array(LayoutEditorNodeSchema).max(500),
  })
  .strict()
  .superRefine((scene, context) => {
    const keys = new Set<string>();
    for (const [index, node] of scene.nodes.entries()) {
      if (keys.has(node.key)) {
        context.addIssue({
          code: 'custom',
          message: 'Node key phải duy nhất trong scene.',
          path: ['nodes', index, 'key'],
        });
      }
      keys.add(node.key);
    }

    for (const [index, node] of scene.nodes.entries()) {
      if (node.parentKey !== null && !keys.has(node.parentKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Node cha phải tồn tại trong cùng scene.',
          path: ['nodes', index, 'parentKey'],
        });
      }
      if (node.parentKey === node.key) {
        context.addIssue({
          code: 'custom',
          message: 'Node không thể tự làm node cha.',
          path: ['nodes', index, 'parentKey'],
        });
      }
    }
  });

export type LayoutEditorScene = z.infer<typeof LayoutEditorSceneSchema>;

export const LayoutEditorManifestSchema = z
  .object({
    version: z.literal(1),
    sourceAnimationSyncGenerationId: CreationIdSchema,
    sourceAnimationSyncContentRevision: z.number().int().positive(),
    sourceAnimationSyncSourceHash: Sha256Schema,
    scenes: z
      .array(LayoutEditorSceneSchema)
      .min(pipelineSafetyLimits.minimumSections)
      .max(pipelineSafetyLimits.maximumSections),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sceneIds = new Set<string>();
    for (const [index, scene] of manifest.scenes.entries()) {
      if (sceneIds.has(scene.sceneId)) {
        context.addIssue({
          code: 'custom',
          message: 'Scene trong layout manifest không được trùng.',
          path: ['scenes', index, 'sceneId'],
        });
      }
      sceneIds.add(scene.sceneId);
    }
  });

export type LayoutEditorManifest = z.infer<
  typeof LayoutEditorManifestSchema
>;

export const LayoutSceneSummarySchema = z
  .object({
    sceneId: z.string().uuid(),
    filePath: SceneFilePathSchema,
    editableNodeCount: z.number().int().nonnegative().max(500),
    overrideCount: z.number().int().nonnegative().max(500),
  })
  .strict();

export const LayoutBundleSchema = z
  .object({
    status: LayoutStatusSchema,
    contentRevision: z.number().int().positive(),
    sourceAnimationSyncContentRevision: z.number().int().positive(),
    sourceAnimationSyncGenerationId: CreationIdSchema,
    sourceAnimationSyncSourceHash: Sha256Schema,
    workspacePath: z
      .string()
      .regex(
        /^layout\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    sourceWorkspacePath: z
      .string()
      .regex(
        /^sync\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    projectFile: z.literal('src/project.ts'),
    audioFile: z.literal('audio/narration.wav'),
    overridesFile: z.literal('overrides.json'),
    manifestFile: z.literal('editor-manifest.json'),
    overrideContractVersion: z.literal(1),
    renderSettings: LayoutRenderSettingsSchema.default(
      defaultLayoutRenderSettings,
    ),
    totalDurationSeconds: z.number().positive(),
    scenes: z
      .array(LayoutSceneSummarySchema)
      .min(pipelineSafetyLimits.minimumSections)
      .max(pipelineSafetyLimits.maximumSections),
    validation: z
      .object({
        validatedAt: z.string().datetime(),
        sourceHash: Sha256Schema,
        overridesHash: Sha256Schema,
        manifestHash: Sha256Schema,
        motionCanvasVersion: z.string().trim().min(1).max(40),
        audioDurationSeconds: z.number().positive(),
      })
      .strict(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('local'),
        tool: z.literal('layout-editor'),
        generatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.workspacePath !==
      `layout/generations/${bundle.generation.generationId}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Layout workspace phải trỏ đúng layout generation.',
        path: ['workspacePath'],
      });
    }

    if (
      bundle.sourceWorkspacePath !==
      `sync/generations/${bundle.sourceAnimationSyncGenerationId}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source workspace phải trỏ đúng sync generation.',
        path: ['sourceWorkspacePath'],
      });
    }

    if (
      Math.abs(
        bundle.validation.audioDurationSeconds -
          bundle.totalDurationSeconds,
      ) >= 0.05
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Thời lượng audio và layout workspace không khớp.',
        path: ['validation', 'audioDurationSeconds'],
      });
    }

    const sceneIds = new Set<string>();
    for (const [index, scene] of bundle.scenes.entries()) {
      if (sceneIds.has(scene.sceneId)) {
        context.addIssue({
          code: 'custom',
          message: 'Scene trong layout bundle không được trùng.',
          path: ['scenes', index, 'sceneId'],
        });
      }
      if (scene.overrideCount > scene.editableNodeCount) {
        context.addIssue({
          code: 'custom',
          message: 'Số override không thể lớn hơn số node chỉnh được.',
          path: ['scenes', index, 'overrideCount'],
        });
      }
      sceneIds.add(scene.sceneId);
    }
  });

export type LayoutBundle = z.infer<typeof LayoutBundleSchema>;

export const CommitLayoutSchema = z
  .object({
    generationId: CreationIdSchema,
    baseGenerationId: CreationIdSchema.nullable(),
    sourceAnimationSyncGenerationId: CreationIdSchema,
    sessionNonce: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    overrides: LayoutOverridesArraySchema,
    renderSettings: LayoutRenderSettingsSchema.default(
      defaultLayoutRenderSettings,
    ),
  })
  .strict();

export type CommitLayout = z.infer<typeof CommitLayoutSchema>;

export const ApproveLayoutSchema = z
  .object({
    generationId: CreationIdSchema,
  })
  .strict();

export type ApproveLayout = z.infer<typeof ApproveLayoutSchema>;
