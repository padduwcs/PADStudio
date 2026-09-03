import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

async function main(args) {
  if (args.length !== 0) {
    throw new Error("Cách dùng: npm run tool:list");
  }
  const registry = createDefaultToolRegistry();
  const capabilities = await registry.describeCapabilities();
  process.stdout.write(JSON.stringify(capabilities, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
