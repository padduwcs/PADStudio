import { readdirSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2"
});

// Brand artwork and fonts never change under the same name, so browsers may keep them.
const LONG_LIVED = /^\/(?:brand|fonts)\//;

/**
 * Decide, once, which files below `uiDirectory` the observer may serve. Requests are matched against this
 * fixed table by exact URL path, so a request can never name a file that was not listed here: documentation
 * and licence files next to the assets, hidden files and anything outside the directory are not reachable.
 */
export function buildStaticAssets(uiDirectory) {
  const assets = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const type = CONTENT_TYPES[extname(entry.name).toLowerCase()];
      if (!entry.isFile() || !type) continue;
      const url = "/" + relative(uiDirectory, path).split(sep).join("/");
      assets.set(url, { path, type, longLived: LONG_LIVED.test(url) });
    }
  };
  visit(uiDirectory);
  const index = assets.get("/index.html");
  if (index) assets.set("/", index);
  return assets;
}

/** Send one listed asset with a validator, so reloads of unchanged files cost a 304. */
export function sendStaticAsset(request, response, asset) {
  const info = statSync(asset.path);
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": asset.type,
    ETag: etag,
    "Cache-Control": asset.longLived ? "public, max-age=86400" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    return response.end();
  }
  response.writeHead(200, { ...headers, "Content-Length": info.size });
  const stream = createReadStream(asset.path);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}
