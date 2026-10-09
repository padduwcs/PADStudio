import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultSkillCatalog } from "../intelligence/skill-catalog.js";
import { resolveProjectRoot } from "../config/project-root.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(args) {
  const [projectId] = args;
  if (args.length > 1) throw new Error("Usage: npm run skill:list -- [project-id]");
  const projectRoot = projectId ? join(resolveProjectRoot(), projectId) : undefined;
  const skills = await createDefaultSkillCatalog({ applicationRoot, projectRoot }).listPublic();
  process.stdout.write(JSON.stringify(skills, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
