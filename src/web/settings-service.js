import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import {
  loadLocalConfig,
  localConfigPath,
  publicLocalSettings,
  updateLocalConfig
} from "../config/local-config.js";
import { ElevenLabsClient, ElevenLabsError } from "../tools/elevenlabs-client.js";
import { buildToolsOverview } from "./tools-overview.js";

// The picker shows a dozen voices at a time; "Tải thêm" fetches the next page.
const VOICES_PER_PAGE = 12;

export class SettingsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SettingsError";
    this.status = status;
  }
}

// A preview is played by the browser straight from ElevenLabs when the user presses play. Only https links to
// ElevenLabs' own storage are passed on; anything else the provider returns is dropped.
export function safePreviewUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    const trusted = host === "elevenlabs.io" || host.endsWith(".elevenlabs.io") ||
      (host === "storage.googleapis.com" && url.pathname.startsWith("/eleven-"));
    return url.protocol === "https:" && !url.username && !url.password && trusted ? url.href : null;
  } catch {
    return null;
  }
}

const text = (value, limit) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "") || null;

function publicVoice(voice) {
  const labels = Object.entries(voice.labels && typeof voice.labels === "object" ? voice.labels : {})
    .filter(([key, value]) => typeof key === "string" && typeof value === "string" && value)
    .slice(0, 8).map(([key, value]) => ({ key: text(key, 30), value: text(value, 40) }));
  return {
    voiceId: voice.voiceId, name: text(voice.name, 120) ?? voice.voiceId, category: text(voice.category, 40),
    description: text(voice.description, 280), labels,
    verifiedLanguages: (Array.isArray(voice.verifiedLanguages) ? voice.verifiedLanguages : [])
      .map((entry) => text(entry?.language ?? entry?.locale ?? entry, 20)).filter(Boolean).slice(0, 12),
    previewUrl: safePreviewUrl(voice.previewUrl),
    usable: true,
    costNote: voice.customRate === null ? null
      : "Giọng này có hệ số giá riêng nên số credit ước tính chỉ là mức tối thiểu; số thực tế được ghi lại sau khi tạo."
  };
}

function publicModel(model) {
  const usable = model.supportsRequestedLanguage !== false && model.creditMultiplier !== null;
  return {
    modelId: model.modelId, name: text(model.name, 80) ?? model.modelId,
    supportsLanguage: model.supportsRequestedLanguage, creditMultiplier: model.creditMultiplier,
    maxCharacters: model.maximumTextLengthPerRequest, usable,
    unusableReason: model.supportsRequestedLanguage === false ? "Model này không hỗ trợ ngôn ngữ đã chọn."
      : model.creditMultiplier === null ? "Model này không công bố hệ số credit nên không đặt được trần credit." : null
  };
}

function providerError(error, { notFound = null } = {}) {
  if (!(error instanceof ElevenLabsError)) return new SettingsError(500, "Không đọc được dữ liệu từ ElevenLabs.");
  if (error.code === "credential_rejected") return new SettingsError(502, "ElevenLabs từ chối khóa này. Kiểm tra lại khóa.");
  if (error.code === "provider_unreachable") return new SettingsError(502, "Không kết nối được tới ElevenLabs. Kiểm tra mạng rồi thử lại.");
  if (error.code === "provider_limit") return new SettingsError(502, "ElevenLabs đang giới hạn tần suất hoặc đã hết hạn mức. Thử lại sau.");
  if (notFound && [400, 404, 422].includes(error.status)) return new SettingsError(404, notFound);
  return new SettingsError(502, "ElevenLabs trả lỗi khi đọc dữ liệu (" + (error.status ?? "không rõ") + ").");
}

/**
 * Backs the observer's Tools page. Checking every tool's availability starts several programs and can take
 * a few seconds, so the overview is cached briefly and shared by concurrent requests; saving a setting or
 * pressing "Kiểm tra lại" refreshes it.
 */
