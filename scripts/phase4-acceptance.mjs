import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPadStudioServer } from "../src/web/server.js";
import { ProjectReader } from "../src/web/project-reader.js";
import { locatePilotFixture } from "./lib/pilot-fixture.mjs";
import { resolve } from "node:path";
const exec = promisify(execFile);
const report = { version: "1.0", phase: 4, checkedAt: new Date().toISOString(), status: "incomplete", checks: {}, limits: ["User approval applies only to the exact recorded Result.", "Animation is preset-based; no general keyframe editor.", "Local fonts can differ between machines.", "Synthetic media tests do not certify arbitrary long or complex productions."] };
const logDir = resolve(".cache/phase4-acceptance"); await mkdir(logDir, { recursive: true });
async function run(name, command, args) {
  try {
    const r = await exec(command, args, { windowsHide: true, encoding: "utf8", maxBuffer: 8e6, timeout: 180000 });
    await writeFile(resolve(logDir, name + ".txt"), r.stdout + r.stderr);
    report.checks[name] = { status: "passed", output: (r.stdout + r.stderr).slice(-900) };
    console.log(name + ": passed");
  } catch (e) {
    await writeFile(resolve(logDir, name + ".txt"), (e.stdout ?? "") + (e.stderr ?? ""));
    report.checks[name] = { status: "failed", error: e.message }; throw e;
  }
}
let server;
try {
  await run("repository", process.execPath, ["--test"]);
  await run("analysis-harness", process.execPath, ["scripts/source-eval.mjs", "test"]);
  const pilot = JSON.parse(await readFile("reports/phase4-pilot.json", "utf8"));
  const fixture = await locatePilotFixture(pilot.projectId);
  const reader = new ProjectReader(fixture.root);
  const context = await reader.readProject(pilot.projectId);
  const result = context.results.find((entry) => entry.id === pilot.resultId);
  const artifact = context.artifacts.find((entry) => entry.id === pilot.artifactId);
  const direction = context.artifacts.find((entry) => entry.id === pilot.creativeDirectionArtifactId);
  const graphic = context.results.find((entry) => entry.id === pilot.graphicResultId);
  const narration = context.results.find((entry) => entry.id === pilot.narrationResultId);
  const parent = context.artifacts.find((entry) => entry.id === artifact?.supersedes);
  const currentSequences = context.production.sequences.filter((sequence) => sequence.role === "current");
  const activeDirection = context.intelligence.activeArtifacts.some((entry) => entry.id === direction?.id);
  const obsolete = context.artifacts.filter((entry) => entry.key === "phase4-piper-revision").sort((a, b) => a.revision - b.revision).at(-1);
  const audio = result?.verification?.details?.audioMeasurement;
  const [opening, card] = artifact?.data.segments ?? [];
  const latestDecision = context.decisions.filter((decision) => decision.resultId === result?.id).at(-1);
  const failures = [
    [result?.files.some((file) => file.id === "primary" && file.available), "Pilot result not available."],
    [artifact?.key === "pilot-preview" && artifact.status === "active", "Pilot is not the active canonical chain."],
    [parent?.key === artifact?.key && parent.revision === artifact.revision - 1, "Pilot did not continue the expected revision chain."],
    [currentSequences.length === 1 && currentSequences[0].artifactId === artifact?.id, "Project must have exactly one current sequence."],
    [obsolete?.status === "retired", "Mistaken parallel sequence branch was not retired."],
    [activeDirection && direction?.data.sample?.durationSeconds === 12, "Creative direction does not require 12 seconds."],
    [Math.abs((result?.data.durationSeconds ?? 0) - 12) <= 0.05, "Pilot duration does not match the 12-second direction."],
    [result?.data.sequenceRole === "current" && result?.data.historical === false, "Result is not marked as the current sequence render."],
    [opening?.durationSeconds === 8 && opening.visual?.volume === 0 && opening.visual.volumeRanges?.length === 1 &&
      opening.visual.volumeRanges[0].startSeconds === 4 && opening.visual.volumeRanges[0].endSeconds === 8 &&
      opening.visual.volumeRanges[0].volume > 0 && opening.narration?.offsetSeconds === 0,
    "Opening does not separate Piper narration from source audio as specified."],
    [card?.durationSeconds === 4 && card.narration?.source?.id === narration?.id && card.visual?.source?.id === graphic?.id,
      "Concept card is not bound to its explicit graphic and Piper narration."],
    [Number.isFinite(audio?.tailSilenceSeconds) && audio.tailSilenceSeconds <= 0.75, "Pilot has an excessive silent tail."],
    [graphic?.tool.name === "browser-graphic" && graphic.data.graphic.footer === "Pilot local • Đợt 4" && graphic.data.graphic.body.includes("\n"), "Graphic typography/footer contract failed."],
    [narration?.tool.name === "piper-local" && narration.data.durationSeconds <= 4.03, "Closing narration is not a fitting local Piper result."],
    [[graphic?.tool.provider, narration?.tool.provider, result?.tool.provider].every((provider) => ["Local browser", "Piper", "FFmpeg"].includes(provider)), "Pilot used an unexpected provider."],
    [latestDecision?.outcome === "accepted" && latestDecision.decidedBy === "user", "Exact pilot Result does not have current user acceptance."],
    [pilot.paidProviderCalls === 0 && pilot.userApproval === true, "Pilot report misstates cost or approval."],
  ].filter(([passed]) => !passed).map(([, message]) => message);
  if (failures.length) {
    report.checks["pilot-contract"] = { status: "failed", failures };
    throw new Error(failures.join(" "));
  }
  report.checks["pilot-contract"] = { status: "passed", sequence: `pilot-preview r${artifact.revision}`, durationSeconds: result.data.durationSeconds,
    currentSequenceCount: currentSequences.length, tailSilenceSeconds: audio.tailSilenceSeconds, providers: [graphic.tool.provider, narration.tool.provider, result.tool.provider] };
  server = createPadStudioServer({ reader });
  await new Promise((ok, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ok); });
  await run("browser", process.execPath, ["scripts/ui-smoke.mjs", "--project", pilot.projectId, "--url", `http://127.0.0.1:${server.address().port}`]);
  report.pilot = { projectId: pilot.projectId, artifactId: pilot.artifactId, resultId: pilot.resultId,
    fixtureStore: fixture.name,
    sequenceKey: artifact.key, sequenceRevision: artifact.revision, durationSeconds: result.data.durationSeconds,
    tailSilenceSeconds: audio.tailSilenceSeconds, currentSequenceCount: currentSequences.length, paidProviderCalls: 0, userApproval: true,
    decisionId: latestDecision.id };
  report.status = "passed_with_documented_limits";
} catch (e) { report.status = "failed"; report.error = e.message; process.exitCode = 1; }
finally {
  if (server) { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); }
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase4-production-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report.status);
}
