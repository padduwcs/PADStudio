import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

async function main(args) {
  const language = args[0] || "vi";
  if (args.length > 1) throw new Error("Usage: npm run tts:inspect -- [language]");
  const tool = createDefaultToolRegistry().get("elevenlabs", "tts.synthesize");
  const availability = await tool.checkAvailability();
  if (availability.status !== "available") throw new Error(availability.reason);
  const catalog = await tool.inspect({ language });
  process.stdout.write(JSON.stringify(catalog, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
