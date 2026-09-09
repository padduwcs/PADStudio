import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisReader } from "../analysis/analysis-reader.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || !source || args.length !== 2) {
    throw new Error("Usage: npm run analysis:read -- <project-id> <query-json|->");
  }
  const store = new ProjectStore(projectRoot);
  const response = await new AnalysisReader({ rootDir: projectRoot, projectStore: store })
    .query(projectId, await readJsonInput(source));
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message, code: error.code ?? "analysis_read_failed" }) + "\n");
  process.exitCode = 1;
});
