import {z} from 'zod';
import {DEFAULT_NARRATION_CALIBRATION} from './narrationTiming.ts';
import {
  LayoutBundleSchema,
  VisualDesignBundleSchema,
} from './layout.ts';
import {FinalRenderBundleSchema} from './render.ts';

export * from './layout.ts';
export * from './render.ts';

export const audienceValues = ['beginner', 'familiar'] as const;
export const durationValues = ['concise', 'standard', 'deep'] as const;
const projectStepV8Values = [
  'topic',
  'outline',
  'voiceVisual',
  'motionCanvas',
  'voice',
  'sync',
] as const;
const projectStepV9Values = [...projectStepV8Values, 'layout'] as const;
export const projectStepValues = [...projectStepV9Values, 'render'] as const;
export const projectStatusValues = ['draft'] as const;
export const outlineStatusValues = ['draft', 'approved'] as const;
export const voiceVisualStatusValues = ['draft', 'approved'] as const;
export const motionCanvasStatusValues = ['draft', 'approved'] as const;
export const voiceStatusValues = ['draft', 'approved'] as const;
export const animationSyncStatusValues = ['draft', 'approved'] as const;
export const currentProjectVersion = 11 as const;

export const ProjectStepSchema = z.enum(projectStepValues);
const ProjectStepV8Schema = z.enum(projectStepV8Values);
const ProjectStepV9Schema = z.enum(projectStepV9Values);
export type ProjectStep = z.infer<typeof ProjectStepSchema>;
export const ProjectStatusSchema = z.enum(projectStatusValues);
export const CreationIdSchema = z.string().uuid();

export const TopicInputSchema = z
  .object({
    topic: z
      .string()
      .trim()
      .min(6, 'Hãy mô tả chủ đề rõ hơn một chút.')
      .max(180, 'Chủ đề nên ngắn hơn 180 ký tự.'),
    learningGoal: z
      .string()
      .trim()
      .max(320, 'Mục tiêu học nên ngắn hơn 320 ký tự.')
      .optional(),
    videoDirection: z
      .string()
      .trim()
      .max(1200, 'Mô tả video nên ngắn hơn 1200 ký tự.')
      .optional(),
    audience: z.enum(audienceValues),
    duration: z.enum(durationValues),
  })
  .strict();

export type TopicInput = z.infer<typeof TopicInputSchema>;

export const AiVideoBriefSchema = z
  .object({
    summary: z
      .string()
      .trim()
      .min(12, 'Bản tóm tắt yêu cầu còn quá ngắn.')
      .max(700, 'Bản tóm tắt yêu cầu nên ngắn hơn 700 ký tự.'),
    assumptions: z
      .array(
        z
          .string()
          .trim()
          .min(3, 'Giả định cần rõ nghĩa hơn.')
          .max(220, 'Mỗi giả định nên ngắn hơn 220 ký tự.'),
      )
      .max(6, 'Chỉ nên giữ tối đa 6 giả định.'),
  })
  .strict();

export const TeachingOutlineSectionSchema = z
  .object({
    id: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(3, 'Tên ý còn quá ngắn.')
      .max(120, 'Tên ý nên ngắn hơn 120 ký tự.'),
    goal: z
      .string()
      .trim()
      .min(6, 'Mục tiêu của ý cần rõ hơn.')
      .max(280, 'Mục tiêu của ý nên ngắn hơn 280 ký tự.'),
    content: z
      .string()
      .trim()
      .min(12, 'Nội dung của ý cần rõ hơn.')
      .max(900, 'Nội dung của ý nên ngắn hơn 900 ký tự.'),
    estimatedSeconds: z
      .number()
      .int()
      .min(10, 'Mỗi ý cần ít nhất 10 giây.')
      .max(240, 'Mỗi ý không nên dài quá 240 giây.'),
  })
  .strict();

export type TeachingOutlineSection = z.infer<
  typeof TeachingOutlineSectionSchema
