import { ICONS, formatSize, node, svgIcon } from "./dom.js";
import { renderChatMarkdown } from "./chat-markdown.js";

const MAX_UPLOAD = 100 * 1024 * 1024;
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';

function action(label, handler, style = "button button-quiet") {
  const button = node("button", label, style); button.type = "button";
  button.addEventListener("click", handler); return button;
}

export function createChatPanel({ root, toggle, onProjectCreated, getVideoTarget = () => null }) {
  let projectId;
  let projectTitle = "";
  let state = { connected: false, authenticated: false, models: [] };
  let session = null;
  let stream = null;
  let generation = 0;
  let sending = false;
  let uploading = false;
  let opened = false;
  let returnFocus = null;
  let notice = "";
  let online = true;
  let requestSignature = "";
  let conversationSignature = "";
  let renderedItems = new Map();
  const drafts = new Map();
  const smallScreen = window.matchMedia("(max-width: 900px)");

  const head = node("header", undefined, "chat-head");
  const heading = node("div");
  const title = node("h2", "Trò chuyện"); title.id = "chat-title";
  const subtitle = node("p", "Codex", "chat-subtitle");
  heading.append(title, subtitle);
  const closeButton = action("", () => close(), "icon-button"); closeButton.append(svgIcon(ICONS.close)); closeButton.setAttribute("aria-label", "Đóng trò chuyện");
  head.append(heading, closeButton);
  const projectBar = node("div", undefined, "chat-project");
  const projectName = node("span", "Một video mới"); projectName.id = "chat-project-name";
  const createButton = action("Dự án mới", () => {
    newProjectForm.hidden = !newProjectForm.hidden;
    if (!newProjectForm.hidden) newProjectName.focus();
  }, "button button-ghost"); createButton.id = "chat-new-project";
  projectBar.append(projectName, createButton);
  const conversations = node("select", undefined, "select chat-conversations"); conversations.id = "chat-conversations";
  conversations.setAttribute("aria-label", "Chọn cuộc trò chuyện"); conversations.hidden = true;
  conversations.addEventListener("change", async () => {
    if (!conversations.value) return;
    conversations.disabled = true;
    try { acceptSession((await post(endpoint("conversation"), { conversationId: conversations.value })).session); }
    catch (error) { setNotice(error.message); }
    finally { updateControls(); }
  });
  const newProjectForm = node("form", undefined, "chat-new-project-form"); newProjectForm.hidden = true;
  const newProjectName = node("input"); newProjectName.placeholder = "Tên dự án"; newProjectName.maxLength = 160; newProjectName.required = true; newProjectName.setAttribute("aria-label", "Tên dự án mới");
  const createSubmit = node("button", "Tạo dự án", "button button-soft"); createSubmit.type = "submit";
  newProjectForm.append(newProjectName, createSubmit);
  const connection = node("div", undefined, "chat-connection");
  const options = node("div", undefined, "chat-options");
  const modelLabel = node("label", "Model", "sr-only"); modelLabel.htmlFor = "chat-model";
  const model = node("select", undefined, "select select-quiet"); model.id = "chat-model"; model.setAttribute("aria-label", "Model của agent");
  const newChat = action("Hội thoại mới", () => {
    resetBox.hidden = !resetBox.hidden;
  }, "button button-ghost"); newChat.id = "chat-new-conversation";
  options.append(modelLabel, model, newChat);
  const resetBox = node("div", undefined, "chat-reset"); resetBox.hidden = true;
  resetBox.append(node("p", "Mở cuộc trò chuyện mới cho dự án này? Bạn vẫn có thể mở lại hội thoại trước. Công việc trong dự án được giữ nguyên."));
  resetBox.append(action("Mở hội thoại mới", async () => {
    try { const result = await post(endpoint("new"), {}); acceptSession(result.session); resetBox.hidden = true; }
    catch (error) { setNotice(error.message); }
  }, "button button-soft"), action("Quay lại", () => { resetBox.hidden = true; }, "button button-ghost"));
  const history = node("div", undefined, "chat-history"); history.id = "chat-history"; history.setAttribute("role", "log"); history.setAttribute("aria-label", "Lịch sử trò chuyện"); history.setAttribute("aria-live", "off"); history.tabIndex = 0;
  const empty = node("div", undefined, "chat-empty");
  empty.append(node("span", "Cùng làm một video", "chat-empty-title"), node("p", "Nói ý tưởng của bạn, thêm tư liệu và trao đổi với agent ngay tại đây."));
  for (const suggestion of ["Tôi muốn làm một video giải thích…", "Xem dự án và cho tôi biết đang làm tới đâu."]) {
    empty.append(action(suggestion, () => { input.value = suggestion; saveDraft(); resize(); input.focus(); }, "chat-suggestion"));
  }
  const messages = node("div", undefined, "chat-messages");
  const older = node("p", "Đang hiển thị phần gần nhất của hội thoại.", "chat-older"); older.hidden = true;
  history.append(empty, older, messages);
  const jump = action("Tin nhắn mới ↓", () => scrollToEnd(true), "button button-soft chat-jump"); jump.hidden = true;
  const requests = node("div", undefined, "chat-requests"); requests.id = "chat-requests";
  const status = node("p", "", "chat-status"); status.id = "chat-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const noticeBox = node("p", "", "chat-notice"); noticeBox.id = "chat-notice"; noticeBox.hidden = true; noticeBox.setAttribute("role", "alert");
  const composer = node("form", undefined, "chat-composer"); composer.id = "chat-composer";
  const chips = node("div", undefined, "chat-attachments"); chips.id = "chat-attachments";
  const inputLabel = node("label", "Tin nhắn cho agent", "sr-only"); inputLabel.htmlFor = "chat-input";
  const input = node("textarea"); input.id = "chat-input"; input.rows = 3; input.maxLength = 32_000; input.placeholder = "Bạn muốn làm video như thế nào?";
  const composerActions = node("div", undefined, "chat-composer-actions");
  const attach = action("Thêm tư liệu", () => fileInput.click(), "button button-ghost"); attach.id = "chat-attach"; attach.prepend(svgIcon(ICONS.file, { size: 16 }));
  const fileInput = node("input"); fileInput.type = "file"; fileInput.multiple = true; fileInput.hidden = true; fileInput.id = "chat-files";
  const controls = node("div", undefined, "chat-send-controls");
  const stop = action("Dừng", async () => {
    stop.disabled = true;
    try { const result = await post(endpoint("interrupt"), {}); acceptSession(result.session); }
    catch (error) { setNotice(error.message); }
    finally { updateControls(); }
  }, "button button-quiet"); stop.id = "chat-stop"; stop.hidden = true;
  const submit = node("button", "Gửi", "button button-primary"); submit.type = "submit"; submit.id = "chat-send";
  controls.append(stop, submit); composerActions.append(attach, controls);
  composer.append(chips, inputLabel, input, fileInput, composerActions);
  const hint = node("p", "Enter để gửi · Shift + Enter để xuống dòng. Lượt chat dùng hạn mức tài khoản Codex đang kết nối.", "chat-hint");
  root.append(head, projectBar, conversations, newProjectForm, connection, options, resetBox, history, jump, requests, status, noticeBox, composer, hint);

  function draft() {
    const key = projectId ?? "new";
    if (!drafts.has(key)) {
      let stored = null;
      try { stored = JSON.parse(sessionStorage.getItem("padstudio-chat-draft:" + key)); } catch { /* Optional browser storage. */ }
      drafts.set(key, stored && typeof stored.text === "string" && Array.isArray(stored.attachments)
        ? stored : { text: "", attachments: [], anchor: null, model: "", attempt: null });
    }
    return drafts.get(key);
  }

  function saveDraft() {
    const value = draft(); value.text = input.value; value.model = model.value;
    try { sessionStorage.setItem("padstudio-chat-draft:" + (projectId ?? "new"), JSON.stringify(value)); } catch { /* Optional browser storage. */ }
    updateControls();
  }

  function resize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; }
  function endpoint(action = "") { return `/api/chat/projects/${encodeURIComponent(projectId)}` + (action ? "/" + action : ""); }
  function setNotice(message) { notice = message || ""; noticeBox.textContent = notice; noticeBox.hidden = !notice; }

  async function post(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-PADStudio-Intent": "chat" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể gửi yêu cầu.");
    return result;
  }

  async function createProject(titleText) {
    const result = await post("/api/chat/projects", { title: titleText });
    await onProjectCreated(result.project);
    return result.project.id;
  }

  function updateControls() {
    const waiting = Boolean(session?.requests.length);
    submit.disabled = sending || uploading || !online || !state.connected || !state.authenticated || waiting || (!input.value.trim() && !draft().attachments.length);
    submit.textContent = sending ? "Đang gửi…" : session?.active ? "Gửi bổ sung" : "Gửi";
    stop.hidden = !session?.active; stop.disabled = sending || !online;
    attach.disabled = uploading || sending || !online;
    model.disabled = Boolean(session?.active) || sending;
    newChat.disabled = Boolean(session?.active) || sending || !session?.hasConversation;
    conversations.disabled = Boolean(session?.active) || sending;
    status.textContent = !online ? "Mất kết nối. Đang thử kết nối lại…" : sending ? "Đang gửi yêu cầu…" : uploading ? "Đang thêm tư liệu vào dự án…"
      : waiting ? "Đang chờ bạn trả lời" : session?.active ? "Agent đang làm việc…" : state.authenticated ? "Sẵn sàng" : "Kết nối Codex để bắt đầu";
    root.classList.toggle("is-working", Boolean(session?.active));
  }

  function renderConnection() {
    connection.replaceChildren();
    connection.hidden = state.connected && state.authenticated && !state.error;
    subtitle.textContent = !state.connected ? "Chưa kết nối Codex" : state.authenticated ? "Codex · Đã kết nối" : "Codex · Cần đăng nhập";
    if (!state.connected || state.error) {
      connection.append(node("p", state.error || "Dùng Codex trên máy để trò chuyện và làm video."));
      connection.append(action("Kết nối Codex", () => connect(), "button button-soft"));
    } else if (!state.authenticated) {
      connection.append(node("p", "Đăng nhập tài khoản ChatGPT để dùng Codex."));
      if (state.login?.url) {
        const link = node("a", "Mở trang đăng nhập", "button button-soft"); link.href = state.login.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        connection.append(link, action("Hủy đăng nhập", async () => {
          try { acceptStatus((await post("/api/chat/login/cancel", {})).status); } catch (error) { setNotice(error.message); }
        }, "button button-ghost"));
      } else connection.append(action("Đăng nhập ChatGPT", async () => {
        try { acceptStatus((await post("/api/chat/login", {})).status); } catch (error) { setNotice(error.message); }
      }, "button button-soft"));
    }
    const value = draft().model || "";
    model.replaceChildren();
    const defaultOption = node("option", "Mặc định Codex"); defaultOption.value = ""; model.append(defaultOption);
    for (const entry of state.models ?? []) { const option = node("option", entry.name); option.value = entry.id; model.append(option); }
    if ([...model.options].some((option) => option.value === value)) model.value = value;
    options.hidden = !state.authenticated;
    updateControls();
  }

  function acceptStatus(next) {
    if (!next) return;
    const signature = JSON.stringify(state);
    state = next;
    if (signature !== JSON.stringify(next)) renderConnection();
    updateControls();
  }

  function scrollToEnd(force = false) {
    if (force || history.scrollHeight - history.scrollTop - history.clientHeight < 100) {
      history.scrollTop = history.scrollHeight; jump.hidden = true;
    } else jump.hidden = false;
  }

  function renderMessages() {
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 100;
    const items = session?.items ?? [];
    empty.hidden = items.length > 0; older.hidden = !session?.truncated;
    const present = new Set();
    for (const item of items) {
      present.add(item.id);
      let rendered = renderedItems.get(item.id);
      if (!rendered) {
        const element = node(item.role === "tool" ? "details" : "article", undefined, `chat-message chat-message-${item.role}`);
        element.dataset.messageId = item.id;
        if (item.role === "tool") {
          const summary = node("summary"); const body = node("pre"); element.append(summary, body);
          rendered = { element, body, summary };
        } else {
          const label = node("span", item.role === "user" ? "Bạn" : "Codex", "chat-message-author");
          const body = node("div", undefined, "chat-prose"); element.append(label, body); rendered = { element, body };
        }
        renderedItems.set(item.id, rendered);
      }
      const signature = JSON.stringify(item);
      if (rendered.signature !== signature) {
        if (item.role === "tool") {
          const working = item.status === "inProgress";
          rendered.summary.textContent = item.kind === "command" ? (working ? "Đang chạy lệnh" : item.exitCode === 0 ? "Đã chạy lệnh" : "Kết quả chạy lệnh")
            : item.kind === "files" ? "Thay đổi file" : item.kind === "search" ? "Tìm kiếm trên web" : item.text;
          rendered.body.textContent = [item.text, item.output].filter(Boolean).join("\n\n");
        } else if (item.role === "assistant") renderChatMarkdown(rendered.body, item.text);
        else rendered.body.textContent = item.text;
        rendered.element.classList.toggle("is-uncertain", item.status === "uncertain");
        rendered.signature = signature;
      }
      messages.append(rendered.element);
    }
    for (const [id, rendered] of renderedItems) if (!present.has(id)) { rendered.element.remove(); renderedItems.delete(id); }
    if (nearBottom) scrollToEnd(true); else if (items.length) jump.hidden = false;
  }

  function renderRequests() {
    const values = session?.requests ?? [];
    const signature = JSON.stringify(values);
    if (requestSignature === signature) return;
    requestSignature = signature; requests.replaceChildren();
    for (const request of values) {
      const form = node("form", undefined, "chat-request"); form.dataset.requestId = request.id;
      form.append(node("h3", request.title));
      if (request.reason) form.append(node("p", request.reason));
      if (request.detail) form.append(node("pre", request.detail));
      const fields = new Map();
      for (const question of request.questions ?? []) {
        const label = node("label", question.question, "chat-question");
        let field;
        if (question.options.length && !question.secret) {
          field = node("select", undefined, "select");
          const placeholder = node("option", "Chọn câu trả lời…"); placeholder.value = ""; field.append(placeholder);
          for (const option of question.options) { const entry = node("option", option.label); entry.value = option.label; field.append(entry); }
          const custom = node("option", "Nhập câu trả lời khác…"); custom.value = "__custom__"; field.append(custom);
          const details = node("div", undefined, "chat-option-descriptions");
          for (const option of question.options) if (option.description) details.append(node("p", option.label + ": " + option.description));
          const other = node("input"); other.placeholder = "Câu trả lời của bạn"; other.hidden = true; other.maxLength = 8_000;
          field.addEventListener("change", () => { other.hidden = field.value !== "__custom__"; other.required = !other.hidden; if (!other.hidden) other.focus(); });
          label.append(field, other, details); fields.set(question.id, () => field.value === "__custom__" ? other.value : field.value);
        } else {
          field = node("input"); field.type = question.secret ? "password" : "text"; field.maxLength = 8_000;
          label.append(field); fields.set(question.id, () => field.value);
        }
        field.required = true; form.append(label);
      }
      for (const spec of request.fields ?? []) {
        const label = node("label", spec.label, "chat-question");
        const field = node(spec.options ? "select" : "input", undefined, spec.options ? "select" : "");
        if (spec.options) for (const option of spec.options) { const entry = node("option", String(option)); entry.value = String(option); field.append(entry); }
        else field.type = spec.type === "boolean" ? "checkbox" : ["integer", "number"].includes(spec.type) ? "number" : "text";
        if (field.type === "number") field.step = spec.type === "integer" ? "1" : "any";
        if (field.type !== "checkbox") field.required = spec.required;
        label.append(field); if (spec.description) label.append(node("small", spec.description)); form.append(label);
        fields.set(spec.name, () => spec.type === "boolean" ? field.checked : ["integer", "number"].includes(spec.type) ? (field.value === "" ? "" : Number(field.value)) : field.value);
      }
      if (request.url) {
        const link = node("a", "Mở trang cần xác nhận", "button button-soft"); link.href = request.url; link.target = "_blank"; link.rel = "noopener noreferrer"; form.append(link);
      }
      const buttons = node("div", undefined, "chat-request-actions");
      const accept = node("button", request.kind === "questions" || request.kind === "form" ? "Gửi câu trả lời" : request.kind === "external" ? "Tôi đã hoàn tất" : "Cho phép lần này", "button button-soft"); accept.type = "submit";
      const answer = async (decision) => {
        const currentProject = projectId;
        for (const button of buttons.querySelectorAll("button")) button.disabled = true;
        try {
          const data = Object.fromEntries([...fields].map(([key, value]) => [key, value()]));
          const result = await post(endpoint("answer"), { requestId: request.id, decision, answers: data, content: data });
          if (projectId === currentProject) { acceptSession(result.session); setNotice(""); }
        } catch (error) { setNotice(error.message); for (const button of buttons.querySelectorAll("button")) button.disabled = false; }
      };
      buttons.append(accept, action(request.kind === "questions" ? "Bỏ qua" : "Từ chối", () => answer("decline"), "button button-ghost"));
      form.append(buttons); form.addEventListener("submit", (event) => { event.preventDefault(); answer("accept"); }); requests.append(form);
    }
  }

  function acceptSession(next) {
    if (!next || next.projectId !== projectId) return;
    session = next; renderMessages(); renderRequests(); updateControls();
    const signature = JSON.stringify(session.conversations ?? []);
    if (conversationSignature !== signature) {
      conversationSignature = signature; conversations.replaceChildren();
      if (!session.hasConversation) { const placeholder = node("option", "Cuộc trò chuyện mới"); placeholder.value = ""; conversations.append(placeholder); }
      for (const entry of session.conversations ?? []) {
        const option = node("option", entry.title); option.value = entry.id; option.selected = entry.current; conversations.append(option);
      }
      conversations.hidden = (session.conversations?.length ?? 0) < (session.hasConversation ? 2 : 1);
    }
    if (session.error) setNotice(session.error);
  }

  function renderChips() {
    chips.replaceChildren();
    const value = draft();
    for (const attachment of value.attachments) {
      const chip = node("span", undefined, "chat-attachment");
      chip.append(node("span", attachment.name + " · " + formatSize(attachment.sizeBytes)));
      const remove = action("×", () => { value.attachments = value.attachments.filter((entry) => entry.resourceId !== attachment.resourceId); saveDraft(); renderChips(); }, "chat-chip-remove");
      remove.setAttribute("aria-label", "Bỏ " + attachment.name + " khỏi tin nhắn"); chip.append(remove); chips.append(chip);
    }
    if (value.anchor || (!value.omitVideoTarget && getVideoTarget())) {
      const chip = node("span", undefined, "chat-attachment chat-anchor"); chip.append(node("span", value.anchor ? "Đã gắn mốc video đang xem" : "Kèm bản video đang xem"));
      const remove = action("×", () => { value.anchor = null; value.omitVideoTarget = true; saveDraft(); renderChips(); }, "chat-chip-remove");
      remove.setAttribute("aria-label", "Bỏ mốc video khỏi tin nhắn"); chip.append(remove); chips.append(chip);
    }
  }

  async function loadSession() {
    if (!projectId) return;
    const current = projectId; const version = generation;
    const response = await fetch(endpoint()); const result = await response.json();
    if (version !== generation || current !== projectId) return;
    if (!response.ok) throw new Error(result.error || "Không mở được hội thoại.");
    acceptSession(result.session);
  }

  function subscribe() {
    stream?.close(); stream = null;
    if (!opened || document.hidden) return;
    const version = generation;
    stream = new EventSource("/api/chat/events" + (projectId ? "?project=" + encodeURIComponent(projectId) : ""));
    stream.addEventListener("state", (event) => {
      if (version !== generation) return;
      const data = JSON.parse(event.data); online = true; acceptStatus(data.status); acceptSession(data.session); updateControls();
    });
    stream.onopen = () => { online = true; loadSession().catch((error) => setNotice(error.message)); updateControls(); };
    stream.onerror = () => { online = false; updateControls(); };
  }

  async function connect() {
    setNotice("");
    connection.replaceChildren(node("p", "Đang kết nối Codex…"));
    try { acceptStatus((await post("/api/chat/connect", {})).status); await loadSession(); }
    catch (error) { state = { ...state, connected: false, error: error.message }; renderConnection(); }
  }

  function modalState() {
    const otherModal = ["#library", "#tools"].some((selector) => !document.querySelector(selector).hidden);
    const modal = opened && smallScreen.matches && !otherModal;
    root.setAttribute("role", modal ? "dialog" : "complementary");
    if (modal) root.setAttribute("aria-modal", "true"); else root.removeAttribute("aria-modal");
    document.querySelector("#main").inert = modal || otherModal;
    document.querySelector("#topbar").inert = modal || otherModal;
    root.inert = otherModal;
    root.classList.toggle("is-covered", otherModal && smallScreen.matches);
    document.body.classList.toggle("chat-modal-open", modal);
  }

  function openPanel() {
    if (opened) { input.focus(); return; }
    returnFocus = document.activeElement;
    opened = true; root.hidden = false; document.body.classList.add("chat-is-open"); toggle.setAttribute("aria-expanded", "true");
    modalState(); renderConnection(); subscribe(); connect(); input.focus(); resize(); scrollToEnd(true);
    const url = new URL(location.href); url.searchParams.set("chat", "1"); historyUrl(url);
  }
  function historyUrl(url) { window.history.replaceState(null, "", url); }
  function close() {
    opened = false; root.hidden = true; document.body.classList.remove("chat-is-open"); toggle.setAttribute("aria-expanded", "false");
    stream?.close(); stream = null; modalState();
    const url = new URL(location.href); url.searchParams.delete("chat"); historyUrl(url);
    if (returnFocus?.isConnected && returnFocus !== document.body && !root.contains(returnFocus)) returnFocus.focus(); else toggle.focus();
  }

  async function setProject(id, name = "") {
    if (id === projectId) { if (name) { projectTitle = name; projectName.textContent = name; } return; }
    if (projectId !== undefined) saveDraft();
    projectId = id; projectTitle = name; generation += 1; session = null; requestSignature = ""; conversationSignature = "";
    conversations.hidden = true;
    requests.replaceChildren(); messages.replaceChildren(); renderedItems = new Map();
    projectName.textContent = projectTitle || "Một video mới"; projectName.title = projectTitle;
    input.value = draft().text; renderChips(); renderMessages(); renderConnection(); setNotice(""); resize();
    resetBox.hidden = true;
    if (opened) { subscribe(); loadSession().catch((error) => setNotice(error.message)); }
  }

  async function addFiles(files) {
    if (uploading || sending) return;
    uploading = true; setNotice(""); updateControls();
    let current = projectId;
    try {
      if (!current) current = await createProject("Video mới");
      const destination = draft();
      for (const file of [...files]) {
        if (destination.attachments.length >= 12) throw new Error("Mỗi tin nhắn tối đa 12 tư liệu.");
        if (file.size > MAX_UPLOAD) throw new Error(file.name + ": mỗi tư liệu tối đa 100 MB.");
        if (!file.size) throw new Error(file.name + ": file đang trống.");
        const response = await fetch(`/api/chat/projects/${encodeURIComponent(current)}/attachments`, { method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-PADStudio-Intent": "chat", "X-PADStudio-Filename": encodeURIComponent(file.name) }, body: file });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không thêm được tư liệu.");
        destination.attachments.push(result.attachment);
        if (current === projectId) { renderChips(); saveDraft(); }
      }
    } catch (error) { setNotice(error.message); }
    finally { uploading = false; fileInput.value = ""; updateControls(); }
  }

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    sending = true; setNotice(""); updateControls();
    const original = draft(); const message = input.value; let current = projectId;
    try {
      if (!current) {
        current = await createProject(message.trim().split("\n")[0].slice(0, 100) || "Video mới");
        Object.assign(draft(), original); input.value = message;
      }
      const value = draft();
      const base = { message, model: value.model || null, attachments: value.attachments.map((entry) => entry.resourceId), anchor: value.anchor };
      const signature = JSON.stringify([base, Boolean(value.omitVideoTarget)]);
      const sameAttempt = value.attempt?.signature === signature;
      const body = sameAttempt ? value.attempt.body : { ...base, anchor: value.anchor || (!value.omitVideoTarget ? getVideoTarget() : null) };
      const clientId = sameAttempt ? value.attempt.clientId : crypto.randomUUID();
      value.attempt = { signature, clientId, body }; saveDraft();
      const result = await post(`/api/chat/projects/${encodeURIComponent(current)}/messages`, { ...body, clientId });
      if (current === projectId) {
        value.text = ""; value.attachments = []; value.anchor = null; value.omitVideoTarget = false; value.attempt = null; input.value = "";
        saveDraft(); renderChips(); acceptSession(result.session); resize(); scrollToEnd(true); input.focus();
      }
    } catch (error) { setNotice(error.message + " Nếu mất kết nối khi gửi, kiểm tra lịch sử trước khi gửi lại."); }
    finally { sending = false; updateControls(); }
  });
  input.addEventListener("input", () => { saveDraft(); resize(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!submit.disabled) composer.requestSubmit(); }
  });
  input.addEventListener("paste", (event) => { if (event.clipboardData.files.length) { event.preventDefault(); addFiles(event.clipboardData.files); } });
  model.addEventListener("change", saveDraft);
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  history.addEventListener("scroll", () => { if (history.scrollHeight - history.scrollTop - history.clientHeight < 100) jump.hidden = true; });
  newProjectForm.addEventListener("submit", async (event) => {
    event.preventDefault(); createSubmit.disabled = true;
    try { await createProject(newProjectName.value); newProjectName.value = ""; newProjectForm.hidden = true; input.focus(); }
    catch (error) { setNotice(error.message); }
    finally { createSubmit.disabled = false; }
  });
  root.addEventListener("dragover", (event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); root.classList.add("is-dragging"); } });
  root.addEventListener("dragleave", (event) => { if (!root.contains(event.relatedTarget)) root.classList.remove("is-dragging"); });
  root.addEventListener("drop", (event) => { event.preventDefault(); root.classList.remove("is-dragging"); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab" || !smallScreen.matches) return;
    const candidates = [...root.querySelectorAll(focusable)].filter((element) => element.getClientRects().length);
    const first = candidates[0]; const last = candidates.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  toggle.addEventListener("click", () => opened ? close() : openPanel());
  smallScreen.addEventListener("change", modalState);
  document.addEventListener("visibilitychange", subscribe);
  document.addEventListener("padstudio-feedback", (event) => {
    if (event.detail.projectId !== projectId) return;
    draft().anchor = { resultId: event.detail.resultId, text: event.detail.text }; draft().omitVideoTarget = false; renderChips(); saveDraft(); openPanel(); input.focus();
    input.placeholder = "Bạn muốn sửa gì ở vị trí này?";
  });
  return { open: openPanel, close, setProject, refreshVideoTarget: renderChips, syncModal: modalState };
}
