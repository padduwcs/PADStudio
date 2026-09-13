import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { createToolDiscoveryView, parseToolListArgs } from "../execution/tool-discovery.js";

async function main(args) {
  const options = parseToolListArgs(args);
  const registry = createDefaultToolRegistry();
  const description = await registry.describeCapabilities();
  process.stdout.write(JSON.stringify(createToolDiscoveryView(description, options), null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
