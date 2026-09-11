import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

async function main(args) {
  const language = args[0] || "vi";
  if (args.length > 1 || !/^[a-z]{2}$/.test(language)) {
    throw new Error("Usage: npm run tts:inspect -- [lowercase ISO 639-1 language]");
  }
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
