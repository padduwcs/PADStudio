import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {CodexTokenUsage, TopicInput} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const NARRATION_VISUAL_PLANNER_PROMPT_VERSION =
  'narration-visual-planner-v1';

/** One reviewed sentence with a stable ID. The AI planner may only reference
 * this ID; it never receives permission to echo, paraphrase, or invent text. */
export interface NarrationPlannerUnit {
  id: string;
  text: string;
}

export class NarrationVisualPlannerError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

const hexColor = /^#[0-9a-fA-F]{6}$/;

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
  })
  .strict();

const plannerSceneSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    goal: z.string().trim().min(6).max(400),
    stateHandoffIncoming: z.string().trim().min(3).max(500).nullable(),
    stateHandoffOutgoing: z.string().trim().min(3).max(500).nullable(),
    units: z
      .array(plannerUnitBlueprintSchema)
      .min(1)
      .max(pipelineSafetyLimits.maximumBeatsPerSection),
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
        body: z.number().int().min(14).max(120),
      })
      .strict(),
    shapeLanguage: z.string().trim().min(12).max(600),
    diagramLanguage: z.string().trim().min(12).max(600),
    motionTempo: z.string().trim().min(12).max(600),
    transitionConvention: z.string().trim().min(12).max(600),
    visualAnchor: z.string().trim().min(12).max(600),
  })
  .strict();

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

const outputJsonSchema = z.toJSONSchema(narrationVisualPlannerOutputSchema, {
  target: 'draft-7',
});

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
      'AI visual planner đã bỏ sót, lặp lại hoặc đổi thứ tự lời thoại đã duyệt.',
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
      'AI visual planner trả về nội dung có mã nguồn hoặc Markdown fence thay vì blueprint.',
    );
  }
}

export interface NarrationVisualPlannerRequest {
  topicInput: TopicInput;
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
    'Bạn là AI Visual Planner. Bạn CHỈ lập kế hoạch hình ảnh; tuyệt đối không được viết, sửa, rút gọn, dịch hay diễn giải lại lời thoại.',
    'Input units là danh sách câu lời thoại đã được người dùng duyệt, mỗi câu có unitId ổn định. Bạn không có quyền trả về voiceover text; chỉ được tham chiếu unitId.',
    'Nhóm TOÀN BỘ unit theo đúng thứ tự xuất hiện trong units thành các scene liên tiếp không chồng lấn: mọi unitId phải xuất hiện đúng một lần, không bỏ sót, không lặp lại, không đổi thứ tự.',
    'Mỗi scene cần title và teaching goal cụ thể cho đúng nội dung của các unit trong scene đó; không dùng nhãn chung chung như "Đoạn N".',
    'Với mỗi unit, viết visualPurpose (ý nào trong lời thoại trở thành quan hệ nhìn thấy được), visualDescription (hình gì, bố cục nào) và animationDescription (chuyển động gì) cụ thể cho riêng unit đó; không dùng caption lặp lại lời thoại.',
    'stateHandoffIncoming mô tả scene kế thừa gì từ scene trước (null nếu là scene đầu); stateHandoffOutgoing mô tả scene để lại gì cho scene sau (null nếu là scene cuối).',
    'visualBible áp dụng cho toàn video: palette (không gồm màu nền, hệ thống tự khóa theo lựa chọn người dùng), typography scale, ngôn ngữ hình khối/sơ đồ, nhịp chuyển động, quy ước chuyển scene, và một visual anchor xuyên suốt toàn video.',
    'Không trả TSX, mã nguồn, Markdown fence, hay bất kỳ nội dung lời thoại mới nào. Chỉ trả đúng JSON theo schema.',
    JSON.stringify({
      topicInput: request.topicInput,
      units: request.units,
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
      ? 'AI visual planner mất quá nhiều thời gian.'
      : error.reason === 'tool_used'
        ? 'AI visual planner đã cố dùng công cụ trong lượt chỉ được phép lập kế hoạch.'
        : error.reason === 'empty_response'
          ? 'AI visual planner không trả về nội dung.'
          : 'AI visual planner không hoàn tất được.';
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
            'AI visual planner trả về JSON không hợp lệ.',
            {cause: error},
          );
        }
        const parsed =
          narrationVisualPlannerOutputSchema.safeParse(responseJson);
        if (!parsed.success) {
          throw new NarrationVisualPlannerError(
            'CODEX_NARRATION_PLANNER_INVALID_RESPONSE',
            'AI visual planner trả về cấu trúc chưa đúng schema.',
            {cause: parsed.error},
          );
        }
        validatePlannerCoversUnitsInOrder(request.units, parsed.data.scenes);
        assertPlannerOutputHasNoCodeArtifacts(parsed.data);
        return {
          output: parsed.data,
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
