import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = join(applicationRoot, ".padstudio", "projects");

async function main(args) {
  const [projectId, source] = args;
  if (!projectId || !source || args.length !== 2) {
    throw new Error("Usage: <review-json> | npm run project:review -- <project-id> - or <file-json>");
  }
  const review = await new ProjectStore(projectRoot).recordReview(projectId, await readJsonInput(source));
  process.stdout.write(JSON.stringify(review, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