export function createSettingsService({
  configPath = null,
  registryFactory = createDefaultToolRegistry,
  checkElevenLabs = null,
  createClient = (apiKey) => new ElevenLabsClient({ apiKey }),
  cacheTtlMs = 60_000,
  now = Date.now
} = {}) {
  const path = configPath ?? localConfigPath();
  let registry = null;
  let cached = null;

  async function settings() {
    return publicLocalSettings(await loadLocalConfig({ path }));
  }

  async function freshOverview() {
    registry ??= registryFactory();
    return buildToolsOverview(await registry.describeCapabilities(), { checkedAt: new Date(now()).toISOString() });
  }

  async function overview({ refresh = false } = {}) {
    if (refresh || !cached || now() - cached.at >= cacheTtlMs) {
      const promise = freshOverview();
      cached = { at: now(), promise };
      promise.catch(() => { if (cached?.promise === promise) cached = null; });
    }
    const [tools, current] = await Promise.all([cached.promise, settings()]);
    return { tools, settings: current };
  }

  async function update(patch) {
    await updateLocalConfig(patch, { path });
    // A key changes which tools are available; the declared services do not.
    if (patch && typeof patch === "object" && "elevenLabs" in patch) cached = null;
    return settings();
  }

  async function checkKey() {
    const config = await loadLocalConfig({ path });
    if (!config.elevenLabs.apiKey) return { ok: false, message: "Chưa có khóa ElevenLabs để kiểm tra." };
    try {
      const catalog = checkElevenLabs
        ? await checkElevenLabs(config.elevenLabs.apiKey)
        : await createClient(config.elevenLabs.apiKey)
          .inspect({ language: "vi", signal: AbortSignal.timeout(20_000) });
      const used = catalog.subscription?.characterCount;
      const limit = catalog.subscription?.characterLimit;
      return {
        ok: true,
        message: `Kết nối được: ${catalog.voices?.length ?? 0} giọng, ${catalog.models?.length ?? 0} model` +
          (Number.isFinite(used) && Number.isFinite(limit) ? `, đã dùng ${used.toLocaleString("vi")}/${limit.toLocaleString("vi")} ký tự.` : ".")
      };
    } catch (error) {
      const message = error instanceof ElevenLabsError
        ? (error.code === "credential_rejected" ? "ElevenLabs từ chối khóa này. Kiểm tra lại khóa." : error.message)
        : "Không kiểm tra được kết nối tới ElevenLabs.";
      return { ok: false, message };
    }
  }

  // The three catalog calls below only read from ElevenLabs (no credits). They need a saved key; the key never
  // leaves this process.
  async function withProvider(action, options) {
    const key = (await loadLocalConfig({ path })).elevenLabs.apiKey;
    if (!key) throw new SettingsError(409, "Chưa có khóa ElevenLabs. Dán khóa ở trên rồi thử lại.");
    try {
      return await action(createClient(key), AbortSignal.timeout(20_000));
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw providerError(error, options);
    }
  }

  async function elevenLabsModels({ language = "vi" } = {}) {
    const models = await withProvider((client, signal) => client.listModels({ language, signal }));
    return { language, models: models.map(publicModel)
      .sort((left, right) => Number(right.usable) - Number(left.usable) || Number(right.supportsLanguage === true) - Number(left.supportsLanguage === true)
        || left.name.localeCompare(right.name, "vi")) };
  }

  async function elevenLabsVoices({ language = "vi", search = "", pageToken = null } = {}) {
    const page = await withProvider((client, signal) => client.searchVoices({ language, search, pageToken, pageSize: VOICES_PER_PAGE, signal }));
    return { language, search: String(search ?? "").trim(), voices: page.voices.map(publicVoice), nextPageToken: page.nextPageToken, totalCount: page.totalCount };
  }

  async function elevenLabsVoice({ voiceId }) {
    const voice = await withProvider((client, signal) => client.getVoice(voiceId, { signal }), {
      notFound: "Không tìm thấy giọng này trong tài khoản ElevenLabs của bạn. Giọng từ Voice Library cần được thêm vào My Voices trước."
    });
    return { voice: publicVoice(voice) };
  }

  return { path, settings, overview, update, checkElevenLabs: checkKey, elevenLabsModels, elevenLabsVoices, elevenLabsVoice };
}
