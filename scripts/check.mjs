// Fast static checks that need no dependencies: `npm run check`.
//   1. every tracked JavaScript file parses (node --check)
//   2. no unused imports and no node:path/url helper used without an import
//   3. every relative Markdown link resolves and every `npm run <script>` in the docs exists
// The checks are deliberately simple; they exist to catch mechanical mistakes, not to replace review.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const problems = [];

// 1. syntax ---------------------------------------------------------------------------------------------
const scripts = tracked.filter((file) => /\.(?:m?js)$/.test(file) && existsSync(file));
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    problems.push(`${file}: syntax error\n${String(error.stderr ?? error.message).split("\n").slice(0, 4).join("\n")}`);
  }
}

// 2. imports --------------------------------------------------------------------------------------------
const HELPERS = ["join", "dirname", "extname", "basename", "fileURLToPath"];
for (const file of scripts.filter((name) => !name.startsWith("ui/") || true)) {
  const text = readFileSync(file, "utf8");
  const importPattern = /^import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+(\w+))?\s*from\s+"[^"]+";/gms;
  const imported = new Set();
  for (const match of text.matchAll(importPattern)) {
    if (match[1]) imported.add(match[1]);
    if (match[3]) imported.add(match[3]);
    for (const part of (match[2] ?? "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) imported.add(name);
    }
  }
  const body = text.replace(/^import\s[\s\S]*?from\s+"[^"]+";/gm, "");
  for (const name of imported) {
    if (!new RegExp(`\\b${name}\\b`).test(body)) problems.push(`${file}: unused import ${name}`);
  }
  for (const name of HELPERS) {
    const used = new RegExp(`(?<![\\w.])${name}\\(`).test(body);
    const declared = imported.has(name) || new RegExp(`(?:const|let|var|function|async function)\\s+${name}\\b`).test(body);
    if (used && !declared) problems.push(`${file}: ${name}() is used but not imported`);
  }
}

// 3. documentation --------------------------------------------------------------------------------------
const packageScripts = new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts));
for (const file of tracked.filter((name) => name.endsWith(".md") && !name.startsWith("reports/") && !name.startsWith("eval/"))) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (path && !existsSync(resolve(dirname(file), path))) problems.push(`${file}: broken link ${target}`);
  }
  for (const match of text.matchAll(/npm run ([a-z0-9:.-]+)/gi)) {
    if (!packageScripts.has(match[1])) problems.push(`${file}: unknown npm script "${match[1]}"`);
  }
}

if (problems.length) {
  process.stderr.write(`${problems.length} problem(s):\n${problems.map((item) => "  - " + item).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`check passed: ${scripts.length} scripts, ${tracked.filter((name) => name.endsWith(".md")).length} documents\n`);
}
