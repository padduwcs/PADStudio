import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureLimit = 8 * 1024 * 1024;

function argumentsFrom(argv) {
  const options = { reportPath: "reports/phase3-tts-acceptance.json" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") options.reportPath = argv[++index];
    else throw new Error(`Tham số không được hỗ trợ: ${argv[index]}`);
  }
  if (!options.reportPath) throw new Error("--report cần đường dẫn.");
  return options;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const append = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > captureLimit) {
        child.kill();
        reject(new Error("Output tiến trình vượt giới hạn acceptance."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun({
      code,
      signal,
      durationMs: Date.now() - started,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
}

function requireSuccess(label, result) {
  if (result.code === 0) return result;
  throw new Error(`${label} thất bại (exit ${result.code}):\n${(result.stderr || result.stdout).slice(-4000)}`);
}

function parseJson(label, text) {
  try {
    return JSON.parse(text.trim());
  } catch (error) {
    throw new Error(`${label} không trả JSON hợp lệ: ${error.message}`);
  }
}

function tapCount(tap, label) {
  return Number(tap.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? 0);
}

function safeReportPath(path) {
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (isAbsolute(relation) || relation.startsWith("..")) {
    throw new Error("Từ chối ghi report ngoài repository.");
  }
  return target;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const tests = requireSuccess("TTS integration tests", await run(process.execPath, [
    "--test", "--test-reporter=tap", "test/tts-tools.test.js"
  ]));
  const registryRun = requireSuccess("tool registry", await run(process.execPath, [
    "src/cli/list-tools.js"
  ]));
  const registry = parseJson("tool registry", registryRun.stdout);
  const capability = registry.capabilities.find((entry) => entry.id === "tts.synthesize");
  if (!capability || capability.tools.length !== 2) {
    throw new Error("Registry phải công bố đúng hai TTS backend.");
  }
  const tools = Object.fromEntries(capability.tools.map((tool) => [
    tool.name,
    {
      version: tool.version,
      runtime: tool.runtime,
      approvalRequired: tool.approvalRequired,
      availability: tool.availability
    }
  ]));
  if (!tools["piper-local"] || !tools.elevenlabs) {
    throw new Error("Registry thiếu Piper hoặc ElevenLabs.");
  }
  if (tools["piper-local"].approvalRequired || !tools.elevenlabs.approvalRequired) {
    throw new Error("TTS approval policy không đúng contract.");
  }

  const report = {
    version: "1.0",
    phase: 3,
    package: "tts",
    status: tools["piper-local"].availability.status === "available"
      ? "passed"
      : "passed_with_environment_limits",
    scope: "contract_integration_and_local_readiness",
    startedAt,
    completedAt: new Date().toISOString(),
    automatedVerification: {
      tests: {
        status: "passed",
        tests: tapCount(tests.stdout, "tests"),
        passed: tapCount(tests.stdout, "pass"),
        failed: tapCount(tests.stdout, "fail"),
        durationMs: tests.durationMs
      },
      registry: {
        status: "passed",
        capability: "tts.synthesize",
        available: capability.available,
        durationMs: registryRun.durationMs
      }
    },
    environment: { tools },
    acceptanceMatrix: [
      { id: "shared-contract", status: "passed", evidence: "Piper and ElevenLabs share explicit tts.synthesize without fallback." },
      { id: "local-result", status: "passed", evidence: "Piper integration produces verified reusable WAV Results in automated tests." },
      { id: "paid-authorization", status: "passed", evidence: "ElevenLabs is bound to an exact single-use credit authorization." },
      { id: "paid-recovery", status: "passed", evidence: "Receipt-first recovery is idempotent and never repeats the provider POST." },
      { id: "secret-handling", status: "passed", evidence: "Credentials are local-only and absent from project records and CLI output." }
    ],
    limits: [
      "This gate does not submit a paid provider request.",
      "Automated provider responses are simulated; current provider catalog, quota and voice quality require a configured account.",
      "A real Piper sample must still be listened to and reviewed in a project before claiming creative voice quality."
    ]
  };

  const target = safeReportPath(options.reportPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    version: "1.0",
    status: "failed",
    error: error?.message || String(error)
  }, null, 2) + "\n");
  process.exitCode = 1;
});
