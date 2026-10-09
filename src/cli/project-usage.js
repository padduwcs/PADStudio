import { ProjectStore } from "../project/project-store.js";
import { analyzeProjectStorage, formatBytes } from "../operations/project-storage.js";
import { resolveProjectRoot } from "../config/project-root.js";

const USAGE = "Cách dùng: npm run project:usage -- <project-id> [--full] | --all";

function summarizeProject(report) {
  const outputs = report.areas.outputs;
  return {
    projectId: report.projectId,
    totalBytes: report.totalBytes,
    total: formatBytes(report.totalBytes),
    registered: formatBytes(outputs.registeredBytes),
    unregistered: formatBytes(outputs.unregisteredBytes),
    inputs: formatBytes(report.areas.inputs.bytes),
    reclaimableBytes: report.reclaimable.unregisteredBytes
  };
}

async function main(args) {
  const store = new ProjectStore(resolveProjectRoot());
  const all = args.includes("--all");
  const full = args.includes("--full");
  const rest = args.filter((arg) => arg !== "--all" && arg !== "--full");
  if (rest.some((arg) => arg.startsWith("-")) || (all && (rest.length || full)) || (!all && rest.length !== 1)) {
    throw new Error(USAGE);
  }

  if (all) {
    const projects = await store.listProjects();
    const rows = [];
    for (const project of projects) rows.push(summarizeProject(await analyzeProjectStorage(store, project.id)));
    rows.sort((left, right) => right.totalBytes - left.totalBytes);
    const totalBytes = rows.reduce((sum, row) => sum + row.totalBytes, 0);
    const reclaimableBytes = rows.reduce((sum, row) => sum + row.reclaimableBytes, 0);
    process.stdout.write(JSON.stringify({
      version: "1.0",
      projects: rows.length,
      total: formatBytes(totalBytes),
      reclaimable: formatBytes(reclaimableBytes),
      note: "Reclaimable bytes are files in completed Run outputs that no Result registers. Remove them with project:prune.",
      rows
    }, null, 2) + "\n");
    return;
  }

  const report = await analyzeProjectStorage(store, rest[0]);
  const outputs = report.areas.outputs;
  const view = {
    version: report.version,
    projectId: report.projectId,
    generatedAt: report.generatedAt,
    total: formatBytes(report.totalBytes),
    totalBytes: report.totalBytes,
    areas: {
      inputs: { bytes: report.areas.inputs.bytes, human: formatBytes(report.areas.inputs.bytes), files: report.areas.inputs.files },
      records: { bytes: report.areas.records.bytes, human: formatBytes(report.areas.records.bytes), files: report.areas.records.files },
      analysis: { bytes: report.areas.analysis.bytes, human: formatBytes(report.areas.analysis.bytes), files: report.areas.analysis.files },
      outputs: {
        bytes: outputs.bytes, human: formatBytes(outputs.bytes),
        registered: formatBytes(outputs.registeredBytes),
        unregistered: formatBytes(outputs.unregisteredBytes),
        orphan: formatBytes(outputs.orphanBytes),
        temporary: formatBytes(outputs.temporaryBytes)
      }
    },
    reclaimable: {
      bytes: report.reclaimable.unregisteredBytes,
      human: formatBytes(report.reclaimable.unregisteredBytes),
      runs: report.reclaimable.unregisteredRuns,
      how: "npm run project:prune -- " + report.projectId
    },
    orphans: report.orphans,
    temporary: report.temporary,
    runs: (full ? report.runs : report.runs.slice(0, 10)).map((run) => ({
      runId: run.runId,
      capability: run.capability,
      resultTypes: run.resultTypes,
      registered: formatBytes(run.registeredBytes),
      unregistered: formatBytes(run.unregisteredBytes),
      ...(full ? { unregisteredEntries: run.unregisteredEntries } : {})
    })),
    ...(!full && report.runs.length > 10 ? { runsOmitted: report.runs.length - 10, runsNote: "Dùng --full để xem mọi Run." } : {})
  };
  process.stdout.write(JSON.stringify(view, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