>;

export const TeachingOutlineContentSchema = z
  .object({
    brief: AiVideoBriefSchema,
    centralMessage: z
      .string()
      .trim()
      .min(10, 'Thông điệp trung tâm cần rõ hơn.')
      .max(400, 'Thông điệp trung tâm nên ngắn hơn 400 ký tự.'),
    sections: z
      .array(TeachingOutlineSectionSchema)
      .min(2, 'Mạch giảng cần ít nhất 2 ý.')
      .max(10, 'Mạch giảng không nên có quá 10 ý.'),
  })
  .strict();

export type TeachingOutlineContent = z.infer<
  typeof TeachingOutlineContentSchema
>;

export const CodexTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export type CodexTokenUsage = z.infer<typeof CodexTokenUsageSchema>;

export const CodexReasoningEffortSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const TeachingOutlineSchema = TeachingOutlineContentSchema.extend({
  status: z.enum(outlineStatusValues),
  contentRevision: z.number().int().positive(),
  sourceInput: TopicInputSchema,
  generation: z
    .object({
      generationId: CreationIdSchema,
      provider: z.literal('codex'),
      model: z.string().min(1).max(160),
      requestedModel: z.string().min(1).max(160).optional(),
      reasoningEffort: CodexReasoningEffortSchema.optional(),
      promptVersion: z.string().min(1).max(40),
      generatedAt: z.string().datetime(),
      usage: CodexTokenUsageSchema.nullable(),
    })
    .strict(),
}).strict();

export type TeachingOutline = z.infer<typeof TeachingOutlineSchema>;

export const VoiceVisualBeatSchema = z
  .object({
    id: z.string().uuid(),
    voiceover: z
      .string()
      .trim()
      .min(12, 'Lời thuyết minh của beat cần rõ hơn.')
      .max(1000, 'Lời thuyết minh của beat nên ngắn hơn 1000 ký tự.'),
    visualDescription: z
      .string()
      .trim()
      .min(12, 'Mô tả visual của beat cần rõ hơn.')
      .max(700, 'Mô tả visual của beat nên ngắn hơn 700 ký tự.'),
    animationDescription: z
      .string()
      .trim()
      .min(8, 'Mô tả chuyển động của beat cần rõ hơn.')
      .max(500, 'Mô tả chuyển động của beat nên ngắn hơn 500 ký tự.'),
    visualHoldSeconds: z
      .number()
      .int()
      .min(0, 'Thời gian giữ hình không thể âm.')
      .max(30, 'Mỗi beat chỉ nên giữ hình thêm tối đa 30 giây.')
      .default(0),
    durationSeconds: z
      .number()
      .int()
      .min(4, 'Mỗi beat cần ít nhất 4 giây.')
      .max(90, 'Mỗi beat không nên dài quá 90 giây.'),
  })
  .strict();

export type VoiceVisualBeat = z.infer<typeof VoiceVisualBeatSchema>;

export const VoiceVisualSectionSchema = z
  .object({
    outlineSectionId: z.string().uuid(),
    beats: z
      .array(VoiceVisualBeatSchema)
      .min(1, 'Mỗi ý trong mạch giảng cần ít nhất một beat.')
      .max(8, 'Mỗi ý không nên có quá 8 beat.'),
  })
  .strict();

