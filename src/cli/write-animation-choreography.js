import { ANIMATION_CHOREOGRAPHY_TYPE, choreographyRepeatedBeatText } from "../animation/visual-choreography.js";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { resolveProjectRoot } from "../config/project-root.js";

const root = resolveProjectRoot();

async function main(args) {
  if (args.length !== 2) throw new Error("Usage: npm run project:choreography -- <project-id> <json-file|->");
  const value = await readJsonInput(args[1]);
  if (value.type !== undefined && value.type !== ANIMATION_CHOREOGRAPHY_TYPE) {
    throw new Error("Expected animation.choreography.");
  }
  const artifact = await new ProjectStore(root).recordArtifact(args[0], { ...value, type: ANIMATION_CHOREOGRAPHY_TYPE });
  process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
  for (const repeat of choreographyRepeatedBeatText(artifact.data) ?? []) {
    process.stderr.write(`Note: ${repeat.field} is the same sentence in ${repeat.beatIds.length} beats (${repeat.beatIds.join(", ")}). `
      + "Say what each beat carries, changes or frames; a rule for every beat belongs in direction or presentation.\n");
  }
}

main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
