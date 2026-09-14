import { dirname } from "node:path";
import { resolve } from "node:path";
import { readJsonInput } from "./json-input.js";
import { lockHoldoutCorpus } from "../release/holdout-corpus.js";

async function main(args) { const [source, root] = args; if (!source || args.length > 2) throw new Error("Usage: npm run release:holdout:lock -- <manifest-json|file|-> [corpus-root]");
  const baseDirectory = resolve(root ?? (source === "-" || source.trim().startsWith("{") ? process.cwd() : dirname(resolve(source))));
  process.stdout.write(JSON.stringify(await lockHoldoutCorpus(await readJsonInput(source), { baseDirectory }), null, 2) + "\n"); }
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
