// Reproducible local revision of the reviewed phase-3 sample. Never calls a paid tool.
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ProjectStore } from "../src/project/project-store.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";

const projectId = "phase3-vd04-asset-pilot", rootDir = resolve(".padstudio/projects");
const store = new ProjectStore(rootDir), executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
const context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
const baseline = context.results.find((r) => r.id === "result-mtxaw6zq-5779e7b0");
if (!baseline) throw new Error("Expected phase-3 pilot baseline is missing.");
const original = context.artifacts.find((a) => a.id === baseline.data.sequence.artifactId);
const graphicSource = await store.readResult(projectId, "result-mtxav8a5-f67a641d");
const feedback = "Người dùng: Piper khoảng 4 giây chồng tiếng gốc nhỏ; 4–8 giây chỉ còn tiếng gốc nhỏ gây hụt âm lượng; chữ dễ đọc nhưng font thô, chưa đẹp.";
if (!context.decisions.some((d) => d.resultId === baseline.id && d.note === feedback)) {
  await store.recordDecision(projectId, { resultId: baseline.id, outcome: "changes_requested", note: feedback });
}
const graphic = (await executor.execute(projectId, { capability: "graphic.render", tool: "browser-graphic", purpose: "Điều chỉnh typography theo phản hồi người dùng; giữ nội dung graphic", inputs: {
  ...graphicSource.data.graphic, typography: { font: "Segoe UI", titleWeight: 400, lineSpacing: 1.45 }, artifactIds: graphicSource.inputArtifacts,
} })).result;
const data = structuredClone(original.data);
data.version = "1.1";
data.changeReason = "Đợt 4: tắt tiếng gốc, kết thúc hình nguồn cùng lời Piper; typography mới để người dùng so sánh.";
data.captionStyle = { font: "Segoe UI", fontSize: 52, margin: 0.08 };
data.segments[0].durationSeconds = 4;
data.segments[0].visual.volume = 0;
data.segments[0].narration.offsetSeconds = 0;
data.segments[0].narration.fadeInSeconds = 0.02;
data.segments[0].narration.fadeOutSeconds = 0.04;
data.segments[1].visual.source = { kind: "result", id: graphic.id, file: "primary" };
const key = "phase4-piper-revision";
const previous = context.artifacts.filter((a) => a.key === key).at(-1);
const artifact = await store.recordArtifact(projectId, { key, type: "video.sequence", name: "Đợt 4 — bản sửa Piper và chữ", summary: data.changeReason, status: "active", data,
  references: original.references, ...(previous ? { expectedRevision: previous.revision } : {}) });
const result = (await executor.execute(projectId, { capability: "video.render-sequence", tool: "ffmpeg-sequence", purpose: "Bản sửa theo phản hồi; chờ người dùng xem/nghe", inputs: { artifactId: artifact.id } })).result;
await store.recordReview(projectId, { target: { kind: "result", id: result.id }, perspective: "technical", verdict: "passed", summary: "Render/stream/frame/source checks passed. Human listening and typography approval remain pending.", criteria: [
  { id: "render", criterion: "File hợp lệ và đúng thời lượng", status: "passed", evidence: "Result verification: " + result.verification.checks.join(", ") },
] });
await store.writeCheckpoint(projectId, { goal: "Review bản sửa Đợt 4 về tiếng chồng, khoảng trống và typography", constraints: ["Local-only", "Không kế thừa phê duyệt bản cũ; chờ người dùng xem/nghe"],
  selectedResources: context.checkpoint.selectedResources, pending: ["Người dùng xem/nghe Result " + result.id, "Chưa phê duyệt chất giọng hoặc font mới"], next: "So sánh baseline " + baseline.id + " với " + result.id + "; sửa theo phản hồi cụ thể." });
const report = { status: "technical_pass_human_review_pending", projectId, baselineResultId: baseline.id, artifactId: artifact.id, resultId: result.id,
  preview: resolve(rootDir, projectId, result.files.find((f) => f.id === "primary").path), graphic: resolve(rootDir, projectId, graphic.files[0].path),
  durationSeconds: result.data.durationSeconds, audioMeasurement: result.verification.details.audioMeasurement, paidProviderCalls: 0, userApproval: false };
await mkdir("reports", { recursive: true });
await writeFile("reports/phase4-pilot.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
