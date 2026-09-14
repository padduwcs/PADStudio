import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { assembleReleaseEvidence, selectLatestHumanAttestation } from "../release/release-evidence-assembler.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");
async function main(args) {
  const [projectId, baseSource, holdoutSource, resultId] = args;
  if (!projectId || !baseSource || !holdoutSource || args.length > 4) throw new Error("Usage: npm run release:evidence:assemble -- <project-id> <base-evidence-json|file|-> <locked-holdout-json|file> [result-id]");
  const store = new ProjectStore(root);
  const [baseEvidence, holdoutBundle, context] = await Promise.all([readJsonInput(baseSource), readJsonInput(holdoutSource), store.readContext(projectId)]);
  const human = selectLatestHumanAttestation(context.reviews, { resultId });
  if (!human) throw new Error("No matching full human attestation was found.");
  const exact = await store.verifyResultFile(projectId, human.target.id, "primary");
  const evidence = assembleReleaseEvidence({ baseEvidence, holdoutBundle, reviews: context.reviews, resultId, verifiedResult: { id: human.target.id, sha256: exact.sha256 } });
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
