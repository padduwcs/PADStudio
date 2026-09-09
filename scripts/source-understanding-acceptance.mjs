import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CAPTURE_BYTES = 24 * 1024 * 1024;

function parseArguments(argv) {
  const options = { browserProject: null, reportPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--browser-project") options.browserProject = argv[++index];
    else if (argument === "--report") options.reportPath = argv[++index];
    else throw new Error(`Tham số không được hỗ trợ: ${argument}`);
  }
  if (options.browserProject !== null && !/^[a-z0-9][a-z0-9._-]*$/i.test(options.browserProject ?? "")) {
    throw new Error("--browser-project phải là project id hợp lệ.");
  }
  return options;
}

function appendCapture(state, chunk) {
  const value = Buffer.from(chunk);
  if (state.bytes + value.length > MAX_CAPTURE_BYTES) {
    throw new Error(`Output tiến trình vượt ${MAX_CAPTURE_BYTES} bytes.`);
  }
  state.bytes += value.length;
  state.chunks.push(value);
}

function run(command, args, { env = process.env } = {}) {
  return new Promise((resolveRun, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = { bytes: 0, chunks: [] };
    const stderr = { bytes: 0, chunks: [] };
    child.stdout.on("data", (chunk) => appendCapture(stdout, chunk));
    child.stderr.on("data", (chunk) => appendCapture(stderr, chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolveRun({
      code,
      signal,
      durationMs: Date.now() - startedAt,
      stdout: Buffer.concat(stdout.chunks).toString("utf8"),
      stderr: Buffer.concat(stderr.chunks).toString("utf8")
    }));
  });
}

function requireSuccess(label, result) {
  if (result.code === 0) return result;
  const detail = (result.stderr || result.stdout).trim().slice(-4000);
  throw new Error(`${label} thất bại (exit ${result.code}, signal ${result.signal ?? "none"}):\n${detail}`);
}

function parseJsonOutput(label, output) {
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    throw new Error(`${label} không trả JSON hợp lệ: ${error.message}`);
  }
}

function testNamesFromTap(output) {
  return [...output.matchAll(/^\s*ok\s+\d+\s+-\s+(.+)$/gm)].map((match) => match[1].trim());
}

function tapCount(output, name) {
  const match = output.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
  return match ? Number(match[1]) : null;
}

