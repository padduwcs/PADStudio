import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { rankToolChoices } from "../execution/tool-recommendation.js";
import { readJsonInput } from "./json-input.js";

async function main(args) {
  if (args.length !== 1) throw new Error("Usage: <json> | npm run tool:recommend -- -");
  const registry = createDefaultToolRegistry();
  const result = rankToolChoices(await registry.describeCapabilities(), await readJsonInput(args[0]));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
