import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultAnalysisService } from "../analysis/default-analysis-service.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, analysisJobId] = args;
  if (!projectId || !analysisJobId || args.length !== 2) {
    throw new Error("Cách dùng: npm run analysis:cancel -- <project-id> <analysis-id>");
  }
  const response = await createDefaultAnalysisService({ rootDir: projectRoot })
    .cancel(projectId, analysisJobId);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
