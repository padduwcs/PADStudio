import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {
  PronunciationRuleSchema,
  type PronunciationRule,
} from '../shared/pronunciation.ts';

const FILE_NAME = 'pronunciation-rules.json';
const MAX_LIBRARY_RULES = 2_000;

export interface PronunciationRuleStore {
  list(): Promise<PronunciationRule[]>;
  save(rule: Omit<PronunciationRule, 'id' | 'scope'> & {id?: string}): Promise<PronunciationRule>;
  remove(ruleId: string): Promise<boolean>;
}

function canonicalRules(rules: readonly PronunciationRule[]) {
  return [...rules]
    .filter(rule => rule.scope === 'library')
    .sort((left, right) => left.source.localeCompare(right.source) || left.id.localeCompare(right.id));
}

/** A local pronunciation memory, deliberately separate from immutable project artifacts. */
export function createPronunciationRuleStore(rootDirectory: string): PronunciationRuleStore {
  const directory = path.join(rootDirectory, '.pad-studio');
  const filePath = path.join(directory, FILE_NAME);

  async function readRules() {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return canonicalRules(parsed.flatMap(value => {
        const result = PronunciationRuleSchema.safeParse(value);
        return result.success ? [result.data] : [];
      }));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writeRules(rules: readonly PronunciationRule[]) {
    const canonical = canonicalRules(rules);
    if (canonical.length > MAX_LIBRARY_RULES) {
      throw new Error(`Từ điển dùng chung vượt giới hạn an toàn ${MAX_LIBRARY_RULES} mục.`);
    }
    await mkdir(directory, {recursive: true});
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, {force: true}).catch(() => undefined);
    }
  }

  return {
    list: readRules,
    async save(input) {
      const rule = PronunciationRuleSchema.parse({
        ...input,
        id: input.id ?? randomUUID(),
        scope: 'library',
      });
      const current = await readRules();
      const next = current.filter(item => item.id !== rule.id);
      next.push(rule);
      await writeRules(next);
      return rule;
    },
    async remove(ruleId) {
      const current = await readRules();
      const next = current.filter(rule => rule.id !== ruleId);
      if (next.length === current.length) return false;
      await writeRules(next);
      return true;
    },
  };
}
