import { createDefaultAnalysisService } from "../analysis/default-analysis-service.js";
import { analysisExitCode } from "./analysis-exit-code.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, analysisJobId] = args;
  if (!projectId || !analysisJobId || args.length !== 2) {
    throw new Error("Cách dùng: npm run analysis:resume -- <project-id> <analysis-id>");
  }
  const response = await createDefaultAnalysisService({ rootDir: projectRoot })
    .resume(projectId, analysisJobId);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  process.exitCode = analysisExitCode(response);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
