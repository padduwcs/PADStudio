import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {z} from 'zod';
import type {
  CodexTokenUsage,
  MotionCanvasBundle,
  MotionCanvasScene,
  TeachingOutline,
  TopicInput,
  VoiceVisualBeat,
  VoiceVisualPlan,
} from '../shared/topic.ts';
import {defaultVideoFrame, type VideoFrame} from '../shared/videoFormat.ts';
import {videoBackgroundTone} from '../shared/topic.ts';
import {pipelineSafetyLimits} from '../shared/pipelineLimits.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';
import {
  findUnsupportedMotionCanvasColorLiterals,
  normalizeMotionCanvasColorFormats,
} from './motionCanvasSourceCompatibility.ts';
import {wcagContrastRatio} from './visualViability.ts';
import {
  MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER,
  extractReferencedMotionCanvasIconIds,
  isKnownMotionCanvasIconId,
  suggestMotionCanvasIconIds,
} from './motionCanvasIconLibrary.ts';

export const MOTION_CANVAS_PROMPT_VERSION = 'motion-canvas-v20-direct-source';
export const MOTION_CANVAS_VERSION = '3.17.2';
export const MOTION_CANVAS_FPS = 30;
export const MOTION_CANVAS_DEFAULT_FONT_FAMILY =
  'Segoe UI, Helvetica Neue, Arial, sans-serif';
export const MOTION_CANVAS_SAFE_MARGIN_X_RATIO = 0.08;
export const MOTION_CANVAS_SAFE_MARGIN_Y_RATIO = 0.07;
export const MAX_CONCURRENT_PRIMARY_BLOCKS = 2;
/** Marks the deterministic renderer fallback as illustrative rather than a
 * verified Visual Intent -> JSX binding. */
export const MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER =
  'pad-semantic:unverified-fallback';
/** Versioned source contract that lets semantic validation distinguish newly
 * traceable direct-TSX from pre-contract handwritten source. */
export const MOTION_CANVAS_SEMANTIC_BINDING_MARKER =
  'pad-semantic:bindings-v1';
// Bounded well under a typical Codex account's concurrent-request rate limit;
// the rendered-frame quality gate has its own independent, smaller
// concurrency (QUALITY_RENDER_CONCURRENCY) so raising this only affects how
// many scenes are requested from Codex in parallel. Override per-deploy via
// PAD_MOTION_CANVAS_CONCURRENCY if a given Codex plan supports more.
export const DEFAULT_MOTION_CANVAS_GENERATION_CONCURRENCY = 8;
export const MAXIMUM_MOTION_CANVAS_GENERATION_CONCURRENCY = 8;
const DEFAULT_SCENE_TIMEOUT_MS = 20 * 60 * 1000;
// One focused repair plus one clean regeneration is both more reliable and
// more token-efficient than repeatedly feeding an increasingly broken source
// back into the model.
const MAX_SOURCE_REPAIR_ATTEMPTS = 1;
const sceneGenerationRunInstructions = {
  baseInstructions:
    'Write one complete Motion Canvas TSX scene for PAD Studio. Do not use tools or read files. Return only JSON matching the schema.',
  developerInstructions:
    'Return name and source: source is the full, literal TSX file contents (a complete file with imports and a default-exported makeScene2D generator). Do not return a declarative spec, Markdown, JSON-in-JSON, or partial code.',
} as const;

const generatedMotionCanvasSceneSchema = z
  .object({
    name: z.string().trim().min(3),
    source: z
      .string()
      .trim()
      .min(120)
      .max(pipelineSafetyLimits.maximumSceneSourceCharacters),
  })
  .strict();

const outputJsonSchema = z.toJSONSchema(generatedMotionCanvasSceneSchema, {
  target: 'draft-7',
});

const modelListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().min(1),
          model: z.string().min(1).optional(),
          isDefault: z.boolean().optional(),
          supportedReasoningEfforts: z
            .array(
              z
                .object({
                  reasoningEffort: z.string().min(1),
                })
                .passthrough(),
            )
            .optional(),
          defaultReasoningEffort: z.string().min(1).nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface MotionCanvasSourceScene extends MotionCanvasScene {
  source: string;
}

export interface MotionCanvasGenerationRequest {
  /** Project ownership namespace for all in-memory scene generation state. */
  projectId: string;
  generationId: string;
  model?: string;
  reasoningEffort?: string;
  topicInput: TopicInput;
  /** The project frame is chosen by the user; legacy callers may omit it. */
  videoFrame?: VideoFrame;
  outline: TeachingOutline;
  voiceVisualPlan: VoiceVisualPlan;
  sectionIndexes?: number[];
  /** A first-pass generation deliberately detached from an existing bundle. */
  regenerateFromScratch?: boolean;
  guidance?: string;
  currentScenes?: MotionCanvasSourceScene[];
  /** Reports bounded per-scene progress without coupling the generator to an
   * HTTP request. Callers must keep this callback non-blocking. */
  onProgress?: (progress: {
    completedScenes: number;
    totalScenes: number;
    sectionIndex: number | null;
    outcome: 'started' | 'completed' | 'failed';
  }) => void;
}

export interface MotionCanvasGenerationResult {
  scenes: MotionCanvasSourceScene[];
  model: string;
  usage: CodexTokenUsage | null;
  /** Bounded audit trail for the richness-triggered quality retry, if any ran. */
  qualityRetryDiagnostics?: NonNullable<MotionCanvasBundle['generationDiagnostics']>;
}

export interface MotionCanvasGenerator {
  generate(
    request: MotionCanvasGenerationRequest,
  ): Promise<MotionCanvasGenerationResult>;
  repair?(
    request: MotionCanvasGenerationRequest,
    generated: MotionCanvasGenerationResult,
    compilerDiagnostics: string,
  ): Promise<MotionCanvasGenerationResult>;
  recover?(
    request: MotionCanvasGenerationRequest,
    generated: MotionCanvasGenerationResult,
    compilerDiagnostics: string,
  ): MotionCanvasGenerationResult;
  discardGeneration?(projectId: string, generationId: string): void;
}

export class MotionCanvasGenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

function toSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54);
}

export function applyMotionCanvasDefaultFont(source: string) {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const insertionOffsets = new Set<number>();

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'Txt' &&
      !node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'fontFamily',
      )
    ) {
      insertionOffsets.add(node.attributes.end);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const attribute = ` fontFamily={${JSON.stringify(
    MOTION_CANVAS_DEFAULT_FONT_FAMILY,
  )}}`;
  return [...insertionOffsets]
    .sort((left, right) => right - left)
    .reduce(
      (result, offset) =>
        `${result.slice(0, offset)}${attribute}${result.slice(offset)}`,
      source,
    );
}

export interface MotionCanvasSceneQualityAssessment {
  score: number;
  richnessPerBeat: number;
  visualNodeCount: number;
  animatedCallCount: number;
  referencedNodeCount: number;
  visualTypeCount: number;
  issues: string[];
}

/**
 * A deterministic post-generation quality signal. This is intentionally not a
 * style judge; it detects the structural collapse seen in long batches (few
 * visual objects and almost no animated changes per beat) while leaving
 * intentional minimalist scenes alone.
 */
