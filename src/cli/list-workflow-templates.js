import { WorkflowTemplateCatalog } from "../intelligence/workflow-template-catalog.js";

async function main(args) {
  if (args.length) throw new Error("Usage: npm run workflow:list");
  process.stdout.write(JSON.stringify(await new WorkflowTemplateCatalog().list(), null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
