import { AnalysisReader } from "../analysis/analysis-reader.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || args.length > 2) {
    throw new Error("Usage: npm run analysis:verify -- <project-id> [query-json|->]");
  }
  const store = new ProjectStore(projectRoot);
  const response = await new AnalysisReader({ rootDir: projectRoot, projectStore: store })
    .verify(projectId, source ? await readJsonInput(source) : {});
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message, code: error.code ?? "analysis_verify_failed" }) + "\n");
  process.exitCode = 1;
});
