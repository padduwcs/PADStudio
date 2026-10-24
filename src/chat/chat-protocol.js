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

export function safeError(error, maximum = 2_000) {
  return text(error?.message || "Không thể hoàn thành yêu cầu.", maximum)
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

// Whitelist displayable items. Raw reasoning, tool arguments, auth data and the entire RPC envelope never reach the UI.
export function displayItem(item, turnId) {
  if (!item || typeof item.id !== "string") return null;
  const base = { id: item.id, turnId, status: item.status ?? "completed" };
  if (item.type === "userMessage") {
    const content = item.content ?? [];
    const fileParts = content.filter((part, index) => part.type === "text" && typeof part.text === "string" &&
      !/[\r\n]/.test(part.text) && (/\battachments[\\/][0-9a-f]{16}[\\/][0-9a-f-]{36}-/.test(part.text) || index > 0 && /^(?:[A-Za-z]:[\\/]|\/)/.test(part.text)));
    return {
    ...base, role: "user", kind: "message", clientId: item.clientId ?? null,
    text: content.filter((part) => part.type === "text" && !fileParts.includes(part)).map((part) => text(part.text)).join("\n"),
    attachments: [...fileParts.map((part) => {
      const match = /(?:^|[\\/])([0-9a-f-]{36})-(.+)$/.exec(part.text);
      return { kind: "file", name: match ? match[2] : part.text.split(/[\\/]/).at(-1), path: part.text, ...(match ? { id: match[1] } : {}) };
    }), ...content.filter((part) => ["image", "localImage", "skill"].includes(part.type)).map((part) => ({
      kind: part.type === "skill" ? "skill" : "image", name: part.name || (part.path ? part.path.split(/[\\/]/).at(-1).replace(/^[0-9a-f-]{36}-/, "") : "Ảnh"),
      ...(part.type === "localImage" && /(?:^|[\\/])([0-9a-f-]{36})-/.test(part.path || "") ? { id: /(?:^|[\\/])([0-9a-f-]{36})-/.exec(part.path)[1] } : {}),
      ...(part.type === "image" && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(part.url) && part.url.length < 15_000_000 ? { url: part.url } : {})
    }))]
  };
  }
  if (item.type === "agentMessage") return { ...base, role: "assistant", kind: "message", text: text(item.text, 100_000) };
  if (item.type === "commandExecution") return {
    ...base, role: "tool", kind: "command", text: text(item.command, 8_000), output: item.aggregatedOutput ? safeError({ message: text(item.aggregatedOutput, 100_000) }, 100_000) : "",
    exitCode: item.exitCode ?? null
  };
  if (item.type === "fileChange") return {
    ...base, role: "tool", kind: "files", text: (item.changes ?? []).slice(0, 100).map((change) => text(change.path, 300)).join("\n"),
    output: (item.changes ?? []).slice(0, 100).map((change) => text(change.diff, 30_000)).join("\n").slice(0, 100_000)
  };
  if (item.type === "reasoning" && Array.isArray(item.summary)) return { ...base, role: "tool", kind: "summary", text: "Tóm tắt suy luận", output: item.summary.map((part) => text(typeof part === "string" ? part : part.text, 20_000)).join("\n") };
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
    detail: params.networkApprovalContext ? text(params.networkApprovalContext.host, 500) : text(params.command, 8_000),
    decisions: (params.availableDecisions ?? ["accept", "acceptForSession", "decline", "cancel"]).filter((entry) => typeof entry === "string" && ["accept", "acceptForSession", "decline", "cancel"].includes(entry)),
    rules: (params.availableDecisions ?? []).flatMap((entry, index) => {
      const exec = entry?.acceptWithExecpolicyAmendment?.execpolicy_amendment;
      const network = entry?.applyNetworkPolicyAmendment?.network_policy_amendment;
      if (Array.isArray(exec) && exec.length && exec.every((part) => typeof part === "string")) return [{ id: `rule-${index}`, label: "Cho phép và ghi nhớ quy tắc lệnh", detail: exec.join(" ").slice(0, 2000) }];
      if (network && ["allow", "deny"].includes(network.action) && typeof network.host === "string") return [{ id: `rule-${index}`, label: network.action === "allow" ? "Luôn cho phép máy chủ này" : "Luôn từ chối máy chủ này", detail: text(network.host, 500) }];
      return [];
    })
  };
  if (method === "item/fileChange/requestApproval") return { ...base, title: "Cho phép thay đổi file?", detail: text(params.grantRoot, 1_000), decisions: ["accept", "acceptForSession", "decline", "cancel"] };
  if (method === "item/permissions/requestApproval") return {
    ...base, title: "Cho phép quyền bổ sung?", detail: JSON.stringify(params.permissions, null, 2).slice(0, 8_000), decisions: ["accept", "acceptForSession", "decline"]
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
  if (view.rules?.some((rule) => rule.id === value.decision)) {
    const index = Number(value.decision.slice(5));
    return { decision: params.availableDecisions[index] };
  }
  const allow = value.decision === "accept" || value.decision === "acceptForSession";
  if (!(view.decisions ?? ["accept", "decline"]).includes(value.decision)) throw new ChatError(400, "Lựa chọn không được yêu cầu này hỗ trợ.");
  if (method === "item/permissions/requestApproval") return { permissions: allow ? params.permissions : {}, scope: value.decision === "acceptForSession" ? "session" : "turn" };
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
  return { decision: value.decision };
}
