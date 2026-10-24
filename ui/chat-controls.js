import { node, svgIcon } from "./dom.js";

const button = (text, run, className = "button button-ghost") => {
  const element = node("button", text, className); element.type = "button";
  element.addEventListener("click", run); return element;
};
const icon = (label, path, run) => {
  const element = button("", run, "icon-button"); element.title = label; element.setAttribute("aria-label", label); element.append(svgIcon(path)); return element;
};

// Ordinary Codex client actions. No knowledge of the video viewer or ProjectStore.
export function createChatControls({ root, composer, input, context, post, endpoint, save, update, notice, adopt, apply, newConversation }) {
  let active = null; let anchor = null; let historyGeneration = 0; let fileGeneration = 0; let attachmentSignature = "";
  const popup = node("section", undefined, "chat-popover"); popup.hidden = true; popup.id = "chat-popover";
  popup.setAttribute("aria-label", "Tùy chọn trò chuyện");
  const closePopup = (restoreFocus = false) => { if (!active) return false; popup.hidden = true; active = null; anchor?.setAttribute("aria-expanded", "false"); if (restoreFocus) anchor?.focus(); return true; };
  const open = (kind, trigger, title) => {
    if (active === kind) { closePopup(); return false; }
    closePopup(); active = kind; anchor = trigger; popup.hidden = false; popup.replaceChildren();
    popup.dataset.kind = kind; trigger?.setAttribute("aria-expanded", "true");
    const head = node("div", undefined, "chat-popover-head");
    head.append(node("strong", title), button("Đóng", () => { closePopup(); trigger?.focus(); })); popup.append(head); return true;
  };
  const optionsButton = icon("Thiết lập Codex", "M4 7h16M4 17h16M8 4v6m8 4v6", settings); optionsButton.id = "chat-settings";
  const moreButton = icon("Thao tác hội thoại", "M5 12h.01M12 12h.01M19 12h.01", actions); moreButton.id = "chat-more";
  const attachButton = icon("Đính kèm file", "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-1 8-5 5", () => picker.click()); attachButton.id = "chat-attach";
  const referenceButton = button("@", references, "icon-button chat-reference"); referenceButton.title = "Tham chiếu file hoặc skill"; referenceButton.setAttribute("aria-label", referenceButton.title); referenceButton.id = "chat-reference";
  for (const trigger of [optionsButton, moreButton, referenceButton]) { trigger.setAttribute("aria-controls", popup.id); trigger.setAttribute("aria-expanded", "false"); }
  const picker = node("input"); picker.type = "file"; picker.multiple = true; picker.hidden = true; picker.id = "chat-file-picker";
  const attachmentList = node("div", undefined, "chat-attachments"); attachmentList.id = "chat-attachments";
  const info = button("", settings, "chat-context-info"); info.id = "chat-context-info"; info.hidden = true;
  const findBar = node("div", undefined, "chat-find"); findBar.hidden = true;
  const find = node("input"); find.type = "search"; find.placeholder = "Tìm trong hội thoại…"; find.setAttribute("aria-label", find.placeholder);
  const found = node("span"); let matches = []; let foundIndex = -1;
  const findNext = (direction = 1) => {
    for (const match of matches) match.classList.remove("chat-search-match");
    const query = find.value.trim().toLocaleLowerCase();
    matches = query ? [...root.querySelectorAll(".chat-message")].filter((element) => element.textContent.toLocaleLowerCase().includes(query)) : [];
    foundIndex = matches.length ? (foundIndex + direction + matches.length) % matches.length : -1;
    found.textContent = matches.length ? `${foundIndex + 1}/${matches.length}` : query ? "0 kết quả" : "";
    matches[foundIndex]?.classList.add("chat-search-match"); matches[foundIndex]?.scrollIntoView({ block: "center" });
  };
  const closeFind = () => { findBar.hidden = true; for (const match of matches) match.classList.remove("chat-search-match"); input.focus(); };
  find.addEventListener("input", () => { foundIndex = -1; findNext(); });
  find.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); findNext(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { event.stopPropagation(); closeFind(); } });
  findBar.append(find, found, button("↑", () => findNext(-1)), button("↓", () => findNext()), button("Đóng", closeFind));
  function showFind() { closePopup(); findBar.hidden = false; find.focus(); find.select(); }

  function settings() {
    if (!open("settings", optionsButton, "Thiết lập Codex")) return;
    const { state, session, draft } = context();
    const model = state.models.find((entry) => entry.id === (draft.model || session?.model)) || state.models.find((entry) => entry.isDefault);
    const definitions = [
      ["effort", "Mức suy luận", (model?.efforts || []).map((id) => ({ id, name: ({ minimal: "Tối thiểu", low: "Thấp", medium: "Vừa", high: "Cao", xhigh: "Rất cao", max: "Tối đa", ultra: "Ultra" })[id] || id }))],
      ["mode", "Chế độ làm việc", (state.modes || []).map((entry) => ({ id: entry.mode, name: entry.mode === "plan" ? "Lập kế hoạch" : "Làm việc" }))],
      ["permissions", "Quyền chạy", (state.permissions || []).map((entry) => ({ id: entry.id, name: ({ ":read-only": "Chỉ đọc", ":workspace": "Trong thư mục làm việc", ":danger-full-access": "Toàn quyền trên máy" })[entry.id] || entry.id }))]
    ];
    for (const [key, title, entries] of definitions) {
      if (!entries.length) continue;
      const label = node("label", title, "chat-setting"); const select = node("select", undefined, "select"); select.id = "chat-option-" + key;
      const inherit = node("option", "Giữ cấu hình Codex"); inherit.value = ""; select.append(inherit);
      for (const entry of entries) { const option = node("option", entry.name); option.value = entry.id; select.append(option); }
      select.value = draft.options?.[key] || ""; select.disabled = Boolean(session?.active || draft.sending);
      select.addEventListener("change", () => { const current = context().draft; current.options ??= {}; if (select.value) current.options[key] = select.value; else delete current.options[key]; save(); refresh(); });
      label.append(select); popup.append(label);
    }
    popup.append(node("p", "Thiết lập được áp dụng khi bạn gửi tin tiếp theo. Codex giữ lựa chọn này cho các lượt sau; “Giữ cấu hình” không ghi đè lựa chọn đang có.", "chat-menu-empty"));
    const current = session?.effective || {};
    popup.append(node("p", `Hiện tại: ${session?.model || "model mặc định"}${current.effort ? " · " + current.effort : ""}${current.mode ? " · " + current.mode : ""}${current.permissions ? " · " + current.permissions : ""}`, "chat-menu-empty"));
    if (session?.usage) popup.append(node("p", `Ngữ cảnh: ${(session.usage.last ?? 0).toLocaleString()} token${session.usage.contextWindow ? " / " + session.usage.contextWindow.toLocaleString() : ""}`, "chat-menu-empty"));
    for (const [key, title] of [["primary", "Hạn mức ngắn hạn"], ["secondary", "Hạn mức dài hạn"]]) {
      const rate = state.rateLimits?.[key]; if (!rate) continue;
      const row = node("label", `${title}: ${Math.round(rate.usedPercent)}% đã dùng`, "chat-setting");
      const meter = node("progress"); meter.max = 100; meter.value = rate.usedPercent; row.append(meter);
      if (rate.resetsAt) row.append(node("small", "Đặt lại " + new Date(rate.resetsAt * 1000).toLocaleString())); popup.append(row);
    }
  }

  async function run(action, body = {}) {
    const id = context().id; closePopup();
    try { const result = await post(endpoint(action, id), body); action === "fork" ? adopt(result.session) : apply(result.session); }
    catch (error) { if (context().id === id) notice(error.message); }
  }
  function actions() {
    if (!open("actions", moreButton, "Hội thoại")) return;
    const { session } = context();
    const rename = node("form", undefined, "chat-rename"); const name = node("input"); name.id = "chat-rename-input"; name.setAttribute("aria-label", "Tên hội thoại"); name.placeholder = "Tên hội thoại"; name.maxLength = 120;
    name.value = session?.conversations.find((entry) => entry.id === context().id)?.title || "";
    const submit = node("button", "Đổi tên", "button button-soft"); submit.type = "submit";
    rename.append(name, submit); rename.addEventListener("submit", (event) => { event.preventDefault(); run("rename", { name: name.value }); }); popup.append(rename);
    const entries = [
      ["Cuộc trò chuyện mới", () => { closePopup(); newConversation(); }],
      ["Tìm trong hội thoại", showFind],
      ["Phân nhánh hội thoại", () => run("fork"), !session?.hasConversation],
      ["Thu gọn ngữ cảnh", () => run("compact"), !session?.hasConversation],
      ["Xuất Markdown", () => download("md")], ["Xuất JSON", () => download("json")],
      [session?.archived ? "Khôi phục hội thoại" : "Lưu trữ hội thoại", () => run(session?.archived ? "unarchive" : "archive")]
    ];
    for (const [label, handler, disabled] of entries) {
      const entry = button(label, handler, "chat-conversation-entry"); entry.disabled = Boolean(disabled || session?.active && ["Phân nhánh hội thoại", "Thu gọn ngữ cảnh", "Lưu trữ hội thoại"].includes(label)); popup.append(entry);
    }
  }
  async function download(format) {
    const id = context().id; closePopup();
    try {
      const response = await fetch(endpoint("export", id)); const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const content = format === "json" ? JSON.stringify(data, null, 2) : `# ${data.title || "Codex"}\n\n` + data.items.map((item) => `## ${item.role === "user" ? "Bạn" : item.role === "assistant" ? "Codex" : "Công cụ"}\n\n${item.text || ""}${(item.attachments || []).map((entry) => `\n\n- ${entry.kind === "image" ? "Ảnh" : entry.kind === "skill" ? "Skill" : "File"}: ${entry.path || entry.name}`).join("")}${item.output ? "\n\n```\n" + item.output + "\n```" : ""}\n`).join("\n");
      const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown;charset=utf-8" }));
      const link = node("a"); link.href = url; link.download = `codex-${id}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { notice(error.message); }
  }

  async function upload(files) {
    const { draft, id } = context(); draft.attachments ??= [];
    if (draft.uploading || draft.sending) { notice("Đợi thao tác gửi hoặc đính kèm hiện tại hoàn tất."); return; }
    if (draft.attachments.length + files.length > 10) { notice("Mỗi tin nhắn tối đa 10 file đính kèm."); return; }
    draft.uploading = true; update();
    try {
      for (const file of files) {
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Mỗi file phải từ 1 byte đến 10 MB.");
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Không đọc được file.")); reader.readAsDataURL(file); });
        const result = await post("/api/chat/attachments", { name: file.name, data }); draft.attachments.push(result.attachment);
      }
    } catch (error) { notice(error.message); }
    finally { draft.uploading = false; save(draft, id); refresh(); update(); }
  }
  picker.addEventListener("change", () => { upload([...picker.files]); picker.value = ""; });
  input.addEventListener("paste", (event) => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); upload(files); } });
  composer.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); composer.classList.add("is-dragging"); } });
  composer.addEventListener("dragleave", () => composer.classList.remove("is-dragging"));
  composer.addEventListener("drop", (event) => { composer.classList.remove("is-dragging"); const files = [...(event.dataTransfer?.files || [])]; if (files.length) { event.preventDefault(); upload(files); } });

  function refresh() {
    const { draft, session, id } = context();
    const chips = [
      ...(draft.attachments || []).map((entry) => ({ name: entry.name, kind: entry.kind, id: entry.id, group: "attachments", entry })),
      ...(draft.references || []).map((path) => ({ name: path.split(/[\\/]/).at(-1), group: "references", entry: path })),
      ...(draft.skills || []).map((name) => ({ name: "$" + name, group: "skills", entry: name }))
    ];
    const signature = JSON.stringify([id, chips]);
    if (signature !== attachmentSignature) {
      attachmentSignature = signature; attachmentList.replaceChildren();
      for (const chip of chips) {
      const element = node("div", undefined, "chat-attachment"); element.title = chip.name;
      if (chip.kind === "image") { const image = node("img"); image.src = `/api/chat/attachments/${chip.id}/image`; image.alt = ""; element.append(image); }
      element.append(node("span", chip.name), button("×", () => { draft[chip.group] = draft[chip.group].filter((entry) => entry !== chip.entry); save(); refresh(); }, "chat-attachment-remove")); attachmentList.append(element);
      }
    }
    attachmentList.hidden = !chips.length;
    optionsButton.classList.toggle("has-options", Object.keys(draft.options || {}).length > 0);
    attachButton.disabled = Boolean(draft.uploading || draft.sending || session?.archived);
    info.hidden = !session?.usage;
    if (session?.usage) {
      const used = session.usage.last || 0, limit = session.usage.contextWindow;
      info.textContent = limit ? `${Math.min(100, Math.round(used / limit * 100))}% ngữ cảnh` : `${used.toLocaleString()} token`;
    }
  }

  function references() {
    if (!open("references", referenceButton, "Tham chiếu file hoặc skill")) return;
    const query = node("input"); query.type = "search"; query.placeholder = "Tìm file trong thư mục…"; query.id = "chat-file-search"; query.setAttribute("aria-label", query.placeholder);
    const results = node("div", undefined, "chat-picker-results"); const skills = node("div", undefined, "chat-picker-results");
    popup.append(query, results, node("p", "Skill có sẵn", "chat-menu-heading"), skills);
    for (const skill of context().state.skills || []) {
      const entry = button(skill.name, () => { const draft = context().draft; draft.skills = [...new Set([...(draft.skills || []), skill.name])].slice(0, 10); save(); refresh(); closePopup(); input.focus(); }, "chat-conversation-entry"); entry.title = skill.description; skills.append(entry);
    }
    let timer;
    query.addEventListener("input", () => {
      clearTimeout(timer); const version = ++fileGeneration;
      timer = setTimeout(async () => {
        try {
          const response = await fetch("/api/chat/files?q=" + encodeURIComponent(query.value)); const result = await response.json();
          if (version !== fileGeneration || active !== "references") return;
          if (!response.ok) throw new Error(result.error); results.replaceChildren();
          for (const file of result.data) results.append(button(file.name, () => { const draft = context().draft; draft.references = [...new Set([...(draft.references || []), file.path])].slice(0, 10); save(); refresh(); closePopup(); input.focus(); }, "chat-conversation-entry"));
          if (!result.data.length) results.append(node("p", "Không tìm thấy file.", "chat-menu-empty"));
        } catch (error) { if (version === fileGeneration) results.textContent = error.message; }
      }, 200);
    }); query.focus();
  }

  function addHistory(menu) {
    const section = node("section", undefined, "chat-native-history");
    const search = node("input"); search.type = "search"; search.id = "chat-history-search"; search.placeholder = "Tìm lịch sử Codex trên máy…"; search.setAttribute("aria-label", search.placeholder);
    const label = node("label", "Đã lưu trữ", "chat-history-archived"); const archived = node("input"); archived.type = "checkbox"; archived.id = "chat-history-archived"; label.prepend(archived);
    const results = node("div", undefined, "chat-native-results"); results.id = "chat-native-results";
    let cursor = null; let timer;
    const more = button("Xem thêm", () => load(true), "button button-ghost"); more.hidden = true;
    async function load(append = false) {
      const version = ++historyGeneration;
      if (!append) { cursor = null; results.replaceChildren(node("p", "Đang tải lịch sử…", "chat-menu-empty")); }
      more.disabled = true;
      try {
        const query = new URLSearchParams({ q: search.value, archived: archived.checked ? "1" : "0" }); if (append && cursor) query.set("cursor", cursor);
        const response = await fetch("/api/chat/history?" + query); const data = await response.json();
        if (version !== historyGeneration) return; if (!response.ok) throw new Error(data.error);
        if (!append) results.replaceChildren(); cursor = data.nextCursor;
        for (const entry of data.data) {
          const row = button("", async () => {
            row.disabled = true;
            try { const result = await post(entry.archived ? "/api/chat/restore" : "/api/chat/resume", { threadId: entry.threadId }); menu.hidden = true; adopt(result.session); }
            catch (error) { notice(error.message); } finally { row.disabled = false; }
          }, "chat-conversation-entry");
          row.append(node("span", entry.title), node("small", entry.archived ? "Khôi phục" : entry.source)); row.title = entry.title; results.append(row);
        }
        if (!results.childNodes.length) results.append(node("p", "Chưa có hội thoại phù hợp trong thư mục này.", "chat-menu-empty"));
        more.hidden = !cursor;
      } catch (error) { if (version === historyGeneration) results.replaceChildren(node("p", error.message, "chat-menu-empty")); }
      finally { more.disabled = false; }
    }
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => load(), 200); }); archived.addEventListener("change", () => load());
    section.append(node("p", "Lịch sử Codex · thư mục hiện tại", "chat-menu-heading"), search, label, results, more); menu.append(section);
    return () => { load(); search.focus(); };
  }

  document.addEventListener("pointerdown", (event) => { if (!popup.hidden && !popup.contains(event.target) && ![optionsButton, moreButton, referenceButton, info].some((button) => button.contains(event.target))) closePopup(); });
  root.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); showFind(); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); newConversation(); }
  });
  // Slash commands are client actions, not instructions inserted into a model prompt.
  function slash() {
    const command = input.value.trim();
    const commands = { "/new": newConversation, "/model": settings, "/permissions": settings, "/plan": () => { context().draft.options = { ...context().draft.options, mode: "plan" }; save(); refresh(); }, "/default": () => { context().draft.options = { ...context().draft.options, mode: "default" }; save(); refresh(); }, "/compact": () => run("compact"), "/fork": () => run("fork"), "/status": settings, "/help": help };
    if (!commands[command]) return false;
    input.value = ""; save(); commands[command](); return true;
  }
  function help() {
    if (!open("help", moreButton, "Phím tắt và lệnh nhanh")) return;
    popup.append(node("p", "Enter: gửi · Shift+Enter: xuống dòng · Ctrl+F: tìm hội thoại · Ctrl+Shift+O: chat mới", "chat-menu-empty"));
    for (const [command, label] of [["/new", "Chat mới"], ["/model", "Model và thiết lập"], ["/plan", "Chọn chế độ lập kế hoạch"], ["/default", "Chọn chế độ làm việc"], ["/permissions", "Quyền chạy"], ["/compact", "Thu gọn ngữ cảnh"], ["/fork", "Phân nhánh"], ["/status", "Trạng thái và hạn mức"]]) popup.append(button(command + " · " + label, () => { input.value = command; save(); closePopup(); input.focus(); }, "chat-conversation-entry"));
  }
  return { popup, optionsButton, moreButton, attachButton, referenceButton, picker, attachmentList, info, findBar, refresh, closePopup, addHistory, slash, help, run };
}
