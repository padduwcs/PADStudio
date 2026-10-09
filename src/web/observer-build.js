import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_DIRECTORIES = ["src", "ui"];
const SOURCE_FILE = /\.(?:m?js|css|html|json)$/;

/**
 * A fingerprint of the code an observer runs: the contents of every source file under src/ and ui/. A server
 * reports the value it started with; observer:ensure compares it with the code on disk to spot a server that
 * is still running yesterday's code.
 */
export function observerBuild(root = applicationRoot) {
  const files = [];
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(path);
    }
  };
  for (const directory of SOURCE_DIRECTORIES) visit(join(root, directory));
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(relative(root, path).split(sep).join("/")).update("\0").update(readFileSync(path)).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
