// Reproducible local correction of the reviewed pilot. Never calls a paid provider.
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";

const projectId = "phase3-vd04-asset-pilot";
const rootDir = resolve(".padstudio/projects");
const sequenceKey = "pilot-preview";
const obsoleteKey = "phase4-piper-revision";
const directionId = "artifact-mtxat6v7-1e339382";
const baselineResultId = "result-mtxaw6zq-5779e7b0";
const correctionMarker = "Đợt 4 hoàn chỉnh: giữ mẫu 12 giây theo creative direction, tách lời Piper khỏi tiếng nguồn và thay graphic đã sửa typography.";
const store = new ProjectStore(rootDir);
const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });

function latestForKey(artifacts, key) {
  return artifacts.filter((artifact) => artifact.key === key).sort((a, b) => a.revision - b.revision).at(-1);
}

function reportFor({ result, artifact, graphicResultId, narrationResultId, currentSequenceCount, userApproval = false }) {
  return {
    status: userApproval ? "accepted" : "technical_pass_human_review_pending",
    projectId,
    creativeDirectionArtifactId: directionId,
    baselineResultId,
    sequenceKey: artifact.key,
    sequenceRevision: artifact.revision,
    artifactId: artifact.id,
    resultId: result.id,
    preview: resolve(rootDir, projectId, result.files.find((file) => file.id === "primary").path),
    graphicResultId,
    narrationResultId,
    durationSeconds: result.data.durationSeconds,
    sequenceRole: result.data.sequenceRole,
    currentSequenceCount,
    audioMeasurement: result.verification.details.audioMeasurement,
    paidProviderCalls: 0,
    userApproval,
  };
}

let context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
const baseline = context.results.find((result) => result.id === baselineResultId);
if (!baseline) throw new Error("Expected phase-3 pilot baseline is missing.");
const direction = context.artifacts.find((artifact) => artifact.id === directionId);
const activeDirection = context.intelligence.activeArtifacts.some((artifact) => artifact.id === directionId);
if (!direction || !activeDirection || direction.data.sample?.durationSeconds !== 12) {
  throw new Error("The active creative direction must require a 12-second sample.");
}
let pilot = latestForKey(context.artifacts, sequenceKey);
if (!pilot) throw new Error("Expected pilot-preview revision chain is missing.");

// Safe reruns return the exact existing correction instead of creating another revision or render.
if (pilot.status === "active" && pilot.data.changeReason === correctionMarker) {
  const existing = context.results.filter((result) => result.data.sequence?.artifactId === pilot.id).at(-1);
  if (!existing) throw new Error("Corrected pilot exists without its registered render.");
  const currentCount = context.production.sequences.filter((sequence) => sequence.role === "current").length;
  const latestDecision = context.decisions.filter((decision) => decision.resultId === existing.id).at(-1);
  const report = reportFor({
    result: existing,
    artifact: pilot,
    graphicResultId: pilot.data.segments[1].visual.source.id,
    narrationResultId: pilot.data.segments[1].narration.source.id,
    currentSequenceCount: currentCount,
    userApproval: latestDecision?.outcome === "accepted" && latestDecision.decidedBy === "user",
  });
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase4-pilot.json", JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const unexpectedCurrent = context.production.sequences.filter((sequence) =>
  sequence.role === "current" && ![sequenceKey, obsoleteKey].includes(sequence.key)
);
if (unexpectedCurrent.length) throw new Error("Unexpected current sequence: " + unexpectedCurrent.map((sequence) => sequence.key).join(", "));

if (!context.decisions.some((decision) => decision.resultId === baseline.id && decision.outcome === "changes_requested")) {
  await store.recordDecision(projectId, {
    resultId: baseline.id,
    outcome: "changes_requested",
    note: "Piper chồng với tiếng gốc nhỏ ở khoảng đầu; phần sau hụt âm lượng; typography còn thô.",
  });
}

const graphic = (await executor.execute(projectId, {
  capability: "graphic.render",
  tool: "browser-graphic",
  purpose: "Tạo lại concept card với ngắt dòng có chủ ý và nhãn đúng đợt triển khai",
  inputs: {
    kind: "card",
    title: "Từ brute force\nđến tối ưu hóa",
    body: "Làm rõ cách giải.\nTìm đúng điểm nghẽn.\nGiảm phần việc lặp lại.\nĐo lại kết quả.",
    footer: "Pilot local • Đợt 4",
    width: 1080,
    height: 1920,
    theme: "dark",
    accent: "#43D17A",
    typography: { font: "Segoe UI", titleWeight: 500, lineSpacing: 1.32 },
    artifactIds: [direction.id],
  },
})).result;

const closingText = "Tìm đúng điểm nghẽn, giảm việc lặp lại, rồi đo lại để kiểm chứng kết quả.";
const closingNarration = (await executor.execute(projectId, {
  capability: "tts.synthesize",
  tool: "piper-local",
  purpose: "Lấp phần graphic bằng lời dẫn tiếng Việt local, không gọi provider trả phí",
  inputs: { text: closingText, lengthScale: 1, sentenceSilence: 0.08 },
})).result;
if (closingNarration.data.durationSeconds > 4.03) {
  throw new Error(`Closing narration is ${closingNarration.data.durationSeconds}s and does not fit the 4-second graphic segment.`);
}

