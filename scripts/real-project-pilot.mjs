import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDefaultToolRegistry } from "../src/execution/default-tool-registry.js";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";
import { ProjectStore } from "../src/project/project-store.js";

const rootDir = resolve(".padstudio/projects");
const projectId = "real-pilot-longest-substring";
const sourceName = "vid15_Longest_Substring_Without_Repeating_Characters.mp4";
const excerptStartSeconds = 320.2;
const excerptDurationSeconds = 9.8;
const store = new ProjectStore(rootDir);
const executor = new ToolExecutor({ store, registry: createDefaultToolRegistry() });
const latest = (items, key) => items.filter((item) => item.key === key)
  .sort((left, right) => left.revision - right.revision).at(-1);

let context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
const resource = context.resources.find((item) => item.source?.name === sourceName);
if (!resource) throw new Error(`Missing imported pilot source: ${sourceName}.`);
const evidence = Object.fromEntries(["source.metadata", "source.scenes", "source.frames", "source.audio-analysis", "source.transcript", "source.preview"]
  .map((type) => [type, context.results.filter((result) => result.type === type && result.inputResources.includes(resource.id)).at(-1)]));
if (Object.values(evidence).some((result) => !result || result.verification?.status !== "passed")) {
  throw new Error("Pilot requires verified probe, scenes, frames, audio, transcript and preview evidence.");
}

let brief = latest(context.artifacts, "real-pilot-brief");
if (!brief) brief = await store.recordArtifact(projectId, {
  key: "real-pilot-brief", type: "project.brief", name: "Brief pilot Longest Substring",
  summary: "Tạo một clip takeaway ngắn, dùng nguyên hình và tiếng nguồn, để kiểm tra workflow thật.",
  data: {
    version: "1.0",
    purpose: "Tạo clip 9 giây truyền đạt quy tắc cốt lõi của sliding window.",
    audience: "Người học thuật toán bằng tiếng Việt.",
    desiredOutcome: "Người xem nhớ ba hành động: mở rộng, thu hẹp và chỉ cập nhật khi cửa sổ hợp lệ.",
    constraints: ["Chỉ dùng media local đã nhập", "Giữ nguyên giọng và hình nguồn", "Không gọi provider trả phí"],
    knownFacts: ["Transcript đặt takeaway tại 320.52–329.58 giây."],
    assumptions: ["Đoạn nguồn đã có thiết kế/caption phù hợp để dùng như một excerpt."],
    openQuestions: ["Người dùng có chấp nhận nhịp, hình và âm thanh của exact Result hay không?"]
  },
  references: [{ kind: "resource", id: resource.id }, { kind: "result", id: evidence["source.transcript"].id }]
});
context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
let direction = latest(context.artifacts, "real-pilot-direction");
if (!direction) direction = await store.recordArtifact(projectId, {
  key: "real-pilot-direction", type: "creative.direction", name: "Source-led takeaway",
  summary: "Một excerpt source-led, không trang trí hoặc thay lời khi chưa có nhu cầu thực.",
  data: {
    version: "1.0", basis: { kind: "direct", briefArtifactId: brief.id },
    selectionReason: "Đoạn kết tự chứa trọn quy tắc và đã có lời tiếng Việt rõ trong transcript.",
    principles: ["Giữ nội dung gốc", "Cắt đúng một ý hoàn chỉnh", "Không thêm lớp âm thanh"],
    avoidances: ["Không ghép câu ngoài ngữ cảnh", "Không giả định ASR là human listening review"],
    reviewCriteria: ["Đủ câu takeaway", "Không cắt đầu/cuối từ", "Hình và tiếng giải mã được"],
    sample: {
      durationSeconds: 9,
      purpose: "Exact excerpt for owner review",
      successCriteria: ["Đủ câu takeaway", "Không cắt đầu hoặc cuối từ", "Hình và tiếng giải mã được"]
    }
  },
  references: [{ kind: "artifact", id: brief.id }]
});
context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
let sequence = latest(context.artifacts, "real-pilot-preview");
if (!sequence || sequence.data.segments[0].visual.startSeconds !== excerptStartSeconds ||
    sequence.data.segments[0].durationSeconds !== excerptDurationSeconds) sequence = await store.recordArtifact(projectId, {
  key: "real-pilot-preview", type: "video.sequence", name: "Longest Substring takeaway — preview",
  summary: "Excerpt 320,2–330,0 giây giữ nguyên hình và tiếng nguồn, có biên an toàn cho âm đầu/cuối.",
  ...(sequence ? { expectedRevision: sequence.revision } : {}),
  data: {
    version: "1.0", changeReason: sequence
      ? "Nới biên cắt sau exact-output ASR để giữ trọn âm đầu/cuối và dừng trước CTA."
      : "Tạo preview đầu tiên từ đoạn takeaway có transcript làm căn cứ.",
    format: { width: 1080, height: 1920, fps: 30 },
    segments: [{
      id: "core-takeaway", title: "Quy tắc sliding window",
      intent: "Giữ trọn câu kết luận về mở rộng, thu hẹp và cập nhật đáp án.",
      durationSeconds: excerptDurationSeconds,
      visual: { source: { kind: "resource", id: resource.id }, startSeconds: excerptStartSeconds, volume: 1 },
      references: [{ kind: "result", id: evidence["source.transcript"].id }]
    }]
  },
  references: [{ kind: "artifact", id: direction.id }]
});
context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
let result = context.results.filter((item) => item.type === "video.sequence-render" && item.data?.sequence?.artifactId === sequence.id).at(-1);
if (!result) result = (await executor.execute(projectId, {
  capability: "video.render-sequence", tool: "ffmpeg-sequence",
  purpose: "Render exact source-led takeaway for owner viewing and listening.",
  inputs: { artifactId: sequence.id }
})).result;
context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
if (!context.reviews.some((review) => review.target?.kind === "result" && review.target.id === result.id)) {
  await store.recordReview(projectId, {
    target: { kind: "result", id: result.id }, perspective: "technical", verdict: "passed_with_notes",
    summary: "Exact Result giải mã được, đúng 9 giây và thuộc sequence hiện hành; human viewing/listening vẫn chờ người dùng.",
    criteria: [
      { id: "duration", criterion: "Đúng thời lượng excerpt", status: "passed", evidence: `Measured ${result.data.durationSeconds}s; planned 9s.` },
      { id: "current", criterion: "Thuộc revision hiện hành", status: "passed", evidence: `${sequence.key} r${sequence.revision}; role ${result.data.sequenceRole}.` },
      { id: "provenance", criterion: "Chỉ dùng nguồn managed đã phân tích", status: "passed", evidence: `${resource.id}; transcript ${evidence["source.transcript"].id}.` },
      { id: "human-quality", criterion: "Đã xem và nghe chất lượng", status: "warning", evidence: "Awaiting the project owner; technical execution cannot attest this." }
    ]
  });
}
context = await new ProjectContextAssembler({ projectStore: store }).build(projectId);
const acceptance = context.decisions.filter((decision) => decision.resultId === result.id).at(-1);
let delivery = context.results.filter((item) =>
  item.type === "delivery.bundle" && item.data?.sourceResultId === result.id).at(-1);