export const VoiceVisualPlanContentSchema = z
  .object({
    voiceDirection: z
      .string()
      .trim()
      .min(6, 'Định hướng giọng kể cần rõ hơn.')
      .max(320, 'Định hướng giọng kể nên ngắn hơn 320 ký tự.'),
    visualDirection: z
      .string()
      .trim()
      .min(6, 'Định hướng hình ảnh cần rõ hơn.')
      .max(420, 'Định hướng hình ảnh nên ngắn hơn 420 ký tự.'),
    timingCalibration: z
      .object({
        source: z.enum(['default', 'voice-history']),
        whitespaceTokensPerMinute: z.number().positive(),
        charactersPerSecond: z.number().positive(),
        voiceId: z.string().trim().min(1).max(160).nullable(),
        modelId: z.string().trim().min(1).max(160).nullable(),
        voiceName: z.string().trim().min(1).max(160).nullable(),
        sampleCount: z.number().int().nonnegative(),
      })
      .strict()
      .default({
        source: 'default',
        ...DEFAULT_NARRATION_CALIBRATION,
        voiceId: null,
        modelId: null,
        voiceName: null,
        sampleCount: 0,
      }),
    sections: z
      .array(VoiceVisualSectionSchema)
      .min(2, 'Kế hoạch cần bao phủ ít nhất 2 ý.')
      .max(10, 'Kế hoạch không nên có quá 10 ý.'),
  })
  .strict();

export type VoiceVisualPlanContent = z.infer<
  typeof VoiceVisualPlanContentSchema
>;

export const VoiceVisualPlanSchema = VoiceVisualPlanContentSchema.extend({
  status: z.enum(voiceVisualStatusValues),
  contentRevision: z.number().int().positive(),
  narrationRevision: z.number().int().positive().default(1),
  sourceOutlineContentRevision: z.number().int().positive(),
  generation: z
    .object({
      generationId: CreationIdSchema,
      provider: z.literal('codex'),
      model: z.string().min(1).max(160),
      requestedModel: z.string().min(1).max(160).optional(),
      reasoningEffort: CodexReasoningEffortSchema.optional(),
      promptVersion: z.string().min(1).max(40),
      generatedAt: z.string().datetime(),
      usage: CodexTokenUsageSchema.nullable(),
    })
    .strict(),
}).strict();

export type VoiceVisualPlan = z.infer<typeof VoiceVisualPlanSchema>;