export function assessMotionCanvasSceneQuality(
  source: string,
  beatCount: number,
): MotionCanvasSceneQualityAssessment {
  const sourceFile = ts.createSourceFile(
    'quality-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visualTypes = new Set<string>();
  let visualNodeCount = 0;
  let animatedCallCount = 0;
  let referencedNodeCount = 0;
  const animationProperties = new Set([
    'position',
    'x',
    'y',
    'scale',
    'rotation',
    'opacity',
    'width',
    'height',
    'fill',
    'stroke',
    'lineWidth',
    'text',
    'points',
    'end',
    'start',
  ]);

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      const type = node.tagName.text;
      if (type !== 'Fragment') {
        visualNodeCount += 1;
        visualTypes.add(type);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createRef'
    ) {
      referencedNodeCount += 1;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      animationProperties.has(node.expression.name.text) &&
      node.arguments.length >= 2
    ) {
      animatedCallCount += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // The background is required infrastructure, not scene richness.
  visualNodeCount = Math.max(0, visualNodeCount - 1);
  const beats = Math.max(1, beatCount);
  const richnessPerBeat =
    (visualNodeCount * 4 +
      animatedCallCount * 3 +
      referencedNodeCount * 2 +
      visualTypes.size * 2 +
      Math.min(20, source.length / 250)) /
    beats;
  const expectedNodes = Math.max(4, beats * 2 + 2);
  const expectedAnimations = Math.max(2, beats * 2);
  const score = Math.round(
    Math.min(
      100,
      (Math.min(visualNodeCount, expectedNodes) / expectedNodes) * 42 +
        (Math.min(animatedCallCount, expectedAnimations) /
          expectedAnimations) *
          38 +
        Math.min(10, referencedNodeCount * 2) +
        Math.min(10, visualTypes.size * 2),
    ),
  );
  const issues: string[] = [];
  if (beats >= 2 && visualNodeCount < expectedNodes) {
    issues.push(
      `chỉ có ${visualNodeCount} visual node cho ${beats} beat (mục tiêu tối thiểu ${expectedNodes})`,
    );
  }
  if (beats >= 2 && animatedCallCount < expectedAnimations) {
    issues.push(
      `chỉ có ${animatedCallCount} thay đổi có animation cho ${beats} beat (mục tiêu tối thiểu ${expectedAnimations})`,
    );
  }
  if (visualTypes.size < 2) {
    issues.push('ngôn ngữ hình ảnh chỉ dùng một loại node');
  }
  return {
    score,
    richnessPerBeat,
    visualNodeCount,
    animatedCallCount,
    referencedNodeCount,
    visualTypeCount: visualTypes.size,
    issues,
  };
}

function sceneDesignBrief(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
  const frame = request.videoFrame ?? request.topicInput.videoFrame ?? defaultVideoFrame;
  const section = request.outline.sections[sectionIndex]!;
  const beats = request.voiceVisualPlan.sections[sectionIndex]!.beats;
  const previous = request.outline.sections[sectionIndex - 1];
  const next = request.outline.sections[sectionIndex + 1];
  const role =
    sectionIndex === 0
      ? 'opening'
      : sectionIndex === request.outline.sections.length - 1
        ? 'closing'
        : 'development';
  return {
    role,
    continuity: {
      previousTitle: previous?.title ?? null,
      currentTitle: section.title,
      nextTitle: next?.title ?? null,
    },
    qualityBudget: {
      minimumPurposefulVisualNodes: Math.max(4, beats.length * 2 + 2),
      minimumAnimatedChanges: Math.max(2, beats.length * 2),
      rule:
        'Mỗi beat phải tạo một thay đổi thị giác có ý nghĩa; tái sử dụng hệ node chung nhưng không được để các beat sau chỉ đổi text hoặc màu.',
    },
    composition:
      `Duy trì một visual anchor xuyên scene, phân cấp foreground/midground/background và chừa safe margin trong khung ${frame.width}x${frame.height}.`,
  };
}

function generationPayload(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
  const frame = request.videoFrame ?? request.topicInput.videoFrame ?? defaultVideoFrame;
  const outlineSection = request.outline.sections[sectionIndex];
  const voiceVisualSection =
    request.voiceVisualPlan.sections[sectionIndex];
  if (
    !outlineSection ||
    !voiceVisualSection ||
    voiceVisualSection.outlineSectionId !== outlineSection.id
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_REQUEST',
      'Kế hoạch voice–visual không khớp với mạch giảng.',
    );
  }

  return {
    topicInput: request.topicInput,
    video: {
      centralMessage: request.outline.centralMessage,
      voiceDirection: request.voiceVisualPlan.voiceDirection,
      visualDirection: request.voiceVisualPlan.visualDirection,
      visualBible: request.voiceVisualPlan.visualBible,
      flow: request.outline.sections.map((section) => ({
        title: section.title,
        goal: section.goal,
      })),
    },
    scene: {
      position: sectionIndex + 1,
      totalScenes: request.outline.sections.length,
      outline: {
        title: outlineSection.title,
        goal: outlineSection.goal,
        content: outlineSection.content,
        estimatedSeconds: outlineSection.estimatedSeconds,
      },
      beats: voiceVisualSection.beats.map((beat) => ({
        id: beat.id,
        timing: {
          startEvent: `beat:${beat.id}:start`,
          endEvent: `beat:${beat.id}:end`,
        },
        voiceover: beat.voiceover,
        visualPurpose: beat.visualPurpose,
        visualDescription: beat.visualDescription,
        animationDescription: beat.animationDescription,
        primaryBlock: beat.primaryBlock,
        visualLifecycle: beat.visualLifecycle,
        compositionContract: beat.compositionContract,
        visualIntent: beat.visualIntent,
        durationSeconds: beat.durationSeconds,
      })),
      stateHandoff: voiceVisualSection.stateHandoff,
    },
    canvas: {
      width: frame.width,
      height: frame.height,
      fps: frame.fps,
      defaultFontFamily: MOTION_CANVAS_DEFAULT_FONT_FAMILY,
    },
    designBrief: sceneDesignBrief(request, sectionIndex),
    ...(request.guidance ? {guidance: request.guidance} : {}),
    ...(request.guidance && request.currentScenes?.[sectionIndex]
      ? {
          currentScene: {
            name: request.currentScenes[sectionIndex]!.name,
            source: request.currentScenes[sectionIndex]!.source,
          },
        }
      : {}),
  };
}

function buildPrompt(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
  return [
    'Write one complete Motion Canvas TSX scene (a full file: imports plus `export default makeScene2D(function* (view) { ... })`) for the requested teaching section. Return JSON exactly as {"name":"...","source":"..."}; source is the entire literal TSX file contents. Do not return Markdown fences, a declarative spec, JSON-in-JSON, or placeholder code.',
    `Derive canvasWidth/canvasHeight from view.width()/view.height() and apply safe margins MOTION_CANVAS_SAFE_MARGIN_X_RATIO (${MOTION_CANVAS_SAFE_MARGIN_X_RATIO}) and MOTION_CANVAS_SAFE_MARGIN_Y_RATIO (${MOTION_CANVAS_SAFE_MARGIN_Y_RATIO}); never hardcode 1080x1920-style canvas literals.`,
    'Every lifecycle binding is an inseparable triple: one literal lifecycle key comment `// lifecycle:beat:<id>:enter=...|stay=...|exit=...|primary=...` per beat, one explicit JSX node carrying that key, and one createRef assigned to a bare identifier with ref={thatIdentifier} on that same node. Every enter and exit animation for that beat must call that exact ref.',
    'Structural attachment invariant: exactly one direct view.add(<SceneTree />) statement inside the default makeScene2D generator. The attached JSX tree must contain exactly one key="scene-background" with key="scene-content-root" nested inside it. Never yield or yield* JSX, view.add, or node.add, and never leave JSX unattached.',
    "Beat timing contract: for each scene.beats[] entry, yield* waitUntil(timing.startEvent), then const beatDuration = useDuration(timing.endEvent), then immediately const beatEndTime = useThread().time() + beatDuration. After the beat's visual work, yield* waitFor(Math.max(0, beatEndTime - useThread().time())) so the beat always ends exactly on time regardless of how long the visual animation actually took.",
    'Import rule: only from @motion-canvas/2d and @motion-canvas/core, plus the icon atlas import described below. Use only named exports (createRef, createSignal, easing functions like easeInOutCubic, ...); never import ref, signal, or easing as bare names.',
    "Semantic key rule: every visual JSX node needs a unique, stable, lowercase kebab-case key string literal describing its role — never an index, UUID, random value, or expression-derived string. Group related nodes under container blocks keyed block-*, with children positioned in that block's local coordinates. Never generate visual JSX via a loop or .map.",
    'Use kebab-case flex values (space-between, not spaceBetween). Every Txt needs a font family; default to MOTION_CANVAS_DEFAULT_FONT_FAMILY unless the design deliberately calls for another. Motion Canvas has no CSS transparent keyword — use #00000000. Never tween Line.points between arrays of different length; set points instantly first if the point count must change.',
    'Start the TSX source with the exact comment `// pad-semantic:bindings-v1`. Treat scene.beats[].visualIntent as a binding contract. Every mustShow entity, relation, and action needs its own explicit, visibly represented JSX node/animation whose literal key is exactly that Visual Intent id (for example, intent id "patient-marker" requires key="patient-marker"). This exact key is the machine-verifiable binding; do not use a descriptive substitute, combine several mustShow obligations under one key, invent ids, or silently drop an item.',
    "When a beat's visualIntent entity is an element of a data structure (an array cell, a heap/tree node, a graph vertex, a stack/queue slot, a matrix cell), draw it as a precise schematic shape (a circle or a small rounded rect) at the position its real structure implies — a tree/heap node sits below and to the side of its parent with the same spacing pattern repeated at every depth, array/list/stack/queue cells sit in one uniform row or column, graph vertices sit at the positions their edges require — and connect structurally-adjacent elements with a real <Line>/arrow JSX so the topology is visible, not merely implied by proximity. Give exactly one element per beat the primary size/role (the one being inserted, compared, or returned); render every other sibling element smaller (secondary/muted) so their labels do not visually compete.",
    `For any concrete recognizable object (a leaf, a person, a car, an organ, a device, a building, a weather condition, and so on), do not hand-draw an SVG path. Import {Icon} from '${MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER}' (already generated alongside every scene) and render it, e.g. <Icon key="leaf-icon" id="ph:leaf" x={...} y={...} width={...} height={...} rotation={...} fill={...} stroke={...} strokeWidth={...} opacity={...} />, choosing a real glyph id from Phosphor ("ph:name") or Tabler ("tabler:name") — examples: ph:leaf, ph:sun, ph:drop, ph:snowflake, ph:brain, ph:atom, ph:dna, ph:user, ph:car, tabler:home, tabler:building-hospital, tabler:heart, tabler:device-desktop, tabler:flask, tabler:world. Prefer the plainest, most common name for the concept. Every id is checked against the real icon library; an unknown one is rejected with suggestions. Reserve hand-drawn <Path>/<Line> shapes for abstract, non-representational decorative curves and schematic data-structure shapes — never for a recognizable real-world object.`,
    'Within one beat, JSX nodes render opaque and stack in the order written — they do not blend or turn translucent. Never fake a gradient, a mix, or a state change by piling similar same-tier shapes directly on top of each other; the later ones simply hide the earlier ones. Show a state change instead through a colour/role change, a transform animation across beats, or clear side-by-side placement. Reserve real stacking for genuine physical layering (an eye on a face, a window on a wall).',
    "Reference designBrief (role, continuity, qualityBudget, composition) for how many purposeful visual nodes and animated changes this beat needs, to keep a coherent visual anchor across beats, and to plan boxes with breathing room so unrelated shapes do not overlap.",
    `The required background is ${request.topicInput.background.color} (${videoBackgroundTone(request.topicInput.background)}); apply it to the scene-background node.`,
    JSON.stringify(generationPayload(request, sectionIndex)),
  ].join('\n');
}

function buildRepairPrompt(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
  currentScene: MotionCanvasSourceScene,
  compilerDiagnostics: string,
) {
  return [
    `Preserve the exact lifecycle marker and implementation for every beat, including full exit (opacity 0 or outside the runtime canvas). Preserve runtime canvas variables canvasWidth/canvasHeight and safe margins ${MOTION_CANVAS_SAFE_MARGIN_X_RATIO}/${MOTION_CANVAS_SAFE_MARGIN_Y_RATIO}; do not replace them with 1080x1920 literals.`,
    'Repair every lifecycle binding as an inseparable triple: one literal lifecycle key on one explicit JSX node, one createRef assigned to a bare identifier, and ref={thatIdentifier} on that same node. Every enter and exit animation must call that exact ref. Check all distinct enter/stay/exit keys, not only the first diagnostic.',
    'Structural attachment invariant: preserve or restore exactly one direct view.add(<SceneTree />) statement inside the default makeScene2D generator. The attached JSX tree must contain exactly one key="scene-background" with key="scene-content-root" nested inside it. Never yield or yield* JSX, view.add, or node.add, and do not leave JSX unattached.',
    'Sửa scene Motion Canvas sau để TypeScript biên dịch thành công.',
    'Giữ nguyên ý nghĩa visual, thứ tự beat và tổng timing. Chỉ thay đổi những phần cần để sửa lỗi và làm API đúng.',
    'Trả object gồm name và source; source là mã thuần, không dùng Markdown fence.',
    `Quy tắc import: visual node và makeScene2D từ @motion-canvas/2d; flow, ref, signal, tween, waitFor, waitUntil, useDuration và easing từ @motion-canvas/core; nếu scene dùng icon thì giữ nguyên import {Icon} from '${MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER}', không tự ý xoá hoặc đổi đường dẫn.`,
    'Giữ nguyên đúng waitUntil(startEvent) và useDuration(endEvent) của từng beat trong context; không thêm waitUntil(endEvent), vì đây sẽ là đăng ký event trùng.',
    'Ngay sau useDuration, lưu beatEndTime = useThread().time() + beatDuration; sau visual, gọi yield* waitFor(Math.max(0, beatEndTime - useThread().time())) để beat luôn kết thúc đúng mốc dù visual ngắn hơn.',
    'Tên export phải dùng chính xác: createRef, createSignal, easeInOutCubic; không import ref, signal hoặc easing.',
    'Không dùng JSX.Element, scaleX/scaleY, hoặc yield* một node/setter không có duration.',
    'Bắt đầu source bằng comment chính xác // pad-semantic:bindings-v1. Mỗi Visual Intent entity, relation và action có mustShow=true phải có một JSX node nhìn thấy được với literal key đúng bằng id của item đó; đây là contract truy vết bắt buộc.',
    'Giữ hoặc bổ sung key string literal lowercase kebab-case có ít nhất hai từ cho mọi visual JSX node, kể cả node có ref; key phải duy nhất trong scene và mô tả vai trò ổn định của node.',
    'Giữ hoặc bổ sung scene-content-root và các container block-* cho từng cụm visual. Node con phải dùng tọa độ local của block; không làm phẳng mọi node trực tiếp dưới scene-background.',
    'Không tạo key từ index, thứ tự, nội dung, vị trí, UUID, random, biểu thức hoặc biến. Không sinh visual JSX node bằng map/loop.',
    'Giá trị flex dùng kebab-case như space-between, space-around hoặc space-evenly; không dùng spaceBetween.',
    `Giữ font mặc định của mọi Txt là ${MOTION_CANVAS_DEFAULT_FONT_FAMILY}; không xóa fontFamily khi sửa lỗi.`,
    'Motion Canvas không hỗ trợ CSS keyword transparent. Thay literal màu transparent bằng #00000000.',
    'Không tween Line.points giữa hai mảng khác số điểm. Nếu cần đổi cardinality, set points tức thời rồi mới animate các signal khác.',
    JSON.stringify({
      context: generationPayload(request, sectionIndex),
      compilerDiagnostics,
      currentScene: {
        name: currentScene.name,
        source: currentScene.source,
      },
    }),
  ].join('\n');
}

function buildRegenerationPrompt(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
  diagnostics: string,
) {
  return [
    buildPrompt(request, sectionIndex),
    'The previous result failed validation. Produce a complete replacement Motion Canvas TSX scene from the teaching context; do not copy or repair the failed source.',
    `Diagnostics to avoid:\n${diagnostics}`,
  ].join('\n');
}

export function validateMotionCanvasRuntimeSafety(source: string) {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const motionLineImports = new Set<string>();
  const motion2dNamespaces = new Set<string>();
  const linePointCountsByRef = new Map<string, number>();

  function jsxAttribute(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ) {
    return node.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === name,
    );
  }

  function jsxExpression(attribute: ts.JsxAttribute | undefined) {
    return attribute?.initializer &&
      ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;
  }

  function arrayLiteralLength(expression: ts.Expression | undefined) {
    let current = expression;
    while (
      current &&
      (ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isSatisfiesExpression(current))
    ) {
      current = current.expression;
    }
    return current && ts.isArrayLiteralExpression(current)
      ? current.elements.length
      : null;
  }

  function collect(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@motion-canvas/2d'
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === 'Line') {
            motionLineImports.add(element.name.text);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        motion2dNamespaces.add(bindings.name.text);
      }
    }

    if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      const tagName = node.tagName.getText(sourceFile);
      const isLine =
        motionLineImports.has(tagName) ||
        [...motion2dNamespaces].some(
          namespace => tagName === `${namespace}.Line`,
        );
      if (isLine) {
        const ref = jsxExpression(jsxAttribute(node, 'ref'));
        const pointCount = arrayLiteralLength(
          jsxExpression(jsxAttribute(node, 'points')),
        );
        if (ref && ts.isIdentifier(ref) && pointCount !== null) {
          linePointCountsByRef.set(ref.text, pointCount);
        }
      }
    }

    ts.forEachChild(node, collect);
  }

  function validate(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 2 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'points' &&
      ts.isCallExpression(node.expression.expression) &&
      node.expression.expression.arguments.length === 0 &&
      ts.isIdentifier(node.expression.expression.expression)
    ) {
      const refName = node.expression.expression.expression.text;
      const initialPointCount = linePointCountsByRef.get(refName);
      const targetPointCount = arrayLiteralLength(node.arguments[0]);
      if (
        initialPointCount !== undefined &&
        targetPointCount !== null &&
        initialPointCount !== targetPointCount
      ) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
          `Line.points của ref “${refName}” không được tween từ ${initialPointCount} sang ${targetPointCount} điểm vì Motion Canvas có thể khóa renderer. Hãy giữ cùng số điểm hoặc set points tức thời.`,
        );
      }
    }
    ts.forEachChild(node, validate);
  }

  collect(sourceFile);
  validate(sourceFile);
}

