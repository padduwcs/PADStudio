import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import {VisualIntentSchema, compositionDensityValues, compositionLayoutValues, compositionSemanticRoleValues, type CodexTokenUsage, type TopicInput, type VisualIntent} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const NARRATION_VISUAL_PLANNER_PROMPT_VERSION =
  'narration-visual-v7-structural';

/** One timing-safe spoken unit paired with its original semantic wording. The
 * AI may only reference the stable ID; it never authors narration text. */
export interface NarrationPlannerUnit {
  id: string;
  /** Exact approved wording used for voice and duration calculations. */
  text: string;
  /** Step-1 wording used to understand concepts, notation and proper names. */
  semanticText: string;
}

export class NarrationVisualPlannerError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

const hexColor = /^#[0-9a-fA-F]{6}$/;
const semanticKey = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;

/**
 * The model owns subject-matter meaning only. Cross-reference repair and all
 * compiler-facing lifecycle/composition fields are derived locally below.
 * Keeping those technical invariants out of structured output makes a useful
 * visual plan much less likely to be discarded for a harmless key mismatch.
 */
const plannerVisualIntentSchema = z.object({
  message: z.string().trim().min(12).max(500),
  viewerShouldInfer: z.string().trim().min(12).max(500),
  abstraction: z.enum(['concrete', 'schematic', 'metaphorical', 'mixed']),
  entities: z.array(z.object({
    id: z.string().regex(semanticKey),
    kind: z.string().trim().min(2).max(80),
    label: z.string().trim().min(1).max(32).nullable(),
    role: z.enum(['primary', 'support', 'context']),
    appearance: z.string().trim().min(8).max(300),
    state: z.string().trim().min(2).max(160).nullable(),
    mustShow: z.boolean(),
  })).min(1).max(10),
  relations: z.array(z.object({
    id: z.string().regex(semanticKey),
    type: z.string().trim().min(2).max(80),
    from: z.string().regex(semanticKey),
    to: z.string().regex(semanticKey),
    description: z.string().trim().min(8).max(300),
    mustShow: z.boolean(),
  })).max(14),
  actions: z.array(z.object({
    id: z.string().regex(semanticKey),
    actor: z.string().regex(semanticKey),
    verb: z.string().trim().min(2).max(80),
    target: z.string().regex(semanticKey).nullable(),
    description: z.string().trim().min(8).max(300),
    fromState: z.string().trim().min(2).max(120).nullable(),
    toState: z.string().trim().min(2).max(120).nullable(),
    mustShow: z.boolean(),
  })).max(4),
});

const plannerSemanticUnitSchema = z.object({
  unitId: z.string().trim().regex(/^unit-\d+$/),
  visualPurpose: z.string().trim().min(12).max(500),
  visualDescription: z.string().trim().min(12).max(900),
  animationDescription: z.string().trim().min(8).max(500),
  visualIntent: plannerVisualIntentSchema,
});

const plannerUnitBlueprintSchema = z
  .object({
    unitId: z
      .string()
      .trim()
      .regex(/^unit-\d+$/),
    visualPurpose: z
      .string()
      .trim()
      .min(12, 'Visual purpose phải rõ ràng.')
      .max(500),
    visualDescription: z
      .string()
      .trim()
      .min(12, 'Visual description phải rõ ràng.')
      .max(900),
    animationDescription: z
      .string()
      .trim()
      .min(8, 'Animation description phải rõ ràng.')
      .max(500),
    visualLifecycle: z.object({
      enter: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/)).min(1).max(12),
      stay: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/)).min(1).max(12),
      exit: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/)).min(1).max(12),
    }).strict(),
    primaryBlock: z.string().regex(/^block-[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/),
    compositionContract: z
      .object({
        visualFocus: z.string().trim().min(12, 'Visual focus phải rõ ràng.').max(300),
        hierarchy: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/)).min(2).max(6),
        semanticRole: z.enum(compositionSemanticRoleValues),
        layout: z.enum(compositionLayoutValues),
        density: z.enum(compositionDensityValues),
        spacingNotes: z.string().trim().min(12, 'Spacing notes phải rõ ràng.').max(300),
      })
      .strict(),
    // Optional in the TypeScript boundary so legacy test doubles and stored
    // planner payloads remain readable. The real structured-output parser
    // below requires it for every newly generated unit.
    visualIntent: VisualIntentSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.visualLifecycle.stay.includes(value.primaryBlock)) {
      context.addIssue({code: 'custom', path: ['primaryBlock'], message: 'Primary block must stay visible during its beat.'});
    }
    if (value.visualLifecycle.stay.filter(key => key.startsWith('block-')).length > 2) {
      context.addIssue({code: 'custom', path: ['visualLifecycle', 'stay'], message: 'At most two block-* keys may stay active in one beat.'});
    }
    if (value.compositionContract.hierarchy[0] !== value.primaryBlock) {
      context.addIssue({code: 'custom', path: ['compositionContract', 'hierarchy', 0], message: 'The dominant hierarchy entry must be the primary block.'});
    }
    for (const [index, key] of value.compositionContract.hierarchy.entries()) {
      if (value.visualLifecycle.stay.includes(key)) continue;
      context.addIssue({code: 'custom', path: ['compositionContract', 'hierarchy', index], message: 'Every hierarchy key must stay visible during its beat.'});
    }
  });

const plannerSceneSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    goal: z.string().trim().min(6).max(400),
    stateHandoffIncoming: z.string().trim().min(3).max(500).nullable(),
    stateHandoffOutgoing: z.string().trim().min(3).max(500).nullable(),
    units: z
      .array(plannerUnitBlueprintSchema)
      .min(1)
      .max(pipelineSafetyLimits.maximumTotalBeats),
  })
  .strict();

/** Palette excludes background: the user already chose it in topicInput, and
 * the AI planner must never be able to override that theme decision. */
const plannerVisualBibleSchema = z
  .object({
    palette: z
      .object({
        surface: z.string().regex(hexColor),
        primary: z.string().regex(hexColor),
        accent: z.string().regex(hexColor),
        text: z.string().regex(hexColor),
      })
      .strict(),
    typographyScale: z
      .object({
        title: z.number().int().min(24).max(240),
        label: z.number().int().min(16).max(160),
        // The rendered quality gate rejects text below 18px; keep newly
        // generated visual bibles compatible with that deterministic floor.
        body: z.number().int().min(18).max(120),
      })
      .strict()
      .refine(
        scale => scale.title > scale.label && scale.label > scale.body,
        'typographyScale phải có title > label > body.',
      ),
    shapeLanguage: z.string().trim().min(12).max(600),
    diagramLanguage: z.string().trim().min(12).max(600),
    motionTempo: z.string().trim().min(12).max(600),
    transitionConvention: z.string().trim().min(12).max(600),
    visualAnchor: z.string().trim().min(12).max(600),
  })
  .strict();

const plannerSemanticSceneSchema = z.object({
  title: z.string().trim().min(3).max(160),
  goal: z.string().trim().min(6).max(400),
  stateHandoffIncoming: z.string().trim().min(3).max(500).nullable(),
  stateHandoffOutgoing: z.string().trim().min(3).max(500).nullable(),
  units: z.array(plannerSemanticUnitSchema)
    .min(1)
    .max(pipelineSafetyLimits.maximumTotalBeats),
});

const narrationVisualPlannerSemanticOutputSchema = z.object({
  scenes: z.array(plannerSemanticSceneSchema)
    .min(pipelineSafetyLimits.minimumSections)
    .max(pipelineSafetyLimits.maximumSections),
  visualBible: plannerVisualBibleSchema,
}).strict();

const narrationVisualPlannerOutputSchema = z
  .object({
    scenes: z
      .array(plannerSceneSchema)
      .min(pipelineSafetyLimits.minimumSections)
      .max(pipelineSafetyLimits.maximumSections),
    visualBible: plannerVisualBibleSchema,
  })
  .strict();

export type NarrationVisualPlannerOutput = z.infer<
  typeof narrationVisualPlannerOutputSchema
>;
export type NarrationVisualPlannerScene = z.infer<typeof plannerSceneSchema>;

type PlannerVisualIntent = z.infer<typeof plannerVisualIntentSchema>;

function nextUniqueSemanticId(candidate: string, used: Set<string>) {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  for (let suffix = 2; ; suffix += 1) {
    const resolved = `${candidate}-variant-${suffix}`;
    if (used.has(resolved)) continue;
    used.add(resolved);
    return resolved;
  }
}

