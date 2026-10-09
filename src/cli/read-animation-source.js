import { readFile } from "node:fs/promises";
import { loadSourcePackage, safeSourcePath } from "../animation/source-package.js";
import { ProjectStore } from "../project/project-store.js";
import { resolveProjectRoot } from "../config/project-root.js";

const root = resolveProjectRoot();

async function main(args) {
  if (args.length < 2 || args.length > 3) {
    throw new Error("Usage: npm run animation:read -- <project-id> <source-result-id> [relative-file|--all]");
  }
  const source = await loadSourcePackage(new ProjectStore(root), args[0], args[1]);
  const selection = args[2] ?? null;
  const selected = selection === "--all" ? source.files : selection
    ? [source.files.find((file) => file.path === safeSourcePath(selection, "relative-file"))].filter(Boolean)
    : [];
  if (selection && selection !== "--all" && !selected.length) throw new Error(`Source package does not contain file: ${selection}`);
  const files = await Promise.all(selected.map(async (file) => ({ path: file.path, sizeBytes: file.sizeBytes,
    sha256: file.sha256, content: await readFile(file.filePath, "utf8") })));
  process.stdout.write(JSON.stringify({ resultId: source.result.id, manifest: source.data,
    files: selection ? files : source.data.sourceFiles }, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
