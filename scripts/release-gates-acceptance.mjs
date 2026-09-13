import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { evaluateReleaseGates } from "../src/release/release-gates.js";

const exec = promisify(execFile);

async function run(args, expectedCode) {
  try {
    const result = await exec(process.execPath, ["src/cli/release-gates.js", ...args], {
      cwd: process.cwd(), windowsHide: true, encoding: "utf8"
    });
    if (expectedCode !== 0) throw new Error(`Expected exit ${expectedCode}, received 0.`);
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.code !== expectedCode) throw error;
    return JSON.parse(error.stdout);
  }
}

const absent = await run([], 2);
const fixture = await run(["--evidence", "eval/release-gates/test-fixture-evidence.json"], 0);
if (absent.status !== "blocked" || absent.summary.notMeasured !== absent.summary.total || absent.releaseReady !== false) {
  throw new Error("Missing release evidence did not fail closed.");
}
if (fixture.status !== "fixture_passed" || fixture.summary.measuredPassed !== fixture.summary.total || fixture.releaseReady !== false) {
  throw new Error("Fixture did not verify all gates without claiming release readiness.");
}
const manifest = JSON.parse(await readFile("eval/release-gates/manifest.json", "utf8"));
const fixtureDocument = JSON.parse(await readFile("eval/release-gates/test-fixture-evidence.json", "utf8"));
const falsified = structuredClone(fixtureDocument);
falsified.measurements.find((entry) => entry.gateId === "asr_cer_and_timing_thresholds").metrics.cleanCer = -1;
delete falsified.measurements.find((entry) => entry.gateId === "landscape_source").metrics.endToEndCompleted;
delete falsified.measurements.find((entry) => entry.gateId === "human_viewing_review").attestation;
const rejected = evaluateReleaseGates(manifest, falsified);
if (rejected.status !== "blocked"
  || rejected.gates.find((entry) => entry.id === "asr_cer_and_timing_thresholds").status !== "invalid"
  || rejected.gates.find((entry) => entry.id === "landscape_source").status !== "invalid"
  || rejected.gates.find((entry) => entry.id === "human_viewing_review").status !== "invalid") {
  throw new Error("Evaluator trusted declared outcomes instead of measured requirements.");
}
process.stdout.write(JSON.stringify({
  version: "1.0",
  status: "passed_with_documented_limits",
  checks: {
    missingEvidence: { status: absent.status, notMeasured: absent.summary.notMeasured },
    fixtureMechanics: { status: fixture.status, measuredPassed: fixture.summary.measuredPassed },
    falsifiedPasses: { status: rejected.status, invalid: rejected.summary.invalid }
  },
  releaseDefault: null,
  releaseReady: false,
  limits: [
    "This acceptance uses synthetic fixture evidence and does not measure a release corpus.",
    "The owner vertical development corpus is declared non-holdout.",
    "Human viewing and listening remain not_measured until durable human attestations are supplied."
  ]
}, null, 2) + "\n");
