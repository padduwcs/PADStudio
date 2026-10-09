// A node:test reporter for GitHub Actions: every failing test becomes an `::error` annotation. Annotations show
// on the run page and through the public API, so a failure is readable without downloading the job log (which
// GitHub only serves to repository admins). The workflow runs it next to the normal spec reporter:
//
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//               --test-reporter=./scripts/lib/github-test-reporter.mjs --test-reporter-destination=stdout
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE_LINES = 12;

// GitHub workflow-command escaping: data escapes %, CR and LF; properties also escape ":" and ",".
export function escapeData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function repositoryPath(file) {
  if (!file) return null;
  const path = file.startsWith("file:") ? fileURLToPath(file) : file;
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function failureText(error) {
  const cause = error?.cause ?? error;
  const text = cause?.message ?? cause?.stack ?? String(cause ?? "failed");
  return String(text).split(/\r?\n/).slice(0, MAX_MESSAGE_LINES).join("\n");
}

export function annotationFor(data) {
  const file = repositoryPath(data.file);
  const properties = file ? [`file=${escapeProperty(file)}`, `line=${Number.isInteger(data.line) ? data.line : 1}`] : [];
  properties.push(`title=${escapeProperty("Test failed: " + data.name)}`);
  return `::error ${properties.join(",")}::${escapeData(failureText(data.details?.error))}\n`;
}

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    // A failing test also fails its parent suite and file; annotate the test itself, not every ancestor.
    if (event.type === "test:fail" && event.data.details?.type !== "suite") yield annotationFor(event.data);
  }
}
