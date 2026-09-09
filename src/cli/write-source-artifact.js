import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analysisFingerprint } from "../analysis/source-identity.js";
import { ProjectStore } from "../project/project-store.js";
import {
  SOURCE_ASSESSMENT_TYPE,
  SOURCE_PROFILE_TYPE,
  TRANSCRIPT_EDIT_TYPE
} from "../intelligence/source-artifacts.js";
import { readJsonInput } from "./json-input.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..", "..", ".padstudio", "projects");
const TYPES = new Set([SOURCE_PROFILE_TYPE, SOURCE_ASSESSMENT_TYPE, TRANSCRIPT_EDIT_TYPE]);

function defaultKey(type, data) {
  const source = data.sourceKey.slice(0, 24);
  if (type === SOURCE_PROFILE_TYPE) return "source-profile-" + source;
  if (type === TRANSCRIPT_EDIT_TYPE) return "source-transcript-edit-" + source;
  return "source-assessment-" + source + "-" + analysisFingerprint(data.purpose).slice(0, 8);
}

async function main(args) {
  const [type, projectId, source] = args;
  if (!TYPES.has(type) || !projectId || !source || args.length !== 3) {
    throw new Error("Usage: write-source-artifact <type> <project-id> <json|->");
  }
  const value = await readJsonInput(source);
  if (value.type !== undefined && value.type !== type) throw new Error("Artifact type does not match command.");
  if (!value.data?.sourceKey) throw new Error("Artifact data.sourceKey is required.");
  const store = new ProjectStore(projectRoot);
  const artifact = await store.recordArtifact(projectId, {
    ...value,
    key: value.key ?? defaultKey(type, value.data),
    type
  });
  process.stdout.write(JSON.stringify({ artifact }, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write((error.message || String(error)) + "\n");
  process.exitCode = 1;
});
