export class ChatError extends Error {
  constructor(status, message, code = "invalid_request") {
    super(message);
    this.name = "ChatError";
    this.status = status;
    this.code = code;
  }
}

export function text(value, maximum = 40_000) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

export function safeError(error) {
  return text(error?.message || "Không thể hoàn thành yêu cầu.", 2_000)
    .replace(/\bBearer\s+\S+/gi, "Bearer [đã ẩn]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[khóa đã ẩn]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token đã ẩn]");
}

export function externalUrl(value, { login = false } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    if (login && !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function projectInstructions(project, rootDir) {
  return [
    "Bạn là agent làm video trong cửa sổ chat PADStudio trên máy người dùng. Trả lời bằng ngôn ngữ của người dùng.",
    `Project đang được chọn: ${JSON.stringify({ id: project.id, title: project.title })}. Gốc kho project: ${JSON.stringify(rootDir)}.`,
    "Chỉ vận hành project được chọn. Đọc AGENTS.md và PADSTUDIO-AGENT-RUNTIME.md, bắt đầu bằng npm run project:resume -- với đúng project ID. Chỉ đọc skill/context cần cho công việc hiện tại.",
    "Làm việc như agent bên ngoài: dùng CLI/contract PADStudio, lưu input/output có giá trị trong đúng Resource/Run/Result/Artifact/Delivery. Không sửa mã nguồn PADStudio khi đang vận hành video.",
    "Tin nhắn chat ở đây là tin nhắn trực tiếp của người dùng. Hỏi khi cần lựa chọn, phê duyệt chi phí hoặc chốt bản; không tự suy ra sự đồng ý.",
    "Người dùng xem video trong cùng giao diện. Khi họ chốt một exact Result, ghi acceptance bằng project:accept --from-agent-host và xuất Delivery giữ nguyên byte theo runtime. Không tự khai rằng họ đã xem/nghe toàn bộ.",
    "Tư liệu đính kèm đã được import thành Resource của project. Dùng resourceId và đường dẫn trong project được cung cấp; không nhập lại cùng tư liệu.",
    "Không tự mở hoặc khởi động thêm observer: người dùng đang ở PADStudio. Dùng kết quả và mốc thời gian để hướng dẫn họ xem."
  ].join("\n");
}

export function displayUserText(value) {
  const content = text(value);
  const match = /\n\n<PADStudio-context>\n([^]*?)\n<\/PADStudio-context>$/.exec(content);
  if (!match) return content;
  try {
    const context = JSON.parse(match[1]);
    if (context.version !== "1.0" || !Array.isArray(context.attachments)) return content;
    return [content.slice(0, match.index), context.attachments.length ? "Tư liệu: " + context.attachments.map((entry) => text(entry.name, 200)).join(", ") : null,
      context.video ? "Đã kèm mốc video đang xem." : null].filter(Boolean).join("\n\n");
  } catch { return content; }
}

// Whitelist displayable items. Raw reasoning, tool arguments, auth data and the entire RPC envelope never reach the UI.
export function displayItem(item, turnId) {
  if (!item || typeof item.id !== "string") return null;
  const base = { id: item.id, turnId, status: item.status ?? "completed" };
  if (item.type === "userMessage") return {
    ...base, role: "user", kind: "message", clientId: item.clientId ?? null,
    text: (item.content ?? []).filter((part) => part.type === "text").map((part) => displayUserText(part.text)).join("\n")
  };
  if (item.type === "agentMessage") return { ...base, role: "assistant", kind: "message", text: text(item.text, 100_000) };
  if (item.type === "commandExecution") return {
    ...base, role: "tool", kind: "command", text: text(item.command, 8_000), output: safeError({ message: text(item.aggregatedOutput, 12_000) }),
    exitCode: item.exitCode ?? null
  };
  if (item.type === "fileChange") return {
    ...base, role: "tool", kind: "files", text: (item.changes ?? []).slice(0, 30).map((change) => text(change.path, 300)).join("\n")
  };
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") return {
    ...base, role: "tool", kind: "tool", text: [item.server, item.tool].filter(Boolean).join(" · ")
  };
  if (item.type === "webSearch") return { ...base, role: "tool", kind: "search", text: text(item.query, 1_000) };
  if (item.type === "contextCompaction") return { ...base, role: "tool", kind: "context", text: "Đang thu gọn lịch sử để tiếp tục công việc" };
  if (item.type === "plan") return { ...base, role: "assistant", kind: "plan", text: text(item.text, 20_000) };
  return null;
}

export function approvalView(method, params, id) {
  const base = { id, turnId: params.turnId ?? null, title: "Agent cần bạn xác nhận", kind: "approval", reason: text(params.reason, 4_000) };
  if (method === "item/commandExecution/requestApproval") return {
    ...base, title: params.networkApprovalContext ? "Cho phép kết nối mạng?" : "Cho phép thực hiện thao tác?",
    detail: params.networkApprovalContext ? text(params.networkApprovalContext.host, 500) : text(params.command, 8_000)
  };
  if (method === "item/fileChange/requestApproval") return { ...base, title: "Cho phép thay đổi file?", detail: text(params.grantRoot, 1_000) };
  if (method === "item/permissions/requestApproval") return {
    ...base, title: "Cho phép quyền bổ sung trong lượt này?", detail: JSON.stringify(params.permissions, null, 2).slice(0, 8_000)
  };
  if (method === "item/tool/requestUserInput") return {
    ...base, title: "Agent cần ý kiến của bạn", kind: "questions",
    questions: (params.questions ?? []).slice(0, 10).map((question) => ({
      id: text(question.id, 200), question: text(question.question, 4_000), secret: question.isSecret === true,
      options: (question.options ?? []).slice(0, 20).map((option) => ({ label: text(option.label, 500), description: text(option.description, 1_000) }))
    }))
  };
  if (method === "mcpServer/elicitation/request") {
    if (params.mode === "url") {
      const url = externalUrl(params.url);
      return url ? { ...base, kind: "external", reason: text(params.message, 4_000), url, detail: "Mở trang bên dưới, rồi xác nhận khi bạn đã thực hiện xong." } : null;
    }
    const schema = params.requestedSchema;
    if (!schema?.properties || Object.keys(schema.properties).length > 20) return null;
    const fields = Object.entries(schema.properties);
    if (fields.some(([, field]) => !field || !["string", "number", "integer", "boolean"].includes(field.type))) return null;
    return { ...base, kind: "form", reason: text(params.message, 4_000), fields: fields.map(([name, field]) => ({
      name, label: text(field.title || name, 500), description: text(field.description, 1_000), type: field.type,
      required: schema.required?.includes(name) ?? false, options: Array.isArray(field.enum) ? field.enum.slice(0, 50) : null
    })) };
  }
  return null;
}

export function approvalAnswer(request, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChatError(400, "Câu trả lời không hợp lệ.");
  const { method, params, view } = request;
  const allow = value.decision === "accept";
  if (!["accept", "decline"].includes(value.decision)) throw new ChatError(400, "Cần chọn đồng ý hoặc từ chối.");
  if (method === "item/permissions/requestApproval") return { permissions: allow ? params.permissions : {}, scope: "turn" };
  if (method === "item/tool/requestUserInput") {
    if (!allow) return { answers: {} };
    const answers = Object.fromEntries(view.questions.map((question) => {
      const answer = value.answers?.[question.id];
      if (typeof answer !== "string" || !answer.trim() || answer.length > 8_000) throw new ChatError(400, "Vui lòng trả lời các câu hỏi của agent.");
      return [question.id, { answers: [answer.trim()] }];
    }));
    return { answers };
  }
  if (method === "mcpServer/elicitation/request") {
    if (!allow) return { action: "decline", content: null };
    const content = Object.fromEntries((view.fields ?? []).flatMap((field) => {
      const answer = value.content?.[field.name];
      if (answer === undefined || answer === "") {
        if (field.required) throw new ChatError(400, `Cần nhập ${field.label}.`);
        return [];
      }
      const valid = field.type === "boolean" ? typeof answer === "boolean"
        : field.type === "string" ? typeof answer === "string" && answer.length <= 8_000
          : Number.isFinite(answer) && (field.type !== "integer" || Number.isInteger(answer));
      if (!valid || (field.options && !field.options.includes(answer))) throw new ChatError(400, `Giá trị ${field.label} không hợp lệ.`);
      return [[field.name, answer]];
    }));
    return { action: "accept", content: view.kind === "external" ? null : content };
  }
  return { decision: allow ? "accept" : "decline" };
}
