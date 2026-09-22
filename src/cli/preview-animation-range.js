import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRemotionPreviewRange } from "../animation/remotion-preview-range.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ToolExecutor } from "../execution/tool-executor.js";
import { ProjectStore } from "../project/project-store.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(args) {
  if (args.length !== 4) {
    throw new Error("Usage: npm run animation:preview-range -- <project-id> <composition-artifact-id-or-key> <start-seconds> <end-seconds>");
  }
  const [projectId, compositionReference, start, end] = args;
  const store = new ProjectStore(join(applicationRoot, ".padstudio", "projects"));
  const request = await resolveRemotionPreviewRange(store, projectId, compositionReference, Number(start), Number(end));
  const result = await new ToolExecutor({ store, registry: createDefaultToolRegistry() }).execute(projectId, request);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
