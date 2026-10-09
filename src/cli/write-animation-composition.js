import { ANIMATION_COMPOSITION_TYPE } from "../animation/animation-composition.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const root = resolveProjectRoot();

async function main(args) {
  if (args.length !== 2) throw new Error("Usage: npm run project:animation -- <project-id> <json-file|->");
  const value = await readJsonInput(args[1]);
  if (value.type !== undefined && value.type !== ANIMATION_COMPOSITION_TYPE) throw new Error("Expected animation.composition.");
  const artifact = await new ProjectStore(root).recordArtifact(args[0], { ...value, type: ANIMATION_COMPOSITION_TYPE });
  process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
