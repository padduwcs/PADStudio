// The Tools page lists what PADStudio can use on this machine in the user's terms: a handful of items
// ("Piper", "Manim", "Phiên âm lời nói") instead of 37 internal tools. Each item is built from the live tool
// registry, so a status here is exactly what the Agent sees through tool:list and project:resume.

export const TOOL_GROUPS = Object.freeze([
  { id: "voice", label: "Giọng đọc" },
  { id: "animation", label: "Hoạt họa bằng code" },
  { id: "understanding", label: "Hiểu tư liệu quay sẵn" },
  { id: "assets", label: "Ảnh, đồ họa và tư liệu" },
  { id: "editing", label: "Dựng, kiểm tra và xuất video" },
  { id: "other", label: "Khác" }
]);

const ASK_AGENT = "Nhờ Agent hướng dẫn cài; PADStudio không tự cài gì.";
const ANALYSIS_SETUP = "Cần Python 3.12 và model Whisper (khoảng 5 GB), cài một lần theo eval/source-understanding/README.md, mục “Cài môi trường”. " + ASK_AGENT;

// `match` lists tool names; a name ending in "-" matches every tool with that prefix.
const ITEMS = Object.freeze([
  { id: "piper", group: "voice", name: "Piper", cost: "local", match: ["piper-local"],
    summary: "Giọng đọc tiếng Việt chạy ngay trên máy, không cần mạng, không tốn phí.",
    setup: "Cần Python, gói piper-tts và một model giọng; đường dẫn khai báo ở mục piper trong padstudio.local.json. " + ASK_AGENT },
  { id: "elevenlabs", group: "voice", name: "ElevenLabs", cost: "paid", match: ["elevenlabs"], setting: "elevenLabs.apiKey",
    summary: "Giọng đọc chất lượng cao qua mạng, tính phí theo ký tự. Agent luôn hỏi bạn trước mỗi lần tốn tiền.",
    setup: "Dán khóa API ElevenLabs (elevenlabs.io → Profile → API Keys) vào ô bên dưới." },
  { id: "manim", group: "animation", name: "Manim", cost: "local", match: ["manim-"],
    summary: "Hoạt họa toán học: công thức, đồ thị, hình học, sơ đồ thuật toán.",
    setup: "Cần cài Manim Community (Python) và FFmpeg. " + ASK_AGENT },
  { id: "remotion", group: "animation", name: "Remotion", cost: "local", match: ["remotion-"],
    summary: "Hoạt họa bằng React: chữ động, giao diện, biểu đồ, cảnh có nhiều lớp.",
    setup: "Cần Remotion và Chrome Headless Shell trong thư mục .runtime-tools. " + ASK_AGENT },
  { id: "hyperframes", group: "animation", name: "HyperFrames", cost: "local", match: ["hyperframes-"],
    summary: "Hoạt họa bằng HTML/CSS, dựng chính xác từng khung hình.",
    setup: "Cần HyperFrames trong .runtime-tools/code-animation-node và Chrome hoặc Edge. " + ASK_AGENT },
  { id: "media-reading", group: "understanding", name: "Đọc video và âm thanh", cost: "local",
    match: ["ffprobe-source", "ffmpeg-source-frames", "ffmpeg-audio-analysis", "ffmpeg-source-preview"],
    summary: "Đọc thông số, trích khung hình, đo âm lượng và tạo bản xem nhanh của tư liệu bạn gửi.",
    setup: "Cần FFmpeg và ffprobe trong PATH." },
  { id: "scene-detection", group: "understanding", name: "Tìm điểm cắt cảnh", cost: "local", match: ["pyscenedetect-scenes"],
    summary: "Chia video quay sẵn thành các cảnh để chọn đoạn nhanh hơn.", setup: ANALYSIS_SETUP },
  { id: "transcription", group: "understanding", name: "Phiên âm lời nói", cost: "local", match: ["faster-whisper-transcribe"],
    summary: "Chuyển lời nói trong video, ghi âm thành chữ có mốc thời gian.", setup: ANALYSIS_SETUP },
  { id: "stock", group: "assets", name: "Wikimedia Commons", cost: "network", match: ["wikimedia-stock"],
    summary: "Tìm ảnh, video miễn phí, luôn giữ tác giả, giấy phép và trang nguồn.", setup: "Cần kết nối mạng." },
  { id: "download", group: "assets", name: "Tải tư liệu từ link", cost: "network", match: ["https-media"],
    summary: "Đưa ảnh, video từ một đường link HTTPS vào dự án, giữ nguồn.", setup: "Cần kết nối mạng." },
  { id: "graphics", group: "assets", name: "Thẻ chữ và biểu đồ", cost: "local", match: ["browser-graphic"],
    summary: "Vẽ thẻ tiêu đề, sơ đồ các bước và biểu đồ đơn giản.", setup: "Cần Chrome hoặc Edge." },
  { id: "generated", group: "assets", name: "Tư liệu từ dịch vụ khác", cost: "local", match: ["external-generated-media"],
    summary: "Nhận ảnh, nhạc, video tạo bằng dịch vụ bên ngoài (khai báo ở mục dưới), kèm nguồn, prompt và bản quyền.", setup: "" },
  { id: "editing", group: "editing", name: "Dựng video", cost: "local",
    match: ["ffmpeg-sequence", "ffmpeg-trim", "ffmpeg-concat", "ffmpeg-reformat", "ffmpeg-thumbnail", "ffmpeg-audio-overlay",
      "ffmpeg-subtitle-burn", "ffmpeg-image-to-video", "ffmpeg-audio-prepare", "ffprobe"],
    summary: "Ghép các đoạn, cắt, đổi khung hình, phụ đề, nhạc nền và dựng bản xem hoàn chỉnh.",
    setup: "Cần FFmpeg và ffprobe trong PATH." },
  { id: "quality", group: "editing", name: "Kiểm tra chất lượng", cost: "local", match: ["local-output-quality", "local-sync-verifier"],
    summary: "Agent tự kiểm tra hình, tiếng, khoảng lặng và khớp lời trước khi đưa bạn xem.", setup: "Cần FFmpeg và ffprobe trong PATH." },
  { id: "delivery", group: "editing", name: "Xuất bản giao", cost: "local", match: ["local-delivery"],
    summary: "Đóng gói đúng từng byte của bản bạn đã chốt, kèm checksum.", setup: "Cần ffprobe trong PATH." }
]);

