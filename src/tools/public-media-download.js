import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { isIP } from "node:net";
import { fail } from "./asset-tool-common.js";

export function publicMediaUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("Media URL is invalid."); }
  if (url.href.length > 2048 || url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) fail("Use a public HTTPS URL without credentials, fragment or custom port.");
  return url;
}
export function isPublicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
async function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}
export async function publicAddress(hostname, resolve = lookup, signal) {
  if (isIP(hostname) || hostname.startsWith("[")) {
    if (!isPublicIPv4(hostname)) fail("Media URL must resolve to a public IPv4 address.", "non_public_url");
    return hostname;
  }
  const answers = await abortable(resolve(hostname, { all: true, family: 4 }), signal);
  if (!answers.length || answers.some((answer) => !isPublicIPv4(answer.address))) fail("Media host is not public IPv4.", "non_public_url");
  return answers[0].address;
}

function openResponse(url, address, signal) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", signal, agent: false,
      headers: { "User-Agent": "PADStudio-media/1.0", "Accept-Encoding": "identity" },
      // DNS is checked once per hop and pinned to this address for the socket.
      // The original URL hostname remains the TLS server name and Host header.
      lookup: (_hostname, options, done) => options.all ? done(null, [{ address, family: 4 }]) : done(null, address, 4)
    }, resolve);
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Download socket timed out.")));
    req.end();
  });
}

export const downloadTypes = Object.freeze({
  "image/png": { extension: "png", mediaType: "image", codec: "png" },
  "image/jpeg": { extension: "jpg", mediaType: "image", codec: "mjpeg" },
  "image/webp": { extension: "webp", mediaType: "image", codec: "webp" },
  "video/mp4": { extension: "mp4", mediaType: "video" },
  "video/webm": { extension: "webm", mediaType: "video" },
  "audio/mpeg": { extension: "mp3", mediaType: "audio" },
  "audio/wav": { extension: "wav", mediaType: "audio" },
  "audio/x-wav": { extension: "wav", mediaType: "audio" },
  "audio/mp4": { extension: "m4a", mediaType: "audio" },
  "audio/flac": { extension: "flac", mediaType: "audio" },
  "audio/ogg": { extension: "ogg", mediaType: "audio" }
});

export async function downloadPublicMedia(urlValue, outputPath, {
  mediaType, maxBytes = 128 * 1024 * 1024, signal, resolve = lookup, open = openResponse, timeoutMs = 120000
} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let url = publicMediaUrl(urlValue);
  const redirects = [];
  for (let hop = 0; hop <= 3; hop++) {
    combined.throwIfAborted();
    const address = await publicAddress(url.hostname, resolve, combined);
    combined.throwIfAborted();
    const response = await open(url, address, combined);
    if ([301,302,303,307,308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || hop === 3) fail("Too many redirects or missing redirect target.", "download_failed");
      redirects.push(url.href);
      url = publicMediaUrl(new URL(location, url).href);
      continue;
    }
    if (response.statusCode !== 200) { response.destroy(); fail("Media server returned HTTP " + response.statusCode + ".", "download_failed"); }
    const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const type = downloadTypes[contentType];
    const encoding = response.headers["content-encoding"];
    const lengthHeader = response.headers["content-length"];
    const length = lengthHeader === undefined ? null : Number(lengthHeader);
    if (!type || type.mediaType !== mediaType || (encoding && encoding !== "identity") ||
        (length !== null && (!Number.isSafeInteger(length) || length < 1 || length > maxBytes))) {
      response.destroy(); fail("Unsupported media type, encoding or download size.", "invalid_download");
    }
    let received = 0;
    const counter = new Transform({ transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > maxBytes) done(new Error("Download exceeds byte limit."));
      else done(null, chunk);
    } });
    await pipeline(response, counter, createWriteStream(outputPath, { flags: "wx" }), { signal: combined });
    if (!received || (length !== null && received !== length)) fail("Incomplete media download.", "invalid_download");
    return { finalUrl: url.href, redirects, contentType, ...type, sizeBytes: received };
  }
}
