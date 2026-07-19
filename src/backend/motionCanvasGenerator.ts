import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {z} from 'zod';
import type {
  CodexTokenUsage,
  MotionCanvasScene,
  TeachingOutline,
  TopicInput,
  VoiceVisualPlan,
} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  DEFAULT_CODEX_GENERATION_TIMEOUT_MS,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const MOTION_CANVAS_PROMPT_VERSION = 'motion-canvas-v4';
export const MOTION_CANVAS_VERSION = '3.17.2';
export const MOTION_CANVAS_WIDTH = 1080;
export const MOTION_CANVAS_HEIGHT = 1920;
export const MOTION_CANVAS_FPS = 30;
const DEFAULT_SCENE_TIMEOUT_MS = 5 * 60 * 1000;

const generatedMotionCanvasSceneSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    source: z.string().trim().min(120).max(16_000),
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
  generationId: string;
  topicInput: TopicInput;
  outline: TeachingOutline;
  voiceVisualPlan: VoiceVisualPlan;
  guidance?: string;
  currentScenes?: Array<Pick<MotionCanvasSourceScene, 'name' | 'source'>>;
}

export interface MotionCanvasGenerationResult {
  scenes: MotionCanvasSourceScene[];
  model: string;
  usage: CodexTokenUsage | null;
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
  discardGeneration?(generationId: string): void;
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

function generationPayload(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
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
        visualDescription: beat.visualDescription,
        animationDescription: beat.animationDescription,
        durationSeconds: beat.durationSeconds,
      })),
    },
    canvas: {
      width: MOTION_CANVAS_WIDTH,
      height: MOTION_CANVAS_HEIGHT,
      fps: MOTION_CANVAS_FPS,
    },
    ...(request.guidance ? {guidance: request.guidance} : {}),
    ...(request.guidance && request.currentScenes?.[sectionIndex]
      ? {currentScene: request.currentScenes[sectionIndex]}
      : {}),
  };
}