// Bookkeeping tools every animation runtime shares; they are always local and say nothing the user can act on.
const SUPPORTING = Object.freeze(["code-animation-source", "code-animation-validator", "code-animation-props"]);

const COST_LABELS = Object.freeze({
  local: "Miễn phí · chạy trên máy",
  network: "Miễn phí · cần mạng",
  paid: "Trả phí · qua mạng"
});

const STATUS_LABELS = Object.freeze({
  ready: "Sẵn sàng",
  partial: "Dùng được một phần",
  needs_key: "Cần khóa API",
  needs_setup: "Cần cài thêm"
});

function matches(pattern, name) {
  return pattern.endsWith("-") ? name.startsWith(pattern) : name === pattern;
}

function shortReason(reason) {
  const text = String(reason ?? "").replace(/\s+/g, " ").trim();
  return text.length > 220 ? text.slice(0, 217) + "…" : text || null;
}

function itemStatus(item, tools) {
  const available = tools.filter((tool) => tool.available);
  if (available.length === tools.length) return "ready";
  if (available.length) return "partial";
  if (item.setting && tools.some((tool) => tool.credentialConfigured === false)) return "needs_key";
  return "needs_setup";
}

/**
 * Turn registry.describeCapabilities() into the Tools page. Tool names, statuses and reasons come from the
 * registry; the wording around them comes from the table above. A tool the table does not know yet is still
 * shown, under "Khác", so nothing that is installed or missing is hidden from the user.
 */
export function buildToolsOverview(capabilityDescription, { checkedAt = new Date().toISOString() } = {}) {
  const tools = (capabilityDescription?.capabilities ?? []).flatMap((capability) =>
    (capability.tools ?? []).map((tool) => ({
      name: tool.name,
      capability: capability.id,
      provider: tool.provider ?? null,
      available: tool.availability?.status === "available",
      credentialConfigured: tool.availability?.credentialConfigured,
      reason: tool.availability?.status === "available" ? null : shortReason(tool.availability?.reason)
    })));
  const claimed = new Set();
  const items = [];
  for (const item of ITEMS) {
    const own = tools.filter((tool) => item.match.some((pattern) => matches(pattern, tool.name)));
    if (!own.length) continue;
    for (const tool of own) claimed.add(tool.name);
    const status = itemStatus(item, own);
    items.push({
      id: item.id, group: item.group, name: item.name, summary: item.summary,
      cost: item.cost, costLabel: COST_LABELS[item.cost],
      status, statusLabel: STATUS_LABELS[status],
      setup: status === "ready" ? null : item.setup || null,
      setting: item.setting ?? null,
      missing: own.filter((tool) => !tool.available).map((tool) => ({ name: tool.name, reason: tool.reason })),
      tools: own.map((tool) => tool.name),
      capabilities: [...new Set(own.map((tool) => tool.capability))].sort()
    });
  }
  for (const tool of tools) {
    if (claimed.has(tool.name) || SUPPORTING.includes(tool.name)) continue;
    const status = tool.available ? "ready" : "needs_setup";
    items.push({
      id: "tool:" + tool.name, group: "other", name: tool.provider ? `${tool.provider} (${tool.name})` : tool.name,
      summary: `Công cụ cho ${tool.capability}.`, cost: null, costLabel: null,
      status, statusLabel: STATUS_LABELS[status], setup: status === "ready" ? null : ASK_AGENT, setting: null,
      missing: tool.available ? [] : [{ name: tool.name, reason: tool.reason }],
      tools: [tool.name], capabilities: [tool.capability]
    });
  }
  const groups = TOOL_GROUPS
    .map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length);
  return {
    version: "1.0",
    checkedAt,
    summary: { ready: items.filter((item) => item.status === "ready").length, total: items.length },
    groups
  };
}
