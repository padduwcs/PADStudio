import { t } from "./i18n.js";
import { ICONS, conversationLabel, node, searchKey, svgIcon } from "./dom.js";

const button = (text, run, className = "button button-ghost") => {
  const element = node("button", text, className); element.type = "button";
  element.addEventListener("click", run); return element;
};
const icon = (label, path, run) => {
  const element = button("", run, "icon-button"); element.title = label; element.setAttribute("aria-label", label); element.append(svgIcon(path)); return element;
};

// Keep a menu next to its trigger and above the whole composer, including drafts and attachments.
export function positionChatMenu(surface, trigger, root) {
  if (surface.hidden || !trigger?.isConnected) return;
  const panel = root.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
  const composer = trigger.closest(".chat-composer");
  const edge = 16, width = Math.min(320, panel.width - edge * 2);
  const left = Math.max(edge, Math.min(panel.width - width - edge,
    (composer ? anchor.left : anchor.right - width) - panel.left));
  surface.style.width = width + "px"; surface.style.left = left + "px"; surface.style.right = "auto";
  if (composer) {
    const bottom = Math.min(panel.height - 56, panel.bottom - composer.getBoundingClientRect().top + 8);
    surface.style.top = "auto"; surface.style.bottom = Math.max(edge, bottom) + "px";
    surface.style.maxHeight = Math.max(40, Math.min(620, panel.height - bottom - edge)) + "px";
  } else {
    const top = Math.max(edge, anchor.bottom - panel.top + 8);
    surface.style.top = top + "px"; surface.style.bottom = "auto";
    surface.style.maxHeight = Math.max(40, Math.min(620, panel.height - top - edge)) + "px";
  }
}

