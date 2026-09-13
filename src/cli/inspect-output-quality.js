import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultOutputQualityService } from "../quality/output-quality-service.js";
import { readJsonInput } from "./json-input.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, requestSource] = args;
  if (!projectId || !requestSource || args.length !== 2) {
    throw new Error("Cách dùng: <request-json> | npm run quality:inspect -- <project-id> - hoặc <file-request-json>");
  }
  const request = await readJsonInput(requestSource);
  const response = await createDefaultOutputQualityService({ rootDir: projectRoot }).inspect(projectId, request);
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  if (response.result?.data?.gate?.deliveryEligible !== true) process.exitCode = 2;
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
