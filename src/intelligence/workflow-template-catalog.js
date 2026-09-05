import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertOnlyFields, normalizeWorkItems, requireId, requireObject, requireText } from "./contracts.js";

const MODULE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export class WorkflowTemplateCatalog {
  constructor({ root = path.join(MODULE_ROOT, "workflow-templates") } = {}) {
    this.root = root;
  }

  async list() {
    let names;
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const templates = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const value = JSON.parse(await readFile(path.join(this.root, name), "utf8"));
      templates.push(this.#validate(value));
    }
    return templates;
  }

  async get(templateId) {
    return (await this.list()).find((template) => template.id === templateId) ?? null;
  }

  async instantiate(templateId, overrides = {}) {
    const template = await this.get(templateId);
    if (!template) throw new Error(`Unknown workflow template: ${templateId}`);
    requireObject(overrides, "workflow template overrides");
    assertOnlyFields(overrides, ["name", "purpose"], "workflow template overrides");
    return {
      name: overrides.name === undefined ? template.name : requireText(overrides.name, "workflow.name"),
      purpose: overrides.purpose === undefined ? template.purpose : requireText(overrides.purpose, "workflow.purpose"),
      status: "active",
      changeReason: `Initialized from optional template ${template.id}.`,
      items: structuredClone(template.items),
      metadata: { templateId: template.id, templateVersion: template.version },
    };
  }

  #validate(value) {
    requireObject(value, "workflow template");
    assertOnlyFields(value, ["id", "version", "name", "description", "purpose", "items"], "workflow template");
    return {
      id: requireId(value.id, "template.id"),
      version: requireText(value.version, "template.version"),
      name: requireText(value.name, "template.name"),
      description: requireText(value.description, "template.description"),
      purpose: requireText(value.purpose, "template.purpose"),
      items: normalizeWorkItems(value.items),
    };
  }
}