// Ordinary Codex client actions. No knowledge of the video viewer or ProjectStore.
export function createChatControls({ root, composer, input, context, post, endpoint, save, update, notice, adopt, apply, activate, newConversation, dismissHistory }) {
  let active = null; let anchor = null; let historyGeneration = 0; let fileGeneration = 0; let attachmentSignature = "";
  let searchKeys = "", searchTime = 0;
  const popup = node("section", undefined, "chat-popover"); popup.hidden = true; popup.id = "chat-popover";
  popup.setAttribute("aria-label", t("Tùy chọn trò chuyện"));
  const closePopup = (restoreFocus = false) => { if (!active) return false; popup.hidden = true; active = null; fileGeneration += 1; anchor?.setAttribute("aria-expanded", "false"); if (restoreFocus) anchor?.focus(); return true; };
  const open = (kind, trigger, title, { choices = false } = {}) => {
    if (active === kind) { closePopup(); return false; }
    closePopup(); dismissHistory(); active = kind; anchor = trigger; popup.hidden = false; popup.replaceChildren();
    popup.dataset.kind = kind; trigger?.setAttribute("aria-expanded", "true");
    popup.setAttribute("aria-label", title);
    searchKeys = ""; searchTime = 0;
    const actionMenu = ["add", "settings", "actions", "advanced", "help"].includes(kind);
    if (choices || actionMenu) popup.setAttribute("role", "menu"); else popup.removeAttribute("role");
    if (!choices && !actionMenu) {
      const head = node("div", undefined, "chat-popover-head");
      head.append(node("strong", title), button(t("Đóng"), () => { closePopup(); trigger?.focus(); })); popup.append(head);
    }
    if (actionMenu) queueMicrotask(() => {
      for (const item of popup.querySelectorAll(".chat-conversation-entry")) { item.setAttribute("role", "menuitem"); item.tabIndex = -1; }
      focusChoice();
    });
    queueMicrotask(() => positionChatMenu(popup, anchor, root)); return true;
  };
  const optionsButton = icon(t("Cài đặt Codex"), "m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6", settings); optionsButton.id = "chat-settings";
  const moreButton = icon(t("Thao tác hội thoại"), "M5 12h.01M12 12h.01M19 12h.01", actions); moreButton.id = "chat-more";
  const attachButton = icon(t("Đính kèm file"), "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-1 8-5 5", () => picker.click()); attachButton.id = "chat-attach";
  const referenceButton = button("@", references, "icon-button chat-reference"); referenceButton.title = t("Tham chiếu file hoặc skill"); referenceButton.setAttribute("aria-label", referenceButton.title); referenceButton.id = "chat-reference";
  const addButton = icon(t("Thêm nội dung"), "M12 5v14M5 12h14", addContent); addButton.id = "chat-add";
  const modeButton = button("", modeSettings, "chat-composer-choice"); modeButton.id = "chat-mode-button"; modeButton.setAttribute("aria-label", t("Chế độ và quyền"));
  const modelButton = button("", modelSettings, "chat-composer-choice chat-model-choice"); modelButton.id = "chat-model-button"; modelButton.setAttribute("aria-label", t("Model và mức suy luận"));
  for (const trigger of [modeButton, modelButton, moreButton, addButton, optionsButton]) trigger.setAttribute("aria-haspopup", "menu");
  for (const trigger of [optionsButton, moreButton, referenceButton, addButton, modeButton, modelButton]) { trigger.setAttribute("aria-controls", popup.id); trigger.setAttribute("aria-expanded", "false"); }
  const picker = node("input"); picker.type = "file"; picker.multiple = true; picker.hidden = true; picker.id = "chat-file-picker";
  const attachmentList = node("div", undefined, "chat-attachments"); attachmentList.id = "chat-attachments";
  const info = node("p", t("Chưa có số liệu ngữ cảnh."), "chat-menu-empty"); info.id = "chat-context-info";
  const findBar = node("div", undefined, "chat-find"); findBar.hidden = true;
  const find = node("input"); find.type = "search"; find.placeholder = t("Tìm trong hội thoại…"); find.setAttribute("aria-label", find.placeholder);
  const found = node("span"); let matches = []; let foundIndex = -1;
  const findNext = (direction = 1) => {
    for (const match of matches) match.classList.remove("chat-search-match");
    const query = find.value.trim().toLocaleLowerCase();
    matches = query ? [...root.querySelectorAll(".chat-message")].filter((element) => element.textContent.toLocaleLowerCase().includes(query)) : [];
    foundIndex = matches.length ? (foundIndex + direction + matches.length) % matches.length : -1;
    found.textContent = matches.length ? `${foundIndex + 1}/${matches.length}` : query ? t("0 kết quả") : "";
    matches[foundIndex]?.classList.add("chat-search-match"); matches[foundIndex]?.scrollIntoView({ block: "center" });
  };
  const closeFind = () => { findBar.hidden = true; for (const match of matches) match.classList.remove("chat-search-match"); input.focus(); };
  find.addEventListener("input", () => { foundIndex = -1; findNext(); });
  find.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); findNext(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { event.stopPropagation(); closeFind(); } });
  findBar.append(find, found, button("↑", () => findNext(-1)), button("↓", () => findNext()), button(t("Đóng"), closeFind));
  function showFind() { closePopup(); findBar.hidden = false; find.focus(); find.select(); }

  function addContent() {
    if (!open("add", addButton, t("Thêm nội dung"))) return;
    attachButton.className = "chat-conversation-entry"; attachButton.replaceChildren(svgIcon(ICONS.file), node("span", t("Thêm ảnh hoặc tệp…")));
    attachButton.onclick = () => closePopup();
    referenceButton.className = "chat-conversation-entry"; referenceButton.replaceChildren(node("span", "@", "chat-menu-at"), node("span", t("Tham chiếu file hoặc skill…")));
    popup.append(attachButton, referenceButton);
  }
  function settings() {
    if (!open("settings", moreButton, t("Cài đặt Codex"))) return;
    popup.append(button(t("Model và mức suy luận"), modelSettings, "chat-conversation-entry"), button(t("Chế độ và quyền"), modeSettings, "chat-conversation-entry"), button(t("Mức sử dụng"), usage, "chat-conversation-entry"), button(t("Phím tắt và lệnh nhanh"), help, "chat-conversation-entry"));
  }
  const effortName = id => ({ minimal: t("Tối thiểu"), low: t("Thấp"), medium: t("Vừa"), high: t("Cao"), xhigh: t("Rất cao"), max: t("Tối đa"), ultra: "Ultra" })[id] || id;
  function currentModel() {
    const { state, session, draft } = context();
    const id = draft.model || session?.model;
    return state.models.find(entry => entry.id === id) || (!id ? state.models.find(entry => entry.isDefault) : null);
  }
  function selectChoice(key, value) {
    const { draft, session } = context();
    if (session?.active || draft.sending) return;
    if (key === "model") { if (draft.model !== value && draft.options) delete draft.options.effort; draft.model = value; }
    else { draft.options ??= {}; if (value) draft.options[key] = value; else delete draft.options[key]; }
    save(); refresh(); closePopup(); input.focus();
  }
  function choiceGroup(key, title, entries, selected, { compact = false } = {}) {
    const group = node("div", undefined, "chat-choice-group"); group.setAttribute("role", "group"); group.setAttribute("aria-label", title);
    const heading = node("div", title, "chat-choice-heading"); heading.setAttribute("role", "presentation"); group.append(heading);
    const list = node("div", undefined, compact ? "chat-effort-options" : "chat-choice-options"); list.setAttribute("role", "presentation");
    const { draft, session } = context();
    for (const entry of entries) {
      const item = button("", () => selectChoice(key, entry.id), compact ? "chat-choice chat-choice-compact" : "chat-choice");
      item.dataset.choice = key; item.dataset.value = entry.id; item.dataset.search = entry.name;
      item.setAttribute("role", "menuitemradio"); item.setAttribute("aria-checked", String(entry.id === selected)); item.tabIndex = -1;
      item.disabled = Boolean(session?.active || draft.sending);
      const copy = node("span", undefined, "chat-choice-copy"); copy.append(node("span", entry.name, "chat-choice-name"));
      item.append(copy, svgIcon("m5 12 4 4L19 6", { size: 15 })); list.append(item);
    }
    group.append(list); popup.append(group);
  }
  function focusChoice(last = false) {
    queueMicrotask(() => {
      if (popup.hidden || popup.getAttribute("role") !== "menu") return;
      const items = [...popup.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
      const target = last ? items.at(-1) : items.find(item => item.getAttribute("aria-checked") === "true") || items[0];
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "nearest" });
    });
  }
  function modelSettings() {
    if (!open("model", modelButton, t("Model và mức suy luận"), { choices: true })) return;
    const { state, draft } = context();
    choiceGroup("model", t("Chọn model"), [{ id: "", name: t("Mặc định của Codex") }, ...state.models], draft.model || "");
    const efforts = currentModel()?.efforts || [];
    if (efforts.length) choiceGroup("effort", t("Mức suy luận"), [{ id: "", name: t("Mặc định") }, ...efforts.map(id => ({ id, name: effortName(id) }))], draft.options?.effort || "", { compact: true });
    focusChoice();
  }
  function modeSettings() {
    if (!open("mode", modeButton, t("Chế độ và quyền"), { choices: true })) return;
    const { state, draft } = context();
    if (state.modes?.length) choiceGroup("mode", t("Chế độ làm việc"), [{ id: "", name: t("Mặc định của Codex") }, ...state.modes.map(entry => ({ id: entry.mode, name: entry.mode === "plan" ? t("Lập kế hoạch") : t("Làm việc") }))], draft.options?.mode || "");
    if (state.permissions?.length) choiceGroup("permissions", t("Quyền chạy"), [{ id: "", name: t("Mặc định của Codex") }, ...state.permissions.map(entry => ({ id: entry.id, name: ({ ":read-only": t("Chỉ đọc"), ":workspace": t("Trong thư mục làm việc"), ":danger-full-access": t("Toàn quyền trên máy") })[entry.id] || entry.id }))], draft.options?.permissions || "");
    if (!state.modes?.length && !state.permissions?.length) popup.append(node("p", t("Chế độ và quyền dùng cấu hình Codex hiện có."), "chat-menu-empty"));
    focusChoice();
  }
  popup.addEventListener("keydown", event => {
    if (popup.getAttribute("role") !== "menu" || popup.hidden) return;
    if (event.key === "Tab") { closePopup(true); return; }
    const items = [...popup.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let target;
    if (["ArrowDown", "ArrowRight"].includes(event.key)) target = items[(index + 1) % items.length];
    else if (["ArrowUp", "ArrowLeft"].includes(event.key)) target = items[(index + items.length - 1) % items.length];
    else if (event.key === "Home") target = items[0];
    else if (event.key === "End") target = items.at(-1);
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now(); searchKeys = (now - searchTime < 700 ? searchKeys : "") + event.key; searchTime = now;
      const query = searchKey(searchKeys);
      target = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(item => searchKey(item.dataset.search || item.textContent).startsWith(query));
    }
    if (target) { event.preventDefault(); target.focus(); target.scrollIntoView({ block: "nearest" }); }
  });
  for (const trigger of [modelButton, modeButton, moreButton, addButton]) trigger.addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); if (popup.hidden || anchor !== trigger) trigger.click(); focusChoice(event.key === "ArrowUp");
  });
  function usage() {
    if (!open("usage", moreButton, t("Mức sử dụng"))) return;
    const { state, session } = context(); popup.append(info);
    if (session?.model) popup.append(node("p", "Model: " + session.model, "chat-menu-empty"));
    for (const [key, title] of [["primary", t("Hạn mức ngắn hạn")], ["secondary", t("Hạn mức dài hạn")]]) {
      const rate = state.rateLimits?.[key]; if (!rate) continue;
      const row = node("label", t("{0}: {1}% đã dùng", title, Math.round(rate.usedPercent)), "chat-setting");
      const meter = node("progress"); meter.max = 100; meter.value = rate.usedPercent; row.append(meter);
      if (rate.resetsAt) row.append(node("small", t("Đặt lại ") + new Date(rate.resetsAt * 1000).toLocaleString())); popup.append(row);
    }
  }

  async function run(action, body = {}) {
    const id = context().id; closePopup();
    try { const result = await post(endpoint(action, id), body); action === "fork" ? adopt(result.session) : apply(result.session); }
    catch (error) { if (context().id === id) notice(error.message); }
  }
  function actions() {
    if (!open("actions", moreButton, t("Hội thoại"))) return;
    const { session } = context();
    const entries = [
      [t("Đổi tên"), renameConversation], [t("Tìm trong hội thoại"), showFind],
      [t("Phân nhánh hội thoại"), () => run("fork"), !session?.hasConversation || session?.active],
      [session?.archived ? t("Khôi phục hội thoại") : t("Lưu trữ hội thoại"), () => run(session?.archived ? "unarchive" : "archive"), session?.active],
      [t("Thêm thao tác…"), advancedActions]
    ];
    for (const [label, handler, disabled] of entries) { const entry = button(label, handler, "chat-conversation-entry"); entry.disabled = Boolean(disabled); popup.append(entry); }
    optionsButton.className = "chat-conversation-entry chat-menu-settings";
    optionsButton.replaceChildren(svgIcon("M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2M16 8l2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8"), node("span", t("Cài đặt Codex")));
    popup.append(optionsButton);
  }
  function renameConversation() {
    if (!open("rename", moreButton, t("Đổi tên hội thoại"))) return;
    const { session } = context();
    const rename = node("form", undefined, "chat-rename"); const name = node("input"); name.id = "chat-rename-input"; name.setAttribute("aria-label", t("Tên hội thoại")); name.placeholder = t("Tên hội thoại"); name.maxLength = 120;
    name.value = session?.conversations.find((entry) => entry.id === context().id)?.title || "";
    const submit = node("button", t("Đổi tên"), "button button-soft"); submit.type = "submit";
    rename.append(name, submit); rename.addEventListener("submit", (event) => { event.preventDefault(); run("rename", { name: name.value }); }); popup.append(rename);
    name.focus(); name.select();
  }
  function advancedActions() {
    if (!open("advanced", moreButton, t("Thêm thao tác"))) return;
    const { session } = context();
    const entries = [
      [t("Thu gọn ngữ cảnh"), () => run("compact"), !session?.hasConversation || session?.active],
      [t("Xuất Markdown"), () => download("md")], [t("Xuất JSON"), () => download("json")]
    ];
    for (const [label, handler, disabled] of entries) {
      const entry = button(label, handler, "chat-conversation-entry"); entry.disabled = Boolean(disabled); popup.append(entry);
    }
  }
  async function download(format) {
    const id = context().id; closePopup();
    try {
      const response = await fetch(endpoint("export", id)); const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const content = format === "json" ? JSON.stringify(data, null, 2) : `# ${data.title || "Codex"}\n\n` + data.items.map((item) => `## ${item.role === "user" ? t("Bạn") : item.role === "assistant" ? "Codex" : t("Công cụ")}\n\n${item.text || ""}${(item.attachments || []).map((entry) => `\n\n- ${entry.kind === "image" ? t("Ảnh") : entry.kind === "skill" ? "Skill" : "File"}: ${entry.path || entry.name}`).join("")}${item.output ? "\n\n```\n" + item.output + "\n```" : ""}\n`).join("\n");
      const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown;charset=utf-8" }));
      const link = node("a"); link.href = url; link.download = `codex-${id}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { notice(error.message); }
  }

  async function upload(files) {
    const { draft, id } = context(); draft.attachments ??= [];
    if (draft.uploading || draft.sending) { notice(t("Đợi thao tác gửi hoặc đính kèm hiện tại hoàn tất.")); return; }
    if (draft.attachments.length + files.length > 10) { notice(t("Mỗi tin nhắn tối đa 10 file đính kèm.")); return; }
    draft.uploading = true; update();
    try {
      for (const file of files) {
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(t("Mỗi file phải từ 1 byte đến 10 MB."));
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error(t("Không đọc được file."))); reader.readAsDataURL(file); });
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
    const modelId = draft.model || session?.model;
    const modelName = currentModel()?.name || modelId || t("Model mặc định");
    const effort = draft.options?.effort || session?.effective?.effort;
    modelButton.replaceChildren(node("span", modelName), svgIcon(ICONS.chevron, { size: 12 }));
    modelButton.title = modelName + (effort ? " · " + effort : "");
    modelButton.disabled = Boolean(session?.active || draft.sending || !context().state.authenticated);
    const permissions = draft.options?.permissions || session?.effective?.permissions;
    const mode = draft.options?.mode || session?.effective?.mode;
    const modeName = mode === "plan" ? t("Lập kế hoạch") : ({ ":read-only": t("Chỉ đọc"), ":workspace": "Agent", ":danger-full-access": t("Toàn quyền") })[permissions] || (mode === "default" ? t("Làm việc") : t("Mặc định"));
    modeButton.replaceChildren(svgIcon(mode === "plan" ? "M5 6h14M5 12h14M5 18h9" : "m12 3 8 4v5c0 4-4 7-8 9-4-2-8-5-8-9V7z", { size: 13 }), node("span", modeName), svgIcon(ICONS.chevron, { size: 12 }));
    modeButton.title = t("Chế độ và quyền · ") + modeName; modeButton.disabled = Boolean(session?.active || draft.sending);
    addButton.disabled = Boolean(draft.uploading || draft.sending || session?.archived);
    attachButton.disabled = Boolean(draft.uploading || draft.sending || session?.archived);
    for (const item of popup.querySelectorAll('[role="menuitemradio"]')) item.disabled = Boolean(session?.active || draft.sending);
    if (session?.usage) {
      const used = session.usage.last || 0, limit = session.usage.contextWindow;
      info.textContent = limit ? t("Ngữ cảnh: {0}% · {1} / {2} token", Math.min(100, Math.round(used / limit * 100)), used.toLocaleString(), limit.toLocaleString()) : t("Ngữ cảnh: {0} token", used.toLocaleString());
    } else info.textContent = t("Chưa có số liệu ngữ cảnh.");
  }

  function references() {
    if (!open("references", addButton, t("Tham chiếu file hoặc skill"))) return;
    const query = node("input"); query.type = "search"; query.placeholder = t("Tìm file trong thư mục…"); query.id = "chat-file-search"; query.setAttribute("aria-label", query.placeholder);
    const results = node("div", undefined, "chat-picker-results"); const skills = node("div", undefined, "chat-picker-results");
    popup.append(query, results, node("p", t("Skill có sẵn"), "chat-menu-heading"), skills);
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
          if (!result.data.length) results.append(node("p", t("Không tìm thấy file."), "chat-menu-empty"));
        } catch (error) { if (version === fileGeneration) results.textContent = error.message; }
      }, 200);
    }); query.focus();
  }

  function addHistory(menu) {
    const section = node("section", undefined, "chat-native-history");
    const search = node("input"); search.type = "search"; search.id = "chat-history-search"; search.placeholder = t("Tìm cuộc trò chuyện…"); search.setAttribute("aria-label", search.placeholder);
    const label = node("label", t("Đã lưu trữ"), "chat-history-archived"); const archived = node("input"); archived.type = "checkbox"; archived.id = "chat-history-archived"; label.prepend(archived);
    const results = node("div", undefined, "chat-native-results"); results.id = "chat-native-results";
    let cursor = null; let timer; let nativeEntries = [];
    const more = button(t("Xem thêm"), () => load(true), "button button-ghost"); more.hidden = true;
    async function load(append = false) {
      const version = ++historyGeneration;
      if (!append) { cursor = null; nativeEntries = []; render(); }
      more.disabled = true;
      try {
        const query = new URLSearchParams({ q: search.value, archived: archived.checked ? "1" : "0" }); if (append && cursor) query.set("cursor", cursor);
        const response = await fetch("/api/chat/history?" + query); const data = await response.json();
        if (version !== historyGeneration) return; if (!response.ok) throw new Error(data.error);
        cursor = data.nextCursor; nativeEntries.push(...data.data); render();
        more.hidden = !cursor;
      } catch (error) { if (version === historyGeneration) { render(); results.append(node("p", error.message, "chat-menu-empty")); } }
      finally { if (version === historyGeneration) more.disabled = false; }
    }
    function render() {
      const { session, id, openTabs } = context();
      const locals = session?.conversations || [];
      const localByThread = new Map(locals.filter((entry) => entry.threadId).map((entry) => [entry.threadId, entry]));
      const seen = new Set();
      const merged = [...nativeEntries.map((entry) => ({ ...entry, ...localByThread.get(entry.threadId), archived: entry.archived })), ...[...locals].reverse()];
      results.replaceChildren();
      for (const entry of merged) {
        const key = entry.threadId || entry.id;
        if (seen.has(key)) continue; seen.add(key);
        if (Boolean(entry.archived) !== archived.checked || !searchKey(entry.title).includes(searchKey(search.value))) continue;
        const row = button("", async () => {
          row.disabled = true;
          try {
            if (entry.id && !entry.archived) { dismissHistory(); await activate(entry.id); }
            else {
              const result = entry.id ? await post(endpoint("unarchive", entry.id), {}) : await post(entry.archived ? "/api/chat/restore" : "/api/chat/resume", { threadId: entry.threadId });
              dismissHistory(); adopt(result.session);
            }
          } catch (error) { notice(error.message); } finally { row.disabled = false; }
        }, "chat-conversation-entry");
        if (entry.id) row.dataset.conversationId = entry.id;
        row.dataset.threadId = entry.threadId || "";
        if (entry.id === id) row.setAttribute("aria-current", "true");
        row.append(node("span", conversationLabel(entry)), node("small", entry.archived ? t("Khôi phục") : entry.waiting ? t("Chờ bạn") : entry.active ? t("Đang làm việc") : openTabs.includes(entry.id) ? t("Đang mở") : ""));
        row.title = conversationLabel(entry); results.append(row);
      }
      if (!results.childNodes.length) results.append(node("p", t("Chưa có cuộc trò chuyện phù hợp."), "chat-menu-empty"));
    }
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => load(), 200); }); archived.addEventListener("change", () => load());
    section.append(node("p", t("Lịch sử trò chuyện"), "chat-menu-heading"), search, label, results, more); menu.append(section);
    return () => { load(); search.focus(); };
  }

  document.addEventListener("pointerdown", (event) => { if (!popup.hidden && !popup.contains(event.target) && ![optionsButton, moreButton, addButton, modeButton, modelButton].some((button) => button.contains(event.target))) closePopup(); });
  const menuObserver = new ResizeObserver(() => positionChatMenu(popup, anchor, root));
  for (const element of [root, composer, popup]) menuObserver.observe(element);
  root.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); showFind(); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); newConversation(); }
  });
  // Slash commands are client actions, not instructions inserted into a model prompt.
  function slash() {
    const command = input.value.trim();
    const commands = { "/new": newConversation, "/model": modelSettings, "/permissions": modeSettings, "/plan": () => { context().draft.options = { ...context().draft.options, mode: "plan" }; save(); refresh(); }, "/default": () => { context().draft.options = { ...context().draft.options, mode: "default" }; save(); refresh(); }, "/compact": () => run("compact"), "/fork": () => run("fork"), "/status": usage, "/help": help };
    if (!commands[command]) return false;
    input.value = ""; save(); commands[command](); return true;
  }
  function help() {
    if (!open("help", moreButton, t("Phím tắt và lệnh nhanh"))) return;
    popup.append(node("p", t("Enter: gửi · Shift+Enter: xuống dòng · Ctrl+F: tìm hội thoại · Ctrl+Shift+O: chat mới"), "chat-menu-empty"));
    for (const [command, label] of [["/new", t("Chat mới")], ["/model", t("Model và thiết lập")], ["/plan", t("Chọn chế độ lập kế hoạch")], ["/default", t("Chọn chế độ làm việc")], ["/permissions", t("Quyền chạy")], ["/compact", t("Thu gọn ngữ cảnh")], ["/fork", t("Phân nhánh")], ["/status", t("Trạng thái và hạn mức")]]) popup.append(button(command + " · " + label, () => { input.value = command; save(); closePopup(); input.focus(); }, "chat-conversation-entry"));
  }
  return { popup, optionsButton, moreButton, addButton, modeButton, modelButton, picker, attachmentList, findBar, refresh, closePopup, addHistory, slash, help, run };
}
