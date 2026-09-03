import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importProjectInput } from "../resources/project-importer.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");

async function main(args) {
  const [projectId, sourcePath] = args;
  if (!projectId || !sourcePath || args.length !== 2) {
    throw new Error("Cách dùng: npm run project:import -- <project-id> <file-hoặc-folder-nguồn>");
  }

  const result = await importProjectInput({ rootDir: projectRoot, projectId, sourcePath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