function assertTestEvidence(testNames, matrix) {
  const available = new Set(testNames);
  for (const item of matrix) {
    item.missingTests = item.tests.filter((name) => !available.has(name));
    item.status = item.missingTests.length === 0 ? "passed" : "failed";
  }
  const missing = matrix.flatMap((item) => item.missingTests.map((name) => `${item.id}: ${name}`));
  if (missing.length) throw new Error(`Acceptance evidence bị thiếu:\n${missing.join("\n")}`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Observer dừng sớm với exit ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/api/projects`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Observer không sẵn sàng trong 15 giây.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function browserAcceptance(projectId) {
  const verify = requireSuccess("analysis verify", await run(process.execPath, [
    "src/cli/verify-analysis.js", projectId
  ]));
  const verification = parseJsonOutput("analysis verify", verify.stdout);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["src/web/server.js"], {
    cwd: repositoryRoot,
    env: { ...process.env, PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString("utf8"); });
  try {
    await waitForServer(url, server);
    const browser = requireSuccess("browser acceptance", await run("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/source-observer-browser-smoke.ps1",
      "-Url", url,
      "-ProjectId", projectId
    ]));
    return {
      status: "passed",
      durationMs: browser.durationMs,
      verification: {
        resultCount: Object.keys(verification.results ?? {}).length,
        searchIndexRows: verification.searchIndex?.rowCount ?? null
      },
      ...parseJsonOutput("browser acceptance", browser.stdout)
    };
  } catch (error) {
    if (serverError.trim()) error.message += `\nObserver stderr:\n${serverError.trim()}`;
    throw error;
  } finally {
    await stopChild(server);
  }
}

function safeReportPath(path) {
  const target = resolve(repositoryRoot, path);
  const relation = relative(repositoryRoot, target);
  if (isAbsolute(relation) || relation.startsWith("..")) {
    throw new Error("Từ chối ghi report ngoài repository.");
  }
  return target;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = new Date();
  const repository = requireSuccess("repository tests", await run(process.execPath, [
    "--test", "--test-reporter=tap"
  ]));
  const testNames = testNamesFromTap(repository.stdout);
  const matrix = [
    {
      id: "project_round_trip",
      requirement: "Tạo/import, giữ danh tính và mở lại project/checkpoint.",
      tests: [
        "import preserves sources and records grouped resources and completed runs",
        "project identity and checkpoint survive reopening without temporary files"
      ]
    },
    {
      id: "analysis_lifecycle",
      requirement: "Run/Result, dependency, reuse và source identity đi qua lifecycle chung.",
      tests: [
        "analysis job persists source identity, attempt, Run and Result and reuses verified evidence",
        "requested operations include technical dependencies and bind downstream fingerprints to upstream Results"
      ]
    },
    {
      id: "cancel_resume_reconcile",
      requirement: "Cancel, resume và reconcile không làm mất hoặc chạy lặp Result durable.",
      tests: [
        "cancel persists intent, aborts the active unit and cancels pending units",
        "resume keeps an interrupted attempt and retries it with a new Run",
        "resume reconciles a durable Result after manifest persistence fails without rerunning tool"
      ]
    },
    {
      id: "runtime_and_dependency_failure",
      requirement: "Runtime thiếu hoặc dependency lỗi được báo blocked, không fallback ngầm.",
      tests: [
        "a blocked probe blocks dependent units without running them",
        "tool environment drift after planning fails without committing mismatched evidence"
      ]
    },
    {
      id: "freshness_and_tamper",
      requirement: "Source stale và evidence/index bị sửa được phát hiện, lịch sử được giữ.",
      tests: [
        "resume reruns evidence whose output checksum changed and preserves the historical Result",
        "resume rejects previously successful evidence after source bytes change",
        "verify reports stale managed source without rewriting historical Results",
        "verify reports missing source and dataset without rewriting historical Results"
      ]
    },
    {
      id: "range_pagination_result_sets",
      requirement: "Reader phân trang, range và nhiều Result set mà không tự chọn mơ hồ.",
      tests: [
        "reader streams paged transcript, verifies evidence, and searches Vietnamese text",
        "source workspace keeps profile and range result sets distinct and newest first"
      ]
    },
    {
      id: "legacy_capability_regression",
      requirement: "Các capability media và sequence cũ vẫn chạy end-to-end.",
      tests: [
        "image, concat, audio overlay and subtitle tools chain into one finished video",
        "video toolkit chains concat, reformat and thumbnail into a durable pipeline",
        "local production renders, reuses unchanged segments, preserves reviews and fails without output on invalid sources"
      ]
    }
  ];
  assertTestEvidence(testNames, matrix);

  const harness = requireSuccess("analysis harness tests", await run(process.execPath, [
    "scripts/source-eval.mjs", "test"
  ]));
  const harnessOutput = harness.stdout + "\n" + harness.stderr;
  const harnessCount = Number(harnessOutput.match(/Ran (\d+) tests/)?.[1] ?? 0);
  if (!harnessCount || !/\nOK\s*$/.test(harnessOutput)) {
    throw new Error("Không xác nhận được kết quả analysis harness.");
  }

  const doctorRun = requireSuccess("analysis doctor", await run(process.execPath, [
    "src/cli/analysis-doctor.js"
  ]));
  const doctor = parseJsonOutput("analysis doctor", doctorRun.stdout);
  if (doctor.status !== "ready" || doctor.capabilities?.some((item) => !item.available)) {
    throw new Error("Analysis doctor chưa ready cho mọi capability bắt buộc.");
  }

  const packageC = JSON.parse(await readFile(resolve(
    repositoryRoot,
    "eval/source-understanding/reports/2026-09-09/package-c-verification.json"
  ), "utf8"));
  const browser = options.browserProject
    ? await browserAcceptance(options.browserProject)
    : { status: "not_run", reason: "Truyền --browser-project để chạy browser acceptance trên project có preview/transcript." };

  const blocking = browser.status !== "passed";
  const report = {
    version: "1.0",
    package: "F",
    scope: "practical_owner_machine",
    status: blocking ? "incomplete" : "passed_with_documented_limits",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      practicalDefault: doctor.practicalDefault,
      releaseDefault: doctor.releaseDefault
    },
    automatedVerification: {
      repositoryTests: {
        status: "passed",
        tests: tapCount(repository.stdout, "tests") ?? testNames.length,
        passed: tapCount(repository.stdout, "pass"),
        failed: tapCount(repository.stdout, "fail"),
        skipped: tapCount(repository.stdout, "skipped"),
        durationMs: repository.durationMs
      },
      analysisHarness: { status: "passed", tests: harnessCount, durationMs: harness.durationMs },
      doctor: {
        status: doctor.status,
        capabilities: doctor.capabilities.map((item) => item.id),
        durationMs: doctorRun.durationMs
      },
      browser
    },
    acceptanceMatrix: matrix,
    carriedEvidence: {
      packageCStatus: packageC.status,
      packageCCapabilities: packageC.scope,
      transcriptChunkBoundarySeconds: 300,
      longestProductionTranscriptRangeSeconds: Math.max(
        0,
        ...packageC.realMedia.map((item) => item.coverageSeconds?.end ?? 0)
      ),
      duplicateSegmentIdsAtChunkBoundary: packageC.realMedia
        .map((item) => item.transcriptResult?.duplicateSegmentIds)
        .find(Number.isFinite) ?? null
    },
    qualityAndScaleGates: [
      { id: "owner_media_practical_profile", status: "passed", evidence: "Package A/C practical verification on this machine." },
      { id: "independent_gold_holdout", status: "not_measured", releaseBlocking: true },
      { id: "asr_cer_and_timing_thresholds", status: "not_measured", releaseBlocking: true },
      { id: "scene_precision_recall", status: "not_measured", releaseBlocking: true },
      { id: "two_hour_4k_vfr_nonzero_offset", status: "not_measured", releaseBlocking: true },
      { id: "hundred_file_ten_hour_query_benchmark", status: "not_measured", releaseBlocking: true }
    ],
    limits: [
      "Kết quả này đóng phạm vi sử dụng thực dụng trên máy owner; không phải chứng nhận phát hành rộng.",
      "releaseDefault tiếp tục là null.",
      "Corpus/holdout định lượng, nguồn 2 giờ/4K/VFR/offset và benchmark 100 file/10 giờ chưa được đo.",
      "Không thêm OCR, vector search, diarization, UI mutation, dịch vụ trả phí hoặc capability mới."
    ]
  };

  if (options.reportPath) {
    const path = safeReportPath(options.reportPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (blocking) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message, code: "source_acceptance_failed" }) + "\n");
  process.exitCode = 1;
});
