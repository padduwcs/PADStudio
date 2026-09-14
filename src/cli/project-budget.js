import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { configureProjectBudget, projectBudgetSnapshot } from "../execution/project-budget.js";
import { readJsonInput } from "./json-input.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");
async function main(args) {
  const [projectId, action = "show", source] = args;
  if (!projectId || !["show", "set"].includes(action) || (action === "set" && !source)) throw new Error("Usage: npm run project:budget -- <project-id> show | set <json|file|->");
  const store = new ProjectStore(root);
  if (action === "set") await configureProjectBudget(store, projectId, await readJsonInput(source));
  process.stdout.write(JSON.stringify(await projectBudgetSnapshot(store, projectId), null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
