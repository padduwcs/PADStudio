import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateReleaseGates } from "../release/release-gates.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
let manifestPath = resolve(repositoryRoot, "eval/release-gates/manifest.json");
let evidencePath = null;
let invalid = null;
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  if (option === "--manifest" || option === "--evidence") {
    const value = args[++index];
    if (!value || value.startsWith("--")) { invalid = `Missing value for ${option}.`; break; }
    if (option === "--manifest") manifestPath = resolve(value);
    else evidencePath = resolve(value);
  } else { invalid = `Unknown option: ${option}`; break; }
}

if (invalid) {
  process.stderr.write(invalid + "\nUsage: node src/cli/release-gates.js [--manifest path] [--evidence path]\n");
  process.exitCode = 1;
} else {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidence = evidencePath ? JSON.parse(await readFile(evidencePath, "utf8")) : null;
    const result = evaluateReleaseGates(manifest, evidence);
    process.stdout.write(JSON.stringify({ ...result, manifestPath, evidencePath }, null, 2) + "\n");
    process.exitCode = result.status === "blocked" ? 2 : 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({ version: "1.0", status: "failed", error: error?.message || String(error) }) + "\n");
    process.exitCode = 1;
  }
}
