import { createDefaultAnalysisService } from "../analysis/default-analysis-service.js";
import { analysisExitCode } from "./analysis-exit-code.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

async function main(args) {
  const [projectId, requestSource] = args;
  if (!projectId || !requestSource || args.length !== 2) {
    throw new Error("Cách dùng: <request-json> | npm run project:analyze -- <project-id> - hoặc <file-request-json>");
  }
  const request = await readJsonInput(requestSource);
  const response = await createDefaultAnalysisService({ rootDir: projectRoot })
    .createAndRun(projectId, request);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  process.exitCode = analysisExitCode(response);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
