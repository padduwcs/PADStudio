import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../src/project/project-store.js";

// The CLI is the contract an Agent actually uses: argument parsing, exit codes and the trust gates behind
// `project:accept`. These tests run the real entry points against a throwaway project root.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(root, script, args = [], { input } = {}) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [join(repository, "src", "cli", script), ...args], {
      cwd: repository,
      env: { ...process.env, PADSTUDIO_PROJECT_ROOT: root },
      windowsHide: true
    }, (error, stdout, stderr) => resolveRun({ code: error ? error.code ?? 1 : 0, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "padstudio-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.createProject({ projectId: "demo", title: "Demo" });
  const artifact = await store.recordArtifact("demo", {
    key: "film", type: "video.sequence", name: "Film", summary: "Exact acceptance target", status: "active", createdBy: "agent",
    data: {
      version: "1.0", changeReason: "test", format: { width: 320, height: 180, fps: 25 },
      segments: [{ id: "one", title: "One", intent: "Test", durationSeconds: 1, visual: null, narration: null, captions: [], references: [] }]
    }
  });
  const run = await store.startRun("demo", { capability: "video.render-sequence", purpose: "test", tool: { name: "fixture", version: "1", provider: "test" } });
  const workspace = await store.createRunOutputWorkspace("demo", run.id);
  await writeFile(join(workspace.temporaryDirectory, "preview.mp4"), "exact-render");
  await store.commitRunOutputWorkspace(workspace);
  const result = await store.addResult("demo", {
    runId: run.id, capability: "video.render-sequence", tool: run.tool, type: "video.sequence-render", name: "Preview",
    inputArtifacts: [artifact.id],
    files: [{ id: "primary", role: "primary", path: `${workspace.projectRelativeDirectory}/preview.mp4`, name: "preview.mp4", mediaType: "video", sizeBytes: 12 }],
    data: { sequence: { artifactId: artifact.id, revision: artifact.revision, key: "film" }, durationSeconds: 1 },
    verification: { status: "passed", checks: ["fixture"] }
  });
  return { root, store, artifact, result };
}

test("project:accept records the agent-host channel, resolves same-sequence feedback and rejects bad calls", async (t) => {
  const { root, store, artifact, result } = await fixture(t);

  for (const args of [[], ["demo"], ["demo", result.id, "--unknown"], ["demo", result.id, "--from-agent-host", "--from-agent-host"]]) {
    const failed = await runCli(root, "confirm-video-acceptance.js", args);
    assert.equal(failed.code, 1, args.join(" "));
    assert.match(failed.stderr, /Usage: npm run project:accept/, args.join(" "));
  }
  const notRender = await runCli(root, "confirm-video-acceptance.js", ["demo", artifact.id, "--from-agent-host"]);
  assert.equal(notRender.code, 1);
  assert.match(notRender.stderr, /exact video\.sequence-render Result/);

  // Without --from-agent-host the command needs a person at a terminal; a pipe or an Agent is refused and nothing is recorded.
  const piped = await runCli(root, "confirm-video-acceptance.js", ["demo", result.id], { input: "WATCHED-LISTENED-ACCEPT\n" });
  assert.equal(piped.code, 1);
  assert.match(piped.stderr, /interactive terminal/);
  assert.deepEqual(await store.readDecisions("demo"), []);

  const feedback = await store.recordDecision("demo", {
    resultId: result.id, outcome: "changes_requested", note: "Shorten the opening.",
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision }
  });
  const accepted = await runCli(root, "confirm-video-acceptance.js", ["demo", result.id, "--from-agent-host"]);
  assert.equal(accepted.code, 0, accepted.stderr);
  const output = JSON.parse(accepted.stdout);
  assert.equal(output.mode, "agent_host");
  assert.equal(output.deliveryMode, "preserve_exact_source");
  assert.equal(output.review, null);
  assert.equal(output.decision.outcome, "accepted");
  assert.equal(output.decision.confirmation.channel, "agent_host");
  assert.deepEqual(output.decision.resolvesDecisionIds, [feedback.id]);

  const decisions = await store.readDecisions("demo");
  assert.equal(decisions.at(-1).id, output.decision.id);
  assert.equal(decisions.at(-1).resultId, result.id);
});

