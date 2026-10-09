import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultSkillCatalog } from "../intelligence/skill-catalog.js";
import { resolveProjectRoot } from "../config/project-root.js";

const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(args) {
  const [skillId, projectId] = args;
  if (!skillId || args.length > 2) throw new Error("Usage: npm run skill:read -- <skill-id> [project-id]");
  const projectRoot = projectId ? join(resolveProjectRoot(), projectId) : undefined;
  const skill = await createDefaultSkillCatalog({ applicationRoot, projectRoot }).read(skillId);
  process.stdout.write(JSON.stringify(skill, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
