import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import {
  loadLocalConfig,
  localConfigPath,
  publicLocalSettings,
  updateLocalConfig
} from "../config/local-config.js";
import { ElevenLabsClient, ElevenLabsError } from "../tools/elevenlabs-client.js";
import { buildToolsOverview } from "./tools-overview.js";

/**
 * Backs the observer's Tools page. Checking every tool's availability starts several programs and can take
 * a few seconds, so the overview is cached briefly and shared by concurrent requests; saving a setting or
 * pressing "Kiểm tra lại" refreshes it.
 */
export function createSettingsService({
  configPath = null,
  registryFactory = createDefaultToolRegistry,
  checkElevenLabs = null,
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
        : await new ElevenLabsClient({ apiKey: config.elevenLabs.apiKey })
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

  return { path, settings, overview, update, checkElevenLabs: checkKey };
}