test("project:decide refuses privileged and retired decisions; project:attest takes no claims", async (t) => {
  const { root, store, artifact, result } = await fixture(t);
  const decide = (value) => runCli(root, "record-project-decision.js", ["demo", "-"], { input: JSON.stringify(value) });

  const usage = await runCli(root, "record-project-decision.js", ["demo"]);
  assert.equal(usage.code, 1);
  assert.match(usage.stderr, /Cách dùng/);

  const finalAcceptance = await decide({ resultId: result.id, outcome: "accepted", note: "Agent-authored JSON" });
  assert.equal(finalAcceptance.code, 1);
  assert.match(finalAcceptance.stderr, /project:accept/);

  const retired = await decide({
    target: { kind: "artifact", id: artifact.id }, category: "animation_code_execution", outcome: "approved", decidedBy: "user", note: "run it"
  });
  assert.equal(retired.code, 1);
  assert.match(retired.stderr, /retired decision category/);
  assert.deepEqual(await store.readDecisions("demo"), []);

  const feedback = await decide({
    resultId: result.id, outcome: "changes_requested", note: "Slow the ending.",
    feedbackTarget: { artifactId: artifact.id, revision: artifact.revision }
  });
  assert.equal(feedback.code, 0, feedback.stderr);
  assert.equal(JSON.parse(feedback.stdout).outcome, "changes_requested");

  const attest = await runCli(root, "record-human-attestation.js", ["demo", "-"], { input: "{}" });
  assert.equal(attest.code, 1);
  assert.match(attest.stderr, /project:accept/);
});

test("project:finish only plans by default, refuses a project without Delivery and rejects ambiguous arguments", async (t) => {
  const { root, result } = await fixture(t);
  const before = await readdir(join(root, "demo"));

  for (const args of [[], ["demo", "--all"], ["--apply"], ["demo", "other"], ["demo", "--bogus"]]) {
    const failed = await runCli(root, "project-finish.js", args);
    assert.equal(failed.code, 1, args.join(" "));
    assert.match(failed.stderr, /Cách dùng: npm run project:finish/, args.join(" "));
  }

  const plan = await runCli(root, "project-finish.js", ["demo"]);
  assert.equal(plan.code, 2);
  assert.equal(JSON.parse(plan.stdout).reason, "no_delivery");
  const apply = await runCli(root, "project-finish.js", ["demo", "--apply"]);
  assert.equal(apply.code, 2);
  assert.equal(JSON.parse(apply.stdout).reason, "no_delivery");

  const all = await runCli(root, "project-finish.js", ["--all"]);
  const summary = JSON.parse(all.stdout);
  assert.equal(summary.mode, "plan");
  assert.deepEqual(summary.rows, [{ projectId: "demo", status: "not_finishable", reason: "no_delivery" }]);

  // Nothing was released: the render the user would watch is still on disk and no release ledger exists.
  assert.deepEqual((await readdir(join(root, "demo"))).sort(), before.sort());
  const store = new ProjectStore(root);
  assert.equal((await store.readResult("demo", result.id)).files[0].available, true);
});

test("run, resume and workflow CLIs fail with a message and exit code 1 on bad input", async (t) => {
  const { root } = await fixture(t);

  const runUsage = await runCli(root, "run-tool.js", ["demo"]);
  assert.equal(runUsage.code, 1);
  assert.match(runUsage.stderr, /tool:run/);

  const unknownTool = await runCli(root, "run-tool.js", ["demo", "-"], {
    input: JSON.stringify({ capability: "video.trim", tool: "no-such-tool", purpose: "test", inputs: {} })
  });
  assert.equal(unknownTool.code, 1);
  assert.notEqual(unknownTool.stderr.trim(), "");

  const notJson = await runCli(root, "run-tool.js", ["demo", "-"], { input: "{not json" });
  assert.equal(notJson.code, 1);

  const resumeUsage = await runCli(root, "read-project-resume.js", []);
  assert.equal(resumeUsage.code, 1);
  assert.match(resumeUsage.stderr, /Usage: npm run project:resume/);
  const missing = await runCli(root, "read-project-resume.js", ["does-not-exist"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /does-not-exist/);

  const resume = await runCli(root, "read-project-resume.js", ["demo"]);
  assert.equal(resume.code, 0, resume.stderr);
  assert.equal(JSON.parse(resume.stdout).project.id, "demo");
});
