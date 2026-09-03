import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, title] = args;
  if (!projectId || !title || args.length !== 2) {
    throw new Error("Cách dùng: npm run project:create -- <project-id> <tiêu-đề>");
  }
  const project = await new ProjectStore(projectRoot).createProject({ projectId, title });
  process.stdout.write(`${JSON.stringify(project)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
