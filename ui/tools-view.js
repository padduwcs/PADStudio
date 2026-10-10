import { node } from "./dom.js";
import { createVoicePicker } from "./voice-picker.js";

// The Tools sheet: what PADStudio can use on this machine, the ElevenLabs key and the outside services the user
// has. It is the only part of the web that writes, and it only writes machine settings (never a project), through
// PUT /api/settings with the headers the server requires.

const STATUS_CHIP = Object.freeze({ ready: "accepted", partial: "waiting", needs_key: "waiting", needs_setup: "empty" });
const WRITE_HEADERS = Object.freeze({ "Content-Type": "application/json", "X-PADStudio-Intent": "settings" });

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
  let data = null;
  let loading = null;
  let opener = null;
  const picker = createVoicePicker({ post: (path, body) => send(path, "POST", body), save: (patch, text) => save(patch, text) });

  function isOpen() { return !root.hidden; }

  function keyForm(settings) {
    const state = settings.elevenLabs.apiKey;
    const form = node("form", undefined, "key-form");
    form.noValidate = true;
    const label = node("label", "Khóa API ElevenLabs", "sr-only");
    label.htmlFor = "elevenlabs-key";
    const input = node("input", undefined, "field");
    Object.assign(input, { id: "elevenlabs-key", type: "password", autocomplete: "off", spellcheck: false,
      placeholder: state.configured ? "Dán khóa mới để thay khóa đã lưu" : "Dán khóa API ElevenLabs" });
    input.dataset.control = "elevenlabs-key";
    const saveButton = node("button", "Lưu khóa", "button button-primary");
    saveButton.type = "submit";
    form.append(label, input, saveButton);
    const status = node("p", undefined, "form-message");
    status.setAttribute("role", "status");
    const saved = node("div", undefined, "key-saved");
    if (state.configured) {
      saved.append(node("span", "Đã lưu khóa" + (state.hint ? " " + state.hint : "") + ".", "form-note"));
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
    }
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
    const wrap = node("div", undefined, "key-block");
    wrap.append(form, ...(state.configured ? [saved] : []), status);
    return wrap;
  }

  function item(entry, settings) {
    const row = node("li", undefined, "tool-item");
    row.dataset.tool = entry.id;
    const head = node("div", undefined, "tool-head");
    head.append(node("span", entry.name, "tool-name"));
    if (entry.costLabel) head.append(node("span", entry.costLabel, "tool-cost"));
    head.append(chip(entry.status, entry.statusLabel));
    row.append(head, node("p", entry.summary, "tool-summary"));
    if (entry.setup) row.append(node("p", entry.setup, "tool-setup"));
    if (entry.setting === "elevenLabs.apiKey") {
      row.append(keyForm(settings));
      if (settings.elevenLabs.apiKey.configured) row.append(picker.element(settings));
    }
    if (entry.missing.length) {
      const details = node("details", undefined, "tool-details");
      details.append(node("summary", "Chi tiết kỹ thuật"));
      const list = node("ul");
      for (const missing of entry.missing) list.append(node("li", missing.reason ? `${missing.name}: ${missing.reason}` : missing.name));
      details.append(list);
      row.append(details);
    }
    return row;
  }

  function services(settings) {
    const section = node("section", undefined, "tools-group tools-services");
    section.setAttribute("aria-labelledby", "services-title");
    const title = node("h3", "Dịch vụ khác bạn dùng được"); title.id = "services-title";
    section.append(title, node("p",
      "Đánh dấu những dịch vụ bạn có tài khoản. PADStudio không tự gọi chúng; Agent biết để đề xuất cách làm, rồi lưu file tạo ra vào dự án kèm nguồn và bản quyền.",
      "tool-summary"));
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
    section.append(form);
    return section;
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

  function render({ flash = null } = {}) {
    if (!data) return;
    const scroll = body.scrollTop;
    const focus = describeFocus();
    const { tools, settings } = data;
    const checked = Date.parse(tools.checkedAt);
    const parts = [node("p", `${tools.summary.ready}/${tools.summary.total} mục sẵn sàng` +
      (Number.isFinite(checked) ? ` · kiểm tra lúc ${timeFormat.format(new Date(checked))}` : ""), "tools-summary")];
    for (const group of tools.groups) {
      const section = node("section", undefined, "tools-group");
      const heading = node("h3", group.label);
      heading.id = "tools-group-" + group.id;
      section.setAttribute("aria-labelledby", heading.id);
      const list = node("ul", undefined, "tools-list");
      for (const entry of group.items) list.append(item(entry, settings));
      section.append(heading, list);
      parts.push(section);
    }
    parts.push(services(settings));
    parts.push(node("p", "Khóa API chỉ lưu trong padstudio.local.json trên máy này: không đưa lên Git, không gửi cho Agent, " +
      "không hiện lại trên trang. Đừng dán khóa vào cuộc trò chuyện với Agent.", "tools-privacy"));
    body.replaceChildren(...parts);
    body.scrollTop = scroll;
    restoreFocus(focus);
    if (flash) {
      const target = body.querySelector(flash.selector);
      if (target) message(target, flash.text, "ok");
    }
  }

  async function load({ refresh = false } = {}) {
    if (loading && !refresh) return loading;
    if (!data) body.replaceChildren(node("p", "Đang kiểm tra công cụ trên máy… (lần đầu mất vài giây)", "tools-loading"));
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
  // declared services do not, so that save is instant.
  async function save(patch, text) {
    const result = await send("/api/settings", "PUT", patch);
    if (data) data.settings = result.settings;
    const changesKey = Boolean(patch.elevenLabs && "apiKey" in patch.elevenLabs);
    if (changesKey) picker.reset();
    const selector = !patch.elevenLabs ? ".tools-services .form-message"
      : changesKey ? "[data-tool=elevenlabs] .key-block .form-message" : "[data-tool=elevenlabs] .voice-flash";
    render({ flash: { selector, text } });
    if (changesKey) {
      await load({ refresh: true }).catch(() => {});
      render({ flash: { selector, text } });
    }
  }

  function setUrl(open) {
    const location = new URL(window.location.href);
    if (open) location.searchParams.set("panel", "tools"); else location.searchParams.delete("panel");
    window.history.replaceState(null, "", location);
  }

  function open() {
    if (isOpen()) return;
    opener = document.activeElement;
    root.hidden = false;
    document.body.classList.add("library-open");
    document.querySelector("#main")?.setAttribute("inert", "");
    document.querySelector("#topbar")?.setAttribute("inert", "");
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