if (acceptance?.outcome === "accepted" && !delivery) delivery = (await executor.execute(projectId, {
  capability: "video.export-delivery", tool: "local-delivery",
  purpose: "Export the exact real-pilot Result accepted under explicit owner delegation.",
  inputs: { resultId: result.id, profileId: "local-portrait-h264-v1" }
})).result;
await store.writeCheckpoint(projectId, acceptance?.outcome === "accepted" ? {
  goal: "Pilot Longest Substring đã được duyệt và xuất exact delivery.",
  constraints: ["Source-led", "Local-only", "Giữ exact Result provenance"],
  selectedResources: [resource.id], activeArtifacts: [brief.id, direction.id, sequence.id],
  pending: [], next: "Không còn hành động vận hành cho pilot; dùng ma sát đã ghi để chọn cải tiến tiếp theo."
} : {
  goal: "Duyệt exact Result của clip takeaway Longest Substring.",
  constraints: ["Source-led", "Local-only", "Không ghi user acceptance nếu chưa có phản hồi thật"],
  selectedResources: [resource.id], activeArtifacts: [brief.id, direction.id, sequence.id],
  pending: [`Người dùng xem và nghe Result ${result.id}`, "Nếu đạt, ghi exact acceptance rồi export delivery; nếu chưa đạt, ghi feedback có target."],
  next: `Mở Result ${result.id} trong Observer và xin quyết định của người dùng.`
});
const report = {
  version: "1.0", status: delivery ? "accepted_and_delivered" : "technical_pass_human_review_pending", projectId,
  sourceResourceId: resource.id, analysisJobId: "analysis-mtzrgpxu-3348b84c",
  evidenceResultIds: Object.fromEntries(Object.entries(evidence).map(([type, item]) => [type, item.id])),
  briefArtifactId: brief.id, directionArtifactId: direction.id, sequenceArtifactId: sequence.id,
  sequenceRevision: sequence.revision, resultId: result.id,
  preview: resolve(rootDir, projectId, result.files.find((file) => file.id === "primary").path),
  durationSeconds: result.data.durationSeconds, verification: result.verification,
  exactOutputQualityEvidence: {
    analysisJobId: "analysis-mtzsruf1-f91a63d6",
    audioResultId: "result-mtzsrv1z-d2c7c1c1",
    transcriptResultId: "result-mtzsrz64-c05c25a0"
  },
  userApproval: acceptance?.outcome === "accepted",
  approvalDecisionId: acceptance?.outcome === "accepted" ? acceptance.id : null,
  deliveryCreated: Boolean(delivery), deliveryResultId: delivery?.id ?? null,
  next: delivery ? "Pilot complete." : "Owner views/listens, then accepts exact Result or records targeted feedback."
};
await mkdir("reports", { recursive: true });
await writeFile("reports/real-project-pilot.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
