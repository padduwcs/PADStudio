import { importProjectInput } from "../resources/project-importer.js";
import { resolveProjectRoot } from "../config/project-root.js";

const projectRoot = resolveProjectRoot();

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
