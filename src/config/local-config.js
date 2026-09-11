import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export class LocalConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalConfigError";
  }
}

function optionalText(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new LocalConfigError(label + " must be nonempty text.");
  }
  return value.trim();
}

function section(value, label, allowed) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalConfigError(label + " must be an object.");
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new LocalConfigError(label + " has unsupported fields: " + unknown.join(", "));
  return value;
}

export async function loadLocalConfig({
  path = process.env.PADSTUDIO_LOCAL_CONFIG?.trim() || resolve("padstudio.local.json")
} = {}) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { path, piper: {}, elevenLabs: {} };
    if (error instanceof SyntaxError) throw new LocalConfigError("padstudio.local.json is not valid JSON.");
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalConfigError("Local configuration must be an object.");
  }
  const unknown = Object.keys(value).filter((key) => !["piper", "elevenLabs"].includes(key));
  if (unknown.length) throw new LocalConfigError("Local configuration has unsupported sections: " + unknown.join(", "));
  const piper = section(value.piper, "piper", ["pythonCommand", "modelDirectory", "defaultModel"]);
  const elevenLabs = section(value.elevenLabs, "elevenLabs", ["apiKey"]);
  return {
    path,
    piper: {
      pythonCommand: optionalText(piper.pythonCommand, "piper.pythonCommand"),
      modelDirectory: optionalText(piper.modelDirectory, "piper.modelDirectory"),
      defaultModel: optionalText(piper.defaultModel, "piper.defaultModel")
    },
    elevenLabs: {
      apiKey: optionalText(elevenLabs.apiKey, "elevenLabs.apiKey")
    }
  };
}
