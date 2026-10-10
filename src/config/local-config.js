import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../project/atomic-files.js";

// padstudio.local.json holds what belongs to this machine and this user, never to a project: local runtime
// paths, provider API keys and the outside services the user can use. Git ignores it.
export const LOCAL_CONFIG_ENV = "PADSTUDIO_LOCAL_CONFIG";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class LocalConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalConfigError";
  }
}

/**
 * Services a user can say they have outside PADStudio. PADStudio never calls them: the Agent uses them through
 * its own host (or asks the user to), then registers each file with media.register-generated.
 */
export const USER_SERVICE_CATEGORIES = Object.freeze([
  { id: "image-generation", label: "Tạo ảnh bằng AI", examples: "ChatGPT, Gemini, Midjourney, Ideogram" },
  { id: "video-generation", label: "Tạo video bằng AI", examples: "Sora, Veo, Kling, Runway" },
  { id: "music-generation", label: "Tạo nhạc bằng AI", examples: "Suno, Udio" },
  { id: "voice-generation", label: "Giọng đọc AI khác", examples: "dịch vụ giọng đọc PADStudio chưa tích hợp" },
  { id: "stock-media", label: "Kho ảnh, video trả phí", examples: "Shutterstock, Envato, Storyblocks" },
  { id: "design-tools", label: "Công cụ thiết kế", examples: "Canva, Figma, Photoshop" }
].map((category) => Object.freeze(category)));
const SERVICE_IDS = USER_SERVICE_CATEGORIES.map((category) => category.id);
const MAX_NOTE_LENGTH = 500;
// elevenLabs.voiceId/voiceName/modelId are the user's default narration choice, picked on the Tools page. They are guidance
// for the Agent, not a hidden default: every tts.synthesize request still names its model and voice explicitly.
const ELEVENLABS_FIELDS = Object.freeze(["apiKey", "voiceId", "voiceName", "modelId"]);
const SECTIONS = Object.freeze({
  piper: ["pythonCommand", "modelDirectory", "defaultModel"],
  elevenLabs: ELEVENLABS_FIELDS,
  services: ["available", "note"]
});
const PROVIDER_ID = /^[A-Za-z0-9._-]{1,100}$/;

export function localConfigPath({ env = process.env } = {}) {
  return env[LOCAL_CONFIG_ENV]?.trim() || join(repositoryRoot, "padstudio.local.json");
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

function apiKey(value, label) {
  const key = optionalText(value, label);
  if (key !== null && (key.length < 8 || key.length > 256 || !/^[\x21-\x7e]+$/.test(key))) {
    throw new LocalConfigError(`Khóa API (${label}) phải dài 8–256 ký tự và không có khoảng trắng.`);
  }
  return key;
}

function providerId(value, label) {
  const id = optionalText(value, label);
  if (id !== null && !PROVIDER_ID.test(id)) throw new LocalConfigError(`${label} chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang (tối đa 100 ký tự).`);
  return id;
}

function displayName(value, label) {
  const name = optionalText(value, label);
  if (name !== null && (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))) {
    throw new LocalConfigError(`${label} tối đa 120 ký tự và không chứa ký tự điều khiển.`);
  }
  return name;
}

function services(value) {
  const raw = section(value, "services", SECTIONS.services);
  const available = raw.available ?? [];
  if (!Array.isArray(available) || available.some((id) => !SERVICE_IDS.includes(id))) {
    throw new LocalConfigError("services.available may only list: " + SERVICE_IDS.join(", ") + ".");
  }
  if (new Set(available).size !== available.length) throw new LocalConfigError("services.available lists a service twice.");
  const note = optionalText(raw.note, "services.note");
  // Newlines are fine in a note; other control characters are not.
  if (note !== null && (note.length > MAX_NOTE_LENGTH || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(note))) {
    throw new LocalConfigError(`Ghi chú (services.note) tối đa ${MAX_NOTE_LENGTH} ký tự, chỉ gồm chữ và xuống dòng.`);
  }
  return { available: SERVICE_IDS.filter((id) => available.includes(id)), note };
}

