import { node } from "./dom.js";
import { createVoicePicker } from "./voice-picker.js";

// The Tools sheet, in three tabs so each job has its own place:
//   Tổng quan        what PADStudio can use on this machine; only what needs the user is spelled out
//   Giọng đọc        the ElevenLabs key, model and voice (and the free local voice)
//   Dịch vụ của bạn  the outside services the user has
// It is the only part of the web that writes, and it only writes machine settings (never a project), through
// PUT /api/settings with the headers the server requires.

const TABS = Object.freeze([
  { id: "overview", label: "Tổng quan" },
  { id: "voice", label: "Giọng đọc" },
  { id: "services", label: "Dịch vụ của bạn" }
]);
const STATUS_CHIP = Object.freeze({ ready: "accepted", partial: "waiting", needs_key: "waiting", needs_setup: "empty" });
const ATTENTION_ORDER = Object.freeze({ needs_key: 0, needs_setup: 1, partial: 2 });
const WRITE_HEADERS = Object.freeze({ "Content-Type": "application/json", "X-PADStudio-Intent": "settings" });
const COST_SUFFIX = Object.freeze({ network: "cần mạng", paid: "trả phí" });

const timeFormat = new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" });

function chip(status, label) {
  const element = node("span", undefined, "chip chip-" + (STATUS_CHIP[status] ?? "empty"));
  element.append(node("span", undefined, "chip-dot"), node("span", label));
  return element;
}

function message(element, text, kind) {
  element.textContent = text ?? "";
  element.classList.toggle("is-ok", kind === "ok");
  element.classList.toggle("is-error", kind === "error");
}