/** Repairs only identity bookkeeping; it never invents subject matter. */
function normalizePlannerVisualIntent(input: PlannerVisualIntent): VisualIntent {
  const used = new Set<string>();
  const firstNormalizedId = new Map<string, string>();
  const selectedPrimary = Math.max(
    0,
    input.entities.findIndex(entity => entity.role === 'primary'),
  );
  const entities = input.entities.map((entity, index) => {
    const id = nextUniqueSemanticId(entity.id, used);
    if (!firstNormalizedId.has(entity.id)) firstNormalizedId.set(entity.id, id);
    return {
      ...entity,
      id,
      role: index === selectedPrimary
        ? 'primary' as const
        : entity.role === 'primary'
          ? 'support' as const
          : entity.role,
    };
  });
  const primary = entities[selectedPrimary]!;
  const secondary = entities.find((entity, index) => index !== selectedPrimary) ?? primary;
  const resolveEntity = (id: string, fallback: string) =>
    firstNormalizedId.get(id) ?? fallback;
  const relations = input.relations.map(relation => ({
    ...relation,
    id: nextUniqueSemanticId(relation.id, used),
    from: resolveEntity(relation.from, primary.id),
    to: resolveEntity(relation.to, secondary.id),
  }));
  const actions = input.actions.map(action => ({
    ...action,
    id: nextUniqueSemanticId(action.id, used),
    actor: resolveEntity(action.actor, primary.id),
    target: action.target
      ? resolveEntity(action.target, secondary.id)
      : null,
  }));
  return VisualIntentSchema.parse({...input, entities, relations, actions});
}

function technicalBlueprintForIntent(
  intent: VisualIntent,
  unit: z.infer<typeof plannerSemanticUnitSchema>,
) {
  const primaryEntity =
    intent.entities.find(entity => entity.role === 'primary') ?? intent.entities[0]!;
  const primaryBlock = `block-${primaryEntity.id}`;
  const detailKey = `visual-detail-${primaryEntity.id}`;
  const relationLooksComparative = intent.relations.some(relation =>
    /contrast|compare|difference|versus|đối chiếu|so sánh/iu.test(
      `${relation.type} ${relation.description}`,
    ),
  );
  const semanticRole = intent.actions.length > 0
    ? 'process' as const
    : relationLooksComparative
      ? 'contrast' as const
      : 'claim' as const;
  const layout = intent.entities.length >= 4
    ? 'grid' as const
    : intent.entities.length === 2
      ? 'left-right-split' as const
      : intent.abstraction === 'concrete' || intent.abstraction === 'mixed'
        ? 'full-bleed' as const
        : 'center-focus' as const;
  const density = intent.entities.length <= 2
    ? 'sparse' as const
    : intent.entities.length <= 5
      ? 'balanced' as const
      : 'dense' as const;
  return {
    primaryBlock,
    visualLifecycle: {
      enter: [primaryBlock, detailKey],
      stay: [primaryBlock, detailKey],
      exit: [primaryBlock, detailKey],
    },
    compositionContract: {
      visualFocus: intent.message.slice(0, 300),
      hierarchy: [primaryBlock, detailKey],
      semanticRole,
      layout,
      density,
      spacingNotes:
        `Keep the main ${primaryEntity.kind} readable with clear separation between meaningful objects and relations.`.slice(0, 300),
    },
    visualPurpose: unit.visualPurpose,
    visualDescription: unit.visualDescription,
    animationDescription: unit.animationDescription,
    visualIntent: intent,
  };
}

function directSemanticPlan(
  input: z.infer<typeof narrationVisualPlannerSemanticOutputSchema>,
): NarrationVisualPlannerOutput {
  return narrationVisualPlannerOutputSchema.parse({
    visualBible: input.visualBible,
    scenes: input.scenes.map(scene => ({
      ...scene,
      units: scene.units.map(unit => {
        const visualIntent = normalizePlannerVisualIntent(unit.visualIntent);
        return {
          unitId: unit.unitId,
          ...technicalBlueprintForIntent(visualIntent, unit),
        };
      }),
    })),
  });
}