export function validateMotionCanvasSceneSource(source: string) {
  if (source.includes('```')) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Codex trả về scene có Markdown fence thay vì mã nguồn thuần.',
    );
  }

  const syntaxDiagnostics =
    ts.transpileModule(source, {
      fileName: 'generated-scene.tsx',
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.Latest,
      },
      reportDiagnostics: true,
    }).diagnostics ?? [];
  if (
    syntaxDiagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Codex trả về scene có cú pháp TypeScript/TSX không hợp lệ.',
      {cause: syntaxDiagnostics},
    );
  }
  if (findUnsupportedMotionCanvasColorLiterals(source).length > 0) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Scene dùng CSS keyword transparent mà Motion Canvas không hỗ trợ; hãy dùng #00000000.',
    );
  }

  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  validateMotionCanvasRuntimeSafety(source);
  const bannedIdentifiers = new Map([
    ['require', 'require'],
    ['eval', 'eval'],
    ['Function', 'Function constructor'],
    ['fetch', 'fetch'],
    ['XMLHttpRequest', 'XMLHttpRequest'],
    ['WebSocket', 'WebSocket'],
    ['document', 'browser API'],
    ['window', 'browser API'],
    ['globalThis', 'browser API'],
    ['navigator', 'browser API'],
    ['location', 'browser API'],
    ['localStorage', 'browser storage'],
    ['sessionStorage', 'browser storage'],
    ['indexedDB', 'browser storage'],
    ['process', 'runtime API'],
    ['Deno', 'runtime API'],
    ['Bun', 'runtime API'],
  ]);
  const declaredIdentifiers = new Set<string>();
  const semanticLayoutKeys = new Set<string>();
  const motion2dImports = new Set<string>();
  const motion2dNamespaces = new Set<string>();
  let hasDefaultSceneExport = false;

  function collectBindingName(name: ts.BindingName) {
    if (ts.isIdentifier(name)) {
      declaredIdentifiers.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectBindingName(element.name);
      }
    }
  }

  function collectDeclarations(node: ts.Node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingName(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name
    ) {
      declaredIdentifiers.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name) {
      declaredIdentifiers.add(node.name.text);
    } else if (
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node)
    ) {
      declaredIdentifiers.add(node.name.text);
    }
    ts.forEachChild(node, collectDeclarations);
  }

  function isPropertyName(node: ts.Identifier) {
    const parent = node.parent;
    return (
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isPropertyDeclaration(parent) && parent.name === node) ||
      (ts.isMethodDeclaration(parent) && parent.name === node) ||
      (ts.isJsxAttribute(parent) && parent.name === node)
    );
  }

  function assertAllowedModule(moduleName: string) {
    if (moduleName === MOTION_CANVAS_ICON_ATLAS_IMPORT_SPECIFIER) return;
    if (
      !/^@motion-canvas\/(?:2d|core)(?:\/lib\/[a-zA-Z0-9/_-]+)?$/.test(
        moduleName,
      )
    ) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
        `Scene Motion Canvas import module không được phép: ${moduleName}`,
      );
    }
  }

  function validateSemanticLayoutKey(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ) {
    const tagName = node.tagName.getText(sourceFile);
    if (!/^[A-Z]/.test(tagName)) return;
    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor && ancestor !== sourceFile) {
      if (
        ts.isForStatement(ancestor) ||
        ts.isForInStatement(ancestor) ||
        ts.isForOfStatement(ancestor) ||
        ts.isWhileStatement(ancestor) ||
        ts.isDoStatement(ancestor)
      ) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
          `Visual JSX node <${tagName}> phải được khai báo tường minh, không sinh trong map/loop.`,
        );
      }
      if (
        ts.isFunctionExpression(ancestor) ||
        ts.isArrowFunction(ancestor) ||
        ts.isFunctionDeclaration(ancestor)
      ) {
        const parent = ancestor.parent;
        const isSceneFactory =
          ts.isCallExpression(parent) &&
          parent.arguments.includes(ancestor as ts.Expression) &&
          ts.isIdentifier(parent.expression) &&
          parent.expression.text === 'makeScene2D';
        if (!isSceneFactory) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
            `Visual JSX node <${tagName}> phải được khai báo trực tiếp trong scene, không sinh qua callback/helper lặp.`,
          );
        }
        break;
      }
      ancestor = ancestor.parent;
    }

    const keyAttribute = node.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === 'key',
    );
    const key = keyAttribute ? staticJsxAttributeString(keyAttribute) : null;
    const semanticKeyPattern =
      /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;
    const hasRandomLikeSegment =
      key?.split('-').some((segment) => /^[a-f0-9]{8,}$/i.test(segment)) ??
      false;

    if (
      !key ||
      key.length > 80 ||
      !semanticKeyPattern.test(key) ||
      hasRandomLikeSegment
    ) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        `Visual JSX node <${tagName}> phải có key string literal lowercase kebab-case mô tả vai trò ổn định; không dùng index, UUID, random hoặc biểu thức.`,
      );
    }
    if (semanticLayoutKeys.has(key)) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        `Layout key “${key}” bị trùng trong cùng scene Motion Canvas.`,
      );
    }
    semanticLayoutKeys.add(key);
  }

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      assertAllowedModule(node.moduleSpecifier.text);
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier.text === '@motion-canvas/2d'
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            motion2dImports.add(element.name.text);
          }
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          motion2dNamespaces.add(bindings.name.text);
        }
      }
    }

    if (ts.isImportEqualsDeclaration(node)) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
        'Scene Motion Canvas dùng import assignment ngoài phạm vi cho phép.',
      );
    }

    if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      validateSemanticLayoutKey(node);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
        'Scene Motion Canvas dùng dynamic import ngoài phạm vi cho phép.',
      );
    }

    if (ts.isNewExpression(node)) {
      const constructsMotion2dNode =
        (ts.isIdentifier(node.expression) &&
          motion2dImports.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          motion2dNamespaces.has(node.expression.expression.text));
      if (constructsMotion2dNode) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
          'Visual Motion Canvas phải được khai báo bằng JSX tường minh với semantic key; không dùng new để tạo node.',
        );
      }
    }

    if (
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'makeScene2D'
    ) {
      hasDefaultSceneExport = true;
    }

    if (
      ts.isIdentifier(node) &&
      !declaredIdentifiers.has(node.text) &&
      !isPropertyName(node)
    ) {
      const label = bannedIdentifiers.get(node.text);
      if (label) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_UNSAFE_SOURCE',
          `Scene Motion Canvas dùng global ${node.text} (${label}) ngoài phạm vi cho phép.`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  collectDeclarations(sourceFile);
  visit(sourceFile);
  if (!hasDefaultSceneExport) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Codex trả về scene không có default export Motion Canvas hợp lệ.',
    );
  }
}

/**
 * Codex can no longer rely on a backend compiler to resolve icon ids, so
 * every `<Icon id="...">` reference it writes must name a real glyph from
 * the bundled icon library (see motionCanvasIconLibrary.ts). Checked
 * separately from `validateMotionCanvasSceneSource` so an unknown icon id
 * surfaces its own actionable, suggestion-bearing error message.
 */
export function validateMotionCanvasIconReferences(source: string) {
  for (const iconId of extractReferencedMotionCanvasIconIds(source)) {
    if (!isKnownMotionCanvasIconId(iconId)) {
      const suggestions = suggestMotionCanvasIconIds(iconId);
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        `Icon id "${iconId}" không tồn tại trong thư viện icon.${suggestions.length ? ` Có thể bạn muốn: ${suggestions.join(', ')}.` : ''}`,
      );
    }
  }
}

export function validateMotionCanvasTimingContract(
  source: string,
  beats: Array<{id: string}>,
) {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const waitEvents: string[] = [];
  const durationEvents: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      if (node.expression.text === 'waitUntil') {
        waitEvents.push(node.arguments[0]!.text);
      }
      if (node.expression.text === 'useDuration') {
        durationEvents.push(node.arguments[0]!.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const expectedWaitEvents = beats.map(
    (beat) => `beat:${beat.id}:start`,
  );
  const expectedDurationEvents = beats.map(
    (beat) => `beat:${beat.id}:end`,
  );
  const exactWaitContract =
    waitEvents.length === expectedWaitEvents.length &&
    waitEvents.every((event, index) => event === expectedWaitEvents[index]);
  const exactDurationContract =
    durationEvents.length === expectedDurationEvents.length &&
    durationEvents.every(
      (event, index) => event === expectedDurationEvents[index],
    );
  const escapePattern = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactBeatEndContract = beats.every((beat) => {
    const endEvent = escapePattern(`beat:${beat.id}:end`);
    const durationDeclaration = new RegExp(
      `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*` +
        `useDuration\\(\\s*['"]${endEvent}['"]\\s*\\)\\s*;`,
    ).exec(source);
    const durationName = durationDeclaration?.[1];
    if (!durationName) return false;
    const endDeclaration = new RegExp(
      `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*` +
        `useThread\\(\\)\\.time\\(\\)\\s*\\+\\s*${durationName}\\s*;`,
    ).exec(source);
    const endName = endDeclaration?.[1];
    if (!endName) return false;
    return new RegExp(
      `yield\\s*\\*\\s*waitFor\\(\\s*Math\\.max\\(\\s*0\\s*,\\s*` +
        `${endName}\\s*-\\s*useThread\\(\\)\\.time\\(\\)\\s*\\)\\s*\\)`,
    ).test(source);
  });
  if (
    !exactWaitContract ||
    !exactDurationContract ||
    !exactBeatEndContract
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_TIMING_CONTRACT',
      'Scene không giữ đúng start, duration/endTime và phép bù thời gian cuối của từng beat.',
    );
  }
}

export function mergeMotionCanvasGenerationUsage(
  left: CodexTokenUsage | null,
  right: CodexTokenUsage | null,
): CodexTokenUsage | null {
  if (!left || !right) return null;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

type LifecycleBeat = {
  id: string;
  primaryBlock?: string;
  visualLifecycle?: {enter: string[]; stay: string[]; exit: string[]};
};

type SceneNodeBinding = {key: string; ref: string | null; node: ts.JsxOpeningElement | ts.JsxSelfClosingElement};
type RefAnimation = {ref: string; property: string; target: ts.Expression; node: ts.CallExpression};

function staticJsxAttributeString(attribute: ts.JsxAttribute) {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    (ts.isStringLiteral(initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(initializer.expression))
  ) {
    return initializer.expression.text;
  }
  return null;
}

function sceneNodeBindings(sourceFile: ts.SourceFile) {
  const bindings = new Map<string, SceneNodeBinding>();
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let key: string | null = null;
      let ref: string | null = null;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
        if (attribute.name.text === 'key') key = staticJsxAttributeString(attribute);
        if (attribute.name.text === 'ref' && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isIdentifier(attribute.initializer.expression)) ref = attribute.initializer.expression.text;
      }
      if (key) bindings.set(key, {key, ref, node});
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

/** Extracts literal JSX keys for the static half of semantic evidence. */
export function extractMotionCanvasSemanticKeys(source: string) {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return new Set(sceneNodeBindings(sourceFile).keys());
}

/** A mustShow item is addressable only when a JSX node uses the exact Visual
 * Intent id as its literal key. Runtime validation separately proves visible
 * geometry at the beat's middle frame. */
export function validateMotionCanvasVisualIntentBindings(
  source: string,
  beats: Pick<VoiceVisualBeat, 'visualIntent'>[],
) {
  const required = beats.flatMap(beat => beat.visualIntent
    ? [...beat.visualIntent.entities, ...beat.visualIntent.relations, ...beat.visualIntent.actions]
      .filter(item => item.mustShow)
      .map(item => item.id)
    : [],
  );
  if (required.length === 0) return;
  if (!source.includes(MOTION_CANVAS_SEMANTIC_BINDING_MARKER)) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      `Scene thiếu marker // ${MOTION_CANVAS_SEMANTIC_BINDING_MARKER} cho contract truy vết Visual Intent.`,
    );
  }
  const keys = extractMotionCanvasSemanticKeys(source);
  const missing = [...new Set(required.filter(id => !keys.has(id)))];
  if (missing.length > 0) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      `Scene thiếu JSX key liên kết trực tiếp với Visual Intent mustShow: ${missing.join(', ')}. Mỗi id phải là key string literal của một visual node riêng.`,
    );
  }
}

function generatorStatements(sourceFile: ts.SourceFile) {
  const exported = sourceFile.statements.find(statement => ts.isExportAssignment(statement));
  const factory = exported && ts.isExportAssignment(exported) && ts.isCallExpression(exported.expression)
    ? exported.expression.arguments[0] : undefined;
  return factory && ts.isFunctionExpression(factory) ? [...factory.body.statements] : [];
}

function statementHasStartEvent(statement: ts.Statement, event: string) {
  let found = false;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitUntil' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!) && node.arguments[0]!.text === event) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(statement);
  return found;
}

