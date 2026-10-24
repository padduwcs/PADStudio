import { t } from "./i18n.js";
import { ICONS, conversationLabel, node, svgIcon } from "./dom.js";
import { renderChatMarkdown } from "./chat-markdown.js";
import { createChatControls, positionChatMenu } from "./chat-controls.js";

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';

function action(label, handler, style = "button button-quiet") {
  const button = node("button", label, style); button.type = "button";
  button.addEventListener("click", handler); return button;
}

export function createChatPanel({ root, toggle }) {
  let conversationId = null;
  let openTabs = [];
  let conversationEntries = [];
  let tabsSignature = "";
  const views = new Map();
  let state = { connected: false, authenticated: false, models: [] };
  let session = null;
  let stream = null;
  let generation = 0;
  let opened = false;
  let returnFocus = null;
  let notice = "";
  let online = true;
  let requestSignature = "";
  let renderedItems = new Map();
  const drafts = new Map();
  const smallScreen = window.matchMedia("(max-width: 900px)");
  let preferredWidth = null;
  let extras = null; let openNativeHistory = null;
  let resizePointer = null;
  try { const saved = Number(localStorage.getItem("padstudio-codex-width")); if (saved >= 320 && saved <= 960) preferredWidth = saved; } catch { /* Optional preference. */ }

  const resizeHandle = node("div", undefined, "chat-resize-handle"); resizeHandle.id = "chat-resize-handle";
  resizeHandle.tabIndex = 0; resizeHandle.setAttribute("role", "separator"); resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("aria-label", t("Điều chỉnh chiều rộng trò chuyện"));
  resizeHandle.setAttribute("aria-controls", "chat");
  resizeHandle.title = t("Kéo để đổi chiều rộng · Nhấp đúp để đặt lại");

  const head = node("header", undefined, "chat-head");
  const heading = node("div");
  const title = node("h2", "Codex"); title.id = "chat-title";
  const folderName = node("p", "PADStudio", "chat-subtitle"); folderName.id = "chat-folder-name";
  heading.append(title);
  const headActions = node("div", undefined, "chat-head-actions");
  const historyButton = action("", () => { extras?.closePopup(); menu.hidden = !menu.hidden; historyButton.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) { renderTabs(); openNativeHistory?.(); positionChatMenu(menu, historyButton, root); } }, "icon-button");
  historyButton.id = "chat-history-button"; historyButton.title = t("Lịch sử trò chuyện"); historyButton.setAttribute("aria-label", historyButton.title); historyButton.setAttribute("aria-expanded", "false");
  historyButton.append(svgIcon("M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"));
  const closeButton = action("", () => close(), "icon-button"); closeButton.append(svgIcon(ICONS.close)); closeButton.setAttribute("aria-label", t("Đóng trò chuyện"));
  headActions.append(historyButton, closeButton); head.append(heading, headActions);
  const tabBar = node("div", undefined, "chat-tab-bar");
  const tabs = node("div", undefined, "chat-tabs"); tabs.id = "chat-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", t("Các cuộc trò chuyện đang mở"));
  const newChat = action("", () => newConversation(), "icon-button chat-tab-add"); newChat.id = "chat-new-conversation";
  newChat.title = t("Cuộc trò chuyện mới"); newChat.setAttribute("aria-label", newChat.title); newChat.append(svgIcon("M12 4H5v15h14v-7M15 3l6 6M10 14l1-5 6-6 4 4-6 6z"));
  tabBar.append(tabs); tabBar.hidden = true;
  const menu = node("div", undefined, "chat-menu"); menu.hidden = true; menu.setAttribute("aria-label", t("Lịch sử trò chuyện"));
  const connection = node("div", undefined, "chat-connection");
  const history = node("div", undefined, "chat-history"); history.id = "chat-history"; history.setAttribute("role", "tabpanel"); history.setAttribute("aria-label", t("Lịch sử trò chuyện")); history.tabIndex = 0;
  const empty = node("div", undefined, "chat-empty");
  empty.append(node("span", t("Bạn muốn làm gì?"), "chat-empty-title"));
  const messages = node("div", undefined, "chat-messages");
  messages.setAttribute("role", "log"); messages.setAttribute("aria-label", t("Tin nhắn")); messages.setAttribute("aria-live", "off");
  const older = action(t("Tải tin nhắn cũ hơn"), async () => {
    const id = conversationId; const top = history.scrollTop, height = history.scrollHeight; older.disabled = true;
    try { const result = await post(endpoint("older", id), {}); if (id === conversationId) { acceptSession(result.session); history.scrollTop = top + history.scrollHeight - height; } }
    catch (error) { if (id === conversationId) setNotice(error.message); } finally { older.disabled = false; }
  }, "button button-ghost chat-older"); older.hidden = true;
  history.append(empty, older, messages);
  const jump = action(t("Tin nhắn mới ↓"), () => scrollToEnd(true), "button button-soft chat-jump"); jump.hidden = true;
  const requests = node("div", undefined, "chat-requests"); requests.id = "chat-requests";
  const status = node("p", "", "chat-status"); status.id = "chat-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const noticeBox = node("p", "", "chat-notice"); noticeBox.id = "chat-notice"; noticeBox.hidden = true; noticeBox.setAttribute("role", "alert");
  const composer = node("form", undefined, "chat-composer"); composer.id = "chat-composer";
  const inputLabel = node("label", t("Tin nhắn cho agent"), "sr-only"); inputLabel.htmlFor = "chat-input";
  const input = node("textarea"); input.id = "chat-input"; input.rows = 2; input.maxLength = 32_000; input.placeholder = t("Nhắn tin cho Codex…");
  const composerActions = node("div", undefined, "chat-composer-actions");
  const controls = node("div", undefined, "chat-send-controls");
  const stop = action("", async () => {
    const currentConversation = conversationId;
    stop.disabled = true;
    try { const result = await post(endpoint("interrupt", currentConversation), {}); if (currentConversation === conversationId) acceptSession(result.session); }
    catch (error) { if (currentConversation === conversationId) setNotice(error.message); }
    finally { updateControls(); }
  }, "icon-button chat-stop"); stop.id = "chat-stop"; stop.hidden = true; stop.title = t("Dừng trả lời"); stop.setAttribute("aria-label", stop.title); stop.append(svgIcon("M6 6h12v12H6z", { size: 16 }));
  const submit = node("button", undefined, "icon-button chat-send"); submit.type = "submit"; submit.id = "chat-send"; submit.append(svgIcon("M12 19V5m-6 6 6-6 6 6", { size: 18 }));
  const composerTools = node("div", undefined, "chat-composer-tools");
  controls.append(stop, submit); composerActions.append(composerTools, controls);
  composer.append(inputLabel, input, composerActions);
  extras = createChatControls({ root, composer, input, context: () => ({ state, session, id: conversationId, draft: draft(), openTabs }), post, endpoint, save: saveDraft,
    update: updateControls, notice: setNotice, adopt: adoptConversation, apply: acceptSession, activate: activateTab, newConversation, dismissHistory: dismissMenu });
  openNativeHistory = extras.addHistory(menu);
  headActions.insertBefore(newChat, historyButton); headActions.insertBefore(extras.moreButton, closeButton);
  composerTools.append(extras.addButton, extras.modeButton);
  controls.prepend(extras.modelButton);
  composer.prepend(extras.attachmentList); composer.append(extras.picker);
  const workspace = node("div", undefined, "chat-workspace"); workspace.append(svgIcon("M3 7h6l2-3h10v16H3z", { size: 13 }), folderName);
  const dock = node("div", undefined, "chat-dock"); dock.append(requests, status, noticeBox, composer, workspace);
  root.append(resizeHandle, head, tabBar, menu, extras.popup, connection, extras.findBar, history, jump, dock);
  const historyObserver = new ResizeObserver(() => {
    root.style.setProperty("--chat-scrollbar", Math.max(0, history.offsetWidth - history.clientWidth) + "px");
    positionChatMenu(menu, historyButton, root);
  });
  historyObserver.observe(history);
  new ResizeObserver(() => positionChatMenu(menu, historyButton, root)).observe(menu);

  function widthLimits() { return { min: 320, max: Math.max(320, Math.min(960, Math.floor(innerWidth * 0.65), innerWidth - 320)) }; }
  function updateLayout() {
    const { min, max } = widthLimits();
    const width = Math.round(Math.max(min, Math.min(max, preferredWidth ?? Math.max(390, Math.min(540, innerWidth * 0.34)))));
    document.documentElement.style.setProperty("--chat-width", width + "px");
    resizeHandle.setAttribute("aria-valuemin", String(min)); resizeHandle.setAttribute("aria-valuemax", String(max));
    resizeHandle.setAttribute("aria-valuenow", String(width)); resizeHandle.setAttribute("aria-valuetext", width + " pixel");
    document.body.classList.toggle("chat-narrow-workspace", !smallScreen.matches && innerWidth - width < 1060);
    resize(); revealSelectedTab();
  }
  function setWidth(width) {
    const { min, max } = widthLimits(); preferredWidth = Math.round(Math.max(min, Math.min(max, width)));
    try { localStorage.setItem("padstudio-codex-width", String(preferredWidth)); } catch { /* Optional preference. */ }
    updateLayout();
  }
  function resetWidth() {
    preferredWidth = null;
    try { localStorage.removeItem("padstudio-codex-width"); } catch { /* Optional preference. */ }
    updateLayout();
  }
  function stopResize() {
    const pointer = resizePointer; resizePointer = null; document.body.classList.remove("chat-is-resizing");
    if (pointer !== null && resizeHandle.hasPointerCapture(pointer)) resizeHandle.releasePointerCapture(pointer);
  }
  resizeHandle.addEventListener("pointerdown", (event) => {
    if (smallScreen.matches || event.button !== 0) return;
    event.preventDefault(); resizePointer = event.pointerId; resizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add("chat-is-resizing");
  });
  window.addEventListener("pointermove", (event) => { if (event.pointerId === resizePointer) setWidth(innerWidth - event.clientX); }, true);
  window.addEventListener("pointerup", stopResize, true); window.addEventListener("pointercancel", stopResize, true);
  window.addEventListener("blur", stopResize);
  resizeHandle.addEventListener("lostpointercapture", stopResize); resizeHandle.addEventListener("dblclick", resetWidth);
  resizeHandle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); setWidth(root.getBoundingClientRect().width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 64 : 16));
    } else if (event.key === "Home") { event.preventDefault(); setWidth(widthLimits().min); }
    else if (event.key === "End") { event.preventDefault(); setWidth(widthLimits().max); }
    else if (event.key === "Enter") { event.preventDefault(); resetWidth(); }
  });
  window.addEventListener("resize", updateLayout);

  function draftKey() { return conversationId ?? "new"; }
  function draft() {
    const key = draftKey();
    if (!drafts.has(key)) {
      let stored = null;
      try {
        stored = JSON.parse(sessionStorage.getItem("padstudio-codex-draft:" + key));
      } catch { /* Optional browser storage. */ }
      drafts.set(key, stored && typeof stored.text === "string"
        ? stored : { text: "", model: "", attempt: null });
    }
    return drafts.get(key);
  }

  function persistDraft(value, key) {
    const { sending, uploading, ...stored } = value;
    try { sessionStorage.setItem("padstudio-codex-draft:" + key, JSON.stringify(stored)); } catch { /* Optional browser storage. */ }
  }

  function saveDraft(explicit = null, id = draftKey()) {
    if (explicit && typeof explicit.text === "string") { persistDraft(explicit, id); if (id === draftKey()) updateControls(); return; }
    const value = draft(); value.text = input.value;
    persistDraft(value, draftKey());
    updateControls();
  }

  function saveTabs() {
    try { sessionStorage.setItem("padstudio-codex-tabs", JSON.stringify({ ids: openTabs, selected: conversationId })); } catch { /* Optional browser storage. */ }
  }

  function saveView() {
    if (!conversationId) return;
    saveDraft();
    if (!session) return;
    views.set(draftKey(), { renderedItems, requestSignature, requestNodes: [...requests.childNodes], notice,
      scrollTop: history.scrollTop, atEnd: history.scrollHeight - history.scrollTop - history.clientHeight < 100 });
  }

  function showConversation(id) {
    saveView(); extras?.closePopup(); conversationId = id; generation += 1; session = null;
    const view = views.get(draftKey());
    renderedItems = view?.renderedItems ?? new Map(); requestSignature = view?.requestSignature ?? "";
    messages.replaceChildren(...[...renderedItems.values()].map((entry) => entry.element));
    requests.replaceChildren(...(view?.requestNodes ?? [])); setNotice(view?.notice ?? "");
    input.value = draft().text; input.placeholder = t("Nhắn tin cho Codex…");
    renderConnection(); extras?.refresh(); updateControls(); resize(); jump.hidden = true;
    history.scrollTop = view?.atEnd ? history.scrollHeight : view?.scrollTop ?? 0;
  }

  async function activateTab(id) {
    if (id === conversationId) { dismissMenu(); input.focus(); return; }
    if (!openTabs.includes(id)) openTabs.push(id);
    const entries = conversationEntries;
    showConversation(id); renderTabs(entries); saveTabs(); dismissMenu(); subscribe();
    try { await loadSession(); } catch (error) { setNotice(error.message); }
    input.focus();
  }

  function dismissMenu() { menu.hidden = true; historyButton.setAttribute("aria-expanded", "false"); }

  function revealSelectedTab() {
    const selected = tabs.querySelector('[aria-selected="true"]')?.parentElement;
    if (!selected) return;
    const area = tabs.getBoundingClientRect(); const bounds = selected.getBoundingClientRect();
    if (bounds.right > area.right) tabs.scrollLeft += bounds.right - area.right;
    else if (bounds.left < area.left) tabs.scrollLeft -= area.left - bounds.left;
  }
  new ResizeObserver(revealSelectedTab).observe(tabs);

  async function newConversation() {
    newChat.disabled = true;
    try {
      const result = await post("/api/chat/conversations", {});
      showConversation(result.session.conversationId);
      openTabs.push(conversationId); acceptSession(result.session); saveTabs(); dismissMenu(); subscribe(); input.focus();
    } catch (error) { setNotice(error.message); }
    finally { newChat.disabled = false; }
  }

  async function closeTab(id) {
    const index = openTabs.indexOf(id); if (index < 0) return;
    openTabs.splice(index, 1);
    if (id === conversationId) {
      if (openTabs.length) await activateTab(openTabs[Math.min(index, openTabs.length - 1)]);
      else await newConversation();
      if (conversationId === id && !openTabs.includes(id)) openTabs.push(id);
    }
    saveTabs(); renderTabs();
  }

  function adoptConversation(next) {
    if (!next) return;
    if (next.conversationId !== conversationId) showConversation(next.conversationId);
    if (!openTabs.includes(next.conversationId)) openTabs.push(next.conversationId);
    acceptSession(next); saveTabs(); dismissMenu(); subscribe(); input.focus();
  }

  function renderTabs(entries = conversationEntries) {
    if (!entries.length && conversationId) return;
    const current = entries.find((entry) => entry.id === conversationId);
    const named = openTabs.length === 1 && current?.hasConversation;
    title.textContent = named ? current.title : "Codex";
    title.title = named ? current.title : "Codex"; title.classList.toggle("is-conversation", Boolean(named));
    const signature = JSON.stringify([entries, openTabs, conversationId]);
    if (tabsSignature === signature) return;
    tabsSignature = signature;
    const activeElement = document.activeElement;
    const focusedId = tabs.contains(activeElement) ? activeElement.dataset.conversationId : null;
    const focusedClose = activeElement?.classList.contains("chat-tab-close");
    tabs.replaceChildren(); tabBar.hidden = openTabs.length < 2;
    for (const id of openTabs) {
      const entry = entries.find((candidate) => candidate.id === id); if (!entry) continue;
      const wrapper = node("div", undefined, "chat-tab" + (id === conversationId ? " is-selected" : "")); wrapper.setAttribute("role", "presentation");
      const button = action("", () => activateTab(id), "chat-tab-label"); button.id = "chat-tab-" + id;
      button.dataset.conversationId = id; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(id === conversationId));
      button.setAttribute("aria-controls", "chat-history"); button.tabIndex = id === conversationId ? 0 : -1;
      const label = conversationLabel(entry); button.title = label + (entry.waiting ? t(" · Đang chờ bạn") : entry.active ? t(" · Đang trả lời") : "");
      const dot = node("span", undefined, "chat-tab-dot" + (entry.waiting ? " is-waiting" : entry.active ? " is-active" : ""));
      button.append(dot, node("span", label));
      button.addEventListener("keydown", (event) => {
        let next;
        if (event.key === "ArrowRight") next = openTabs[(openTabs.indexOf(id) + 1) % openTabs.length];
        else if (event.key === "ArrowLeft") next = openTabs[(openTabs.indexOf(id) + openTabs.length - 1) % openTabs.length];
        else if (event.key === "Home") next = openTabs[0]; else if (event.key === "End") next = openTabs.at(-1);
        if (next) { event.preventDefault(); activateTab(next).then(() => document.getElementById("chat-tab-" + next)?.focus()); }
        if (event.key === "Delete") { event.preventDefault(); closeTab(id).then(() => tabs.querySelector('[aria-selected="true"]')?.focus()); }
      });
      const remove = action("", () => closeTab(id), "chat-tab-close"); remove.dataset.conversationId = id; remove.title = t("Đóng tab: ") + label; remove.setAttribute("aria-label", remove.title);
      remove.append(svgIcon(ICONS.close, { size: 12 })); remove.tabIndex = id === conversationId ? 0 : -1;
      wrapper.append(button, remove); tabs.append(wrapper);
    }
    if (focusedId) tabs.querySelector(`${focusedClose ? ".chat-tab-close" : ".chat-tab-label"}[data-conversation-id="${CSS.escape(focusedId)}"]`)?.focus();
    requestAnimationFrame(revealSelectedTab);
  }

  function resize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; }
  function endpoint(action = "", id = conversationId) { return "/api/chat/conversations" + (id ? "/" + encodeURIComponent(id) : "") + (action ? "/" + action : ""); }
  function setNotice(message) { notice = message || ""; noticeBox.textContent = t(notice); noticeBox.hidden = !notice; }

  async function post(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-PADStudio-Intent": "chat" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || t("Không thể gửi yêu cầu."));
    return result;
  }

  function updateControls() {
    const { sending = false, uploading = false } = draft();
    const waiting = Boolean(session?.requests.length);
    const hasInput = input.value.trim() || draft().attachments?.length || draft().references?.length || draft().skills?.length;
    submit.disabled = sending || uploading || !online || !state.connected || !state.authenticated || !session || session.archived || waiting || !hasInput;
    submit.title = sending ? t("Đang gửi…") : session?.active ? t("Gửi bổ sung") : t("Gửi tin nhắn"); submit.setAttribute("aria-label", submit.title);
    stop.hidden = !session?.active; stop.disabled = sending || !online;
    status.textContent = !online ? t("Mất kết nối. Đang thử kết nối lại…") : uploading ? t("Đang đính kèm file…") : session?.archived ? t("Hội thoại đã lưu trữ. Mở menu để khôi phục.") : sending ? t("Đang gửi yêu cầu…")
      : waiting ? t("Đang chờ bạn trả lời") : session?.active ? t("Agent đang làm việc…") : state.authenticated ? t("Sẵn sàng") : t("Kết nối Codex để bắt đầu");
    root.classList.toggle("is-working", Boolean(session?.active));
    status.classList.toggle("is-idle", online && !sending && !uploading && !session?.archived && !waiting && !session?.active);
    submit.hidden = Boolean(session?.active) && !hasInput;
  }

  function renderConnection() {
    connection.replaceChildren();
    connection.hidden = state.connected && state.authenticated && !state.error;
    if (!state.connected || state.error) {
      connection.append(node("p", state.error ? t(state.error) : t("Dùng Codex trên máy để trò chuyện.")));
      connection.append(action(t("Kết nối Codex"), () => connect(), "button button-soft"));
    } else if (!state.authenticated) {
      connection.append(node("p", t("Đăng nhập tài khoản ChatGPT để dùng Codex.")));
      if (state.login?.url) {
        const link = node("a", t("Mở trang đăng nhập"), "button button-soft"); link.href = state.login.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        connection.append(link, action(t("Hủy đăng nhập"), async () => {
          try { acceptStatus((await post("/api/chat/login/cancel", {})).status); } catch (error) { setNotice(error.message); }
        }, "button button-ghost"));
      } else connection.append(action(t("Đăng nhập ChatGPT"), async () => {
        try { acceptStatus((await post("/api/chat/login", {})).status); } catch (error) { setNotice(error.message); }
      }, "button button-soft"));
    }
    extras?.refresh();
    updateControls();
  }

  function acceptStatus(next) {
    if (!next) return;
    folderName.textContent = next.workspace?.name || "PADStudio";
    folderName.title = next.workspace?.path || "";
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
    const currentTurn = items.findLast((item) => item.turnId)?.turnId;
    empty.hidden = items.length > 0; older.hidden = !session?.hasOlder;
    const present = new Set();
    let previousElement = null;
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
          const label = node("span", item.role === "user" ? t("Bạn") : "Codex", "chat-message-author");
          const body = node("div", undefined, "chat-prose"); const attachments = node("div", undefined, "chat-message-attachments");
          const actions = node("div", undefined, "chat-message-actions");
          rendered = { element, body, attachments, actions };
          const current = rendered;
          const copy = action("", async () => {
            try { await navigator.clipboard.writeText(current.item.text); copy.title = t("Đã sao chép"); setTimeout(() => { copy.title = t("Sao chép"); }, 2000); }
            catch { setNotice(t("Không truy cập được clipboard. Bạn có thể chọn và sao chép nội dung.")); }
          }, "icon-button"); copy.title = t("Sao chép"); copy.setAttribute("aria-label", t("Sao chép")); copy.append(svgIcon(ICONS.copy, { size: 14 }));
          const edit = action("", () => editMessage(current.item), "icon-button");
          edit.title = item.role === "user" ? t("Sửa tin nhắn trong nhánh mới") : t("Gửi lại trong nhánh mới"); edit.setAttribute("aria-label", edit.title);
          edit.append(svgIcon(item.role === "user" ? "m14 4 6 6M5 15l-1 5 5-1L20 8l-4-4z" : "M4 10a8 8 0 1 1 1 7M4 4v6h6", { size: 14 }));
          current.edit = edit; actions.append(copy, edit);
          element.append(label, body, attachments, actions);
        }
        renderedItems.set(item.id, rendered);
      }
      const signature = JSON.stringify(item.role === "tool" ? [item, session.active, currentTurn] : item);
      rendered.item = item;
      if (rendered.edit) rendered.edit.disabled = Boolean(session.active || session.archived || !item.turnId || item.status === "sending" || item.status === "uncertain");
      if (rendered.signature !== signature) {
        if (item.role === "tool") {
          const working = item.status === "inProgress" && session.active && item.turnId === currentTurn;
          rendered.summary.textContent = item.kind === "command" ? `${working ? t("Đang chạy") : item.exitCode === 0 ? t("Đã chạy") : t("Lệnh")} ${(item.text || "").split("\n")[0].slice(0, 90)}`
            : item.kind === "files" ? t("Thay đổi file") : item.kind === "search" ? t("Tìm kiếm trên web") : item.text;
          rendered.body.textContent = [item.text, item.output].filter(Boolean).join("\n\n");
        } else if (item.role === "assistant") renderChatMarkdown(rendered.body, item.text);
        else rendered.body.textContent = item.text;
        if (rendered.attachments) {
          rendered.attachments.replaceChildren();
          for (const attachment of item.attachments || []) {
            const chip = node("span", undefined, "chat-attachment");
            const src = attachment.id ? `/api/chat/attachments/${attachment.id}/image` : attachment.url;
            if (attachment.kind === "image" && src) { const image = node("img"); image.src = src; image.alt = attachment.name || t("Ảnh đính kèm"); chip.append(image); }
            chip.append(node("span", attachment.name || t("Ảnh đính kèm"))); rendered.attachments.append(chip);
          }
        }
        rendered.element.classList.toggle("is-uncertain", item.status === "uncertain");
        rendered.signature = signature;
      }
      const expected = previousElement ? previousElement.nextElementSibling : messages.firstElementChild;
      if (expected !== rendered.element) messages.insertBefore(rendered.element, expected);
      previousElement = rendered.element;
    }
    for (const [id, rendered] of renderedItems) if (!present.has(id)) { rendered.element.remove(); renderedItems.delete(id); }
    if (nearBottom) scrollToEnd(true); else if (items.length) jump.hidden = false;
  }

  async function editMessage(item) {
    const id = conversationId;
    const source = item.role === "user" ? item : session.items.find((entry) => entry.role === "user" && entry.turnId === item.turnId);
    if (!source) { setNotice(t("Không tìm thấy tin nhắn gốc. Hãy tải phần lịch sử cũ hơn.")); return; }
    const images = (source.attachments || []).filter((entry) => entry.kind === "image");
    if (images.some((entry) => !entry.id)) { setNotice(t("Ảnh của hội thoại từ host khác cần được đính kèm lại. Hãy phân nhánh và chọn lại ảnh.")); return; }
    try {
      const result = await post(endpoint("fork", id), { beforeTurnId: item.turnId });
      adoptConversation(result.session); input.value = source.text;
      draft().attachments = (source.attachments || []).filter((entry) => entry.id && entry.kind !== "skill");
      draft().references = (source.attachments || []).filter((entry) => entry.kind === "file" && !entry.id && entry.path).map((entry) => entry.path);
      draft().skills = (source.attachments || []).filter((entry) => entry.kind === "skill" && state.skills.some((skill) => skill.name === entry.name)).map((entry) => entry.name);
      saveDraft(); extras.refresh(); resize();
      if (item.role === "assistant") composer.requestSubmit();
      else setNotice(t("Đã tạo nhánh trước lượt này. Sửa nội dung rồi gửi; các file trên máy vẫn giữ trạng thái hiện tại."));
    } catch (error) { if (id === conversationId) setNotice(error.message); }
  }

  function renderRequests() {
    const values = session?.requests ?? [];
    const signature = JSON.stringify(values);
    if (requestSignature === signature) return;
    requestSignature = signature; requests.replaceChildren();
    for (const request of values) {
      const requestConversation = conversationId;
      const form = node("form", undefined, "chat-request"); form.dataset.requestId = request.id;
      form.append(node("h3", t(request.title)));
      if (request.reason) form.append(node("p", request.reason));
      if (request.detail) form.append(node("pre", request.detail));
      const fields = new Map();
      for (const question of request.questions ?? []) {
        const label = node("label", question.question, "chat-question");
        let field;
        if (question.options.length && !question.secret) {
          field = node("select", undefined, "select");
          const placeholder = node("option", t("Chọn câu trả lời…")); placeholder.value = ""; field.append(placeholder);
          for (const option of question.options) { const entry = node("option", option.label); entry.value = option.label; field.append(entry); }
          const custom = node("option", t("Nhập câu trả lời khác…")); custom.value = "__custom__"; field.append(custom);
          const details = node("div", undefined, "chat-option-descriptions");
          for (const option of question.options) if (option.description) details.append(node("p", option.label + ": " + option.description));
          const other = node("input"); other.placeholder = t("Câu trả lời của bạn"); other.hidden = true; other.maxLength = 8_000;
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
        const link = node("a", t("Mở trang cần xác nhận"), "button button-soft"); link.href = request.url; link.target = "_blank"; link.rel = "noopener noreferrer"; form.append(link);
      }
      const buttons = node("div", undefined, "chat-request-actions");
      const accept = node("button", request.kind === "questions" || request.kind === "form" ? t("Gửi câu trả lời") : request.kind === "external" ? t("Tôi đã hoàn tất") : t("Cho phép lần này"), "button button-soft"); accept.type = "submit";
      const answer = async (decision) => {
        for (const button of buttons.querySelectorAll("button")) button.disabled = true;
        try {
          const data = Object.fromEntries([...fields].map(([key, value]) => [key, value()]));
          const result = await post(endpoint("answer", requestConversation), { requestId: request.id, decision, answers: data, content: data });
          if (conversationId === requestConversation) { acceptSession(result.session); setNotice(""); }
        } catch (error) { if (conversationId === requestConversation) setNotice(error.message); for (const button of buttons.querySelectorAll("button")) button.disabled = false; }
      };
      if (!request.decisions || request.decisions.includes("accept")) buttons.append(accept);
      if (request.decisions?.includes("acceptForSession")) buttons.append(action(t("Cho phép trong phiên"), () => answer("acceptForSession"), "button button-ghost"));
      for (const rule of request.rules || []) { const button = action(t(rule.label), () => answer(rule.id), "button button-ghost"); button.title = rule.detail; form.insertBefore(node("pre", rule.detail), buttons.parentNode === form ? buttons : null); buttons.append(button); }
      if (!request.decisions || request.decisions.includes("decline")) buttons.append(action(request.kind === "questions" ? t("Bỏ qua") : t("Từ chối"), () => answer("decline"), "button button-ghost"));
      if (request.decisions?.includes("cancel")) buttons.append(action(t("Dừng lượt"), () => answer("cancel"), "button button-ghost"));
      form.append(buttons); form.addEventListener("submit", (event) => { event.preventDefault(); answer("accept"); }); requests.append(form);
    }
  }

  function acceptSession(next) {
    if (!next) return;
    let adopted = false;
    if (!conversationId) {
      const pendingDraft = draft();
      showConversation(next.conversationId);
      if (pendingDraft.text) { Object.assign(draft(), pendingDraft); input.value = draft().text; resize(); }
      adopted = true;
    }
    if (next.conversationId !== conversationId) return;
    conversationEntries = next.conversations ?? [];
    const validIds = new Set(conversationEntries.map((entry) => entry.id));
    openTabs = openTabs.filter((id) => validIds.has(id));
    if (!openTabs.includes(conversationId)) openTabs.push(conversationId);
    saveTabs(); renderTabs(); history.setAttribute("aria-labelledby", "chat-tab-" + conversationId);
    session = next; renderMessages(); renderRequests(); extras?.refresh(); updateControls();
    if (session.error) setNotice(session.error);
    if (adopted) subscribe();
  }

  async function loadSession() {
    const version = generation;
    const response = await fetch(endpoint()); const result = await response.json();
    if (version !== generation) return;
    if (!response.ok) throw new Error(result.error || t("Không mở được hội thoại."));
    acceptSession(result.session);
  }

  function subscribe() {
    stream?.close(); stream = null;
    if (!opened || document.hidden) return;
    const version = generation;
    const query = new URLSearchParams(); if (conversationId) query.set("conversation", conversationId);
    stream = new EventSource("/api/chat/events?" + query);
    stream.addEventListener("state", (event) => {
      if (version !== generation) return;
      const data = JSON.parse(event.data); online = true; acceptStatus(data.status); acceptSession(data.session); updateControls();
    });
    stream.onopen = () => { online = true; loadSession().catch((error) => setNotice(error.message)); updateControls(); };
    stream.onerror = () => { online = false; updateControls(); };
  }

  async function connect() {
    setNotice("");
    connection.replaceChildren(node("p", t("Đang kết nối Codex…")));
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
    modalState(); renderConnection(); subscribe(); connect(); input.focus(); updateLayout(); scrollToEnd(true);
    const url = new URL(location.href); url.searchParams.set("chat", "1"); historyUrl(url);
  }
  function historyUrl(url) { window.history.replaceState(null, "", url); }
  function close() {
    stopResize(); dismissMenu(); extras.closePopup(); opened = false; root.hidden = true; document.body.classList.remove("chat-is-open"); toggle.setAttribute("aria-expanded", "false");
    stream?.close(); stream = null; modalState();
    const url = new URL(location.href); url.searchParams.delete("chat"); historyUrl(url);
    if (returnFocus?.isConnected && returnFocus !== document.body && !root.contains(returnFocus)) returnFocus.focus(); else toggle.focus();
  }

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (extras.slash()) { resize(); return; }
    const value = draft(); value.sending = true; setNotice(""); updateControls();
    const message = input.value; const currentConversation = conversationId; const key = draftKey();
    try {
      const attachments = (value.attachments || []).map((entry) => entry.id);
      const references = [...(value.references || [])], skills = [...(value.skills || [])];
      const body = { message, model: value.model || null, attachments, references, skills, options: session?.active ? {} : value.options || {} };
      const signature = JSON.stringify(body); const sameAttempt = value.attempt?.signature === signature;
      const clientId = sameAttempt ? value.attempt.clientId : crypto.randomUUID();
      value.attempt = { signature, clientId }; saveDraft();
      const result = await post(endpoint("messages", currentConversation), { ...body, clientId });
      if (value.text === message) value.text = "";
      value.attachments = (value.attachments || []).filter((entry) => !attachments.includes(entry.id));
      value.references = (value.references || []).filter((entry) => !references.includes(entry));
      value.skills = (value.skills || []).filter((entry) => !skills.includes(entry));
      value.attempt = null; persistDraft(value, key);
      if (currentConversation === conversationId) {
        input.value = value.text; saveDraft(); acceptSession(result.session); resize(); scrollToEnd(true); input.focus();
      }
    } catch (error) {
      const messageText = error.message + t(" Nếu mất kết nối khi gửi, kiểm tra lịch sử trước khi gửi lại.");
      if (currentConversation === conversationId) setNotice(messageText);
      else { const view = views.get(key); if (view) view.notice = messageText; }
    } finally { value.sending = false; updateControls(); }
  });
  input.addEventListener("input", () => { saveDraft(); resize(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!submit.disabled) composer.requestSubmit(); }
  });
  history.addEventListener("scroll", () => { if (history.scrollHeight - history.scrollTop - history.clientHeight < 100) jump.hidden = true; });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); if (extras.closePopup(true)) return; if (!menu.hidden) { dismissMenu(); historyButton.focus(); } else close(); }
    if (event.key !== "Tab" || !smallScreen.matches) return;
    const candidates = [...root.querySelectorAll(focusable)].filter((element) => element.getClientRects().length);
    const first = candidates[0]; const last = candidates.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  try {
    const stored = JSON.parse(sessionStorage.getItem("padstudio-codex-tabs"));
    if (Array.isArray(stored?.ids) && stored.ids.every((id) => typeof id === "string")) {
      openTabs = stored.ids; conversationId = openTabs.includes(stored.selected) ? stored.selected : openTabs[0] ?? null;
      input.value = draft().text;
    }
  } catch { /* Optional browser storage. */ }
  toggle.addEventListener("click", () => opened ? close() : openPanel());
  smallScreen.addEventListener("change", () => { stopResize(); modalState(); updateLayout(); });
  document.addEventListener("visibilitychange", subscribe);
  document.addEventListener("pointerdown", (event) => { if (!menu.hidden && !menu.contains(event.target) && !historyButton.contains(event.target)) dismissMenu(); });
  return { open: openPanel, close, syncModal: modalState };
}