function buildPrompt(
  request: MotionCanvasGenerationRequest,
  sectionIndex: number,
) {
  return [
    'Sinh đúng một scene Motion Canvas TypeScript/TSX cho section trong JSON sau.',
    'Trả object gồm name và source. Source phải export default makeScene2D(function* (view) {...}).',
    'Chỉ import từ @motion-canvas/2d hoặc @motion-canvas/core; không dùng package, asset, mạng, filesystem hay API trình duyệt khác.',
    'Import makeScene2D, Rect, Circle, Line, Txt, Layout và các visual node chỉ từ @motion-canvas/2d.',
    'Import all, chain, sequence, createRef, createSignal, tween, waitFor, waitUntil, useDuration và easing chỉ từ @motion-canvas/core.',
    'Dùng đúng tên export createRef, createSignal và easeInOutCubic; không import ref, signal hoặc easing.',
    'Không dùng JSX.Element hoặc namespace JSX trong type annotation.',
    'Mọi visual JSX node phải có key là string literal tường minh, duy nhất trong scene và mô tả đúng vai trò ổn định của node, kể cả node có ref. Dùng lowercase kebab-case gồm ít nhất hai từ, ví dụ key="search-range" hoặc key="pivot-marker".',
    'Không dùng index, thứ tự, nội dung hiển thị, vị trí hiện tại, UUID, random, biểu thức hoặc biến để tạo key. Không sinh visual JSX node bằng map/loop; hãy khai báo tường minh để Layout Editor giữ được identity ổn định.',
    'Không dùng scaleX/scaleY; dùng scale([x, y], duration) hoặc width/height với duration.',
    'Không yield* view.add/node.add. Mọi giá trị truyền vào all/chain hoặc yield* phải là animation generator, thường là signal(value, duration).',
    'Txt.text phải là string; chuyển số bằng String(value).',
    'Giá trị flex dùng kebab-case như space-between, không dùng spaceBetween.',
    'Scene phải tự chứa toàn bộ node và animation, chạy độc lập và không import file tương đối.',
    'Thiết kế cho khung dọc 1080x1920, ưu tiên hình khối, vị trí, màu và chuyển động để giải thích bản chất.',
    'Không hiển thị source code. Không dùng caption để gánh nội dung chính; chữ ngắn, số và ký hiệu chỉ được dùng khi bản thân visual cần chúng.',
    'Mỗi beat phải gọi đúng một lần yield* waitUntil(startEvent), sau đó khai báo const beatDuration = useDuration(endEvent) và const beatEndTime = useThread().time() + beatDuration. Chạy visual theo tỷ lệ beatDuration rồi kết thúc beat bằng yield* waitFor(Math.max(0, beatEndTime - useThread().time())). Dùng tên duration/endTime riêng cho từng beat nếu không tạo block scope.',
    'Không gọi waitUntil(endEvent), vì waitUntil cũng đăng ký event và sẽ gây trùng với useDuration. Import useThread và waitFor từ @motion-canvas/core.',
    'Không hardcode waitFor để quyết định ranh giới beat. Time-event là hợp đồng bắt buộc để audio có thể điều khiển timeline ở bước đồng bộ.',
    'Giữ source gọn, số node hợp lý, tái sử dụng reference và tránh hiệu ứng trang trí không truyền đạt thông tin.',
    'Tuân theo visualDirection để các scene độc lập vẫn có cùng ngôn ngữ hình ảnh.',
    'Source là mã thuần, không bọc bằng Markdown fence.',
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
    'Sửa scene Motion Canvas sau để TypeScript biên dịch thành công.',
    'Giữ nguyên ý nghĩa visual, thứ tự beat và tổng timing. Chỉ thay đổi những phần cần để sửa lỗi và làm API đúng.',
    'Trả object gồm name và source; source là mã thuần, không dùng Markdown fence.',
    'Quy tắc import: visual node và makeScene2D từ @motion-canvas/2d; flow, ref, signal, tween, waitFor, waitUntil, useDuration và easing từ @motion-canvas/core.',
    'Giữ nguyên đúng waitUntil(startEvent) và useDuration(endEvent) của từng beat trong context; không thêm waitUntil(endEvent), vì đây sẽ là đăng ký event trùng.',
    'Ngay sau useDuration, lưu beatEndTime = useThread().time() + beatDuration; sau visual, gọi yield* waitFor(Math.max(0, beatEndTime - useThread().time())) để beat luôn kết thúc đúng mốc dù visual ngắn hơn.',
    'Tên export phải dùng chính xác: createRef, createSignal, easeInOutCubic; không import ref, signal hoặc easing.',
    'Không dùng JSX.Element, scaleX/scaleY, hoặc yield* một node/setter không có duration.',
    'Giữ hoặc bổ sung key string literal lowercase kebab-case có ít nhất hai từ cho mọi visual JSX node, kể cả node có ref; key phải duy nhất trong scene và mô tả vai trò ổn định của node.',
    'Không tạo key từ index, thứ tự, nội dung, vị trí, UUID, random, biểu thức hoặc biến. Không sinh visual JSX node bằng map/loop.',
    'Giá trị flex dùng kebab-case như space-between, space-around hoặc space-evenly; không dùng spaceBetween.',
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

  const sourceFile = ts.createSourceFile(
    'generated-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

  function staticJsxKey(attribute: ts.JsxAttribute) {
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
    const key = keyAttribute ? staticJsxKey(keyAttribute) : null;
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

  return new MotionCanvasGenerationError(
    mappedError.code,
    `Scene ${sectionIndex + 1} “${sectionTitle}”: ${mappedError.message}`,
    {cause: mappedError},
  );
}

export function createCodexMotionCanvasGenerator(
  client: CodexAppServerClient,
  options: {
    runtimeDirectory?: string;
    timeoutMs?: number;
    concurrency?: number;
    model?: string;
    reasoningEffort?: string;
  } = {},
): MotionCanvasGenerator {
  const runtimeDirectory = path.resolve(
    options.runtimeDirectory ??
      path.join(os.tmpdir(), 'pad-studio-ai-runtime'),
  );
  const timeoutMs =
    options.timeoutMs ??
    Math.max(DEFAULT_CODEX_GENERATION_TIMEOUT_MS, DEFAULT_SCENE_TIMEOUT_MS);
  const concurrency = Math.max(
    1,
    Math.min(4, Math.floor(options.concurrency ?? 4)),
  );
  const sceneGenerations = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<GeneratedSceneResult>;
    }
  >();
  let selectedPolicyPromise: Promise<{
    model?: string;
    reasoningEffort?: string;
  }> | null = null;

  function resolveScenePolicy() {
    if (selectedPolicyPromise) return selectedPolicyPromise;

    selectedPolicyPromise = client
      .request('model/list', {limit: 20, includeHidden: false})
      .then((response) => {
        const parsed = modelListSchema.safeParse(response);
        if (!parsed.success) {
          return {
            ...(options.model ? {model: options.model} : {}),
            ...(options.reasoningEffort
              ? {reasoningEffort: options.reasoningEffort}
              : {}),
          };
        }

        const selected = options.model
          ? parsed.data.data.find(
              (model) =>
                model.model === options.model || model.id === options.model,
            )
          : parsed.data.data.find((model) => model.isDefault);
        const modelName =
          options.model ?? selected?.model ?? selected?.id;
        const supportedEfforts =
          selected?.supportedReasoningEfforts?.map(
            (effort) => effort.reasoningEffort,
          ) ?? [];
        let reasoningEffort = options.reasoningEffort;

        if (reasoningEffort && supportedEfforts.length > 0) {
          if (!supportedEfforts.includes(reasoningEffort)) {
            reasoningEffort =
              selected?.defaultReasoningEffort &&
              supportedEfforts.includes(selected.defaultReasoningEffort)
                ? selected.defaultReasoningEffort
                : undefined;
          }
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
      .catch(() => ({
        ...(options.model ? {model: options.model} : {}),
        ...(options.reasoningEffort
          ? {reasoningEffort: options.reasoningEffort}
          : {}),
      }));
    return selectedPolicyPromise;
  }

  function discardGeneration(generationId: string) {
    const keyPrefix = `${generationId}:`;
    for (const key of sceneGenerations.keys()) {
      if (key.startsWith(keyPrefix)) sceneGenerations.delete(key);
    }
  }

  function generateSceneOnce(
    request: MotionCanvasGenerationRequest,
    sectionIndex: number,
  ) {
    const outlineSection = request.outline.sections[sectionIndex]!;
    const voiceVisualSection =
      request.voiceVisualPlan.sections[sectionIndex]!;
    const fingerprint = JSON.stringify(
      generationPayload(request, sectionIndex),
    );
    const cacheKey = `${request.generationId}:${outlineSection.id}`;
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
      try {
        const scenePolicy = await resolveScenePolicy();
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs,
          outputSchema: outputJsonSchema,
          prompt: buildPrompt(request, sectionIndex),
          baseInstructions:
            'Bạn sinh đúng một scene Motion Canvas cho PAD Studio. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions:
            'Mã phải gọn, tự chứa, dễ chỉnh tiếp và đồng bộ chính xác với từng beat voice–visual. Mọi visual JSX node phải có semantic key tường minh, ổn định cho Layout Editor. Ưu tiên visual logic hơn hiệu ứng.',
          model: scenePolicy.model,
          reasoningEffort: scenePolicy.reasoningEffort,
        });

        let responseJson: unknown;
        try {
          responseJson = JSON.parse(generated.responseText);
        } catch (error) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
            'Codex trả về scene không đúng định dạng.',
            {cause: error},
          );
        }

        const parsed =
          generatedMotionCanvasSceneSchema.safeParse(responseJson);
        if (!parsed.success) {
          throw new MotionCanvasGenerationError(
            'CODEX_MOTION_CANVAS_INVALID_RESPONSE',
            'Codex trả về scene chưa đúng cấu trúc yêu cầu.',
            {cause: parsed.error},
          );
        }

        validateMotionCanvasSceneSource(parsed.data.source);
        validateMotionCanvasTimingContract(
          parsed.data.source,
          voiceVisualSection.beats,
        );
        const slug =
          toSlug(parsed.data.name) || `scene-${sectionIndex + 1}`;
        return {
          scene: {
            id: randomUUID(),
            outlineSectionId: outlineSection.id,
            name: parsed.data.name,
            filePath: `src/scenes/${String(sectionIndex + 1).padStart(2, '0')}-${slug}.tsx`,
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
            source: `${parsed.data.source.trim()}\n`,
          },
          model: generated.model,
          usage: generated.usage,
        };
      } catch (error) {
        throw sceneGenerationError(
          error,
          sectionIndex,
          outlineSection.title,
        );
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
      const scenePolicy = await resolveScenePolicy();
      const repaired = await runCodexStructuredGeneration({
        client,
        runtimeDirectory,
        timeoutMs,
        outputSchema: outputJsonSchema,
        prompt: buildRepairPrompt(
          request,
          sectionIndex,
          generatedScene,
          compilerDiagnostics,
        ),
        baseInstructions:
          'Bạn sửa đúng một scene Motion Canvas theo compiler diagnostics. Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
        developerInstructions:
          'Giữ nguyên mục tiêu giảng giải và timing; sửa tối thiểu để source dùng đúng API Motion Canvas, biên dịch và có semantic key tường minh, ổn định cho mọi visual JSX node.',
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
      validateMotionCanvasSceneSource(parsed.data.source);
      validateMotionCanvasTimingContract(
        parsed.data.source,
        request.voiceVisualPlan.sections[sectionIndex]!.beats,
      );

      const result: GeneratedSceneResult = {
        scene: {
          ...generatedScene,
          name: parsed.data.name,
          source: `${parsed.data.source.trim()}\n`,
        },
        model: repaired.model,
        usage: repaired.usage,
      };
      const cacheKey = `${request.generationId}:${outlineSection.id}`;
      sceneGenerations.set(cacheKey, {
        fingerprint: JSON.stringify(
          generationPayload(request, sectionIndex),
        ),
        promise: Promise.resolve(result),
      });
      return result;
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
      const results = new Array<GeneratedSceneResult>(
        request.outline.sections.length,
      );
      const failures: Array<{index: number; error: unknown}> = [];
      let nextIndex = 0;
      const workerCount = Math.min(
        concurrency,
        request.outline.sections.length,
      );
      const workers = Array.from({length: workerCount}, async () => {
        while (true) {
          const sectionIndex = nextIndex;
          nextIndex += 1;
          if (sectionIndex >= request.outline.sections.length) return;

          try {
            results[sectionIndex] = await generateSceneOnce(
              request,
              sectionIndex,
            );
          } catch (error) {
            failures.push({index: sectionIndex, error});
          }
        }
      });
      await Promise.all(workers);

      if (failures.length > 0) {
        failures.sort((left, right) => left.index - right.index);
        throw failures[0]!.error;
      }

      const models = [
        ...new Set(results.map((result) => result.model)),
      ];
      return {
        scenes: results.map((result) => result.scene),
        model: models.join(', ').slice(0, 160),
        usage: aggregateUsage(results),
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
            const sectionIndex = indexes[repairIndex]!;
            repairs[repairIndex] = await repairScene(
              request,
              generated.scenes[sectionIndex]!,
              sectionIndex,
              diagnosticsForScene(
                generated.scenes[sectionIndex]!.filePath,
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
    discardGeneration,
  };
}