async function send(path, method, body) {
  const response = await fetch(path, { method, headers: WRITE_HEADERS, body: JSON.stringify(body ?? {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Không lưu được cài đặt.");
  return value;
}

export function createToolsPanel({ root, body, refreshButton }) {
  const tabList = root.querySelector("#tools-tabs");
  let data = null;
  let loading = null;
  let opener = null;
  let activeTab = "overview";
  const picker = createVoicePicker({ post: (path, payload) => send(path, "POST", payload), save: (patch, text) => save(patch, text) });

  function isOpen() { return !root.hidden; }

  /* ------------------------------------------------------------------------------------------------ */
  /* Tổng quan                                                                                           */
  /* ------------------------------------------------------------------------------------------------ */

  function attentionCard(entry) {
    const card = node("li", undefined, "tool-card");
    card.dataset.tool = entry.id;
    const head = node("div", undefined, "tool-card-head");
    head.append(node("strong", entry.name, "tool-name"));
    if (entry.costLabel) head.append(node("span", entry.costLabel, "tool-cost"));
    head.append(chip(entry.status, entry.statusLabel));
    card.append(head, node("p", entry.summary, "tool-summary"));
    if (entry.setup) card.append(node("p", entry.setup, "tool-setup"));
    if (entry.id === "elevenlabs" || entry.id === "piper") {
      const go = node("button", entry.id === "elevenlabs" && entry.status === "needs_key" ? "Dán khóa API" : "Mở phần Giọng đọc", "button button-quiet");
      go.type = "button"; go.dataset.control = "goto-voice";
      go.addEventListener("click", () => showTab("voice", { focus: entry.id === "elevenlabs" && entry.status === "needs_key" ? "#elevenlabs-key" : null }));
      card.append(go);
    }
    if (entry.missing.length) {
      const details = node("details", undefined, "tool-details");
      details.append(node("summary", "Chi tiết kỹ thuật"));
      const list = node("ul");
      for (const missing of entry.missing) list.append(node("li", missing.reason ? `${missing.name}: ${missing.reason}` : missing.name));
      details.append(list);
      card.append(details);
    }
    return card;
  }

  function readyPill(entry) {
    const pill = node("li", undefined, "tool-pill");
    pill.dataset.tool = entry.id;
    pill.title = entry.summary;
    pill.append(node("span", undefined, "pill-dot"), node("span", entry.name, "tool-name"));
    if (COST_SUFFIX[entry.cost]) pill.append(node("span", COST_SUFFIX[entry.cost], "tool-cost"));
    pill.append(node("span", entry.summary, "sr-only"));
    return pill;
  }

  function overviewPanel(tools) {
    const entries = tools.groups.flatMap((group) => group.items.map((entry) => ({ ...entry, groupLabel: group.label, groupId: group.id })));
    const needs = entries.filter((entry) => entry.status !== "ready")
      .sort((left, right) => (ATTENTION_ORDER[left.status] ?? 9) - (ATTENTION_ORDER[right.status] ?? 9));
    const checked = Date.parse(tools.checkedAt);
    const parts = [];

    const summary = node("p", undefined, "tools-summary");
    summary.append(node("span", undefined, "summary-dot" + (needs.length ? " is-attention" : "")),
      node("strong", `${tools.summary.ready}/${tools.summary.total} mục sẵn sàng`),
      node("span", Number.isFinite(checked) ? ` · kiểm tra lúc ${timeFormat.format(new Date(checked))}` : "", "form-note"));
    parts.push(summary);

    if (needs.length) {
      const section = node("section", undefined, "tools-section");
      const heading = node("h3", `Cần bạn làm (${needs.length})`, "tools-section-title");
      const list = node("ul", undefined, "tool-cards");
      for (const entry of needs) list.append(attentionCard(entry));
      section.append(heading, list);
      parts.push(section);
    }

    const ready = tools.groups.map((group) => ({ group, items: group.items.filter((entry) => entry.status === "ready") })).filter((row) => row.items.length);
    const readyCount = ready.reduce((sum, row) => sum + row.items.length, 0);
    if (readyCount) {
      const section = node("section", undefined, "tools-section");
      section.append(node("h3", `Sẵn sàng (${readyCount})`, "tools-section-title"));
      for (const row of ready) {
        const line = node("div", undefined, "ready-group");
        line.append(node("span", row.group.label, "ready-label"));
        const pills = node("ul", undefined, "ready-pills");
        for (const entry of row.items) pills.append(readyPill(entry));
        line.append(pills);
        section.append(line);
      }
      parts.push(section);
    }
    return parts;
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Giọng đọc                                                                                           */
  /* ------------------------------------------------------------------------------------------------ */

  function step(number, title, hint) {
    const section = node("section", undefined, "step");
    const heading = node("div", undefined, "step-heading");
    heading.append(node("span", String(number), "step-number"), node("h3", title));
    if (hint) heading.append(node("span", hint, "step-hint"));
    section.append(heading);
    return section;
  }

  function keyStep(settings) {
    const state = settings.elevenLabs.apiKey;
    const section = step(1, "Tài khoản ElevenLabs", "giọng chất lượng cao, tính phí theo ký tự");
    const wrap = node("div", undefined, "key-block");
    const status = node("p", undefined, "form-message");
    status.setAttribute("role", "status");

    if (state.configured) {
      const saved = node("div", undefined, "key-saved");
      saved.append(node("span", "✓ Đã lưu khóa" + (state.hint ? " " + state.hint : ""), "key-state"));
      const check = node("button", "Kiểm tra kết nối", "button button-quiet");
      check.type = "button"; check.dataset.control = "elevenlabs-check";
      const remove = node("button", "Xóa khóa", "button button-ghost");
      remove.type = "button"; remove.dataset.control = "elevenlabs-remove";
      check.addEventListener("click", async () => {
        check.disabled = true; message(status, "Đang kết nối tới ElevenLabs…");
        try {
          const result = await send("/api/settings/elevenlabs/check", "POST");
          message(status, result.message, result.ok ? "ok" : "error");
        } catch (error) { message(status, error.message, "error"); }
        finally { check.disabled = false; }
      });
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try { await save({ elevenLabs: { apiKey: null } }, "Đã xóa khóa."); }
        catch (error) { message(status, error.message, "error"); remove.disabled = false; }
      });
      saved.append(check, remove);
      wrap.append(saved);
    }

    const form = node("form", undefined, "inline-form");
    form.noValidate = true;
    const input = node("input", undefined, "field");
    Object.assign(input, { id: "elevenlabs-key", type: "password", autocomplete: "off", spellcheck: false,
      placeholder: state.configured ? "Dán khóa mới để thay khóa đã lưu" : "Dán khóa API ElevenLabs (elevenlabs.io → Profile → API Keys)" });
    input.setAttribute("aria-label", "Khóa API ElevenLabs");
    input.dataset.control = "elevenlabs-key";
    const saveButton = node("button", "Lưu khóa", "button button-primary");
    saveButton.type = "submit";
    form.append(input, saveButton);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) { message(status, "Dán khóa vào ô trước khi lưu.", "error"); input.focus(); return; }
      saveButton.disabled = true; message(status, "Đang lưu…");
      try {
        await save({ elevenLabs: { apiKey: value } }, "Đã lưu khóa. Agent sẽ dùng được ElevenLabs.");
      } catch (error) {
        message(status, error.message, "error"); saveButton.disabled = false;
      }
    });
    if (state.configured) {
      // A key is already saved: replacing it is rare, so the field stays folded away.
      const replace = node("details", undefined, "key-replace");
      replace.append(node("summary", "Thay bằng khóa khác"), form);
      wrap.append(replace, status);
    } else {
      wrap.append(form, status);
    }
    section.append(wrap);
    return section;
  }

  function localVoiceNote(entry) {
    if (!entry) return null;
    const row = node("div", undefined, "local-voice");
    row.dataset.tool = entry.id;
    const head = node("div", undefined, "local-voice-head");
    head.append(node("strong", "Piper", "tool-name"), node("span", "miễn phí, chạy trên máy", "tool-cost"), chip(entry.status, entry.statusLabel));
    row.append(head);
    if (entry.setup) row.append(node("p", entry.setup, "tool-setup"));
    return row;
  }

  function voicePanel(settings, tools) {
    const entries = tools.groups.flatMap((group) => group.items);
    const eleven = entries.find((entry) => entry.id === "elevenlabs");
    const piper = entries.find((entry) => entry.id === "piper");
    const parts = [];
    const configured = settings.elevenLabs.apiKey.configured;

    if (configured) {
      const built = picker.build(settings, { chip: eleven ? chip(eleven.status, eleven.statusLabel) : null });
      parts.push(built.summary, built.flash, keyStep(settings), built.modelStep, built.voiceStep);
    } else {
      const empty = node("div", undefined, "voice-summary");
      empty.dataset.tool = "elevenlabs";
      const text = node("div", undefined, "voice-summary-text");
      text.append(node("span", "Đang dùng cho lời đọc", "kicker"), node("strong", "Chưa có khóa ElevenLabs", "voice-summary-name is-empty"),
        node("span", "Không có khóa thì Agent dùng giọng Piper miễn phí trên máy.", "voice-summary-meta"));
      empty.append(text, ...(eleven ? [chip(eleven.status, eleven.statusLabel)] : []));
      const later = step(2, "Model và giọng", "mở sau khi lưu khóa");
      later.append(node("p", "Lưu khóa ở bước 1 rồi chọn model, tìm giọng, nghe thử và chọn giọng dùng cho lời đọc.", "form-note"));
      parts.push(empty, keyStep(settings), later);
    }
    const local = localVoiceNote(piper);
    if (local) parts.push(local);
    parts.push(node("p", "Khóa API chỉ lưu trong padstudio.local.json trên máy này: không đưa lên Git, không gửi cho Agent, " +
      "không hiện lại trên trang. Đừng dán khóa vào cuộc trò chuyện với Agent.", "tools-privacy"));
    return parts;
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Dịch vụ của bạn                                                                                     */
  /* ------------------------------------------------------------------------------------------------ */

  function servicesPanel(settings) {
    const intro = node("p", "Đánh dấu những dịch vụ bạn có tài khoản. PADStudio không tự gọi chúng: Agent biết để đề xuất cách làm, " +
      "rồi lưu file tạo ra vào dự án kèm nguồn và bản quyền.", "tools-intro");
    const form = node("form", undefined, "services-form");
    const grid = node("div", undefined, "service-grid");
    for (const category of settings.services.categories) {
      const option = node("label", undefined, "service-option");
      const box = node("input");
      Object.assign(box, { type: "checkbox", name: "service", value: category.id, checked: settings.services.available.includes(category.id) });
      option.append(box, node("span", category.label, "service-name"), node("small", category.examples));
      grid.append(option);
    }
    const noteLabel = node("label", "Ghi chú cho Agent (không bắt buộc)", "form-label");
    noteLabel.htmlFor = "services-note";
    const note = node("textarea", undefined, "field");
    Object.assign(note, { id: "services-note", maxLength: 500, rows: 3, value: settings.services.note ?? "",
      placeholder: "Ví dụ: có ChatGPT Plus để tạo ảnh, Suno bản miễn phí; không muốn tốn quá 5 USD mỗi video." });
    const actions = node("div", undefined, "form-actions");
    const submit = node("button", "Lưu", "button button-primary");
    submit.type = "submit";
    const status = node("p", undefined, "form-message");
    status.setAttribute("role", "status");
    actions.append(submit, status);
    form.append(grid, noteLabel, note, actions);
    form.classList.add("services-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true; message(status, "Đang lưu…");
      try {
        await save({ services: {
          available: [...form.querySelectorAll("input[name=service]:checked")].map((box) => box.value),
          note: note.value.trim() || null
        } }, "Đã lưu. Agent sẽ thấy ở lần đọc dự án tiếp theo.");
      } catch (error) {
        message(status, error.message, "error"); submit.disabled = false;
      }
    });
    return [intro, form];
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Tabs and rendering                                                                                  */
  /* ------------------------------------------------------------------------------------------------ */

  function tabButtons() { return [...tabList.querySelectorAll(".tab")]; }

  function applyTab({ focus = false } = {}) {
    for (const tab of tabButtons()) {
      const selected = tab.dataset.tab === activeTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of body.querySelectorAll(".tools-panel")) panel.hidden = panel.dataset.panel !== activeTab;
    if (activeTab !== "voice") picker.stop();
    else if (data?.settings.elevenLabs.apiKey.configured) picker.start();
  }

  function setUrl(open) {
    const location = new URL(window.location.href);
    if (open) {
      location.searchParams.set("panel", "tools");
      if (activeTab === "overview") location.searchParams.delete("tab"); else location.searchParams.set("tab", activeTab);
    } else {
      location.searchParams.delete("panel"); location.searchParams.delete("tab");
    }
    window.history.replaceState(null, "", location);
  }

  function showTab(id, { focus = null, focusTab = false } = {}) {
    if (!TABS.some((tab) => tab.id === id)) id = "overview";
    activeTab = id;
    applyTab({ focus: focusTab });
    if (isOpen()) setUrl(true);
    if (focus) body.querySelector(focus)?.focus();
  }

  // The sheet is rebuilt after every save. Keep the reader's place and, above all, keyboard focus: the control they just
  // used is replaced, and without this focus would fall back to the page.
  function describeFocus() {
    const active = document.activeElement;
    if (!active || !body.contains(active)) return null;
    return { id: active.id || null, control: active.dataset?.control ?? null, voice: active.closest("[data-voice]")?.dataset.voice ?? null,
      tool: active.closest("[data-tool]")?.dataset.tool ?? null };
  }

  function restoreFocus(focus) {
    if (!focus) return;
    let target = focus.id ? body.querySelector("#" + CSS.escape(focus.id)) : null;
    if (!target && focus.control) {
      const scope = focus.voice ? `[data-voice="${CSS.escape(focus.voice)}"] ` : focus.tool ? `[data-tool="${CSS.escape(focus.tool)}"] ` : "";
      target = body.querySelector(`${scope}[data-control="${focus.control}"]`);
    }
    target?.focus({ preventScroll: true });
  }

  function panel(id, children) {
    const section = node("section", undefined, "tools-panel");
    section.id = "tools-panel-" + id;
    section.dataset.panel = id;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", "tools-tab-" + id);
    section.append(...children);
    return section;
  }

  function render({ flash = null } = {}) {
    if (!data) return;
    const scroll = body.scrollTop;
    const focus = describeFocus();
    const { tools, settings } = data;
    body.replaceChildren(
      panel("overview", overviewPanel(tools)),
      panel("voice", voicePanel(settings, tools)),
      panel("services", servicesPanel(settings))
    );
    applyTab();
    body.scrollTop = scroll;
    restoreFocus(focus);
    if (flash) {
      const target = body.querySelector(flash.selector);
      if (target) message(target, flash.text, "ok");
    }
  }

  async function load({ refresh = false } = {}) {
    if (loading && !refresh) return loading;
    if (!data) body.replaceChildren(node("p", "Đang kiểm tra công cụ trên máy…", "tools-loading"));
    refreshButton.disabled = true;
    loading = (async () => {
      const response = await fetch("/api/tools" + (refresh ? "?refresh=1" : ""));
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || "Không đọc được danh sách công cụ.");
      data = value;
      render();
    })();
    try { await loading; }
    catch (error) { if (!data) body.replaceChildren(node("p", error.message, "tools-loading form-message is-error")); throw error; }
    finally { loading = null; refreshButton.disabled = false; }
  }

  // Save, then show the result. A key changes what is available, so the tools are checked again after it;
  // declared services, the voice and the model do not, so those saves are instant.
  async function save(patch, text) {
    const result = await send("/api/settings", "PUT", patch);
    if (data) data.settings = result.settings;
    const changesKey = Boolean(patch.elevenLabs && "apiKey" in patch.elevenLabs);
    if (changesKey) picker.reset();
    const selector = !patch.elevenLabs ? "#tools-panel-services .form-message"
      : changesKey ? "#tools-panel-voice .key-block .form-message" : "#tools-panel-voice .voice-flash";
    render({ flash: { selector, text } });
    if (changesKey) {
      await load({ refresh: true }).catch(() => {});
      render({ flash: { selector, text } });
    }
  }

  function open({ tab = null } = {}) {
    if (isOpen()) { if (tab) showTab(tab); return; }
    opener = document.activeElement;
    root.hidden = false;
    document.body.classList.add("library-open");
    document.querySelector("#main")?.setAttribute("inert", "");
    document.querySelector("#topbar")?.setAttribute("inert", "");
    if (tab && TABS.some((entry) => entry.id === tab)) activeTab = tab;
    applyTab();
    setUrl(true);
    root.querySelector("[data-tools-close]")?.focus();
    load().catch(() => {});
    root.dispatchEvent(new CustomEvent("toolschange", { bubbles: true, detail: { open: true } }));
  }

  function close() {
    if (!isOpen()) return;
    root.hidden = true;
    picker.stop();
    document.body.classList.remove("library-open");
    document.querySelector("#main")?.removeAttribute("inert");
    document.querySelector("#topbar")?.removeAttribute("inert");
    setUrl(false);
    if (opener instanceof HTMLElement) opener.focus();
    root.dispatchEvent(new CustomEvent("toolschange", { bubbles: true, detail: { open: false } }));
  }

  tabList.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) showTab(tab.dataset.tab);
  });
  tabList.addEventListener("keydown", (event) => {
    const ids = TABS.map((tab) => tab.id);
    const index = ids.indexOf(activeTab);
    const next = { ArrowRight: ids[(index + 1) % ids.length], ArrowLeft: ids[(index + ids.length - 1) % ids.length], Home: ids[0], End: ids.at(-1) }[event.key];
    if (next) { event.preventDefault(); showTab(next, { focusTab: true }); }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll("button:not(:disabled), input, textarea, summary, [href]")]
      .filter((element) => !element.closest("[hidden]") && element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.querySelector("[data-tools-backdrop]")?.addEventListener("click", close);
  root.querySelector("[data-tools-close]")?.addEventListener("click", close);
  refreshButton.addEventListener("click", () => load({ refresh: true }).catch(() => {}));

  return { open, close, isOpen };
}
