import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {
  PronunciationPatchSchema,
  validatePronunciationPatches,
  type PronunciationPatch,
  type PronunciationRule,
} from '../shared/pronunciation.ts';
import type {CodexTokenUsage} from '../shared/topic.ts';
import type {CodexAppServerClient} from './codexConnection.ts';
import {
  CodexStructuredGenerationError,
  codexGenerationTimeoutMs,
  runCodexStructuredGeneration,
} from './codexStructuredGeneration.ts';

export const PRONUNCIATION_AUDIT_PROMPT_VERSION = 'pronunciation-audit-v1';

const resultSchema = z.object({
  patches: z.array(PronunciationPatchSchema).max(120),
}).strict();
const outputSchema = z.toJSONSchema(resultSchema, {target: 'draft-7'});

export interface PronunciationAuditRequest {
  sourceText: string;
  normalizedText: string;
  rules: readonly PronunciationRule[];
  model?: string;
  reasoningEffort?: string;
}

export interface PronunciationAuditResult {
  patches: PronunciationPatch[];
  model: string;
  usage: CodexTokenUsage | null;
}

export interface PronunciationAuditService {
  audit(request: PronunciationAuditRequest): Promise<PronunciationAuditResult>;
}

function technicalWindows(text: string) {
  const matches = [...text.matchAll(/(?:\bO\s*\([^\n)]{1,80}\)|[A-Za-z][A-Za-z0-9_]*\s*(?:\[[^\n\]]+\])+|[A-Za-z]\s*(?:<=|>=|==|!=|===|!==|\+\+|--|->)|\b\d+\s*\^\s*[A-Za-z0-9]+\b)/gu)];
  return matches.slice(0, 80).map(match => ({
    start: Math.max(0, (match.index ?? 0) - 80),
    end: Math.min(text.length, (match.index ?? 0) + match[0].length + 80),
    text: text.slice(Math.max(0, (match.index ?? 0) - 80), Math.min(text.length, (match.index ?? 0) + match[0].length + 80)),
  }));
}

function buildPrompt(request: PronunciationAuditRequest) {
  return [
    'Bạn là lớp rà soát phát âm tiếng Việt cho ElevenLabs, không phải biên tập viên nội dung.',
    'Chỉ phát hiện ký hiệu, công thức hoặc thuật ngữ kỹ thuật còn có nguy cơ đọc sai. Giữ nguyên tiếng Anh thông thường.',
    'Không sửa câu, không đổi dấu câu, không dịch, không thêm/xóa/đổi thứ tự bất cứ nội dung nào.',
    'Mỗi patch bắt buộc dùng chính xác start/end/source của sourceText. Nếu không chắc chắn, bỏ qua.',
    'Các rules hiện có là chuẩn phong cách. Chỉ suggestedRule khi cách đọc đủ tổng quát để tái sử dụng; scope nên là project.',
    JSON.stringify({
      sourceText: request.sourceText,
      normalizedText: request.normalizedText,
      rules: request.rules.map(({id, source, spoken, scope}) => ({id, source, spoken, scope})),
      candidateWindows: technicalWindows(request.sourceText),
    }),
  ].join('\n');
}

export function createCodexPronunciationAuditService(
  client: CodexAppServerClient,
  options: {runtimeDirectory?: string; timeoutMs?: number} = {},
): PronunciationAuditService {
  const runtimeDirectory = path.resolve(options.runtimeDirectory ?? path.join(os.tmpdir(), 'pad-studio-ai-runtime'));
  return {
    async audit(request) {
      if (technicalWindows(request.sourceText).length === 0) {
        return {patches: [], model: 'not-needed', usage: null};
      }
      try {
        const generated = await runCodexStructuredGeneration({
          client,
          runtimeDirectory,
          timeoutMs: options.timeoutMs ?? codexGenerationTimeoutMs(request.reasoningEffort),
          outputSchema,
          prompt: buildPrompt(request),
          baseInstructions: 'Không dùng công cụ hoặc đọc tệp. Chỉ trả JSON đúng schema.',
          developerInstructions: 'Patch phải bám đúng source span. Đây là output an toàn để ghép máy; không được viết lại lời thoại.',
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        });
        const parsed = resultSchema.safeParse(JSON.parse(generated.responseText));
        if (!parsed.success || !validatePronunciationPatches(request.sourceText, parsed.success ? parsed.data.patches : [])) {
          throw new Error('Codex trả patch phát âm không khớp source.');
        }
        return {patches: parsed.data.patches, model: generated.model, usage: generated.usage};
      } catch (error) {
        if (error instanceof CodexStructuredGenerationError) {
          throw new Error(`Không thể rà soát phát âm bằng AI: ${error.reason}.`, {cause: error});
        }
        throw error;
      }
    },
  };
}
