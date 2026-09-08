import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../project/project-store.js";
import { readJsonInput } from "./json-input.js";
import { SEQUENCE_TYPE } from "../production/video-sequence.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".padstudio", "projects");
async function main(args) {
  if (args.length !== 2) throw new Error("Usage: npm run project:sequence -- <project-id> <json-file|->");
  const value = await readJsonInput(args[1]);
  if (value.type !== undefined && value.type !== SEQUENCE_TYPE) throw new Error("Expected video.sequence.");
  const artifact = await new ProjectStore(root).recordArtifact(args[0], { ...value, type: SEQUENCE_TYPE });
  process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
}
main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
