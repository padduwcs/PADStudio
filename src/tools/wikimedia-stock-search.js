const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const MEDIA_FILTER = { image: "bitmap", video: "video", audio: "audio" };

export class WikimediaStockError extends Error {
  constructor(message, code = "stock_search_failed") { super(message); this.name = "WikimediaStockError"; this.code = code; }
}

function normalize(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new WikimediaStockError("Stock search inputs must be an object.", "invalid_input");
  const unknown = Object.keys(inputs).filter((key) => !["query", "mediaType", "limit"].includes(key));
  if (unknown.length) throw new WikimediaStockError(`Unsupported stock search fields: ${unknown.join(", ")}.`, "invalid_input");
  if (typeof inputs.query !== "string" || !inputs.query.trim() || inputs.query.length > 200) throw new WikimediaStockError("query must contain 1-200 characters.", "invalid_input");
  const mediaType = inputs.mediaType ?? "image";
  if (!MEDIA_FILTER[mediaType]) throw new WikimediaStockError("mediaType must be image, video, or audio.", "invalid_input");
  const limit = inputs.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new WikimediaStockError("limit must be an integer from 1 to 50.", "invalid_input");
  return { query: inputs.query.trim(), mediaType, limit };
}

function text(metadata, key) {
  const value = metadata?.[key]?.value;
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() || null : null;
}

function httpsUrl(value) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
  catch { return null; }
}

function expectedMime(mime, mediaType) {
  return typeof mime === "string" && mime.startsWith(mediaType + "/");
}

function candidate(page, requestedMediaType) {
  if (!page || typeof page !== "object" || Array.isArray(page)) return null;
  const info = page.imageinfo?.[0], metadata = info?.extmetadata ?? {};
  const assetUrl = httpsUrl(info?.url);
  if (!assetUrl || !Number.isInteger(page.pageid) || page.pageid <= 0 || typeof page.title !== "string" || !page.title || !expectedMime(info.mime, requestedMediaType)) return null;
  return { id: String(page.pageid), title: page.title.replace(/^File:/, ""), mediaType: info.mime ?? null,
    assetUrl, thumbnailUrl: httpsUrl(info.thumburl),
    sourcePage: `https://commons.wikimedia.org/?curid=${page.pageid}`,
    creator: text(metadata, "Artist"), license: text(metadata, "LicenseShortName"),
    licenseUrl: httpsUrl(text(metadata, "LicenseUrl")), attribution: text(metadata, "Credit"),
    width: info.width ?? null, height: info.height ?? null };
}

export function createWikimediaStockSearch({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  return {
    name: "wikimedia-stock", version: "1.0.0", provider: "Wikimedia Commons", capability: "media.search-stock",
    description: "Search rights-described public image, video, or audio candidates on Wikimedia Commons.",
    runtime: "cloud", executionMode: "sync", producesFiles: false, approvalRequired: false,
    cost: { currency: "USD", estimated: 0 }, sideEffects: ["Makes a read-only HTTPS request; does not import any asset."],
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, mediaType: { enum: Object.keys(MEDIA_FILTER) }, limit: { type: "integer" } }, additionalProperties: false },
    outputDescription: "A durable list of source-page, asset URL, creator, and license candidates for explicit selection.",
    async checkAvailability() { return typeof fetchImpl === "function" ? { status: "available", setupHints: ["No API key required; provider reachability is checked when a search runs."] } : { status: "unavailable", reason: "Fetch API unavailable." }; },
    async prepare({ inputs }) { const request = normalize(inputs); return { runtime: request, trace: request }; },
    async execute(request) {
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search",
        gsrnamespace: "6", gsrsearch: `${request.query} filetype:${MEDIA_FILTER[request.mediaType]}`, gsrlimit: String(request.limit),
        prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "640", origin: "*" }).toString();
      let response;
      try { response = await fetchImpl(url, { headers: { "User-Agent": "PADStudio/0.1 stock-search" }, signal: request.signal }); }
      catch (error) { throw new WikimediaStockError(error?.message || "Wikimedia request failed.", "network_failed"); }
      if (!response || typeof response !== "object") throw new WikimediaStockError("Wikimedia returned no valid response.", "provider_failed");
      if (!response.ok) throw new WikimediaStockError(`Wikimedia returned HTTP ${response.status}.`, "provider_failed");
      let payload;
      try { payload = await response.json(); }
      catch { throw new WikimediaStockError("Wikimedia returned invalid JSON.", "provider_failed"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new WikimediaStockError("Wikimedia returned an invalid response.", "provider_failed");
      if (payload.error) throw new WikimediaStockError(payload.error.info || "Wikimedia API error.", "provider_failed");
      const pages = payload.query?.pages ?? [];
      if (!Array.isArray(pages)) throw new WikimediaStockError("Wikimedia response pages are invalid.", "provider_failed");
      const candidates = pages.map((page) => candidate(page, request.mediaType)).filter(Boolean).slice(0, request.limit);
      return { searchedAt: now(), query: request.query, mediaType: request.mediaType, candidates, actualCostUsd: 0,
        verification: { status: "passed", checks: ["provider_response_valid", "candidate_urls_https", "rights_metadata_preserved"] } };
    },
    createResult({ prepared, execution }) { return { type: "media.stock-search", name: `Stock search: ${prepared.trace.query}`,
      inputResources: [], inputResults: [], inputArtifacts: [], files: [], data: { version: "1.0", provider: "wikimedia-commons", ...execution }, verification: execution.verification }; }
  };
}
