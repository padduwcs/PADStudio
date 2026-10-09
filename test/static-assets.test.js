import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildStaticAssets } from "../src/web/static-assets.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { createPadStudioServer } from "../src/web/server.js";

async function site(t) {
  const directory = await mkdtemp(join(tmpdir(), "padstudio-static-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "brand"), { recursive: true });
  await mkdir(join(directory, ".hidden"), { recursive: true });
  await writeFile(join(directory, "index.html"), "<!doctype html><title>x</title>");
  await writeFile(join(directory, "app.js"), "export {};");
  await writeFile(join(directory, "styles.css"), "body{}");
  await writeFile(join(directory, "brand", "logo.webp"), "webp");
  await writeFile(join(directory, "brand", "README.md"), "# not served");
  await writeFile(join(directory, "brand", "LICENSE.txt"), "not served");
  await writeFile(join(directory, ".hidden", "secret.js"), "nope");
  await writeFile(join(directory, ".env.js"), "nope");
  await writeFile(join(directory, "data.json"), "{}");
  return directory;
}

test("only listed asset types are served, by exact path, and the index also answers the root", async (t) => {
  const directory = await site(t);
  const assets = buildStaticAssets(directory);
  assert.deepEqual([...assets.keys()].sort(), ["/", "/app.js", "/brand/logo.webp", "/index.html", "/styles.css"]);
  assert.equal(assets.get("/app.js").type, "text/javascript; charset=utf-8");
  assert.equal(assets.get("/brand/logo.webp").type, "image/webp");
  assert.equal(assets.get("/brand/logo.webp").longLived, true);
  assert.equal(assets.get("/app.js").longLived, false);
  assert.equal(assets.get("/"), assets.get("/index.html"));
});

test("a symbolic link inside the asset directory is never listed", async (t) => {
  const directory = await site(t);
  const outside = await mkdtemp(join(tmpdir(), "padstudio-static-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "stolen.js"), "secret");
  try {
    await symlink(join(outside, "stolen.js"), join(directory, "linked.js"), "file");
  } catch (error) {
    t.skip("symbolic links are not available here: " + error.code);
    return;
  }
  assert.equal(buildStaticAssets(directory).has("/linked.js"), false);
});

async function listen(t, options) {
  const server = createPadStudioServer({ reader: new ProjectReader(join(tmpdir(), "padstudio-static-no-projects")), ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("assets carry validators and conditional requests are answered with 304", async (t) => {
  const directory = await site(t);
  const origin = await listen(t, { staticDirectory: directory });
  const first = await fetch(`${origin}/app.js`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  assert.equal(first.headers.get("cache-control"), "no-cache");
  assert.equal(await first.text(), "export {};");
  const etag = first.headers.get("etag");
  assert.match(etag, /^W\/"/);
  assert.equal((await fetch(`${origin}/app.js`, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await fetch(`${origin}/brand/logo.webp`)).headers.get("cache-control"), "public, max-age=86400");
  assert.equal((await fetch(`${origin}/`)).headers.get("content-type"), "text/html; charset=utf-8");
});

test("documentation, hidden files and traversal attempts are not reachable", async (t) => {
  const directory = await site(t);
  const origin = await listen(t, { staticDirectory: directory });
  for (const path of ["/brand/README.md", "/brand/LICENSE.txt", "/.hidden/secret.js", "/.env.js", "/data.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/brand/"]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});

test("the real interface serves its modules, brand renditions and font but not its documentation", async (t) => {
  const origin = await listen(t);
  for (const [path, type] of [
    ["/", "text/html"], ["/app.js", "text/javascript"], ["/styles.css", "text/css"],
    ["/fonts/manrope-variable.ttf", "font/ttf"], ["/brand/padstudio-mark.webp", "image/webp"],
    ["/brand/favicon-64.png", "image/png"], ["/brand/apple-touch-icon.png", "image/png"]
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), new RegExp("^" + type.replace("/", "\\/")), path);
  }
  for (const path of ["/fonts/OFL.txt", "/fonts/README.md", "/brand/README.md"]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});