export const MotionCanvasSceneSchema = z
  .object({
    id: z.string().uuid(),
    outlineSectionId: z.string().uuid(),
    name: z
      .string()
      .trim()
      .min(3, 'Tên scene còn quá ngắn.')
      .max(120, 'Tên scene nên ngắn hơn 120 ký tự.'),
    filePath: z
      .string()
      .regex(
        /^src\/scenes\/[a-z0-9][a-z0-9-]{0,80}\.tsx$/,
        'Đường dẫn scene Motion Canvas không hợp lệ.',
      ),
    durationSeconds: z.number().int().min(4).max(360),
    timingEvents: z
      .array(
        z
          .object({
            beatId: z.string().uuid(),
            startEvent: z.string().regex(/^beat:[0-9a-f-]{36}:start$/),
            endEvent: z.string().regex(/^beat:[0-9a-f-]{36}:end$/),
            plannedDurationSeconds: z.number().int().min(4).max(90),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .optional(),
  })
  .strict();

export type MotionCanvasScene = z.infer<typeof MotionCanvasSceneSchema>;

export const MotionCanvasBundleSchema = z
  .object({
    status: z.enum(motionCanvasStatusValues),
    contentRevision: z.number().int().positive(),
    sourceVoiceVisualContentRevision: z.number().int().positive(),
    workspacePath: z
      .string()
      .regex(
        /^motion-canvas\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'Đường dẫn workspace Motion Canvas không hợp lệ.',
      ),
    projectFile: z.literal('src/project.ts'),
    width: z.number().int().min(480).max(3840),
    height: z.number().int().min(480).max(3840),
    fps: z.number().int().min(1).max(120),
    timingContractVersion: z.literal(1).optional(),
    scenes: z
      .array(MotionCanvasSceneSchema)
      .min(2, 'Cần ít nhất 2 scene Motion Canvas.')
      .max(10, 'Không nên có quá 10 scene Motion Canvas.'),
    validation: z
      .object({
        validatedAt: z.string().datetime(),
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
        motionCanvasVersion: z.string().min(1).max(40),
      })
      .strict(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('codex'),
        model: z.string().min(1).max(160),
        requestedModel: z.string().min(1).max(160).optional(),
        reasoningEffort: CodexReasoningEffortSchema.optional(),
        promptVersion: z.string().min(1).max(40),
        generatedAt: z.string().datetime(),
        usage: CodexTokenUsageSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type MotionCanvasBundle = z.infer<typeof MotionCanvasBundleSchema>;

export const ElevenLabsVoiceSettingsSchema = z
  .object({
    stability: z.number().min(0).max(1),
    similarityBoost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    useSpeakerBoost: z.boolean(),
    speed: z.number().min(0.7).max(1.2),
  })
  .strict();

export type ElevenLabsVoiceSettings = z.infer<
  typeof ElevenLabsVoiceSettingsSchema
>;

export const VoiceConfigurationSchema = z
  .object({
    voiceId: z.string().trim().min(1).max(160),
    voiceName: z.string().trim().min(1).max(160),
    voiceCategory: z.string().trim().min(1).max(80).nullable(),
    modelId: z.string().trim().min(1).max(160),
    modelName: z.string().trim().min(1).max(160),
    languageCode: z.literal('vi'),
    outputFormat: z
      .string()
      .regex(
        /^(mp3|pcm|ulaw|alaw|opus)_[a-z0-9_]+$/,
        'Định dạng audio ElevenLabs không hợp lệ.',
      )
      .max(80),
    settings: ElevenLabsVoiceSettingsSchema,
    seed: z.number().int().min(0).max(4_294_967_295).nullable(),
  })
  .strict();

export type VoiceConfiguration = z.infer<typeof VoiceConfigurationSchema>;

export const VoiceBeatTimingSchema = z
  .object({
    beatId: z.string().uuid(),
    textStartIndex: z.number().int().nonnegative(),
    textEndIndex: z.number().int().positive(),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.textEndIndex > value.textStartIndex &&
      value.endSeconds >= value.startSeconds,
    'Timing của beat không hợp lệ.',
  );

const LegacyVoiceSectionAudioSchema = z
  .object({
    outlineSectionId: z.string().uuid(),
    audioPath: z
      .string()
      .regex(
        /^audio\/[0-9]{2}-[0-9a-f-]{36}\.(mp3|wav|pcm|opus)$/,
        'Đường dẫn audio của section không hợp lệ.',
      ),
    alignmentPath: z
      .string()
      .regex(
        /^alignments\/[0-9]{2}-[0-9a-f-]{36}\.json$/,
        'Đường dẫn alignment của section không hợp lệ.',
      ),
    durationSeconds: z.number().positive(),
    characterCost: z.number().int().nonnegative(),
    requestId: z.string().trim().min(1).max(200).nullable(),
    sourceTextHash: z.string().regex(/^[a-f0-9]{64}$/),
    beats: z.array(VoiceBeatTimingSchema).min(1).max(8),
  })
  .strict();

const LegacyVoiceBundleSchema = z
  .object({
    status: z.enum(voiceStatusValues),
    contentRevision: z.number().int().positive(),
    sourceVoiceVisualContentRevision: z.number().int().positive(),
    workspacePath: z
      .string()
      .regex(
        /^voice\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'Đường dẫn workspace voice không hợp lệ.',
      ),
    configuration: VoiceConfigurationSchema,
    sections: z.array(LegacyVoiceSectionAudioSchema).min(2).max(10),
    totalDurationSeconds: z.number().positive(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('elevenlabs'),
        generatedAt: z.string().datetime(),
        characterCost: z.number().int().nonnegative(),
        requestIds: z.array(z.string().trim().min(1).max(200)).max(10),
      })
      .strict(),
  })
  .strict();

export const VoiceNarrationTrackSchema = z
  .object({
    audioPath: z.literal('audio/narration.wav'),
    alignmentPath: z.literal('alignments/narration.json'),
    sourceTextHash: z.string().regex(/^[a-f0-9]{64}$/),
    durationSeconds: z.number().positive(),
    characterCost: z.number().int().nonnegative(),
    strategy: z.enum(['single-request', 'continuity-groups']),
    chunkCount: z.number().int().min(1).max(40),
    calibration: z
      .object({
        whitespaceTokenCount: z.number().int().positive(),
        characterCount: z.number().int().positive(),
        whitespaceTokensPerMinute: z.number().positive(),
        charactersPerSecond: z.number().positive(),
      })
      .strict(),
  })
  .strict();

export const VoiceSectionAudioSchema = z
  .object({
    outlineSectionId: z.string().uuid(),
    textStartIndex: z.number().int().nonnegative(),
    textEndIndex: z.number().int().positive(),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    durationSeconds: z.number().positive(),
    sourceTextHash: z.string().regex(/^[a-f0-9]{64}$/),
    beats: z.array(VoiceBeatTimingSchema).min(1).max(8),
  })
  .strict()
  .refine(
    (value) =>
      value.textEndIndex > value.textStartIndex &&
      value.endSeconds > value.startSeconds &&
      Math.abs(
        value.durationSeconds - (value.endSeconds - value.startSeconds),
      ) < 0.001,
    'Timing global của section voice không hợp lệ.',
  );

export type VoiceSectionAudio = z.infer<typeof VoiceSectionAudioSchema>;

export const VoiceBundleSchema = z
  .object({
    status: z.enum(voiceStatusValues),
    contentRevision: z.number().int().positive(),
    sourceNarrationRevision: z.number().int().positive(),
    workspacePath: z
      .string()
      .regex(
        /^voice\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'Đường dẫn workspace voice không hợp lệ.',
      ),
    configuration: VoiceConfigurationSchema,
    track: VoiceNarrationTrackSchema,
    sections: z.array(VoiceSectionAudioSchema).min(2).max(10),
    totalDurationSeconds: z.number().positive(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('elevenlabs'),
        generatedAt: z.string().datetime(),
        characterCost: z.number().int().nonnegative(),
        requestIds: z.array(z.string().trim().min(1).max(200)).max(40),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      Math.abs(value.totalDurationSeconds - value.track.durationSeconds) <
        0.001 &&
      value.sections.every(
        (section, index) =>
          section.endSeconds <= value.totalDurationSeconds + 0.001 &&
          (index === 0 ||
            Math.abs(
              section.startSeconds - value.sections[index - 1]!.endSeconds,
            ) < 0.001),
      ),
    'Track master và timing section voice không khớp.',
  );

export type VoiceBundle = z.infer<typeof VoiceBundleSchema>;

export const AnimationSyncBeatSchema = z
  .object({
    beatId: z.string().uuid(),
    startEvent: z.string().regex(/^beat:[0-9a-f-]{36}:start$/),
    endEvent: z.string().regex(/^beat:[0-9a-f-]{36}:end$/),
    plannedDurationSeconds: z.number().int().min(4).max(90),
    voiceStartSeconds: z.number().nonnegative(),
    voiceEndSeconds: z.number().positive(),
    synchronizedDurationSeconds: z.number().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.voiceEndSeconds >= value.voiceStartSeconds &&
      Math.abs(
        value.synchronizedDurationSeconds -
          (value.voiceEndSeconds - value.voiceStartSeconds),
      ) < 0.001,
    'Timing đồng bộ của beat không hợp lệ.',
  );

export const AnimationSyncSectionSchema = z
  .object({
    outlineSectionId: z.string().uuid(),
    sceneId: z.string().uuid(),
    filePath: z
      .string()
      .regex(/^src\/scenes\/[a-z0-9][a-z0-9-]{0,80}\.tsx$/),
    plannedDurationSeconds: z.number().positive(),
    synchronizedDurationSeconds: z.number().positive(),
    driftSeconds: z.number().finite(),
    beats: z.array(AnimationSyncBeatSchema).min(1).max(8),
  })
  .strict()
  .refine(
    (value) => {
      const plannedDuration = value.beats.reduce(
        (total, beat) => total + beat.plannedDurationSeconds,
        0,
      );
      const finalBeat = value.beats.at(-1);
      const beatIds = new Set(value.beats.map((beat) => beat.beatId));
      return (
        beatIds.size === value.beats.length &&
        Math.abs(value.plannedDurationSeconds - plannedDuration) < 0.001 &&
        Math.abs(
          value.driftSeconds -
            (value.synchronizedDurationSeconds -
              value.plannedDurationSeconds),
        ) < 0.001 &&
        finalBeat !== undefined &&
        Math.abs(
          finalBeat.voiceEndSeconds - value.synchronizedDurationSeconds,
        ) < 0.001 &&
        value.beats.every(
          (beat, index) =>
            index === 0 ||
            beat.voiceStartSeconds >=
              value.beats[index - 1]!.voiceEndSeconds - 0.001,
        )
      );
    },
    'Timing đồng bộ của section không hợp lệ.',
  );

export const AnimationSyncBundleSchema = z
  .object({
    status: z.enum(animationSyncStatusValues),
    contentRevision: z.number().int().positive(),
    sourceMotionCanvasContentRevision: z.number().int().positive(),
    sourceVoiceContentRevision: z.number().int().positive(),
    workspacePath: z
      .string()
      .regex(
        /^sync\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'Đường dẫn workspace đồng bộ không hợp lệ.',
      ),
    projectFile: z.literal('src/project.ts'),
    audioFile: z.literal('audio/narration.wav'),
    totalDurationSeconds: z.number().positive(),
    sections: z.array(AnimationSyncSectionSchema).min(2).max(10),
    validation: z
      .object({
        validatedAt: z.string().datetime(),
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
        motionCanvasVersion: z.string().min(1).max(40),
        audioDurationSeconds: z.number().positive(),
      })
      .strict(),
    generation: z
      .object({
        generationId: CreationIdSchema,
        provider: z.literal('local'),
        tool: z.literal('ffmpeg'),
        generatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.workspacePath ===
        `sync/generations/${value.generation.generationId}` &&
      Math.abs(
        value.totalDurationSeconds -
          value.sections.reduce(
            (total, section) =>
              total + section.synchronizedDurationSeconds,
            0,
          ),
      ) < 0.001 &&
      Math.abs(
        value.validation.audioDurationSeconds -
          value.totalDurationSeconds,
      ) < 0.05,
    'Tổng thời lượng workspace đồng bộ không hợp lệ.',
  );

export type AnimationSyncBundle = z.infer<
  typeof AnimationSyncBundleSchema
>;

const topicProjectV1Schema = z
  .object({
    id: z.string(),
    version: z.literal(1),
    status: ProjectStatusSchema,
    currentStep: ProjectStepV8Schema,
    topicInput: TopicInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV2Schema = z
  .object({
    id: z.string(),
    version: z.literal(2),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: ProjectStepV8Schema,
    topicInput: TopicInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV3Schema = z
  .object({
    id: z.string(),
    version: z.literal(3),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: z.enum(['topic', 'outline']),
    topicInput: TopicInputSchema,
    outline: TeachingOutlineSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV4Schema = z
  .object({
    id: z.string(),
    version: z.literal(4),
    revision: z.number().int().positive(),
    creationId: CreationIdSchema.nullable(),
    status: ProjectStatusSchema,
    currentStep: z.enum(['topic', 'outline', 'voiceVisual']),
    topicInput: TopicInputSchema,
    outline: TeachingOutlineSchema.nullable(),
    voiceVisualPlan: VoiceVisualPlanSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const topicProjectV5Schema = topicProjectV4Schema
  .omit({version: true})
  .extend({
    version: z.literal(5),
    currentStep: z.enum(['topic', 'outline', 'voiceVisual', 'motionCanvas']),
    motionCanvasBundle: MotionCanvasBundleSchema.nullable(),
  })
  .strict();

const topicProjectV6Schema = topicProjectV5Schema
  .omit({version: true, currentStep: true})
  .extend({
    version: z.literal(6),
    currentStep: z.enum([
      'topic',
      'outline',
      'voiceVisual',
      'motionCanvas',
      'voice',
    ]),
    voiceBundle: LegacyVoiceBundleSchema.nullable(),
  })
  .strict();

const topicProjectV7Schema = topicProjectV6Schema
  .omit({version: true, currentStep: true})
  .extend({
    version: z.literal(7),
    currentStep: ProjectStepV8Schema,
    animationSyncBundle: AnimationSyncBundleSchema.nullable(),
  })
  .strict();

const topicProjectV8Schema = topicProjectV7Schema
  .omit({
    version: true,
    voiceBundle: true,
    animationSyncBundle: true,
  })
  .extend({
    version: z.literal(8),
    voiceBundle: VoiceBundleSchema.nullable(),
    animationSyncBundle: AnimationSyncBundleSchema.nullable(),
  })
  .strict();

const topicProjectV9Schema = topicProjectV8Schema
  .omit({
    version: true,
    currentStep: true,
  })
  .extend({
    version: z.literal(9),
    currentStep: ProjectStepV9Schema,
    layoutBundle: LayoutBundleSchema.nullable(),
  })
  .strict();

const topicProjectV10Schema = topicProjectV9Schema
  .omit({version: true, currentStep: true})
  .extend({
    version: z.literal(10),
    currentStep: ProjectStepSchema,
    renderBundle: FinalRenderBundleSchema.nullable(),
  })
  .strict();

export const TopicProjectSchema = topicProjectV10Schema
  .omit({version: true})
  .extend({
    version: z.literal(currentProjectVersion),
    visualDesignBundle: VisualDesignBundleSchema.nullable(),
  })
  .strict();

export type TopicProject = z.infer<typeof TopicProjectSchema>;

export function parseTopicProject(value: unknown): TopicProject {
  const currentProject = TopicProjectSchema.safeParse(value);
  if (currentProject.success) return currentProject.data;

  const versionTenProject = topicProjectV10Schema.safeParse(value);
  if (versionTenProject.success) {
    return {
      ...versionTenProject.data,
      version: currentProjectVersion,
      visualDesignBundle: null,
    };
  }

  const versionNineProject = topicProjectV9Schema.safeParse(value);
  if (versionNineProject.success) {
    return {
      ...versionNineProject.data,
      version: currentProjectVersion,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionEightProject = topicProjectV8Schema.safeParse(value);
  if (versionEightProject.success) {
    return {
      ...versionEightProject.data,
      version: currentProjectVersion,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionSevenProject = topicProjectV7Schema.safeParse(value);
  if (versionSevenProject.success) {
    return {
      ...versionSevenProject.data,
      version: currentProjectVersion,
      currentStep:
        versionSevenProject.data.currentStep === 'sync'
          ? 'voice'
          : versionSevenProject.data.currentStep,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionSixProject = topicProjectV6Schema.safeParse(value);
  if (versionSixProject.success) {
    return {
      ...versionSixProject.data,
      version: currentProjectVersion,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionFiveProject = topicProjectV5Schema.safeParse(value);
  if (versionFiveProject.success) {
    return {
      ...versionFiveProject.data,
      version: currentProjectVersion,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionFourProject = topicProjectV4Schema.safeParse(value);
  if (versionFourProject.success) {
    return {
      ...versionFourProject.data,
      version: currentProjectVersion,
      motionCanvasBundle: null,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionThreeProject = topicProjectV3Schema.safeParse(value);
  if (versionThreeProject.success) {
    return {
      ...versionThreeProject.data,
      version: currentProjectVersion,
      voiceVisualPlan: null,
      motionCanvasBundle: null,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const versionTwoProject = topicProjectV2Schema.safeParse(value);
  if (versionTwoProject.success) {
    return {
      ...versionTwoProject.data,
      version: currentProjectVersion,
      outline: null,
      voiceVisualPlan: null,
      motionCanvasBundle: null,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  const legacyProject = topicProjectV1Schema.safeParse(value);
  if (legacyProject.success) {
    return {
      ...legacyProject.data,
      version: currentProjectVersion,
      revision: 1,
      creationId: null,
      outline: null,
      voiceVisualPlan: null,
      motionCanvasBundle: null,
      voiceBundle: null,
      animationSyncBundle: null,
      layoutBundle: null,
      renderBundle: null,
      visualDesignBundle: null,
    };
  }

  throw currentProject.error;
}

export const CreateTopicProjectSchema = z
  .object({
    creationId: CreationIdSchema,
    topicInput: TopicInputSchema,
    currentStep: z.literal('outline'),
  })
  .strict();

export type CreateTopicProject = z.infer<typeof CreateTopicProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    topicInput: TopicInputSchema.optional(),
    currentStep: z.literal('outline').optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.topicInput !== undefined ||
      value.currentStep !== undefined,
    'Cần có ít nhất một thay đổi.',
  );

export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const GenerateTeachingOutlineSchema = z
  .object({
    generationId: CreationIdSchema,
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
    guidance: z
      .string()
      .trim()
      .max(600, 'Góp ý cho AI nên ngắn hơn 600 ký tự.')
      .optional(),
  })
  .strict();

export type GenerateTeachingOutline = z.infer<
  typeof GenerateTeachingOutlineSchema
>;

export const GenerateVoiceVisualPlanSchema = z
  .object({
    generationId: CreationIdSchema,
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
    guidance: z
      .string()
      .trim()
      .max(600, 'Góp ý cho AI nên ngắn hơn 600 ký tự.')
      .optional(),
  })
  .strict();

export type GenerateVoiceVisualPlan = z.infer<
  typeof GenerateVoiceVisualPlanSchema
>;

export const GenerateMotionCanvasSchema = z
  .object({
    generationId: CreationIdSchema,
    model: z.string().trim().min(1).max(160).optional(),
    reasoningEffort: CodexReasoningEffortSchema.optional(),
    guidance: z
      .string()
      .trim()
      .max(600, 'Góp ý cho scene nên ngắn hơn 600 ký tự.')
      .optional(),
  })
  .strict();

export type GenerateMotionCanvas = z.infer<
  typeof GenerateMotionCanvasSchema
>;

export const GenerateVoiceSchema = z
  .object({
    generationId: CreationIdSchema,
    voiceId: z.string().trim().min(1).max(160),
    modelId: z.string().trim().min(1).max(160),
    outputFormat: z
      .string()
      .regex(/^(mp3|pcm|ulaw|alaw|opus)_[a-z0-9_]+$/)
      .max(80)
      .default('mp3_44100_128'),
    settings: ElevenLabsVoiceSettingsSchema,
    seed: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
  })
  .strict();

export type GenerateVoice = z.infer<typeof GenerateVoiceSchema>;

export const GenerateAnimationSyncSchema = z
  .object({
    generationId: CreationIdSchema,
  })
  .strict();

export type GenerateAnimationSync = z.infer<
  typeof GenerateAnimationSyncSchema
>;

export type ProjectListIssueCode =
  | 'INVALID_PROJECT_DATA'
  | 'UNSUPPORTED_PROJECT_VERSION'
  | 'PROJECT_READ_ERROR';

export interface ProjectListIssue {
  projectId: string;
  code: ProjectListIssueCode;
  message: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    currentProject?: TopicProject;
  };
}
