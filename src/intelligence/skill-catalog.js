import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isPlainObject, normalizeStringList, requireId, requireText } from "./contracts.js";

const MODULE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function isInsideOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export class SkillCatalog {
  constructor({ roots }) {
    this.roots = roots;
  }

  async list() {
    const skills = [];
    const seen = new Set();
    for (const source of this.roots) {
      let catalog;
      try {
        const catalogPath = path.join(source.root, "catalog.json");
        const [rootReal, catalogReal, stat] = await Promise.all([
          realpath(source.root),
          realpath(catalogPath),
          lstat(catalogPath)
        ]);
        if (!stat.isFile() || stat.isSymbolicLink() || !isInsideOrEqual(rootReal, catalogReal)) {
          throw new Error(`Unsafe skill catalog: ${source.root}`);
        }
        catalog = await readJson(catalogReal);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!Array.isArray(catalog.skills)) throw new Error(`Invalid skill catalog: ${source.root}`);
      for (const raw of catalog.skills) {
        const skill = this.#normalize(raw, source);
        if (seen.has(skill.id)) throw new Error(`Duplicate skill ID: ${skill.id}`);
        seen.add(skill.id);
        skills.push(skill);
      }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(skillId) {
    return (await this.list()).find((skill) => skill.id === skillId) ?? null;
  }

  async read(skillId) {
    const skill = await this.get(skillId);
    if (!skill) throw new Error(`Unknown skill: ${skillId}`);
    const rootReal = await realpath(skill.root);
    const filePath = path.resolve(skill.root, skill.instructions);
    const fileReal = await realpath(filePath);
    if (!isInsideOrEqual(rootReal, fileReal)) throw new Error(`Skill instructions escape their catalog root: ${skillId}`);
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe skill instructions: ${skillId}`);
    return { ...this.#public(skill), instructionsText: await readFile(filePath, "utf8") };
  }

  async listPublic() {
    return (await this.list()).map((skill) => this.#public(skill));
  }

  #normalize(raw, source) {
    if (!isPlainObject(raw)) throw new Error(`Invalid skill entry in ${source.root}`);
    return {
      id: requireId(raw.id, "skill.id"),
      version: requireText(raw.version, "skill.version"),
      name: requireText(raw.name, "skill.name"),
      description: requireText(raw.description, "skill.description"),
      appliesTo: normalizeStringList(raw.appliesTo, "skill.appliesTo", { allowEmpty: false }),
      artifactTypes: normalizeStringList(raw.artifactTypes, "skill.artifactTypes"),
      reviewCriteria: normalizeStringList(raw.reviewCriteria, "skill.reviewCriteria"),
      instructions: requireText(raw.instructions, "skill.instructions"),
      scope: source.scope,
      root: source.root,
    };
  }

  #public(skill) {
    const { root, ...publicSkill } = skill;
    return { ...publicSkill, instructionsPath: path.join(root, skill.instructions) };
  }
}

export function createDefaultSkillCatalog({ applicationRoot = MODULE_ROOT, projectRoot } = {}) {
  const roots = [{ root: path.resolve(applicationRoot, "skills"), scope: "system" }];
  if (projectRoot) roots.push({ root: path.resolve(projectRoot, "skills"), scope: "project" });
  return new SkillCatalog({ roots });
}