/** Splits at unit boundaries only; narration IDs and their order are untouched. */
export function splitPlannerScenesAtBeatLimit(
  scenes: NarrationVisualPlannerScene[],
): NarrationVisualPlannerScene[] {
  const preferred = pipelineSafetyLimits.preferredBeatsPerSection;
  const maximum = pipelineSafetyLimits.maximumBeatsPerSection;
  const result: NarrationVisualPlannerScene[] = [];
  for (const scene of scenes) {
    if (scene.units.length <= maximum) { result.push(scene); continue; }
    for (let start = 0, part = 1; start < scene.units.length; start += preferred, part += 1) {
      const units = scene.units.slice(start, start + preferred);
      const isFirst = start === 0;
      const isLast = start + units.length >= scene.units.length;
      result.push({
        ...scene,
        title: `${scene.title} · part ${part}`.slice(0, 160),
        stateHandoffIncoming: isFirst ? scene.stateHandoffIncoming : `Continue the visual state from ${scene.title}.`,
        stateHandoffOutgoing: isLast ? scene.stateHandoffOutgoing : `Hand off the visual state to the next part of ${scene.title}.`,
        units,
      });
    }
  }
  if (result.length > pipelineSafetyLimits.maximumSections) {
    throw new NarrationVisualPlannerError('CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION', 'Narration needs more scenes than the project safety limit.');
  }
  return result;
}

const outputJsonSchema = z.toJSONSchema(
  narrationVisualPlannerSemanticOutputSchema,
  {
  target: 'draft-7',
  },
);

/** Every unit must appear exactly once, in the exact reviewed order. This is
 * a single positional-equality check: any duplicate, drop, or reorder makes
 * the flattened unit ID sequence diverge from the expected one immediately. */
export function validatePlannerCoversUnitsInOrder(
  units: NarrationPlannerUnit[],
  scenes: NarrationVisualPlannerScene[],
) {
  const expectedIds = units.map((unit) => unit.id);
  const actualIds = scenes.flatMap((scene) =>
    scene.units.map((unit) => unit.unitId),
  );
  const matches =
    actualIds.length === expectedIds.length &&
    actualIds.every((id, index) => id === expectedIds[index]);
  if (!matches) {
    throw new NarrationVisualPlannerError(
      'CODEX_NARRATION_PLANNER_INVARIANT_VIOLATION',
      'AI lập kế hoạch hình ảnh đã bỏ sót, lặp lại hoặc đổi thứ tự lời thoại đã duyệt.',
    );
  }
}

function collectPlannerStrings(output: NarrationVisualPlannerOutput) {
  const strings: string[] = [];
  for (const scene of output.scenes) {
    strings.push(scene.title, scene.goal);
    if (scene.stateHandoffIncoming) strings.push(scene.stateHandoffIncoming);
    if (scene.stateHandoffOutgoing) strings.push(scene.stateHandoffOutgoing);
    for (const unit of scene.units) {
      strings.push(
        unit.visualPurpose,
        unit.visualDescription,
        unit.animationDescription,
        unit.primaryBlock,
        unit.compositionContract.visualFocus,
        unit.compositionContract.spacingNotes,
        ...unit.compositionContract.hierarchy,
        ...unit.visualLifecycle.enter,
        ...unit.visualLifecycle.stay,
        ...unit.visualLifecycle.exit,
        ...(unit.visualIntent ? [
          unit.visualIntent.message,
          unit.visualIntent.viewerShouldInfer,
          ...unit.visualIntent.entities.flatMap(entity => [entity.id, entity.kind, entity.label ?? '', entity.appearance, entity.state ?? '']),
          ...unit.visualIntent.relations.flatMap(relation => [relation.id, relation.type, relation.description]),
          ...unit.visualIntent.actions.flatMap(action => [action.id, action.verb, action.description, action.fromState ?? '', action.toState ?? '']),
        ] : []),
      );
    }
  }
  const {visualBible} = output;
  strings.push(
    visualBible.shapeLanguage,
    visualBible.diagramLanguage,
    visualBible.motionTempo,
    visualBible.transitionConvention,
    visualBible.visualAnchor,
  );
  return strings;
}

/** The AI planner writes only bounded blueprint prose. It has no field for
 * source code, so this is a belt-and-suspenders guard against smuggled
 * TSX/Markdown, matching the same fence check used for scene generation. */
export function assertPlannerOutputHasNoCodeArtifacts(
  output: NarrationVisualPlannerOutput,
) {
  if (collectPlannerStrings(output).some((text) => text.includes('```'))) {
    throw new NarrationVisualPlannerError(
      'CODEX_NARRATION_PLANNER_INVALID_RESPONSE',
      'AI lập kế hoạch hình ảnh trả về nội dung có mã nguồn hoặc Markdown fence thay vì bản mô tả.',
    );
  }
}

export interface NarrationVisualPlannerRequest {
  topicInput: TopicInput;
  /** Complete step-1 transcript, formatting-cleaned but not pronounced. */
  semanticSourceText: string;
  units: NarrationPlannerUnit[];
  model?: string;
  reasoningEffort?: string;
}

