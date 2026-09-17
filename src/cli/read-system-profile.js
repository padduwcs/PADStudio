import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { inspectMachineProfile } from "../operations/machine-profile.js";
import { buildPlanningEnvironment } from "../operations/planning-environment.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

if (process.argv.length !== 2) {
  process.stderr.write("Usage: npm run system:profile\n");
  process.exitCode = 1;
} else {
  try {
    const [machine, capabilities] = await Promise.all([
      inspectMachineProfile({ rootDir: join(applicationRoot, ".padstudio", "projects") }),
      createDefaultToolRegistry().describeCapabilities(),
    ]);
    process.stdout.write(JSON.stringify({
      machine,
      planning: buildPlanningEnvironment({ machine, capabilityDescription: capabilities, onboarding: true }),
    }, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