function refAnimations(nodes: readonly ts.Node[]) {
  const animations: RefAnimation[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression) && ts.isIdentifier(node.expression.expression.expression)) {
      animations.push({ref: node.expression.expression.expression.text, property: node.expression.name.text, target: node.arguments[0]!, node});
    }
    ts.forEachChild(node, visit);
  }
  for (const node of nodes) visit(node);
  return animations;
}

function staticExpressionNumber(expression: ts.Expression | undefined, constants: ReadonlyMap<string, number>) : number | null {
  if (!expression) return null;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return staticExpressionNumber(expression.expression, constants);
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isIdentifier(expression)) return constants.get(expression.text) ?? null;
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken) {
    const value = staticExpressionNumber(expression.operand, constants); return value === null ? null : -value;
  }
  if (ts.isBinaryExpression(expression)) {
    const left = staticExpressionNumber(expression.left, constants); const right = staticExpressionNumber(expression.right, constants);
    if (left === null || right === null) return null;
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return left + right;
      case ts.SyntaxKind.MinusToken: return left - right;
      case ts.SyntaxKind.AsteriskToken: return left * right;
      case ts.SyntaxKind.SlashToken: return right === 0 ? null : left / right;
    }
  }
  return null;
}

function sourceConstants(sourceFile: ts.SourceFile, frame: VideoFrame) {
  const constants = new Map<string, number>([['canvasWidth', frame.width], ['canvasHeight', frame.height]]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !constants.has(node.name.text)) {
        const value = staticExpressionNumber(node.initializer, constants);
        if (value !== null) { constants.set(node.name.text, value); changed = true; }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return constants;
}

export function validateMotionCanvasBeatLifecycle(
  source: string,
  beats: LifecycleBeat[],
  frame: VideoFrame = defaultVideoFrame,
) {
  const sourceFile = ts.createSourceFile('generated-scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = sceneNodeBindings(sourceFile);
  const statements = generatorStatements(sourceFile);
  const constants = sourceConstants(sourceFile, frame);
  if (beats.length > pipelineSafetyLimits.maximumBeatsPerSection) {
    throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', 'Scene exceeds the five-beat lifecycle limit.');
  }
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
    const beat = beats[beatIndex]!;
    const lifecycle = beat.visualLifecycle;
    if (!beat.primaryBlock || !lifecycle || !lifecycle.enter.length || !lifecycle.stay.length || !lifecycle.exit.length || !lifecycle.stay.includes(beat.primaryBlock)) {
      throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', 'Beat is missing its primary block or enter/stay/exit blueprint.');
    }
    const marker = `lifecycle:beat:${beat.id}:enter=${lifecycle.enter.join(',')}|stay=${lifecycle.stay.join(',')}|exit=${lifecycle.exit.join(',')}|primary=${beat.primaryBlock}`;
    if (!source.includes(marker)) {
      throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Scene does not implement the planned lifecycle for beat ${beat.id}.`);
    }
    const lifecycleKeys = [...new Set([...lifecycle.enter, ...lifecycle.stay, ...lifecycle.exit])];
    for (const key of lifecycleKeys) {
      if (!bindings.get(key)?.ref) {
        throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Lifecycle visual “${key}” must map to one explicit JSX node whose matching literal key and ref={bareIdentifier} are attached to that same node.`);
      }
    }
    if (lifecycle.stay.filter(key => key.startsWith('block-')).length > MAX_CONCURRENT_PRIMARY_BLOCKS) {
      throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Beat ${beat.id} keeps more than ${MAX_CONCURRENT_PRIMARY_BLOCKS} block-* visuals active.`);
    }
    const startIndex = statements.findIndex(statement => statementHasStartEvent(statement, `beat:${beat.id}:start`));
    const nextStartIndex = beatIndex + 1 < beats.length
      ? statements.findIndex(statement => statementHasStartEvent(statement, `beat:${beats[beatIndex + 1]!.id}:start`))
      : statements.length;
    if (startIndex < 0 || nextStartIndex <= startIndex) {
      throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Cannot isolate executable lifecycle scope for beat ${beat.id}.`);
    }
    const animations = refAnimations(statements.slice(startIndex + 1, nextStartIndex));
    const animationsFor = (key: string) => animations.filter(animation => animation.ref === bindings.get(key)!.ref);
    for (const key of lifecycle.enter) {
      const implemented = animationsFor(key).some(animation => {
        if (animation.property === 'opacity') {
          const value = staticExpressionNumber(animation.target, constants); return value !== null && value > 0;
        }
        return animation.property === 'x' || animation.property === 'y' || animation.property === 'position';
      });
      if (!implemented) throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Beat ${beat.id} does not animate enter visual “${key}” through its own ref.`);
    }
    for (const key of lifecycle.exit) {
      const implemented = animationsFor(key).some(animation => {
        if (animation.property === 'opacity') return staticExpressionNumber(animation.target, constants) === 0;
        if (animation.property === 'x') { const value = staticExpressionNumber(animation.target, constants); return value !== null && Math.abs(value) > frame.width / 2; }
        if (animation.property === 'y') { const value = staticExpressionNumber(animation.target, constants); return value !== null && Math.abs(value) > frame.height / 2; }
        if (animation.property === 'position' && ts.isArrayLiteralExpression(animation.target) && animation.target.elements.length === 2) {
          const x = staticExpressionNumber(animation.target.elements[0] as ts.Expression, constants);
          const y = staticExpressionNumber(animation.target.elements[1] as ts.Expression, constants);
          return (x !== null && Math.abs(x) > frame.width / 2) || (y !== null && Math.abs(y) > frame.height / 2);
        }
        return false;
      });
      if (!implemented) throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LIFECYCLE', `Beat ${beat.id} does not fully exit visual “${key}” through its own ref.`);
    }
  }
}

/** Static responsive-layout contract for generated scenes. */
export function validateMotionCanvasResponsiveLayout(source: string, frame: VideoFrame, beats: LifecycleBeat[] = []) {
  const sourceFile = ts.createSourceFile('generated-scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!/const\s+canvasWidth\s*=\s*view\.width\(\)\s*;/.test(source) || !/const\s+canvasHeight\s*=\s*view\.height\(\)\s*;/.test(source)) {
    throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LAYOUT', 'Scene must derive canvasWidth/canvasHeight from view.width()/view.height().');
  }
  if (!new RegExp(`const\\s+safeMarginX\\s*=\\s*canvasWidth\\s*\\*\\s*${MOTION_CANVAS_SAFE_MARGIN_X_RATIO}`).test(source) || !new RegExp(`const\\s+safeMarginY\\s*=\\s*canvasHeight\\s*\\*\\s*${MOTION_CANVAS_SAFE_MARGIN_Y_RATIO}`).test(source)) {
    throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LAYOUT', 'Scene must declare the quantified safe margins from canvas dimensions.');
  }
  const constants = sourceConstants(sourceFile, frame);
  const bindings = sceneNodeBindings(sourceFile);
  const exitRefs = new Set(beats.flatMap(beat => beat.visualLifecycle?.exit ?? []).map(key => bindings.get(key)?.ref).filter((ref): ref is string => Boolean(ref)));
  function jsxExpression(attribute: ts.JsxAttribute | undefined) {
    return attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
  }
  function coordinate(expression: ts.Expression | undefined) { return staticExpressionNumber(expression, constants); }
  function coordinates(attributes: ReadonlyMap<string, ts.JsxAttribute>) {
    const position = jsxExpression(attributes.get('position'));
    if (position && ts.isArrayLiteralExpression(position) && position.elements.length === 2) return [coordinate(position.elements[0] as ts.Expression), coordinate(position.elements[1] as ts.Expression)] as const;
    return [coordinate(jsxExpression(attributes.get('x'))), coordinate(jsxExpression(attributes.get('y')))] as const;
  }
  function dimensions(attributes: ReadonlyMap<string, ts.JsxAttribute>) {
    const size = coordinate(jsxExpression(attributes.get('size')));
    return [coordinate(jsxExpression(attributes.get('width'))) ?? size, coordinate(jsxExpression(attributes.get('height'))) ?? size] as const;
  }
  function assertBox(x: number | null, y: number | null, width: number | null, height: number | null, label: string, allowOutside: boolean) {
    if (allowOutside) return;
    const minX = -frame.width / 2 + frame.width * MOTION_CANVAS_SAFE_MARGIN_X_RATIO;
    const maxX = frame.width / 2 - frame.width * MOTION_CANVAS_SAFE_MARGIN_X_RATIO;
    const minY = -frame.height / 2 + frame.height * MOTION_CANVAS_SAFE_MARGIN_Y_RATIO;
    const maxY = frame.height / 2 - frame.height * MOTION_CANVAS_SAFE_MARGIN_Y_RATIO;
    if ((x !== null && ((width !== null && (x - width / 2 < minX || x + width / 2 > maxX)) || (width === null && (x < minX || x > maxX)))) || (y !== null && ((height !== null && (y - height / 2 < minY || y + height / 2 > maxY)) || (height === null && (y < minY || y > maxY))))) {
      throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LAYOUT', `${label} is outside the quantified safe area.`);
    }
  }
  let responsiveBackground = false;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = new Map<string, ts.JsxAttribute>();
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name)) attributes.set(attribute.name.text, attribute);
      const keyAttribute = attributes.get('key');
      const keyText = keyAttribute
        ? staticJsxAttributeString(keyAttribute)
        : null;
      if (keyText === 'scene-background') {
        const width = jsxExpression(attributes.get('width'));
        const height = jsxExpression(attributes.get('height'));
        responsiveBackground = Boolean(width && height && ts.isIdentifier(width) && width.text === 'canvasWidth' && ts.isIdentifier(height) && height.text === 'canvasHeight');
      }
      const [x, y] = coordinates(attributes); const [width, height] = dimensions(attributes);
      const ref = bindings.get(keyText ?? '')?.ref;
      const lifecycleStaging = Boolean(ref && beats.some(beat => [...(beat.visualLifecycle?.enter ?? []), ...(beat.visualLifecycle?.exit ?? [])].some(key => bindings.get(key)?.ref === ref)));
      if (keyText !== 'scene-background') assertBox(x, y, width, height, `Initial visual ${keyText ?? 'without-key'}`, lifecycleStaging);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const animation of refAnimations(generatorStatements(sourceFile))) {
    if (!['x', 'y', 'position'].includes(animation.property)) continue;
    const binding = [...bindings.values()].find(candidate => candidate.ref === animation.ref);
    if (!binding) continue;
    const attributes = new Map<string, ts.JsxAttribute>();
    for (const attribute of binding.node.attributes.properties) if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name)) attributes.set(attribute.name.text, attribute);
    const [, , width, height] = [...coordinates(attributes), ...dimensions(attributes)];
    let x: number | null = null; let y: number | null = null;
    if (animation.property === 'x') x = coordinate(animation.target);
    if (animation.property === 'y') y = coordinate(animation.target);
    if (animation.property === 'position' && ts.isArrayLiteralExpression(animation.target) && animation.target.elements.length === 2) { x = coordinate(animation.target.elements[0] as ts.Expression); y = coordinate(animation.target.elements[1] as ts.Expression); }
    assertBox(x, y, width, height, `Animation target for ${binding.key}`, exitRefs.has(animation.ref));
  }
  if (!responsiveBackground || /(?:width|height)=\{\s*(?:1080|1920)\s*\}/.test(source)) {
    throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_LAYOUT', 'Scene hard-codes canvas dimensions instead of using the runtime canvas.');
  }
}

function attachedSceneTreeNodes(source: string) {
  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sceneExports = sourceFile.statements.filter(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  const sceneFactory = sceneExports[0]?.expression;
  const sceneFactoryArgument =
    sceneFactory && ts.isCallExpression(sceneFactory)
      ? sceneFactory.arguments[0]
      : undefined;
  if (
    sceneExports.length !== 1 ||
    !sceneFactory ||
    !ts.isCallExpression(sceneFactory) ||
    !ts.isIdentifier(sceneFactory.expression) ||
    sceneFactory.expression.text !== 'makeScene2D' ||
    sceneFactory.arguments.length !== 1 ||
    !sceneFactoryArgument ||
    !ts.isFunctionExpression(sceneFactoryArgument)
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Scene must export exactly one default makeScene2D(function* (view) {...}) generator.',
    );
  }

  const generator = sceneFactoryArgument;
  const viewParameter = generator.parameters[0]?.name;
  if (
    !generator.asteriskToken ||
    generator.parameters.length !== 1 ||
    !viewParameter ||
    !ts.isIdentifier(viewParameter)
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'The default Motion Canvas scene must be a function* with exactly one view parameter.',
    );
  }

  const viewName = viewParameter.text;
  const viewAddCalls: ts.CallExpression[] = [];
  function collectViewAddCalls(node: ts.Node) {
    if (node !== generator && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === viewName &&
      node.expression.name.text === 'add'
    ) {
      viewAddCalls.push(node);
    }
    ts.forEachChild(node, collectViewAddCalls);
  }
  collectViewAddCalls(generator.body);

  const viewAdd = viewAddCalls[0];
  if (
    viewAddCalls.length !== 1 ||
    !viewAdd ||
    !ts.isExpressionStatement(viewAdd.parent) ||
    viewAdd.parent.expression !== viewAdd ||
    viewAdd.parent.parent !== generator.body
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'The scene generator must contain exactly one direct view.add(<SceneTree />) statement.',
    );
  }
  const sceneTree = viewAdd?.arguments[0];
  if (
    viewAdd.arguments.length !== 1 ||
    !sceneTree ||
    !ts.isJsxElement(sceneTree)
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'view.add must receive exactly one statically visible JSX scene tree.',
    );
  }

  const attachedNodes = new Set<
    ts.JsxOpeningElement | ts.JsxSelfClosingElement
  >();
  function collectAttachedNodes(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      attachedNodes.add(node);
    }
    ts.forEachChild(node, collectAttachedNodes);
  }
  collectAttachedNodes(sceneTree);
  return {sourceFile, attachedNodes};
}

export function validateMotionCanvasBackground(
  source: string,
  requiredColor: string,
) {
  const {sourceFile, attachedNodes} = attachedSceneTreeNodes(source);
  const backgroundColors: string[] = [];

  function staticAttribute(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ) {
    const attribute = node.attributes.properties.find(
      candidate =>
        ts.isJsxAttribute(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === name,
    );
    if (!attribute || !ts.isJsxAttribute(attribute)) return null;
    const initializer = attribute.initializer;
    if (initializer && ts.isStringLiteral(initializer)) {
      return initializer.text;
    }
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      (ts.isStringLiteral(initializer.expression) ||
        ts.isNoSubstitutionTemplateLiteral(initializer.expression))
    ) {
      return initializer.expression.text;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      attachedNodes.has(node)
    ) {
      if (staticAttribute(node, 'key') === 'scene-background') {
        const color = staticAttribute(node, 'fill');
        if (color) backgroundColors.push(color);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const backgroundColor = backgroundColors.at(-1);
  if (
    backgroundColors.length !== 1 ||
    backgroundColor?.toLocaleLowerCase('en-US') !==
    requiredColor.toLocaleLowerCase('en-US')
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      `Scene phải có node scene-background dùng đúng màu ${requiredColor}.`,
    );
  }
}

export function validateMotionCanvasContainerContract(source: string) {
  const {sourceFile, attachedNodes} = attachedSceneTreeNodes(source);
  const nodes: Array<{key: string; parentKey: string | null}> = [];

  function staticKey(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ) {
    const attribute = node.attributes.properties.find(
      candidate =>
        ts.isJsxAttribute(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === 'key',
    );
    if (!attribute || !ts.isJsxAttribute(attribute)) return null;
    const initializer = attribute.initializer;
    if (initializer && ts.isStringLiteral(initializer)) {
      return initializer.text;
    }
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      (ts.isStringLiteral(initializer.expression) ||
        ts.isNoSubstitutionTemplateLiteral(initializer.expression))
    ) {
      return initializer.expression.text;
    }
    return null;
  }

  function parentKey(node: ts.Node) {
    let parent: ts.Node | undefined = node.parent;
    while (parent) {
      if (
        ts.isJsxElement(parent) &&
        parent.openingElement !== node
      ) {
        const key = staticKey(parent.openingElement);
        if (key) return key;
      }
      parent = parent.parent;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      attachedNodes.has(node)
    ) {
      const key = staticKey(node);
      if (key) nodes.push({key, parentKey: parentKey(node)});
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const contentRoots = nodes.filter(
    node => node.key === 'scene-content-root',
  );
  const backgrounds = nodes.filter(
    node => node.key === 'scene-background',
  );
  const blockKeys = new Set(
    nodes
      .filter(node => node.key.startsWith('block-'))
      .map(node => node.key),
  );
  const parentByKey = new Map(
    nodes.map(node => [node.key, node.parentKey]),
  );
  function descendsFrom(key: string, ancestorKey: string) {
    const visited = new Set<string>();
    let current = parentByKey.get(key) ?? null;
    while (current && !visited.has(current)) {
      if (current === ancestorKey) return true;
      visited.add(current);
      current = parentByKey.get(current) ?? null;
    }
    return false;
  }
  function descendsFromAnyBlock(key: string) {
    const visited = new Set<string>();
    let current = parentByKey.get(key) ?? null;
    while (current && !visited.has(current)) {
      if (blockKeys.has(current)) return true;
      visited.add(current);
      current = parentByKey.get(current) ?? null;
    }
    return false;
  }
  const unframedContent = nodes.filter(
    node =>
      node.key !== 'scene-background' &&
      node.key !== 'scene-content-root' &&
      (
        !descendsFrom(node.key, 'scene-content-root') ||
        (
          !node.key.startsWith('block-') &&
          !descendsFromAnyBlock(node.key)
        )
      ),
  );

  if (
    backgrounds.length !== 1 ||
    contentRoots.length !== 1 ||
    contentRoots[0]!.parentKey !== 'scene-background' ||
    blockKeys.size === 0 ||
    [...blockKeys].some(
      key => !descendsFrom(key, 'scene-content-root'),
    ) ||
    unframedContent.length > 0
  ) {
    throw new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Scene phải có scene-content-root trong scene-background và các container block-* dùng tọa độ local.',
    );
  }
}

function mapStructuredError(error: CodexStructuredGenerationError) {
  if (error.reason === 'timeout') {
    return new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_TIMEOUT',
      'Codex mất quá nhiều thời gian để sinh scene Motion Canvas.',
      {cause: error},
    );
  }
  if (error.reason === 'tool_used') {
    return new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_TOOL_USED',
      'Codex đã cố dùng công cụ trong khi sinh scene Motion Canvas.',
      {cause: error},
    );
  }
  if (error.reason === 'empty_response') {
    return new MotionCanvasGenerationError(
      'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
      'Codex không trả về mã scene Motion Canvas.',
      {cause: error},
    );
  }

  return new MotionCanvasGenerationError(
    'CODEX_MOTION_CANVAS_GENERATION_FAILED',
    error.message || 'Codex không hoàn tất việc sinh scene Motion Canvas.',
    {cause: error},
  );
}

interface GeneratedSceneResult {
  scene: MotionCanvasSourceScene;
  model: string;
  usage: CodexTokenUsage | null;
  fallbackReason?: string | null;
}

/** Deterministic geometry for one declared composition archetype. Ratios are
 * canvas-relative so the fallback stays responsive and inside the safe area. */
function fallbackCompositionGeometry(
  layout: NonNullable<VoiceVisualPlan['sections'][number]['beats'][number]['compositionContract']>['layout'] | undefined,
  density: NonNullable<VoiceVisualPlan['sections'][number]['beats'][number]['compositionContract']>['density'] | undefined,
) {
  const heightScale = density === 'sparse' ? 0.88 : density === 'dense' ? 1.16 : 1;
  const base = {widthRatio: 1, restXRatio: 0, restYRatio: 0, heightRatio: 0.271};
  switch (layout) {
    case 'left-right-split':
      return {...base, widthRatio: 0.62, restXRatio: -0.16, heightRatio: 0.3 * heightScale};
    case 'top-bottom-stack':
      return {...base, restYRatio: -0.12, heightRatio: 0.22 * heightScale};
    case 'grid':
      return {...base, widthRatio: 0.7, heightRatio: 0.24 * heightScale};
    case 'full-bleed':
      return {...base, heightRatio: 0.4 * heightScale};
    default:
      return {...base, heightRatio: 0.271 * heightScale};
  }
}

/** Picks the candidate colour with the best worst-case contrast against every
 * surface it will sit on, so palette adherence never costs readability. */
function bestContrastColor(candidates: string[], surfaces: string[], fallback: string) {
  let best: {color: string; ratio: number} | null = null;
  for (const candidate of candidates) {
    const ratios = surfaces.map(surface => wcagContrastRatio(candidate, surface));
    if (ratios.some(ratio => ratio === null)) continue;
    const worst = Math.min(...(ratios as number[]));
    if (!best || worst > best.ratio) best = {color: candidate, ratio: worst};
  }
  return best?.color ?? fallback;
}

function fallbackSceneSource(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
  const outlineSection = request.outline.sections[sectionIndex]!;
  const beats = request.voiceVisualPlan.sections[sectionIndex]!.beats;
  const background = request.topicInput.background;
  const backgroundTone = videoBackgroundTone(background);
  const bible = request.voiceVisualPlan.visualBible;
  // Deterministic fallback still obeys the visual bible so the rendered-frame
  // gate sees the same palette and type ratios it sees for AI scenes.
  const foreground = bible?.palette.text ?? (backgroundTone === 'light' ? '#18342C' : '#F3F7F4');
  const trackColor = bible?.palette.surface ?? (backgroundTone === 'light' ? '#D7E1DB' : '#365149');
  const cardColors = bible ? [bible.palette.primary, bible.palette.accent] : ['#51B68E', '#ED8F67'];
  const labelColor = bible
    ? bestContrastColor([bible.palette.background, bible.palette.text, bible.palette.surface], cardColors, '#10231D')
    : '#10231D';
  const headingFontRatio = 0.061;
  const labelFontRatio = bible ? headingFontRatio * (bible.typographyScale.label / bible.typographyScale.title) : 0.044;
  // Planner keys are content-dependent. Materialize every lifecycle identity
  // instead of relying on one hard-coded concept card that only fits tests.
  const lifecycleKeys = [...new Set(beats.flatMap(beat => [
    ...(beat.visualLifecycle?.enter ?? []),
    ...(beat.visualLifecycle?.stay ?? []),
    ...(beat.visualLifecycle?.exit ?? []),
  ]))];
  const occupiedKeys = new Set(lifecycleKeys);
  function infrastructureKey(base: string) {
    let candidate = base;
    let suffix = 1;
    while (occupiedKeys.has(candidate)) {
      candidate = `${base}-alt${suffix}`;
      suffix += 1;
    }
    occupiedKeys.add(candidate);
    return candidate;
  }
  const headingBlockKey = infrastructureKey('block-fallback-scene-heading');
  const headingLabelKey = infrastructureKey('fallback-scene-heading-label');
  const supportLayerKey = infrastructureKey('block-fallback-support-layer');
  const progressBlockKey = infrastructureKey('block-fallback-progress-track');
  const progressTrackKey = infrastructureKey('fallback-progress-track');
  const progressFillKey = infrastructureKey('fallback-progress-fill');
  const lifecycleNodes = lifecycleKeys.map((key, nodeIndex) => {
    const primaryBeatIndex = beats.findIndex(beat => beat.primaryBlock === key);
    const firstBeatIndex = beats.findIndex(beat => {
      const lifecycle = beat.visualLifecycle;
      return lifecycle
        ? [...lifecycle.enter, ...lifecycle.stay, ...lifecycle.exit].includes(key)
        : false;
    });
    const beatIndex = primaryBeatIndex >= 0
      ? primaryBeatIndex
      : Math.max(0, firstBeatIndex);
    const beat = beats[beatIndex]!;
    const geometry = fallbackCompositionGeometry(
      beat.compositionContract?.layout,
      beat.compositionContract?.density,
    );
    const isPrimary = primaryBeatIndex >= 0;
    const restXRatio = isPrimary
      ? geometry.restXRatio
      : Math.max(-0.3, Math.min(0.3, geometry.restXRatio + 0.23));
    const restYRatio = isPrimary
      ? geometry.restYRatio
      : Math.max(-0.3, Math.min(0.3, geometry.restYRatio - 0.15));
    return {
      key,
      refName: `lifecycleNode${nodeIndex + 1}`,
      isPrimary,
      restXRatio,
      restYRatio,
      widthRatio: geometry.widthRatio,
      heightRatio: geometry.heightRatio,
      color: cardColors[beatIndex % cardColors.length]!,
      label: beat.visualDescription.replace(/\s+/g, ' ').trim().slice(0, 84),
      labelKey: isPrimary
        ? infrastructureKey(`fallback-beat-u${String(beatIndex + 1).padStart(2, '0')}-label`)
        : null,
    };
  });
  const lifecycleNodeByKey = new Map(
    lifecycleNodes.map(node => [node.key, node]),
  );
  const primaryNodes = lifecycleNodes
    .filter(node => node.isPrimary)
    .map(node => `        <Rect
          key="${node.key}"
          ref={${node.refName}}
          width={(canvasWidth - safeMarginX * 2) * ${node.widthRatio}}
          height={canvasHeight * ${node.heightRatio}}
          radius={canvasWidth * 0.048}
          fill={'${node.color}'}
          padding={canvasWidth * 0.059}
          opacity={0}
          x={(canvasWidth - safeMarginX * 2) * ${node.restXRatio}}
          y={canvasHeight}
        >
          <Txt
            key="${node.labelKey}"
            text={${JSON.stringify(node.label)}}
            width={(canvasWidth - safeMarginX * 2) * ${node.widthRatio} - canvasWidth * 0.118}
            fill={'${labelColor}'}
            fontSize={canvasWidth * ${labelFontRatio}}
            fontWeight={650}
            textAlign={'center'}
          />
        </Rect>`);
  const supportNodes = lifecycleNodes
    .filter(node => !node.isPrimary)
    .map(node => `          <Rect
            key="${node.key}"
            ref={${node.refName}}
            width={canvasWidth * 0.13}
            height={canvasWidth * 0.13}
            radius={canvasWidth * 0.026}
            fill={'${node.color}'}
            rotation={45}
            opacity={0}
            x={(canvasWidth - safeMarginX * 2) * ${node.restXRatio}}
            y={canvasHeight}
          />`);
  const beatBlocks = beats.map((beat, beatIndex) => {
    const number = beatIndex + 1;
    const progress = (beatIndex + 1) / beats.length;
    const lifecycle = beat.visualLifecycle!;
    const enterAnimations = lifecycle.enter.flatMap(key => {
      const node = lifecycleNodeByKey.get(key)!;
      return [
        `    ${node.refName}().opacity(1, enterDuration${number})`,
        `    ${node.refName}().y(canvasHeight * ${node.restYRatio}, enterDuration${number})`,
      ];
    });
    const exitAnimations = lifecycle.exit.flatMap(key => {
      const node = lifecycleNodeByKey.get(key)!;
      return [
        `    ${node.refName}().opacity(0, exitDuration${number})`,
        `    ${node.refName}().y(canvasHeight, exitDuration${number})`,
      ];
    });
    return `  // lifecycle:beat:${beat.id}:enter=${lifecycle.enter.join(',')}|stay=${lifecycle.stay.join(',')}|exit=${lifecycle.exit.join(',')}|primary=${beat.primaryBlock}
  yield* waitUntil('beat:${beat.id}:start');
  const beatDuration${number} = useDuration('beat:${beat.id}:end');
  const beatEndTime${number} = useThread().time() + beatDuration${number};
  const enterDuration${number} = Math.min(0.45, Math.max(0.05, beatDuration${number} * 0.12));
  const exitDuration${number} = Math.min(0.4, Math.max(0.05, beatDuration${number} * 0.1));
  yield* all(
${enterAnimations.join(',\n')},
    progressFill().width((canvasWidth - safeMarginX * 4) * ${progress}, enterDuration${number}),
  );
  yield* waitFor(Math.max(0, beatDuration${number} - enterDuration${number} - exitDuration${number}));
  yield* all(
${exitAnimations.join(',\n')},
  );
  yield* waitFor(Math.max(0, beatEndTime${number} - useThread().time()));`;
  });
  return `// ${MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER}
import {Layout, makeScene2D, Rect, Txt} from '@motion-canvas/2d';
import {all, createRef, useDuration, useThread, waitFor, waitUntil} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const canvasWidth = view.width();
  const canvasHeight = view.height();
  const safeMarginX = canvasWidth * ${MOTION_CANVAS_SAFE_MARGIN_X_RATIO};
  const safeMarginY = canvasHeight * ${MOTION_CANVAS_SAFE_MARGIN_Y_RATIO};
${lifecycleNodes.map(node => `  const ${node.refName} = createRef<Rect>();`).join('\n')}
  const progressFill = createRef<Rect>();

  view.add(
    <Rect key="scene-background" width={canvasWidth} height={canvasHeight} fill={${JSON.stringify(background.color)}}>
      <Layout key="scene-content-root">
        <Layout key="${headingBlockKey}" y={-canvasHeight * 0.3385}>
          <Txt
            key="${headingLabelKey}"
            text={${JSON.stringify(outlineSection.title.slice(0, 80))}}
            width={canvasWidth - safeMarginX * 2}
            fill={${JSON.stringify(foreground)}}
            fontSize={canvasWidth * ${headingFontRatio}}
            fontWeight={700}
            textAlign={'center'}
          />
        </Layout>
${primaryNodes.join('\n')}
        <Layout key="${supportLayerKey}">
${supportNodes.join('\n')}
        </Layout>
        <Layout key="${progressBlockKey}" y={canvasHeight * 0.3385}>
          <Rect key="${progressTrackKey}" width={canvasWidth - safeMarginX * 4} height={canvasHeight * 0.0094} radius={canvasHeight * 0.0047} fill={${JSON.stringify(trackColor)}}>
            <Rect
              key="${progressFillKey}"
              ref={progressFill}
              width={0}
              height={canvasHeight * 0.0094}
              radius={canvasHeight * 0.0047}
              fill={${JSON.stringify(foreground)}}
              offsetX={-1}
              x={-(canvasWidth - safeMarginX * 4) / 2}
            />
          </Rect>
        </Layout>
      </Layout>
    </Rect>,
  );

${beatBlocks.join('\n\n')}
});
`;
}

function aggregateUsage(results: GeneratedSceneResult[]) {
  if (results.some((result) => result.usage === null)) return null;

  return results.reduce<CodexTokenUsage>(
    (total, result) => ({
      inputTokens: total.inputTokens + result.usage!.inputTokens,
      cachedInputTokens:
        total.cachedInputTokens + result.usage!.cachedInputTokens,
      outputTokens: total.outputTokens + result.usage!.outputTokens,
      reasoningOutputTokens:
        total.reasoningOutputTokens +
        result.usage!.reasoningOutputTokens,
      totalTokens: total.totalTokens + result.usage!.totalTokens,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
}

function addUsage(
  baseUsage: CodexTokenUsage | null,
  results: GeneratedSceneResult[],
) {
  const repairUsage = aggregateUsage(results);
  if (!baseUsage || !repairUsage) return null;
  return {
    inputTokens: baseUsage.inputTokens + repairUsage.inputTokens,
    cachedInputTokens:
      baseUsage.cachedInputTokens + repairUsage.cachedInputTokens,
    outputTokens: baseUsage.outputTokens + repairUsage.outputTokens,
    reasoningOutputTokens:
      baseUsage.reasoningOutputTokens +
      repairUsage.reasoningOutputTokens,
    totalTokens: baseUsage.totalTokens + repairUsage.totalTokens,
  };
}

function sceneGenerationError(
  error: unknown,
  sectionIndex: number,
  sectionTitle: string,
) {
  const mappedError =
    error instanceof CodexStructuredGenerationError
      ? mapStructuredError(error)
      : error instanceof MotionCanvasGenerationError
        ? error
        : new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_GENERATION_FAILED',
            'Không thể sinh scene bằng Codex.',
            {cause: error},
          );

  if (mappedError.message.startsWith(`Scene ${sectionIndex + 1} “`)) {
    return mappedError;
  }

  return new MotionCanvasGenerationError(
    mappedError.code,
    `Scene ${sectionIndex + 1} “${sectionTitle}”: ${mappedError.message}`,
    {cause: mappedError},
  );
}

function repairDiagnostics(error: unknown) {
  if (!(error instanceof Error)) return 'Scene không vượt qua validation.';
  const lines = [error.message];
  if (error instanceof MotionCanvasGenerationError && Array.isArray(error.cause)) {
    for (const value of error.cause.slice(0, 20)) {
      const diagnostic = value as ts.Diagnostic;
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n',
      );
      if (diagnostic.file && diagnostic.start !== undefined) {
        const location = diagnostic.file.getLineAndCharacterOfPosition(
          diagnostic.start,
        );
        lines.push(
          `generated-scene.tsx(${location.line + 1},${location.character + 1}): ${message}`,
        );
      } else {
        lines.push(message);
      }
    }
  }
  if (error instanceof MotionCanvasGenerationError && error.cause instanceof z.ZodError) {
    for (const issue of error.cause.issues.slice(0, 20)) {
      lines.push(`spec.${issue.path.join('.')}: ${issue.message}`);
    }
  }
  return [...new Set(lines)].join('\n').slice(0, 12_000);
}

export function createCodexMotionCanvasGenerator(
  client: CodexAppServerClient,
  options: {
    runtimeDirectory?: string;
    timeoutMs?: number;
    concurrency?: number;
    qualityRetryLimit?: number;
    model?: string;
    reasoningEffort?: string;
  } = {},
): MotionCanvasGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  const configuredTimeoutMs = options.timeoutMs;
  const concurrency = Math.max(
    1,
    Math.min(
      MAXIMUM_MOTION_CANVAS_GENERATION_CONCURRENCY,
      Math.floor(
        options.concurrency ?? DEFAULT_MOTION_CANVAS_GENERATION_CONCURRENCY,
      ),
    ),
  );
  // Structural richness is telemetry, not proof that a semantic blueprint
  // failed. Rendered-frame and semantic validation own repair decisions, so
  // this speculative pre-render Codex retry is opt-in and bounded per batch —
  // never an approval signal and never an unbounded AI expense.
  const qualityRetryLimit = Math.max(
    0,
    Math.min(
      2,
      Math.floor(
        Number.isFinite(options.qualityRetryLimit)
          ? options.qualityRetryLimit!
          : 0,
      ),
    ),
  );
  const sceneGenerations = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<GeneratedSceneResult>;
    }
  >();
  const selectedPolicyPromises = new Map<string, Promise<{
    model?: string;
    reasoningEffort?: string;
  }>>();

  function resolveScenePolicy(
    requestedModel?: string,
    requestedReasoningEffort?: string,
  ) {
    const configuredModel = requestedModel ?? options.model;
    const configuredReasoningEffort =
      requestedReasoningEffort ?? options.reasoningEffort;
    const cacheKey = `${configuredModel ?? '__default__'}:${configuredReasoningEffort ?? '__default__'}`;
    const existing = selectedPolicyPromises.get(cacheKey);
    if (existing) return existing;

    const policyPromise = client
      .request('model/list', {limit: 100, includeHidden: false})
      .then((response) => {
        const parsed = modelListSchema.safeParse(response);
        if (!parsed.success) {
          return {
            ...(configuredModel ? {model: configuredModel} : {}),
            ...(configuredReasoningEffort
              ? {reasoningEffort: configuredReasoningEffort}
              : {}),
          };
        }

        const selected = configuredModel
          ? parsed.data.data.find(
              (model) =>
                model.model === configuredModel || model.id === configuredModel,
            )
          : parsed.data.data.find((model) => model.isDefault) ??
            parsed.data.data[0];
        if (configuredModel && !selected) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_MODEL_UNSUPPORTED',
            'Model đã chọn không còn khả dụng trong Codex catalog. Hãy chọn lại model.',
          );
        }
        const modelName =
          configuredModel ?? selected?.model ?? selected?.id;
        const supportedEfforts =
          selected?.supportedReasoningEfforts?.map(
            (effort) => effort.reasoningEffort,
          ) ?? [];
        let reasoningEffort = configuredReasoningEffort;

        if (reasoningEffort && !supportedEfforts.includes(reasoningEffort)) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_REASONING_UNSUPPORTED',
            'Mức suy luận đã chọn không còn được model này hỗ trợ. Hãy chọn lại mức suy luận.',
          );
        } else if (!reasoningEffort && supportedEfforts.length > 0) {
          reasoningEffort = supportedEfforts.includes('medium')
            ? 'medium'
            : selected?.defaultReasoningEffort &&
                supportedEfforts.includes(selected.defaultReasoningEffort)
              ? selected.defaultReasoningEffort
              : supportedEfforts.includes('high')
                ? 'high'
                : undefined;
        }

        return {
          ...(modelName ? {model: modelName} : {}),
          ...(reasoningEffort ? {reasoningEffort} : {}),
        };
      })
      .catch((error) => {
        if (error instanceof MotionCanvasGenerationError) throw error;
        return {
          ...(configuredModel ? {model: configuredModel} : {}),
          ...(configuredReasoningEffort
            ? {reasoningEffort: configuredReasoningEffort}
            : {}),
        };
      });
    selectedPolicyPromises.set(cacheKey, policyPromise);
    return policyPromise;
  }

  function discardGeneration(projectId: string, generationId: string) {
    const keyPrefix = `${projectId}:${generationId}:`;
    for (const key of sceneGenerations.keys()) {
      if (key.startsWith(keyPrefix)) sceneGenerations.delete(key);
    }
  }

  function sceneResultFromResponse(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
    responseText: string,
    model: string,
    usage: CodexTokenUsage | null,
    previousScene?: MotionCanvasSourceScene,
  ): GeneratedSceneResult {
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch (error) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        'Codex trả về scene không đúng định dạng JSON.',
        {cause: error},
      );
    }

    const parsed = generatedMotionCanvasSceneSchema.safeParse(responseJson);
    if (!parsed.success) {
      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        'Codex trả về scene chưa đúng cấu trúc hoặc source vượt quá cầu chì an toàn.',
        {cause: parsed.error},
      );
    }

    const outlineSection = request.outline.sections[sectionIndex]!;
    const voiceVisualSection = request.voiceVisualPlan.sections[sectionIndex]!;
    const slug = toSlug(parsed.data.name) || `scene-${sectionIndex + 1}`;
    const sceneSource = applyMotionCanvasDefaultFont(
      normalizeMotionCanvasColorFormats(parsed.data.source.trim()),
    );
    return {
      scene: {
        id: previousScene?.id ?? randomUUID(),
        outlineSectionId: outlineSection.id,
        name: parsed.data.name,
        filePath:
          previousScene?.filePath ??
          `src/scenes/${String(sectionIndex + 1).padStart(2, '0')}-${slug}.tsx`,
        durationSeconds: voiceVisualSection.beats.reduce(
          (total, beat) => total + beat.durationSeconds,
          0,
        ),
        timingEvents: voiceVisualSection.beats.map((beat) => ({
          beatId: beat.id,
          startEvent: `beat:${beat.id}:start`,
          endEvent: `beat:${beat.id}:end`,
          plannedDurationSeconds: beat.durationSeconds,
        })),
        source: `${sceneSource.trim()}\n`,
      },
      model,
      usage,
    };
  }

  function validateSceneSourceContracts(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
    source: string,
  ) {
    validateMotionCanvasSceneSource(source);
    if (!source.includes(MOTION_CANVAS_UNVERIFIED_SEMANTIC_FALLBACK_MARKER)) {
      validateMotionCanvasVisualIntentBindings(
        source,
        request.voiceVisualPlan.sections[sectionIndex]!.beats,
      );
    }
    validateMotionCanvasIconReferences(source);
    validateMotionCanvasBackground(
      source,
      request.topicInput.background.color,
    );
    validateMotionCanvasContainerContract(source);
    validateMotionCanvasTimingContract(
      source,
      request.voiceVisualPlan.sections[sectionIndex]!.beats,
    );
    validateMotionCanvasBeatLifecycle(
      source,
      request.voiceVisualPlan.sections[sectionIndex]!.beats,
      request.videoFrame ?? request.topicInput.videoFrame ?? defaultVideoFrame,
    );
    validateMotionCanvasResponsiveLayout(
      source,
      request.videoFrame ?? request.topicInput.videoFrame ?? defaultVideoFrame,
      request.voiceVisualPlan.sections[sectionIndex]!.beats,
    );
  }

  function validateSceneResult(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
    result: GeneratedSceneResult,
  ) {
    validateSceneSourceContracts(request, sectionIndex, result.scene.source);
    return result;
  }

  function validateAcceptedScenes(
    request: MotionCanvasGenerationRequest,
    scenes: MotionCanvasSourceScene[],
  ) {
    for (const scene of scenes) {
      const sectionIndex = request.outline.sections.findIndex(
        section => section.id === scene.outlineSectionId,
      );
      if (sectionIndex < 0) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_INVALID_REQUEST',
          'Accepted scene no longer matches the teaching outline.',
        );
      }
      validateSceneSourceContracts(request, sectionIndex, scene.source);
    }
  }

  function isRecoverableSceneOutputError(error: unknown) {
    return (
      error instanceof MotionCanvasGenerationError &&
      (error.code === 'CODEX_MOTION_CANVAS_INVALID_RESPONSE' ||
        error.code === 'CODEX_MOTION_CANVAS_INVALID_TIMING_CONTRACT' ||
        error.code === 'CODEX_MOTION_CANVAS_INVALID_LIFECYCLE' ||
        error.code === 'CODEX_MOTION_CANVAS_INVALID_LAYOUT' ||
        error.code === 'CODEX_MOTION_CANVAS_UNSAFE_SOURCE')
    );
  }

  function localFallbackResult(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
    previousScene: MotionCanvasSourceScene | undefined,
    model: string,
    usage: CodexTokenUsage | null,
  ) {
    const outlineSection = request.outline.sections[sectionIndex]!;
    const fallbackName = `${previousScene?.name ?? outlineSection.title} · safe fallback`
      .slice(0, 120);
    const slug = toSlug(fallbackName) || `scene-${sectionIndex + 1}`;
    const voiceVisualSection = request.voiceVisualPlan.sections[sectionIndex]!;
    const result: GeneratedSceneResult = {
      scene: {
        id: previousScene?.id ?? randomUUID(),
        outlineSectionId: outlineSection.id,
        name: fallbackName,
        filePath:
          previousScene?.filePath ??
          `src/scenes/${String(sectionIndex + 1).padStart(2, '0')}-${slug}.tsx`,
        durationSeconds: voiceVisualSection.beats.reduce(
          (total, beat) => total + beat.durationSeconds,
          0,
        ),
        timingEvents: voiceVisualSection.beats.map((beat) => ({
          beatId: beat.id,
          startEvent: `beat:${beat.id}:start`,
          endEvent: `beat:${beat.id}:end`,
          plannedDurationSeconds: beat.durationSeconds,
        })),
        source: applyMotionCanvasDefaultFont(fallbackSceneSource(request, sectionIndex)),
      },
      model: [...new Set([model, 'local-safe-fallback'].filter(Boolean))]
        .join(', ')
        .slice(0, 160),
      usage,
      fallbackReason: 'Codex did not return a valid scene after the bounded repair and clean-regeneration attempts.',
    };
    return validateSceneResult(request, sectionIndex, result);
  }

  async function regenerateSceneFromScratch(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
    diagnostics: string,
    previousScene?: MotionCanvasSourceScene,
  ) {
    const scenePolicy = await resolveScenePolicy(
      request.model,
      request.reasoningEffort,
    );
    const regenerated = await runCodexStructuredGeneration({
      client,
      runtimeDirectory,
      timeoutMs:
        configuredTimeoutMs ??
        codexGenerationTimeoutMs(
          scenePolicy.reasoningEffort,
          DEFAULT_SCENE_TIMEOUT_MS,
        ),
      outputSchema: outputJsonSchema,
      prompt: buildRegenerationPrompt(request, sectionIndex, diagnostics),
      baseInstructions: sceneGenerationRunInstructions.baseInstructions,
      developerInstructions: sceneGenerationRunInstructions.developerInstructions,
      model: scenePolicy.model,
      reasoningEffort: scenePolicy.reasoningEffort,
    });
    return validateSceneResult(
      request,
      sectionIndex,
      sceneResultFromResponse(
        request,
        sectionIndex,
        regenerated.responseText,
        regenerated.model,
        regenerated.usage,
        previousScene,
      ),
    );
  }

  function generateSceneOnce(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
  ) {
    const outlineSection = request.outline.sections[sectionIndex]!;
    const fingerprint = JSON.stringify({
      payload: generationPayload(request, sectionIndex),
      model: request.model,
      reasoningEffort: request.reasoningEffort,
    });
    const cacheKey =
      `${request.projectId}:${request.generationId}:${outlineSection.id}`;
    const existing = sceneGenerations.get(cacheKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_GENERATION_ID_REUSED',
          'Generation ID đã được dùng với nội dung scene khác.',
        );
      }
      return existing.promise;
    }

    const promise = (async (): Promise<GeneratedSceneResult> => {
      let initialModel = '';
      let initialUsage: CodexTokenUsage | null = null;
      let initialScene: MotionCanvasSourceScene | undefined;
      const previousScene = request.currentScenes?.[sectionIndex];
      try {
        const scenePolicy = await resolveScenePolicy(
          request.model,
          request.reasoningEffort,
        );
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            configuredTimeoutMs ??
            codexGenerationTimeoutMs(
              scenePolicy.reasoningEffort,
              DEFAULT_SCENE_TIMEOUT_MS,
            ),
          outputSchema: outputJsonSchema,
          prompt: buildPrompt(request, sectionIndex),
          baseInstructions: sceneGenerationRunInstructions.baseInstructions,
          developerInstructions: sceneGenerationRunInstructions.developerInstructions,
          model: scenePolicy.model,
          reasoningEffort: scenePolicy.reasoningEffort,
        });
        initialModel = generated.model;
        initialUsage = generated.usage;
        const initialResult = sceneResultFromResponse(
          request,
          sectionIndex,
          generated.responseText,
          generated.model,
          generated.usage,
          previousScene,
        );
        initialScene = initialResult.scene;
        try {
          return validateSceneResult(request, sectionIndex, initialResult);
        } catch (validationError) {
          if (!(validationError instanceof MotionCanvasGenerationError)) {
            throw validationError;
          }
          const repaired = await repairScene(
            request,
            initialResult.scene,
            sectionIndex,
            repairDiagnostics(validationError),
          );
          return {
            ...repaired,
            model: [...new Set([initialResult.model, repaired.model])]
              .join(', ')
              .slice(0, 160),
            usage: addUsage(initialResult.usage, [repaired]),
          };
        }
      } catch (error) {
        const generationError = sceneGenerationError(
          error,
          sectionIndex,
          outlineSection.title,
        );
        if (!isRecoverableSceneOutputError(generationError)) {
          throw generationError;
        }

        try {
          const regenerated = await regenerateSceneFromScratch(
            request,
            sectionIndex,
            repairDiagnostics(generationError),
            initialScene,
          );
          return {
            ...regenerated,
            model: [...new Set([initialModel, regenerated.model].filter(Boolean))]
              .join(', ')
              .slice(0, 160),
            usage: initialModel
              ? addUsage(initialUsage, [regenerated])
              : regenerated.usage,
          };
        } catch (regenerationError) {
          const mappedRegenerationError = sceneGenerationError(
            regenerationError,
            sectionIndex,
            outlineSection.title,
          );
          if (!isRecoverableSceneOutputError(mappedRegenerationError)) {
            throw mappedRegenerationError;
          }
          return localFallbackResult(
            request,
            sectionIndex,
            initialScene,
            initialModel,
            initialUsage,
          );
        }
      }
    })();

    sceneGenerations.set(cacheKey, {fingerprint, promise});
    void promise.catch(() => {
      if (sceneGenerations.get(cacheKey)?.promise === promise) {
        sceneGenerations.delete(cacheKey);
      }
    });

    while (sceneGenerations.size > 120) {
      const oldestKey = sceneGenerations.keys().next().value;
      if (!oldestKey) break;
      sceneGenerations.delete(oldestKey);
    }

    return promise;
  }

  async function repairScene(
    request: MotionCanvasGenerationRequest,
    generatedScene: MotionCanvasSourceScene,
    sectionIndex: number,
    compilerDiagnostics: string,
  ): Promise<GeneratedSceneResult> {
    const outlineSection = request.outline.sections[sectionIndex]!;
    try {
      const scenePolicy = await resolveScenePolicy(
        request.model,
        request.reasoningEffort,
      );
      let currentScene = generatedScene;
      let diagnostics = compilerDiagnostics;
      const repairs: GeneratedSceneResult[] = [];
      for (let attempt = 0; attempt < MAX_SOURCE_REPAIR_ATTEMPTS; attempt += 1) {
        const repaired = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs:
            configuredTimeoutMs ??
            codexGenerationTimeoutMs(
              scenePolicy.reasoningEffort,
              DEFAULT_SCENE_TIMEOUT_MS,
            ),
          outputSchema: outputJsonSchema,
          prompt: buildRepairPrompt(
            request,
            sectionIndex,
            currentScene,
            diagnostics,
          ),
          baseInstructions: sceneGenerationRunInstructions.baseInstructions,
          developerInstructions: sceneGenerationRunInstructions.developerInstructions,
          model: scenePolicy.model,
          reasoningEffort: scenePolicy.reasoningEffort,
        });

        let responseJson: unknown;
        try {
          responseJson = JSON.parse(repaired.responseText);
        } catch (error) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
            'Codex trả về scene sửa lỗi không đúng định dạng.',
            {cause: error},
          );
        }
        const parsed =
          generatedMotionCanvasSceneSchema.safeParse(responseJson);
        if (!parsed.success) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
            'Codex trả về scene sửa lỗi chưa đúng cấu trúc.',
            {cause: parsed.error},
          );
        }

        const candidate = sceneResultFromResponse(
          request,
          sectionIndex,
          repaired.responseText,
          repaired.model,
          repaired.usage,
          currentScene,
        );
        repairs.push(candidate);
        try {
          validateSceneSourceContracts(
            request,
            sectionIndex,
            candidate.scene.source,
          );
          const result: GeneratedSceneResult = {
            ...candidate,
            model: [...new Set(repairs.map((item) => item.model))]
              .join(', ')
              .slice(0, 160),
            usage: aggregateUsage(repairs),
          };
          const cacheKey =
            `${request.projectId}:${request.generationId}:${outlineSection.id}`;
          sceneGenerations.set(cacheKey, {
            fingerprint: JSON.stringify({
              payload: generationPayload(request, sectionIndex),
              model: request.model,
              reasoningEffort: request.reasoningEffort,
            }),
            promise: Promise.resolve(result),
          });
          return result;
        } catch (validationError) {
          if (
            !(validationError instanceof MotionCanvasGenerationError) ||
            attempt + 1 >= MAX_SOURCE_REPAIR_ATTEMPTS
          ) {
            throw validationError;
          }
          currentScene = candidate.scene;
          diagnostics = repairDiagnostics(validationError);
        }
      }

      throw new MotionCanvasGenerationError(
        'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
        'Codex chưa sửa được scene sau các lượt tự khắc phục.',
      );
    } catch (error) {
      throw sceneGenerationError(
        error,
        sectionIndex,
        outlineSection.title,
      );
    }
  }

  return {
    async generate(request) {
      for (const section of request.voiceVisualPlan.sections) {
        if (section.beats.length > pipelineSafetyLimits.maximumBeatsPerSection || section.beats.some(beat => !beat.primaryBlock || !beat.visualLifecycle || !beat.visualLifecycle.stay.includes(beat.primaryBlock) || beat.visualLifecycle.stay.filter(key => key.startsWith('block-')).length > MAX_CONCURRENT_PRIMARY_BLOCKS)) {
          throw new MotionCanvasGenerationError('CODEX_MOTION_CANVAS_INVALID_REQUEST', 'Kế hoạch hình ảnh chỉ được có tối đa năm beat trong mỗi scene và phải khai báo đầy đủ vòng đời cho từng beat.');
        }
      }
      const sectionIndexes = request.sectionIndexes ??
        request.outline.sections.map((_section, index) => index);
      if (
        sectionIndexes.length === 0 ||
        new Set(sectionIndexes).size !== sectionIndexes.length ||
        sectionIndexes.some(
          index =>
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= request.outline.sections.length,
        )
      ) {
        throw new MotionCanvasGenerationError(
          'CODEX_MOTION_CANVAS_INVALID_REQUEST',
          'Phạm vi scene cần sinh không hợp lệ.',
        );
      }
      const results = new Array<GeneratedSceneResult>(sectionIndexes.length);
      const failures: Array<{index: number; error: unknown}> = [];
      let nextIndex = 0;
      let completedScenes = 0;
      request.onProgress?.({
        completedScenes,
        totalScenes: sectionIndexes.length,
        sectionIndex: null,
        outcome: 'started',
      });
      const workerCount = Math.min(
        concurrency,
        sectionIndexes.length,
      );
      const workers = Array.from({length: workerCount}, async () => {
        while (true) {
          const resultIndex = nextIndex;
          nextIndex += 1;
          if (resultIndex >= sectionIndexes.length) return;
          const sectionIndex = sectionIndexes[resultIndex]!;

          try {
            results[resultIndex] = await generateSceneOnce(
              request,
              sectionIndex,
            );
            completedScenes += 1;
            request.onProgress?.({
              completedScenes,
              totalScenes: sectionIndexes.length,
              sectionIndex,
              outcome: 'completed',
            });
          } catch (error) {
            failures.push({index: resultIndex, error});
            completedScenes += 1;
            request.onProgress?.({
              completedScenes,
              totalScenes: sectionIndexes.length,
              sectionIndex,
              outcome: 'failed',
            });
          }
        }
      });
      await Promise.all(workers);

      if (failures.length > 0) {
        failures.sort((left, right) => left.index - right.index);
        throw failures[0]!.error;
      }

      // Structural richness is retained as telemetry for diagnostics only.
      // It is deliberately not a pass/fail signal: rendered-frame validation
      // owns acceptance and retries after compilation.
      const assessments = results.map((result, index) =>
        assessMotionCanvasSceneQuality(
          result.scene.source,
          request.voiceVisualPlan.sections[sectionIndexes[index]!]!.beats
            .length,
        ),
      );
      const qualityRetryIndexes = new Set<number>();
      const qualityRetryDiagnostics: NonNullable<MotionCanvasBundle['generationDiagnostics']> = [];
      for (let index = 0; index < assessments.length; index++) {
        const assessment = assessments[index]!;
        const sectionIndex = sectionIndexes[index]!;
        const result = results[index]!;
        const beatCount =
          request.voiceVisualPlan.sections[sectionIndex]!.beats.length;
        const previousRichness = assessments
          .slice(0, index)
          .map((item) => item.richnessPerBeat)
          .sort((left, right) => left - right);
        const baseline =
          previousRichness.length > 0
            ? previousRichness[
                Math.floor((previousRichness.length - 1) / 2)
              ]!
            : null;
        // Richness comparisons are meaningful only for compiler-owned scene
        // specs, which no longer exist: every scene is hand-authored TSX with
        // its own, subject-dependent primitive count, so comparing richness
        // across scenes would spend an unnecessary Codex turn on a false
        // signal. Structural-richness-based auto-retry is intentionally
        // disabled here; the rendered-frame and semantic gates own repair
        // decisions instead (see qualityRetryLimit's own doc comment above).
        const compilerOwned = false;
        const severeAbsoluteDrop = compilerOwned && beatCount >= 3 && assessment.score < 45;
        const relativeDrop = compilerOwned && baseline !== null && baseline >= 12 && assessment.richnessPerBeat < baseline * 0.72;
        if (result.fallbackReason) {
          qualityRetryIndexes.add(index);
          qualityRetryDiagnostics.push({
            stage: 'fallback',
            attempt: 1,
            reason: `Scene "${result.scene.name.slice(0, 80)}" used the illustrated compiler fallback. ${result.fallbackReason}`.slice(0, 4_000),
            outcome: 'used_fallback',
          });
        }
        if (severeAbsoluteDrop || relativeDrop) qualityRetryIndexes.add(index);
      }

      for (const resultIndex of [...qualityRetryIndexes].slice(
        0,
        qualityRetryLimit,
      )) {
        const sectionIndex = sectionIndexes[resultIndex]!;
        const initialResult = results[resultIndex]!;
        const initialAssessment = assessments[resultIndex]!;
        const sceneName = initialResult.scene.name.slice(0, 80);
        const diagnostics = [
          'QUALITY_GATE: Scene hợp lệ nhưng độ hoàn thiện thị giác thấp hơn chuẩn của batch.',
          `Điểm cấu trúc ${initialAssessment.score}/100; richness/beat ${initialAssessment.richnessPerBeat.toFixed(1)}.`,
          ...initialAssessment.issues.map((issue) => `- ${issue}`),
          'Sinh lại từ đầu với visual anchor rõ, đủ node có mục đích và mỗi beat có một tiến triển hình học/chuyển động riêng. Không kéo dài caption để bù chất lượng.',
        ].join('\n');
        try {
          const regenerated = await regenerateSceneFromScratch(
            request,
            sectionIndex,
            diagnostics,
            initialResult.scene,
          );
          const regeneratedAssessment = assessMotionCanvasSceneQuality(
            regenerated.scene.source,
            request.voiceVisualPlan.sections[sectionIndex]!.beats.length,
          );
          const improved =
            regeneratedAssessment.richnessPerBeat >
              initialAssessment.richnessPerBeat * 1.08 ||
            regeneratedAssessment.score > initialAssessment.score + 5;
          results[resultIndex] = {
            ...(improved ? regenerated : initialResult),
            model: [
              ...new Set([initialResult.model, regenerated.model]),
            ]
              .join(', ')
              .slice(0, 160),
            usage: addUsage(initialResult.usage, [regenerated]),
          };
          assessments[resultIndex] = improved
            ? regeneratedAssessment
            : initialAssessment;
          const outlineSection = request.outline.sections[sectionIndex]!;
          const cacheKey =
            `${request.projectId}:${request.generationId}:${outlineSection.id}`;
          const cached = sceneGenerations.get(cacheKey);
          if (cached) {
            sceneGenerations.set(cacheKey, {
              fingerprint: cached.fingerprint,
              promise: Promise.resolve(results[resultIndex]!),
            });
          }
          qualityRetryDiagnostics.push({
            stage: 'quality-retry',
            attempt: 1,
            reason: `Scene "${sceneName}": điểm ${initialAssessment.score}→${regeneratedAssessment.score}, richness/beat ${initialAssessment.richnessPerBeat.toFixed(1)}→${regeneratedAssessment.richnessPerBeat.toFixed(1)}.`.slice(0, 4_000),
            outcome: improved ? 'passed' : 'skipped',
          });
        } catch (error) {
          // The original scene already passed the strict source/timing gates.
          // A best-effort visual retry must never turn a valid batch into a
          // failed generation.
          qualityRetryDiagnostics.push({
            stage: 'quality-retry',
            attempt: 1,
            reason: `Scene "${sceneName}": regenerate thất bại, giữ bản gốc. ${error instanceof Error ? error.message : 'Unknown error.'}`.slice(0, 4_000),
            outcome: 'failed',
          });
        }
      }

      const models = [
        ...new Set(results.map((result) => result.model)),
      ];
      return {
        scenes: results.map((result) => result.scene),
        model: models.join(', ').slice(0, 160),
        usage: aggregateUsage(results),
        ...(qualityRetryDiagnostics.length ? {qualityRetryDiagnostics} : {}),
      };
    },
    async repair(request, generated, compilerDiagnostics) {
      const normalizedDiagnostics = compilerDiagnostics.replaceAll(
        '\\',
        '/',
      );
      const diagnosticsForScene = (filePath: string) => {
        const lines = normalizedDiagnostics.split(/\r?\n/);
        const selected: string[] = [];
        let includeContinuation = false;
        for (const line of lines) {
          const sceneError = /^src\/scenes\/[^()]+\.tsx\(/.test(line);
          if (sceneError) {
            includeContinuation = line.startsWith(`${filePath}(`);
          }
          if (includeContinuation) selected.push(line);
        }
        return selected.join('\n') || normalizedDiagnostics;
      };
      let indexes = generated.scenes
        .map((scene, index) =>
          normalizedDiagnostics.includes(scene.filePath)
            ? index
            : -1,
        )
        .filter((index) => index >= 0);
      if (indexes.length === 0) {
        indexes = generated.scenes.map((_scene, index) => index);
      }

      const repairs = new Array<GeneratedSceneResult>(indexes.length);
      let nextRepair = 0;
      const repairWorkers = Array.from(
        {length: Math.min(concurrency, indexes.length)},
        async () => {
          while (true) {
            const repairIndex = nextRepair;
            nextRepair += 1;
            if (repairIndex >= indexes.length) return;
            const generatedIndex = indexes[repairIndex]!;
            const generatedScene = generated.scenes[generatedIndex]!;
            const sectionIndex = request.outline.sections.findIndex(
              section => section.id === generatedScene.outlineSectionId,
            );
            if (sectionIndex < 0) {
              throw new MotionCanvasGenerationError(
                'CODEX_MOTION_CANVAS_INVALID_REQUEST',
                'Scene cần sửa không còn khớp với mạch giảng.',
              );
            }
            repairs[repairIndex] = await repairScene(
              request,
              generatedScene,
              sectionIndex,
              diagnosticsForScene(
                generatedScene.filePath,
              ),
            );
          }
        },
      );
      await Promise.all(repairWorkers);
      const repairedScenes = [...generated.scenes];
      for (const repair of repairs) {
        const sectionIndex = repairedScenes.findIndex(
          (scene) =>
            scene.outlineSectionId ===
            repair.scene.outlineSectionId,
        );
        if (sectionIndex >= 0) {
          repairedScenes[sectionIndex] = repair.scene;
        }
      }
      validateAcceptedScenes(request, repairedScenes);
      const models = [
        ...new Set([
          generated.model,
          ...repairs.map((repair) => repair.model),
        ]),
      ];
      return {
        scenes: repairedScenes,
        model: models.join(', ').slice(0, 160),
        usage: addUsage(generated.usage, repairs),
      };
    },
    recover(request, generated, compilerDiagnostics) {
      const normalizedDiagnostics = compilerDiagnostics.replaceAll('\\', '/');
      const fallbackScenes = generated.scenes.map((scene) => {
        const sectionIndex = request.outline.sections.findIndex(
          section => section.id === scene.outlineSectionId,
        );
        if (sectionIndex < 0) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_REQUEST',
            'Scene fallback không còn khớp với mạch giảng.',
          );
        }
        if (
          normalizedDiagnostics &&
          normalizedDiagnostics.includes('src/scenes/') &&
          !normalizedDiagnostics.includes(scene.filePath)
        ) return scene;
        const fallback = {
          ...scene,
          name: `${scene.name} · safe fallback`.slice(0, 120),
          source: applyMotionCanvasDefaultFont(fallbackSceneSource(request, sectionIndex)),
        };
        validateSceneSourceContracts(request, sectionIndex, fallback.source);
        return fallback;
      });
      validateAcceptedScenes(request, fallbackScenes);
      return {
        scenes: fallbackScenes,
        model: `${generated.model}, local-safe-fallback`.slice(0, 160),
        usage: generated.usage,
      };
    },
    discardGeneration,
  };
}