export interface NarrationVisualPlannerResult {
  output: NarrationVisualPlannerOutput;
  model: string;
  usage: CodexTokenUsage | null;
}

export interface NarrationVisualPlannerService {
  plan(
    request: NarrationVisualPlannerRequest,
  ): Promise<NarrationVisualPlannerResult>;
}

function buildPrompt(request: NarrationVisualPlannerRequest) {
  return [
    'Group all units in their exact input order into consecutive, non-overlapping scenes. Prefer 3–4 beats per scene and never exceed 5; split at unit boundaries.',
    'Do not return renderer lifecycle keys, templates, coordinates, layout enums, or compiler primitives. PAD Studio derives those technical constraints locally after your semantic plan succeeds.',
    'Bạn là AI Visual Planner. Bạn CHỈ lập kế hoạch hình ảnh; tuyệt đối không được viết, sửa, rút gọn, dịch hay diễn giải lại lời thoại.',
    'semanticSourceText và semanticText là nội dung gốc ở bước 1, là nguồn sự thật để hiểu ngữ nghĩa, công thức, thuật ngữ và tên riêng.',
    'spokenText chỉ là cách đọc đã duyệt dành cho TTS và timing. Không được dùng cách viết phiên âm trong spokenText để suy diễn sai khái niệm hình ảnh.',
    'Mỗi input unit có unitId ổn định. Bạn không có quyền trả về voiceover text; chỉ được tham chiếu unitId.',
    'Nhóm TOÀN BỘ unit theo đúng thứ tự xuất hiện trong units thành các scene liên tiếp không chồng lấn: mọi unitId phải xuất hiện đúng một lần, không bỏ sót, không lặp lại, không đổi thứ tự.',
    'Mỗi scene cần title và teaching goal cụ thể cho đúng nội dung của các unit trong scene đó; không dùng nhãn chung chung như "Đoạn N".',
    'Với mỗi unit, viết visualPurpose (ý nào trong lời thoại trở thành quan hệ nhìn thấy được), visualDescription (hình gì, bố cục nào) và animationDescription (chuyển động gì) cụ thể cho riêng unit đó; không dùng caption lặp lại lời thoại.',
    'Visual-first: visualDescription và animationDescription phải xoay quanh vật thể, môi trường, quan hệ hoặc ẩn dụ nhìn thấy được mà một mình nó truyền tải được ý chính của unit. Chữ trên khung hình chỉ được dùng cho tiêu đề hoặc nhãn ngắn — không phải phương tiện chính để truyền đạt nội dung.',
    'topicInput.videoDirection và learningGoal là ràng buộc sáng tạo ưu tiên cao. Nếu người dùng yêu cầu một vật thể cụ thể hoặc cấm node/card/sơ đồ chung chung, kế hoạch phải giữ đúng yêu cầu đó ở entities, appearance, relations và actions.',
    'stateHandoffIncoming mô tả scene kế thừa gì từ scene trước (null nếu là scene đầu); stateHandoffOutgoing mô tả scene để lại gì cho scene sau (null nếu là scene cuối).',
    'visualBible áp dụng cho toàn video: palette (không gồm màu nền, hệ thống tự khóa theo lựa chọn người dùng), typography scale, ngôn ngữ hình khối/sơ đồ, nhịp chuyển động, quy ước chuyển scene, và một visual anchor xuyên suốt toàn video. Typography scale bắt buộc title > label > body.',
    'Không trả TSX, mã nguồn, Markdown fence, hay bất kỳ nội dung lời thoại mới nào. Chỉ trả đúng JSON theo schema.',
    'For every unit, visualIntent is REQUIRED and is the lossless semantic handoff. message states the visual claim; viewerShouldInfer states what a viewer should understand without reading narration; abstraction selects concrete/schematic/metaphorical/mixed. Declare 1-10 concrete entities with stable semantic kebab-case ids, open-vocabulary kind, visible appearance/state, role, and mustShow. Exactly one entity is primary. Declare every meaningful relation and action using those exact entity ids; mustShow marks obligations that the compiled scene must visibly bind. Do not collapse distinct people, objects, places, states, or data structures into generic nodes.',
    "When a unit's subject is a concrete data structure with countable elements (array, list, stack, queue, heap, tree, graph, hash table, matrix, and so on), do not declare one entity for the whole structure and leave its internal complexity to prose appearance text. Instead declare one entity per element actually being discussed (an array cell, a heap/tree node, a graph vertex) with a concrete sample value in its label or appearance — invent small consistent example values (numbers, short keys) when the source material implies content but never states literal numbers — and declare explicit relations between those element entities that mirror the real topology: parent/child edges for a tree or heap, sequential adjacency for a list/array/stack/queue, named edges for a graph. A single container/boundary entity is fine only in addition to its visible element entities, never instead of them.",
    'visualBible is also consumed by a rendered quality gate: choose typographyScale.title, label, and body with title > label > body and body >= 18 so every planned text step remains readable; use exact palette colours and let the renderer use opacity for muted variants.',
    'Visual Intent describes subject matter and is deliberately open vocabulary. Do not choose renderer primitives, templates, coordinates, cards, or implementation details here. Name what the object is and why it matters; the downstream Visual Director will choose a safe composition.',
    JSON.stringify({
      topicInput: request.topicInput,
      semanticSourceText: request.semanticSourceText,
      units: request.units.map(unit => ({
        unitId: unit.id,
        semanticText: unit.semanticText,
        spokenText: unit.text,
      })),
    }),
  ].join('\n');
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  const code =
    error.reason === 'timeout'
      ? 'CODEX_NARRATION_PLANNER_TIMEOUT'
      : error.reason === 'tool_used'
        ? 'CODEX_NARRATION_PLANNER_TOOL_USED'
        : error.reason === 'empty_response'
          ? 'CODEX_NARRATION_PLANNER_INVALID_RESPONSE'
          : 'CODEX_NARRATION_PLANNER_FAILED';
  const message =
    error.reason === 'timeout'
      ? 'AI lập kế hoạch hình ảnh mất quá nhiều thời gian.'
      : error.reason === 'tool_used'
        ? 'AI lập kế hoạch hình ảnh đã cố dùng công cụ trong lượt chỉ được phép lập kế hoạch.'
        : error.reason === 'empty_response'
          ? 'AI lập kế hoạch hình ảnh không trả về nội dung.'
          : 'AI lập kế hoạch hình ảnh không hoàn tất được.';
  return new NarrationVisualPlannerError(code, message, {cause: error});
}

