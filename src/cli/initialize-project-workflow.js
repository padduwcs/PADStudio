import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowTemplateCatalog } from "../intelligence/workflow-template-catalog.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = join(applicationRoot, ".padstudio", "projects");

async function main(args) {
  const [projectId, templateId, overrideSource] = args;
  if (!projectId || !templateId || args.length > 3) {
    throw new Error("Usage: npm run project:workflow:init -- <project-id> <template-id> [overrides-json|-]");
  }
  const overrides = overrideSource ? await readJsonInput(overrideSource) : {};
  const workflow = await new WorkflowTemplateCatalog().instantiate(templateId, overrides);
  const saved = await new ProjectStore(projectRoot).writeWorkflow(projectId, workflow);
  process.stdout.write(JSON.stringify(saved, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