// Retire the mistaken parallel branch before activating the corrected revision on the canonical chain.
const obsolete = latestForKey(context.artifacts, obsoleteKey);
if (obsolete?.status === "active") {
  await store.recordArtifact(projectId, {
    key: obsolete.key,
    type: obsolete.type,
    name: obsolete.name,
    summary: "Giữ làm lịch sử; bản sửa đúng tiếp tục trên pilot-preview.",
    status: "retired",
    data: obsolete.data,
    references: obsolete.references,
    expectedRevision: obsolete.revision,
  });
}

const data = structuredClone(pilot.data);
data.version = "1.1";
data.changeReason = correctionMarker;
data.captionStyle = { font: "Segoe UI", fontSize: 52, margin: 0.08 };
data.audio = { loudnessTargetLufs: -18 };
data.segments[0].durationSeconds = 8;
data.segments[0].visual.volume = 0;
data.segments[0].visual.volumeRanges = [{ startSeconds: 4, endSeconds: 8, volume: 0.65 }];
data.segments[0].narration.offsetSeconds = 0;
data.segments[0].narration.fadeInSeconds = 0.02;
data.segments[0].narration.fadeOutSeconds = 0.04;
data.segments[1].durationSeconds = 4;
data.segments[1].visual.source = { kind: "result", id: graphic.id, file: "primary" };
data.segments[1].visual.volume = 0;
data.segments[1].narration = {
  text: closingText,
  source: { kind: "result", id: closingNarration.id, file: "primary" },
  startSeconds: 0,
  offsetSeconds: 0,
  durationSeconds: closingNarration.data.durationSeconds,
  volume: 0.82,
  fadeInSeconds: 0.02,
  fadeOutSeconds: 0.04,
};

pilot = await store.recordArtifact(projectId, {
  key: sequenceKey,
  type: "video.sequence",
  name: "Preview source-first với Piper — bản sửa Đợt 4",
  summary: correctionMarker,
  status: "active",
  data,
  references: pilot.references,
  expectedRevision: pilot.revision,
});
const result = (await executor.execute(projectId, {
  capability: "video.render-sequence",
  tool: "ffmpeg-sequence",
  purpose: "Render bản sửa đúng creative direction để người dùng xem và nghe",
  inputs: { artifactId: pilot.id },
})).result;

const audio = result.verification.details.audioMeasurement;
const durationPassed = Math.abs(result.data.durationSeconds - direction.data.sample.durationSeconds) <= 0.05;
const tailPassed = audio.tailSilenceSeconds <= 0.75;
if (!durationPassed || !tailPassed || result.data.sequenceRole !== "current") {
  throw new Error(`Corrected pilot failed its technical gate: duration=${result.data.durationSeconds}, tailSilence=${audio.tailSilenceSeconds}, role=${result.data.sequenceRole}.`);
}
await store.recordReview(projectId, {
  target: { kind: "result", id: result.id },
  perspective: "technical",
  verdict: "passed",
  summary: "Đúng sequence hiện hành, đủ 12 giây và không còn đuôi im lặng bất thường. Việc nghe/xem thẩm mỹ vẫn chờ người dùng.",
  criteria: [
    { id: "direction-duration", criterion: "Khớp thời lượng 12 giây của creative direction", status: "passed", evidence: `Measured ${result.data.durationSeconds}s; direction ${direction.data.sample.durationSeconds}s.` },
    { id: "tail-silence", criterion: "Không còn khoảng im lặng dài ở cuối", status: "passed", evidence: `Measured tail silence ${audio.tailSilenceSeconds}s; threshold 0.75s.` },
    { id: "canonical-chain", criterion: "Render thuộc revision hiện hành của pilot-preview", status: "passed", evidence: `${pilot.key} r${pilot.revision}; role ${result.data.sequenceRole}.` },
    { id: "local-only", criterion: "Không gọi provider trả phí", status: "passed", evidence: "Graphic, Piper and FFmpeg runs are local; actual cost USD 0." },
  ],
});

context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
const currentSequences = context.production.sequences.filter((sequence) => sequence.role === "current");
if (currentSequences.length !== 1 || currentSequences[0].artifactId !== pilot.id) {
  throw new Error("Project does not have exactly one corrected current sequence.");
}
await store.writeCheckpoint(projectId, {
  goal: "Người dùng xem/nghe bản sửa Đợt 4 trên đúng chain pilot-preview",
  constraints: ["Local-only", "Không kế thừa phê duyệt bản cũ", "Creative direction yêu cầu 12 giây"],
  selectedResources: context.checkpoint.selectedResources,
  activeArtifacts: [pilot.id, direction.id],
  pending: [`Người dùng xem/nghe Result ${result.id}`, "Chưa phê duyệt thẩm mỹ typography hoặc chất giọng"],
  next: `So sánh baseline ${baseline.id} với ${result.id}; chỉ sửa tiếp trên key ${sequenceKey}.`,
});

const report = reportFor({
  result,
  artifact: pilot,
  graphicResultId: graphic.id,
  narrationResultId: closingNarration.id,
  currentSequenceCount: currentSequences.length,
});
await mkdir("reports", { recursive: true });
await writeFile("reports/phase4-pilot.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
