import { ICONS, node, svgIcon } from "./dom.js";

// The ElevenLabs voice and model picker, shown on the "Giọng đọc" tab of the Tools sheet. It reads the user's own
// ElevenLabs account through this server (free, read-only lookups) and saves the chosen voice and model as the default
// the Agent proposes. Nothing here spends credits; synthesis still needs an exact authorization for every request.

const LANGUAGE = "vi";
const SEARCH_DELAY_MS = 350;
const MAX_TAGS = 3;

export function createVoicePicker({ post, save }) {
  const state = {
    started: false, search: "",
    voices: [], next: null, total: null, loadingVoices: false, voicesError: null,
    models: null, modelsError: null,
    lookup: null, lookupError: null, lookingUp: false, lookupOpen: false,
    playing: null
  };
  let settings = null;
  let nodes = null;
  let audio = null;
  let timer = null;
  let sequence = 0;

  const currentVoiceId = () => settings?.elevenLabs.voice?.id ?? null;
  const currentModelId = () => settings?.elevenLabs.modelId ?? null;

  function stopAudio() {
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null; }
    state.playing = null;
  }

  function modelLabel(model) {
    const language = model.supportsLanguage === true ? "tiếng Việt ✓"
      : model.supportsLanguage === false ? "không hỗ trợ tiếng Việt" : "chưa rõ tiếng Việt";
    const cost = model.creditMultiplier === null ? "không rõ hệ số credit" : `${model.creditMultiplier} credit/ký tự`;
    return `${model.name} · ${language} · ${cost}`;
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Painting: each function redraws one region from `state`, so a late answer never rebuilds the form   */
  /* ------------------------------------------------------------------------------------------------ */

  function paintCurrent() {
    const voice = settings.elevenLabs.voice;
    const model = state.models?.find((entry) => entry.modelId === currentModelId());
    nodes.voiceName.textContent = voice ? (voice.name ?? voice.id) : "Chưa chọn giọng";
    nodes.voiceName.classList.toggle("is-empty", !voice);
    const model_ = currentModelId() ? (model?.name ?? currentModelId()) : "chưa chọn model";
    nodes.voiceMeta.textContent = voice
      ? `Model: ${model_} · mã ${voice.id}`
      : `Model: ${model_} · Agent sẽ hỏi bạn khi cần giọng đọc`;
  }

  function paintModels() {
    const select = nodes.model;
    select.replaceChildren();
    if (state.modelsError) { nodes.modelNote.textContent = state.modelsError; nodes.modelNote.className = "form-message is-error"; select.disabled = true; return; }
    if (!state.models) { nodes.modelNote.textContent = "Đang đọc danh sách model…"; nodes.modelNote.className = "form-note"; select.disabled = true; return; }
    const saved = currentModelId();
    const none = node("option", "Chọn model…"); none.value = ""; select.append(none);
    for (const model of state.models) {
      const option = node("option", modelLabel(model) + (model.usable ? "" : " (không dùng được)"));
      option.value = model.modelId; option.disabled = !model.usable;
      select.append(option);
    }
    if (saved && !state.models.some((model) => model.modelId === saved)) {
      const missing = node("option", `${saved} (không còn trong tài khoản)`); missing.value = saved; select.append(missing);
    }
    select.value = saved ?? "";
    select.disabled = false;
    const chosen = state.models.find((model) => model.modelId === saved);
    nodes.modelNote.className = "form-note";
    nodes.modelNote.textContent = chosen
      ? (chosen.usable ? "Tối đa " + (chosen.maxCharacters ? chosen.maxCharacters.toLocaleString("vi") + " ký tự mỗi lần tạo." : "số ký tự mỗi lần tạo do ElevenLabs quy định.") : chosen.unusableReason ?? "")
      : "Chỉ model hỗ trợ tiếng Việt và công bố hệ số credit mới chọn được.";
  }

  function voiceCard(voice) {
    const isCurrent = voice.voiceId === currentVoiceId();
    const card = node("li", undefined, "voice-card" + (isCurrent ? " is-current" : "") + (voice.usable ? "" : " is-unusable"));
    card.dataset.voice = voice.voiceId;
    const play = node("button", undefined, "voice-play");
    play.type = "button";
    const playing = state.playing === voice.voiceId;
    play.setAttribute("aria-label", (playing ? "Dừng nghe thử " : "Nghe thử ") + voice.name);
    play.disabled = !voice.previewUrl;
    if (!voice.previewUrl) play.title = "Giọng này không có bản nghe thử";
    play.append(svgIcon(playing ? ICONS.pause : ICONS.play, { size: 16 }));
    play.addEventListener("click", () => togglePreview(voice));

    const text = node("div", undefined, "voice-text");
    const tags = node("span", undefined, "voice-meta");
    const verified = voice.verifiedLanguages.some((language) => /^vi\b/i.test(language));
    const labels = [...voice.labels.map((label) => label.value), ...(voice.category ? [voice.category] : [])].slice(0, MAX_TAGS);
    for (const label of labels) tags.append(node("span", label, "voice-tag"));
    if (verified) tags.append(node("span", "✓ tiếng Việt", "voice-tag is-verified"));
    const head = node("div", undefined, "voice-line");
    head.append(node("span", voice.name, "voice-name"), tags);
    text.append(head);
    if (voice.description) text.append(node("span", voice.description, "voice-desc"));
    if (!voice.usable && voice.unusableReason) text.append(node("span", voice.unusableReason, "voice-desc is-error"));

    const use = node("button", isCurrent ? "Đang dùng" : "Dùng giọng này", "button " + (isCurrent ? "button-soft" : "button-quiet"));
    use.type = "button"; use.disabled = isCurrent || !voice.usable;
    use.dataset.control = "use-voice";
    use.addEventListener("click", () => chooseVoice(voice, use));
    card.append(play, text, use);
    return card;
  }

  function paintVoices() {
    const { list, status, more } = nodes;
    list.replaceChildren(...state.voices.map(voiceCard));
    const query = state.search ? ` cho “${state.search}”` : "";
    if (state.voicesError) { status.textContent = state.voicesError; status.className = "form-message is-error"; }
    else if (state.loadingVoices && !state.voices.length) { status.textContent = "Đang tìm giọng…"; status.className = "form-note"; }
    else if (!state.voices.length) { status.textContent = `Không có giọng nào${query}. Thử từ khóa khác, hoặc dán mã giọng nếu bạn đã dùng giọng này.`; status.className = "form-note"; }
    else {
      const total = Number.isFinite(state.total) ? ` / ${state.total}` : "";
      status.textContent = `${state.voices.length}${total} giọng${query}`; status.className = "form-note";
    }
    more.hidden = !state.next;
    more.disabled = state.loadingVoices;
  }

  function paintLookup() {
    const { lookupResult, lookupMessage } = nodes;
    lookupResult.replaceChildren(...(state.lookup ? [voiceCard(state.lookup)] : []));
    lookupMessage.textContent = state.lookingUp ? "Đang tìm…" : state.lookupError ?? "";
    lookupMessage.className = "form-message" + (state.lookupError ? " is-error" : "");
  }

  function paintAll() { paintCurrent(); paintModels(); paintVoices(); paintLookup(); }

  /* ------------------------------------------------------------------------------------------------ */
  /* Actions                                                                                           */
  /* ------------------------------------------------------------------------------------------------ */

  async function loadModels() {
    try { state.models = (await post("/api/settings/elevenlabs/models", { language: LANGUAGE })).models; state.modelsError = null; }
    catch (error) { state.modelsError = error.message; }
    if (nodes) { paintModels(); paintCurrent(); }
  }

  async function loadVoices({ append = false } = {}) {
    const mine = ++sequence;
    state.loadingVoices = true; state.voicesError = null;
    if (!append) { state.voices = []; state.next = null; }
    if (nodes) paintVoices();
    try {
      const page = await post("/api/settings/elevenlabs/voices", {
        language: LANGUAGE, search: state.search, pageToken: append ? state.next : null
      });
      if (mine !== sequence) return;
      state.voices = append ? [...state.voices, ...page.voices] : page.voices;
      state.next = page.nextPageToken; state.total = page.totalCount;
    } catch (error) {
      if (mine !== sequence) return;
      state.voicesError = error.message;
    }
    state.loadingVoices = false;
    if (nodes) paintVoices();
  }

  /** Load the account's models and first voices once, when the tab is first shown with a saved key. */
  function start() {
    if (state.started) return;
    state.started = true;
    loadModels();
    loadVoices();
  }

  async function togglePreview(voice) {
    if (state.playing === voice.voiceId) { stopAudio(); if (nodes) paintAll(); return; }
    stopAudio();
    audio = new Audio();
    audio.preload = "none";
    audio.src = voice.previewUrl;
    state.playing = voice.voiceId;
    audio.addEventListener("ended", () => { state.playing = null; if (nodes) paintAll(); }, { once: true });
    if (nodes) paintAll();
    try { await audio.play(); }
    catch {
      stopAudio();
      if (nodes) {
        paintAll();
        nodes.status.textContent = "Không phát được bản nghe thử (cần kết nối mạng tới ElevenLabs).";
        nodes.status.className = "form-message is-error";
      }
    }
  }

  function showError(error) {
    nodes.flash.textContent = error.message;
    nodes.flash.className = "form-message voice-flash is-error";
  }

  async function chooseVoice(voice, button) {
    button.disabled = true;
    try { await save({ elevenLabs: { voiceId: voice.voiceId, voiceName: voice.name } }, `Đã chọn giọng ${voice.name} làm mặc định.`); }
    catch (error) { showError(error); button.disabled = false; }
  }

  async function chooseModel() {
    const value = nodes.model.value;
    try { await save({ elevenLabs: { modelId: value || null } }, value ? "Đã lưu model mặc định." : "Đã bỏ model mặc định."); }
    catch (error) { showError(error); }
  }

  async function lookupVoice(id) {
    state.lookup = null; state.lookupError = null; state.lookingUp = true; paintLookup();
    try { state.lookup = (await post("/api/settings/elevenlabs/voice", { voiceId: id })).voice; }
    catch (error) { state.lookupError = error.message; }
    state.lookingUp = false;
    paintLookup();
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Structure                                                                                         */
  /* ------------------------------------------------------------------------------------------------ */

  function step(number, title, hint) {
    const section = node("section", undefined, "step");
    const heading = node("div", undefined, "step-heading");
    heading.append(node("span", String(number), "step-number"), node("h3", title));
    if (hint) heading.append(node("span", hint, "step-hint"));
    section.append(heading);
    return section;
  }

  /**
   * The parts of the picker for a saved key: the card showing what is in use, the model step and the voice step.
   * `chip` is the tool's status chip, shown on the card. The caller places the parts and calls `start()` when they are seen.
   */
  function build(nextSettings, { chip = null } = {}) {
    settings = nextSettings;

    const summary = node("div", undefined, "voice-summary");
    summary.dataset.tool = "elevenlabs";
    const summaryText = node("div", undefined, "voice-summary-text");
    const voiceName = node("strong", undefined, "voice-summary-name");
    const voiceMeta = node("span", undefined, "voice-summary-meta");
    summaryText.append(node("span", "Đang dùng cho lời đọc", "kicker"), voiceName, voiceMeta);
    summary.append(summaryText, ...(chip ? [chip] : []));
    const flash = node("p", undefined, "form-message voice-flash"); flash.setAttribute("role", "status");

    const modelStep = step(2, "Model");
    const model = node("select", undefined, "select"); model.id = "elevenlabs-model"; model.dataset.control = "model";
    model.setAttribute("aria-label", "Model ElevenLabs");
    const modelNote = node("p", undefined, "form-note");
    modelStep.append(model, modelNote);

    const voiceStep = step(3, "Giọng", "trong tài khoản ElevenLabs của bạn");
    const searchBox = node("label", undefined, "search voice-search");
    searchBox.append(svgIcon(ICONS.search, { size: 16 }));
    const search = node("input"); Object.assign(search, { id: "voice-search", type: "search", autocomplete: "off", spellcheck: false, maxLength: 100, placeholder: "Tìm giọng theo tên…" });
    search.setAttribute("aria-label", "Tìm giọng theo tên");
    search.value = state.search; search.dataset.control = "voice-search";
    searchBox.append(search);
    const status = node("p", undefined, "form-note voice-status"); status.setAttribute("role", "status");
    const list = node("ul", undefined, "voice-list"); list.setAttribute("aria-label", "Danh sách giọng");
    const more = node("button", "Tải thêm giọng", "button button-quiet voice-more"); more.type = "button"; more.dataset.control = "voice-more";

    const lookup = node("details", undefined, "voice-lookup-details");
    lookup.open = state.lookupOpen;
    lookup.addEventListener("toggle", () => { state.lookupOpen = lookup.open; });
    lookup.append(node("summary", "Đã dùng một giọng trước đó? Dán mã giọng (voice ID)"));
    const lookupForm = node("form", undefined, "voice-lookup");
    lookupForm.noValidate = true;
    const lookupRow = node("div", undefined, "inline-form");
    const lookupInput = node("input", undefined, "field"); Object.assign(lookupInput, { id: "voice-id", type: "text", autocomplete: "off", spellcheck: false, maxLength: 100, placeholder: "Ví dụ: 21m00Tcm4TlvDq8ikWAM" });
    lookupInput.setAttribute("aria-label", "Mã giọng (voice ID)");
    lookupInput.dataset.control = "voice-id";
    const lookupButton = node("button", "Tìm theo mã", "button button-quiet"); lookupButton.type = "submit";
    lookupRow.append(lookupInput, lookupButton);
    const lookupMessage = node("p", undefined, "form-message"); lookupMessage.setAttribute("role", "status");
    const lookupResult = node("ul", undefined, "voice-list voice-found");
    lookupForm.append(lookupRow, lookupMessage, lookupResult,
      node("p", "Giọng phải nằm trong My Voices của tài khoản. Giọng ở Voice Library cần được thêm vào My Voices trước.", "form-note"));
    lookup.append(lookupForm);

    voiceStep.append(searchBox, status, list, more, lookup);
    nodes = { voiceName, voiceMeta, model, modelNote, search, status, list, more, lookupResult, lookupMessage, flash };

    model.addEventListener("change", chooseModel);
    search.addEventListener("input", () => {
      state.search = search.value.trim();
      clearTimeout(timer);
      timer = setTimeout(() => loadVoices(), SEARCH_DELAY_MS);
    });
    more.addEventListener("click", () => loadVoices({ append: true }));
    lookupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = lookupInput.value.trim();
      if (!id) { state.lookupError = "Dán mã giọng vào ô trước khi tìm."; paintLookup(); return; }
      lookupVoice(id);
    });

    paintAll();
    return { summary, flash, modelStep, voiceStep };
  }

  // A different key can mean a different account: forget its voices and models.
  function reset() {
    stopAudio();
    Object.assign(state, { started: false, search: "", voices: [], next: null, total: null, voicesError: null, models: null,
      modelsError: null, lookup: null, lookupError: null, lookupOpen: false });
  }

  return { build, start, stop: stopAudio, reset };
}