function normalize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalConfigError("Local configuration must be an object.");
  }
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(SECTIONS, key));
  if (unknown.length) throw new LocalConfigError("Local configuration has unsupported sections: " + unknown.join(", "));
  const piper = section(value.piper, "piper", SECTIONS.piper);
  const elevenLabs = section(value.elevenLabs, "elevenLabs", SECTIONS.elevenLabs);
  return {
    piper: {
      pythonCommand: optionalText(piper.pythonCommand, "piper.pythonCommand"),
      modelDirectory: optionalText(piper.modelDirectory, "piper.modelDirectory"),
      defaultModel: optionalText(piper.defaultModel, "piper.defaultModel")
    },
    elevenLabs: {
      apiKey: apiKey(elevenLabs.apiKey, "elevenLabs.apiKey"),
      voiceId: providerId(elevenLabs.voiceId, "elevenLabs.voiceId"),
      voiceName: displayName(elevenLabs.voiceName, "elevenLabs.voiceName"),
      modelId: providerId(elevenLabs.modelId, "elevenLabs.modelId")
    },
    services: services(value.services)
  };
}

async function readRaw(path) {
  try {
    // Windows PowerShell 5.1 and Notepad write a byte-order mark; JSON.parse rejects it.
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new LocalConfigError("padstudio.local.json không phải JSON hợp lệ; sửa file rồi tải lại trang.");
    throw error;
  }
}

export async function loadLocalConfig({ path = localConfigPath() } = {}) {
  const raw = await readRaw(path);
  return { path, ...normalize(raw ?? {}) };
}

// Writes are queued so two quick saves from the web page cannot interleave their read-modify-write.
let writeQueue = Promise.resolve();

/**
 * Change only the API keys and the declared services. Runtime paths (Piper's Python, model directories) are
 * left exactly as they are: they name programs PADStudio executes, so only the file itself may set them.
 * An existing file that does not validate is never overwritten.
 */
export function updateLocalConfig(patch, { path = localConfigPath() } = {}) {
  const run = writeQueue.then(async () => {
    const changes = section(patch, "settings", ["elevenLabs", "services"]);
    const raw = (await readRaw(path)) ?? {};
    normalize(raw);
    const next = structuredClone(raw);
    if (changes.elevenLabs !== undefined) {
      const requested = section(changes.elevenLabs, "elevenLabs", ELEVENLABS_FIELDS);
      const merged = { ...(next.elevenLabs ?? {}) };
      for (const [field, value] of Object.entries(requested)) {
        if (value === null || value === "") {
          if (field === "apiKey") merged.apiKey = "";
          else delete merged[field];
        } else {
          merged[field] = value;
        }
      }
      next.elevenLabs = merged;
    }
    if (changes.services !== undefined) {
      const requested = section(changes.services, "services", SECTIONS.services);
      next.services = { ...(next.services ?? {}), ...requested };
      if (next.services.note === null) delete next.services.note;
    }
    const normalized = normalize(next);
    if (next.elevenLabs) {
      const { apiKey: key, voiceId, voiceName, modelId } = normalized.elevenLabs;
      // A voice name without a voice is meaningless, so the pair is kept together (after both were validated).
      next.elevenLabs = { apiKey: key ?? "", ...(voiceId ? { voiceId } : {}), ...(voiceId && voiceName ? { voiceName } : {}), ...(modelId ? { modelId } : {}) };
    }
    if (next.services) next.services = { available: normalized.services.available, ...(normalized.services.note ? { note: normalized.services.note } : {}) };
    await writeJsonAtomic(path, next);
    return { path, ...normalized };
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** A key is shown only as "configured" plus its last four characters, so the user can tell which one is saved. */
export function maskSecret(value) {
  if (!value) return { configured: false, hint: null };
  return { configured: true, hint: value.length >= 12 ? "…" + value.slice(-4) : null };
}

/** What a settings page may show: never a secret, never a runtime path. */
export function publicLocalSettings(config) {
  return {
    elevenLabs: {
      apiKey: maskSecret(config.elevenLabs?.apiKey),
      voice: config.elevenLabs?.voiceId
        ? { id: config.elevenLabs.voiceId, name: config.elevenLabs.voiceName ?? null }
        : null,
      modelId: config.elevenLabs?.modelId ?? null
    },
    services: {
      available: [...(config.services?.available ?? [])],
      note: config.services?.note ?? null,
      categories: USER_SERVICE_CATEGORIES.map((category) => ({ ...category }))
    }
  };
}