export function createCodexNarrationVisualPlanner(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): NarrationVisualPlannerService {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ?? path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );

  return {
    async plan(request) {
      try {
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            options.timeoutMs ??
            codexGenerationTimeoutMs(request.reasoningEffort),
          outputSchema: outputJsonSchema,
          prompt: buildPrompt(request),
          baseInstructions:
            'Bạn lập kế hoạch hình ảnh cho PAD Studio. Không dùng công cụ hay đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Bạn chỉ tham chiếu unitId, không được trả lời thoại, mã nguồn hay Markdown. Mọi unit phải được bao phủ đúng một lần, đúng thứ tự.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });
        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new NarrationVisualPlannerError(
            'CODEX_NARRATION_PLANNER_INVALID_RESPONSE',
            'AI lập kế hoạch hình ảnh trả về JSON không hợp lệ.',
            {cause: error},
          );
        }
        const parsed =
          narrationVisualPlannerSemanticOutputSchema.safeParse(responseJson);
        if (!parsed.success) {
          throw new NarrationVisualPlannerError(
            'CODEX_NARRATION_PLANNER_INVALID_RESPONSE',
            'AI lập kế hoạch hình ảnh trả về cấu trúc chưa đúng schema.',
            {cause: parsed.error},
          );
        }
        const semanticOutput = {
          ...parsed.data,
          scenes: splitPlannerScenesAtBeatLimit(
            directSemanticPlan(parsed.data).scenes,
          ),
        };
        const output = narrationVisualPlannerOutputSchema.parse({
          ...semanticOutput,
          visualBible: parsed.data.visualBible,
        });
        validatePlannerCoversUnitsInOrder(request.units, output.scenes);
        assertPlannerOutputHasNoCodeArtifacts(output);
        return {
          output,
          model: generated.model,
          usage: generated.usage,
        };
      } catch (error) {
        if (error instanceof NarrationVisualPlannerError) throw error;
        if (error instanceof CodexStructuredGenerationError) {
          throw mapStructuredError(error);
        }
        throw new NarrationVisualPlannerError(
          'CODEX_NARRATION_PLANNER_FAILED',
          'Không thể lập kế hoạch hình ảnh bằng AI.',
          {cause: error},
        );
      }
    },
  };
}
