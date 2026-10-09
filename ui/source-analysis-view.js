const workspaceStates = new WeakMap();

const VIEW_LABELS = Object.freeze({
  overview: "Tổng quan",
  transcript: "Transcript",
  scenes: "Cảnh",
  frames: "Khung hình",
  audio: "Âm thanh",
  assessment: "Nhận xét"
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatAnalysisTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const remaining = (tenths % 600) / 10;
  const tail = remaining.toFixed(1).padStart(4, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export function coverageIntervals(coverage) {
  if (!coverage || coverage.startSeconds === undefined || coverage.endSeconds === undefined) return [];
  if (Array.isArray(coverage.intervals) && coverage.intervals.length) return coverage.intervals;
  return [{ startSeconds: coverage.startSeconds, endSeconds: coverage.endSeconds }];
}

export function analysisQueryUrl(projectId, query) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "range") {
      parameters.set("startSeconds", String(value.startSeconds));
      parameters.set("endSeconds", String(value.endSeconds));
    } else {
      parameters.set(key, String(value));
    }
  }
  return `/api/projects/${encodeURIComponent(projectId)}/analysis/query?${parameters}`;
}

export function analysisResultSets(source, view) {
  return (source?.resultSets ?? [])
    .filter((result) => result.operation === view)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function contextSignature(context) {
  return JSON.stringify({
    project: context.project.id,
    resources: context.resources.map((resource) => [
      resource.id, resource.available, resource.items.map((item) => [item.path, item.available, item.modifiedAt])
    ]),
    sources: (context.analysis?.sources ?? []).map((source) => [
      source.sourceKey, source.freshness, source.verifiedAt,
      source.resultSets.map((result) => [result.id, result.freshness, result.verifiedAt])
    ]),
    artifacts: (context.intelligence?.activeArtifacts ?? [])
      .filter((artifact) => artifact.type.startsWith("source."))
      .map((artifact) => [artifact.id, artifact.revision, artifact.status])
  });
}

function resultById(context, resultId) {
  return context.results.find((result) => result.id === resultId) ?? null;
}

function resourceFor(context, sourceReference) {
  if (sourceReference?.kind !== "resource") return null;
  return context.resources.find((resource) => resource.id === sourceReference.id) ?? null;
}

function itemFor(resource, sourceReference) {
  if (!resource) return null;
  if (sourceReference.itemPath) {
    return resource.items.find((item) =>
      item.relativePath === sourceReference.itemPath || item.path.endsWith("/" + sourceReference.itemPath)
    ) ?? null;
  }
  return resource.items.length === 1 ? resource.items[0] : null;
}

function sourceProfile(context, sourceKey) {
  return (context.intelligence?.activeArtifacts ?? []).find((artifact) =>
    artifact.type === "source.profile" && artifact.data?.sourceKey === sourceKey
  ) ?? null;
}

function sourceName(context, source) {
  const resource = resourceFor(context, source.source);
  const item = itemFor(resource, source.source);
  if (item) return item.name;
  if (resource) return source.source.itemPath || resource.name;
  const result = source.source?.kind === "result" ? resultById(context, source.source.id) : null;
  return result?.name ?? source.sourceKey.slice(0, 12);
}

function sourceKind(context, source) {
  const resource = resourceFor(context, source.source);
  const item = itemFor(resource, source.source);
  if (item) return item.mediaType;
  const result = source.source?.kind === "result" ? resultById(context, source.source.id) : null;
  const primary = result?.files?.find((file) => file.id === "primary");
  return primary?.mediaType?.split("/")[0] ?? "unknown";
}

function freshnessLabel(status) {
  return {
    verified_current: "Đã xác minh",
    stale: "Nguồn đã thay đổi",
    missing: "Thiếu nguồn",
    unchecked: "Chưa xác minh"
  }[status] ?? status;
}

function resultFileUrl(projectId, resultId, fileId) {
  return ["/project-results", encodeURIComponent(projectId), encodeURIComponent(resultId), encodeURIComponent(fileId)].join("/");
}

function inputUrl(projectId, item) {
  const path = item.path.startsWith("inputs/") ? item.path.slice(7) : item.path;
  return `/project-inputs/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function sourceMediaDescriptor(context, source) {
  const preview = resultById(context, source.operations?.preview?.id);
  const primary = preview?.files?.find((file) => file.id === "primary" && file.available)
    ?? preview?.files?.find((file) => file.available);
  if (preview && primary) {
    const kind = primary.mediaType?.split("/")[0];
    if (["video", "audio", "image"].includes(kind)) {
      return {
        kind,
        url: resultFileUrl(context.project.id, preview.id, primary.id),
        key: preview.id + ":" + primary.id,
        sourceStart: preview.data?.details?.sourceStartSeconds ?? 0,
        sourceEnd: preview.data?.details?.sourceEndSeconds ?? null,
        derivative: true
      };
    }
  }
  const resource = resourceFor(context, source.source);
  const item = itemFor(resource, source.source);
  if (item?.available && ["video", "audio", "image"].includes(item.mediaType)) {
    return {
      kind: item.mediaType,
      url: inputUrl(context.project.id, item),
      key: item.path + ":" + item.modifiedAt,
      sourceStart: 0,
      sourceEnd: null,
      derivative: false
    };
  }
  if (source.source?.kind === "result") {
    const result = resultById(context, source.source.id);
    const file = result?.files?.find((file) => file.id === "primary" && file.available);
    const kind = file?.mediaType?.split("/")[0];
    if (["video", "audio", "image"].includes(kind)) return {
      kind, url: resultFileUrl(context.project.id, result.id, file.id),
      key: result.id + ":" + file.id, sourceStart: 0, sourceEnd: null, derivative: false
    };
  }
  return null;
}

function sourceDuration(context, source) {
  const probe = resultById(context, source.operations?.probe?.id);
  const duration = probe?.data?.details?.format?.durationSeconds;
  if (Number.isFinite(duration)) return duration;
  return Math.max(0, ...Object.values(source.operations ?? {})
    .map((result) => result.coverage?.endSeconds)
    .filter(Number.isFinite));
}

function makeState(container, context) {
  const previous = workspaceStates.get(container);
  const sources = context.analysis?.sources ?? [];
  const selectedSourceKey = sources.some((source) => source.sourceKey === previous?.selectedSourceKey)
    ? previous.selectedSourceKey : sources[0]?.sourceKey ?? null;
  previous?.viewController?.abort();
  previous?.searchController?.abort();
  return {
    container,
    context,
    signature: contextSignature(context),
    selectedSourceKey,
    selectedView: previous?.selectedView ?? "overview",
    selectedResults: previous?.selectedResults ?? new Map(),
    transcriptMode: previous?.transcriptMode ?? "both",
    viewController: null,
    searchController: null,
    viewVersion: 0,
    searchVersion: 0,
    rows: [],
    nextCursor: null,
    player: null,
    playerDescriptor: null,
    pendingSourceTime: previous?.player ? previous.player.currentTime + (previous.playerDescriptor?.sourceStart ?? 0) : 0,
    evidenceRows: [],
    searchRows: [],
    scrollTop: previous?.body?.scrollTop ?? 0
  };
}

function currentSource(state) {
  return state.context.analysis.sources.find((source) => source.sourceKey === state.selectedSourceKey) ?? null;
}

function pill(text, modifier = "") {
  return element("span", "source-pill" + (modifier ? " " + modifier : ""), text);
}

function renderSourceList(state) {
  const browser = element("aside", "source-browser");
  const list = element("nav", "source-browser-list");
  list.setAttribute("aria-label", "Nguồn đã phân tích");
  for (const source of state.context.analysis.sources) {
    const button = element("button", source.sourceKey === state.selectedSourceKey
      ? "source-browser-button is-active" : "source-browser-button");
    button.type = "button";
    button.append(
      element("strong", "", sourceName(state.context, source)),
      element("span", "input-meta", { video: "Video", audio: "Âm thanh", image: "Hình ảnh", unknown: "Tư liệu" }[sourceKind(state.context, source)] ?? "Tư liệu")
    );
    if (source.freshness === "stale") button.append(pill(freshnessLabel(source.freshness), "freshness-stale"));
    button.addEventListener("click", () => {
      if (source.sourceKey === state.selectedSourceKey) return;
      state.viewController?.abort();
      state.searchController?.abort();
      state.selectedSourceKey = source.sourceKey;
      state.selectedView = "overview";
      state.rows = [];
      state.nextCursor = null;
      state.pendingSourceTime = 0;
      renderWorkspace(state);
    });
    list.append(button);
  }
  if (state.context.analysis.sources.length > 5) {
    const filter = element("input", "source-filter");
    filter.type = "search";
    filter.placeholder = "Tìm tư liệu…";
    filter.setAttribute("aria-label", "Tìm theo tên tư liệu");
    filter.value = state.sourceQuery ?? "";
    const empty = element("p", "source-filter-empty", "Không tìm thấy tư liệu.");
    const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
    const applyFilter = () => {
      state.sourceQuery = filter.value;
      const query = normalize(filter.value);
      for (const button of list.querySelectorAll("button")) button.hidden = !normalize(button.querySelector("strong").textContent).includes(query);
      empty.hidden = !!list.querySelector("button:not([hidden])");
    };
    filter.addEventListener("input", applyFilter);
    applyFilter();
    browser.append(filter, empty);
  }
  browser.append(list);
  return browser;
}

function seekSourceTime(state, sourceTime) {
  if (!state.player || !Number.isFinite(sourceTime)) return;
  const start = state.playerDescriptor?.sourceStart ?? 0;
  const end = state.playerDescriptor?.sourceEnd;
  if (Number.isFinite(end) && (sourceTime < start || sourceTime > end)) {
    state.mediaNote.textContent = "Thời điểm này nằm ngoài vùng proxy hiện có. Hãy yêu cầu Agent tạo preview cho vùng đó.";
    return;
  }
  state.player.currentTime = Math.max(0, sourceTime - start);
  state.player.focus();
  state.player.play().catch(() => {});
  updatePlayback(state);
}

function updatePlayback(state) {
  if (!state.player) return;
  const sourceTime = state.player.currentTime + (state.playerDescriptor?.sourceStart ?? 0);
  if (state.timeLabel) state.timeLabel.textContent = formatAnalysisTime(sourceTime);
  if (state.timeline) state.timeline.value = String(Math.min(Number(state.timeline.max), sourceTime));
  for (const row of state.evidenceRows) {
    const start = Number(row.dataset.start);
    const end = Number(row.dataset.end);
    row.classList.toggle("is-playing", Number.isFinite(start) && Number.isFinite(end) && sourceTime >= start && sourceTime < end);
  }
}

function renderMedia(state, source, host) {
  const descriptor = sourceMediaDescriptor(state.context, source);
  state.playerDescriptor = descriptor;
  const mediaBox = element("div", "source-media");
  state.mediaNote = element("p", "source-media-note");
  if (!descriptor) {
    mediaBox.append(element("div", "source-empty", "Chưa có bản xem trước."));
    state.mediaNote.textContent = "Yêu cầu bản xem trước trong cuộc trò chuyện của bạn.";
    host.append(mediaBox, state.mediaNote);
    return;
  }
  if (descriptor.kind === "image") {
    const image = element("img", "source-image");
    image.src = descriptor.url;
    image.alt = sourceName(state.context, source);
    mediaBox.append(image);
  } else {
    const media = document.createElement(descriptor.kind);
    media.className = "source-player";
    media.src = descriptor.url;
    media.controls = true;
    media.preload = "metadata";
    if (descriptor.kind === "video") media.playsInline = true;
    media.addEventListener("loadedmetadata", () => {
      if (state.pendingSourceTime) {
        const target = state.pendingSourceTime - descriptor.sourceStart;
        if (target >= 0 && target <= media.duration) media.currentTime = target;
        state.pendingSourceTime = 0;
      }
      updatePlayback(state);
    });
    media.addEventListener("timeupdate", () => updatePlayback(state));
    media.addEventListener("error", () => {
      state.mediaNote.textContent = descriptor.derivative
        ? "Proxy không phát được trong trình duyệt hoặc file đang thiếu."
        : "Nguồn gốc không phát được; hãy yêu cầu Agent chuẩn bị proxy browser-safe.";
    });
    state.player = media;
    mediaBox.append(media);
  }
  state.mediaNote.textContent = descriptor.derivative ? "Bản xem trước · mốc thời gian theo tư liệu gốc" : "";
  host.append(mediaBox, state.mediaNote);
}

function renderTimeline(state, source, host) {
  const duration = sourceDuration(state.context, source);
  if (!duration || sourceKind(state.context, source) === "image") return;
  const block = element("div", "source-timeline");
  const head = element("div", "source-timeline-head");
  state.timeLabel = element("strong", "", formatAnalysisTime(state.pendingSourceTime || 0));
  head.append(element("span", "", "Thời gian nguồn"), state.timeLabel, element("span", "", formatAnalysisTime(duration)));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(duration);
  slider.step = "0.01";
  slider.value = String(Math.min(duration, state.pendingSourceTime || 0));
  slider.setAttribute("aria-label", "Đi đến thời điểm trong nguồn");
  slider.addEventListener("input", () => seekSourceTime(state, Number(slider.value)));
  state.timeline = slider;
  block.append(head, slider);

  const lanes = element("div", "coverage-lanes");
  for (const view of ["preview", "transcript", "scenes", "frames", "audio"]) {
    const result = source.operations?.[view];
    if (!result) continue;
    const lane = element("div", "coverage-lane");
    lane.append(element("span", "coverage-label", { preview: "Xem thử", transcript: "Lời thoại", scenes: "Cảnh", frames: "Khung hình", audio: "Âm thanh" }[view]));
    const track = element("div", "coverage-track");
    for (const interval of coverageIntervals(result.coverage)) {
      const bar = element("span", "coverage-bar coverage-" + result.coverage.mode);
      bar.style.left = `${Math.max(0, interval.startSeconds / duration * 100)}%`;
      bar.style.width = `${Math.max(0.4, (interval.endSeconds - interval.startSeconds) / duration * 100)}%`;
      bar.title = `${formatAnalysisTime(interval.startSeconds)}–${formatAnalysisTime(interval.endSeconds)}`;
      track.append(bar);
    }
    lane.append(track);
    lanes.append(lane);
  }
  block.append(lanes);
  host.append(block);
}

function selectedResult(state, source, view) {
  const sets = analysisResultSets(source, view);
  const key = source.sourceKey + ":" + view;
  const remembered = state.selectedResults.get(key);
  const selected = sets.find((result) => result.id === remembered)
    ?? sets.find((result) => result.id === source.operations?.[view]?.id)
    ?? sets[0] ?? null;
  if (selected) state.selectedResults.set(key, selected.id);
  return { selected, sets, key };
}

function resultSelector(state, source, view) {
  const { selected, sets, key } = selectedResult(state, source, view);
  if (sets.length <= 1) return null;
  const label = element("label", "source-result-select");
  label.append(element("span", "", "Tập dữ liệu"));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Chọn tập dữ liệu phân tích");
  for (const result of sets) {
    const option = document.createElement("option");
    option.value = result.id;
    option.selected = result.id === selected?.id;
    option.textContent = [
      result.method.profileId,
      result.coverage.startSeconds === undefined ? result.coverage.mode
        : `${formatAnalysisTime(result.coverage.startSeconds)}–${formatAnalysisTime(result.coverage.endSeconds)}`,
      result.freshness === "verified_current" ? "đã xác minh" : result.freshness
    ].join(" · ");
    select.append(option);
  }
  select.addEventListener("change", () => {
    state.selectedResults.set(key, select.value);
    loadView(state, true).catch((error) => showQueryError(state, error));
  });
  label.append(select);
  return label;
}

async function fetchAnalysis(state, query, channel = "view") {
  const controllerKey = channel + "Controller";
  const versionKey = channel + "Version";
  state[controllerKey]?.abort();
  state[controllerKey] = new AbortController();
  const version = ++state[versionKey];
  const response = await fetch(analysisQueryUrl(state.context.project.id, query), {
    signal: state[controllerKey].signal
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || "Không thể đọc dữ liệu phân tích.");
    error.code = body.code;
    throw error;
  }
  if (version !== state[versionKey]) {
    const error = new Error("Response cũ đã bị bỏ qua.");
    error.name = "AbortError";
    throw error;
  }
  return body;
}

function showQueryError(state, error) {
  if (error.name === "AbortError") return;
  state.evidenceHost.replaceChildren();
  const box = element("div", "source-state source-state-error");
  box.append(element("strong", "", "Không đọc được dữ liệu"), element("p", "", error.message));
  if (error.code === "index_not_ready") {
    box.append(element("p", "input-meta", "Hãy yêu cầu Agent chạy analysis:verify; web không tự tạo index."));
  }
  state.evidenceHost.append(box);
}

function registerEvidenceRow(state, node, row) {
  const start = Number(row.startSeconds ?? row.actualTime);
  const end = Number(row.endSeconds ?? (Number.isFinite(start) ? start + 0.05 : NaN));
  if (Number.isFinite(start)) node.dataset.start = String(start);
  if (Number.isFinite(end)) node.dataset.end = String(end);
  state.evidenceRows.push(node);
}

function seekButton(state, row, label) {
  const start = Number(row.startSeconds ?? row.actualTime);
  const button = element("button", "evidence-time", Number.isFinite(start) ? formatAnalysisTime(start) : "—");
  button.type = "button";
  button.disabled = !Number.isFinite(start) || !state.player;
  button.setAttribute("aria-label", label + (Number.isFinite(start) ? " tại " + formatAnalysisTime(start) : ""));
  button.addEventListener("click", () => seekSourceTime(state, start));
  return button;
}

function renderTranscript(state, rows) {
  const list = element("div", "transcript-list");
  for (const row of rows) {
    const card = element("article", "evidence-row transcript-row");
    card.append(seekButton(state, row, "Phát câu"));
    const text = element("div", "transcript-text");
    text.append(element("p", "", row.text || row.correctedText || "Đoạn không có chữ."));
    const meta = [formatAnalysisTime(row.endSeconds), row.language, row.correction ? "đã hiệu chỉnh" : "raw"]
      .filter(Boolean).join(" · ");
    text.append(element("span", "input-meta", meta));
    if (row.rawText && row.rawText !== row.text) {
      const raw = element("details", "transcript-raw");
      raw.append(element("summary", "", "Xem ASR gốc"), element("p", "", row.rawText));
      text.append(raw);
    }
    card.append(text);
    registerEvidenceRow(state, card, row);
    list.append(card);
  }
  return list;
}

function renderScenes(state, rows) {
  const list = element("div", "scene-list");
  for (const row of rows) {
    const card = element("article", "evidence-row scene-row");
    card.append(
      seekButton(state, row, "Phát cảnh"),
      element("strong", "", row.id),
      element("span", "input-meta", `${formatAnalysisTime(row.startSeconds)}–${formatAnalysisTime(row.endSeconds)} · ${row.boundaryKind}`)
    );
    registerEvidenceRow(state, card, row);
    list.append(card);
  }
  return list;
}

function renderFrames(state, rows, resultId) {
  const grid = element("div", "frame-grid");
  for (const row of rows) {
    const card = element("article", "evidence-row frame-card");
    const image = element("img", "");
    image.src = resultFileUrl(state.context.project.id, resultId, row.fileId);
    image.alt = `${row.id} tại ${formatAnalysisTime(row.actualTime)}`;
    image.loading = "lazy";
    const controls = element("div", "frame-meta");
    controls.append(seekButton(state, row, "Phát từ khung hình"), element("span", "", row.reason ?? row.shotId ?? ""));
    card.append(image, controls);
    registerEvidenceRow(state, card, row);
    grid.append(card);
  }
  return grid;
}

function renderAudio(state, rows) {
  const windows = rows.filter((row) => row.kind === "level_window");
  const wrap = element("div", "audio-analysis");
  if (windows.length) {
    const bars = element("div", "waveform-bars");
    bars.setAttribute("role", "img");
    bars.setAttribute("aria-label", "Waveform của trang dữ liệu hiện tại");
    for (const row of windows) {
      const bar = element("button", "waveform-bar");
      bar.type = "button";
      bar.style.height = `${Math.max(2, Math.min(100, (row.peak ?? row.rms ?? 0) * 100))}%`;
      bar.title = `${formatAnalysisTime(row.startSeconds)} · ${row.dbfs === null ? "im lặng" : row.dbfs.toFixed(1) + " dBFS"}`;
      bar.addEventListener("click", () => seekSourceTime(state, row.startSeconds));
      bars.append(bar);
    }
    wrap.append(bars);
  }
  const events = rows.filter((row) => row.kind !== "level_window");
  for (const row of events) {
    const line = element("article", "evidence-row audio-event");
    line.append(
      seekButton(state, row, "Phát sự kiện âm thanh"),
      element("strong", "", row.kind.replaceAll("_", " ")),
      element("span", "input-meta", `${formatAnalysisTime(row.startSeconds)}–${formatAnalysisTime(row.endSeconds)}`)
    );
    registerEvidenceRow(state, line, row);
    wrap.append(line);
  }
  return wrap;
}

function assessmentTime(artifact) {
  const pointers = [
    ...(artifact.data?.findings ?? []).flatMap((finding) => finding.evidence ?? []),
    ...(artifact.data?.usableRanges ?? []).flatMap((range) => range.evidence ?? [])
  ];
  return pointers.find((pointer) => pointer.range)?.range?.startSeconds ?? null;
}

function renderAssessments(state, rows) {
  const list = element("div", "assessment-list");
  for (const artifact of rows) {
    const card = element("article", "assessment-card");
    const heading = element("div", "assessment-head");
    heading.append(element("strong", "", artifact.data.purpose), pill("revision " + artifact.revision));
    card.append(heading, element("p", "", artifact.data.summary));
    for (const finding of artifact.data.findings) {
      const line = element("div", "assessment-finding");
      const pointer = finding.evidence.find((evidence) => evidence.range);
      if (pointer) line.append(seekButton(state, pointer.range, "Phát bằng chứng nhận xét"));
      line.append(
        pill(finding.basis === "observation" ? "Quan sát" : "Suy luận", "basis-" + finding.basis),
        element("span", "", finding.statement),
        element("small", "input-meta", "Độ chắc chắn: " + finding.certainty)
      );
      card.append(line);
    }
    if (artifact.data.limitations.length || artifact.data.openQuestions.length) {
      const details = element("details", "assessment-limits");
      details.append(element("summary", "", "Giới hạn và câu hỏi mở"));
      const listNode = element("ul", "");
      for (const text of [...artifact.data.limitations, ...artifact.data.openQuestions]) {
        listNode.append(element("li", "", text));
      }
      details.append(listNode);
      card.append(details);
    }
    const start = assessmentTime(artifact);
    if (Number.isFinite(start)) {
      card.dataset.start = String(start);
      card.dataset.end = String(start + 0.05);
      state.evidenceRows.push(card);
    }
    list.append(card);
  }
  return list;
}

function renderOverview(state, source) {
  const context = state.context;
  const probe = resultById(context, source.operations?.probe?.id);
  const profile = sourceProfile(context, source.sourceKey);
  const grid = element("div", "source-overview-grid");
  const facts = [
    ["Loại", probe?.data?.details?.format?.longName ?? sourceKind(context, source)],
    ["Thời lượng", formatAnalysisTime(sourceDuration(context, source))],
    ["Vai trò", profile?.data?.usage ?? "chưa phân loại"],
    ["Result sets", String(source.resultSets.length)],
    ["Phiên bản nguồn", source.versions.map((version) => version.slice(0, 12)).join(", ")]
  ];
  for (const [label, value] of facts) {
    const fact = element("div", "source-fact");
    fact.append(element("span", "", label), element("strong", "", value));
    grid.append(fact);
  }
  state.evidenceHost.append(grid);
  if (profile) state.evidenceHost.append(element("p", "source-profile-note", profile.data.purpose));

  const operations = element("div", "operation-grid");
  for (const [view, result] of Object.entries(source.operations)) {
    const card = element("article", "operation-card");
    card.append(
      element("strong", "", VIEW_LABELS[view] ?? view),
      pill(result.outcome),
      element("span", "input-meta", `${result.method.profileId} · ${result.coverage.mode}`)
    );
    operations.append(card);
  }
  state.evidenceHost.append(operations);

  const warnings = [...new Map((source.warnings ?? []).map((warning) => [warning.code + warning.message, warning])).values()];
  if (warnings.length) {
    const box = element("div", "source-warnings");
    box.append(element("strong", "", "Cảnh báo cần đọc đúng"));
    const list = element("ul", "");
    for (const warning of warnings) list.append(element("li", "", warning.message));
    box.append(list);
    state.evidenceHost.append(box);
  }
}

function renderLoadedRows(state, source, view, response, append) {
  if (!append) {
    state.rows = [];
    state.evidenceRows = [];
    state.evidenceHost.replaceChildren();
  }
  state.rows.push(...response.rows);
  state.nextCursor = response.nextCursor;
  const selected = selectedResult(state, source, view).selected;
  const content = view === "transcript" ? renderTranscript(state, response.rows)
    : view === "scenes" ? renderScenes(state, response.rows)
      : view === "frames" ? renderFrames(state, response.rows, response.result.id)
        : view === "audio" ? renderAudio(state, response.rows)
          : renderAssessments(state, response.rows);
  if (!response.rows.length && !append) {
    state.evidenceHost.append(element("div", "source-state", "Không có dữ liệu trong tập đã chọn."));
  } else {
    state.evidenceHost.append(content);
  }
  state.loadMore.replaceChildren();
  if (state.nextCursor) {
    const button = element("button", "source-load-more", "Tải thêm");
    button.type = "button";
    button.addEventListener("click", () => loadView(state, false).catch((error) => showQueryError(state, error)));
    state.loadMore.append(button);
  }
  if (selected) {
    state.datasetMeta.textContent = [
      selected.method.profileId,
      selected.coverage.mode,
      freshnessLabel(selected.freshness),
      selected.verifiedAt ? "xác minh " + new Date(selected.verifiedAt).toLocaleString("vi") : null
    ].filter(Boolean).join(" · ");
  }
  updatePlayback(state);
}

async function loadView(state, reset) {
  const source = currentSource(state);
  const view = state.selectedView;
  if (!source || view === "overview") {
    state.datasetMeta.textContent = "";
    state.evidenceHost.replaceChildren();
    renderOverview(state, source);
    return;
  }
  const { selected } = selectedResult(state, source, view);
  if (view !== "assessment" && !selected) {
    state.evidenceHost.replaceChildren(element("div", "source-state", "Nguồn này chưa có dữ liệu " + VIEW_LABELS[view].toLowerCase() + "."));
    return;
  }
  if (reset) {
    state.rows = [];
    state.nextCursor = null;
    state.evidenceRows = [];
    state.datasetMeta.textContent = "";
    state.evidenceHost.replaceChildren(element("div", "source-state", "Đang tải dữ liệu…"));
  }
  const query = {
    view,
    sourceKey: view === "assessment" ? source.sourceKey : undefined,
    resultId: view === "assessment" ? undefined : selected.id,
    transcriptMode: view === "transcript" ? state.transcriptMode : undefined,
    limit: view === "audio" ? 200 : 50,
    cursor: reset ? undefined : state.nextCursor
  };
  const response = await fetchAnalysis(state, query);
  renderLoadedRows(state, source, view, response, !reset);
}

async function runSearch(state, text) {
  const source = currentSource(state);
  state.searchStatus.textContent = "Đang tìm…";
  state.searchResults.replaceChildren();
  try {
    const response = await fetchAnalysis(state, {
      view: "search", sourceKey: source.sourceKey, text,
      transcriptMode: state.transcriptMode, diacriticInsensitive: true, limit: 50
    }, "search");
    state.searchStatus.textContent = response.rows.length ? `${response.rows.length} kết quả` : "Không tìm thấy.";
    for (const row of response.rows) {
      const card = element("button", "search-result");
      card.type = "button";
      card.append(
        element("span", "search-result-kind", row.kind),
        element("strong", "", row.snippet),
        element("span", "input-meta", [
          Number.isFinite(row.startSeconds) ? formatAnalysisTime(row.startSeconds) : null,
          freshnessLabel(row.freshness)
        ].filter(Boolean).join(" · "))
      );
      card.addEventListener("click", () => {
        if (Number.isFinite(row.startSeconds)) seekSourceTime(state, row.startSeconds);
      });
      state.searchResults.append(card);
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    state.searchStatus.textContent = error.code === "index_not_ready"
      ? "Index chưa sẵn sàng. Hãy yêu cầu Agent chạy analysis:verify."
      : error.message;
  }
}

function renderEvidenceControls(state, source) {
  state.viewControls.replaceChildren();
  const selector = resultSelector(state, source, state.selectedView);
  if (selector) state.viewControls.append(selector);
  if (state.selectedView === "transcript") {
    const label = element("label", "source-result-select");
    label.append(element("span", "", "Văn bản"));
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Chọn raw hoặc corrected transcript");
    for (const [value, text] of [["raw", "Raw ASR"], ["corrected", "Đã hiệu chỉnh"], ["both", "Cả hai"]]) {
      const option = element("option", "", text);
      option.value = value;
      option.selected = value === state.transcriptMode;
      select.append(option);
    }
    select.addEventListener("change", () => {
      state.transcriptMode = select.value;
      loadView(state, true).catch((error) => showQueryError(state, error));
    });
    label.append(select);
    state.viewControls.append(label);
  }
}

function renderEvidencePanel(state, source, host) {
  const panel = element("section", "source-evidence-panel");
  const controls = element("div", "source-evidence-controls");
  const tabs = element("div", "source-tabs");
  tabs.setAttribute("role", "tablist");
  for (const view of Object.keys(VIEW_LABELS)) {
    const button = element("button", state.selectedView === view ? "source-tab is-active" : "source-tab", VIEW_LABELS[view]);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(state.selectedView === view));
    const available = view === "overview" || view === "assessment" || Boolean(source.operations?.[view]);
    button.disabled = !available;
    button.addEventListener("click", () => {
      if (state.selectedView === view) return;
      state.selectedView = view;
      for (const tab of tabs.children) {
        tab.classList.toggle("is-active", tab === button);
        tab.setAttribute("aria-selected", String(tab === button));
      }
      renderEvidenceControls(state, source);
      loadView(state, true).catch((error) => showQueryError(state, error));
    });
    tabs.append(button);
  }
  controls.append(tabs);
  state.viewControls = element("div", "source-view-options");
  controls.append(state.viewControls);
  panel.append(controls);
  state.datasetMeta = element("p", "input-meta source-dataset-meta");
  const metadata = element("details", "source-dataset-details");
  metadata.append(element("summary", "", "Thông tin phân tích"), state.datasetMeta);
  panel.append(metadata);
  state.evidenceHost = element("div", "source-evidence-body");
  state.body = state.evidenceHost;
  panel.append(state.evidenceHost);
  state.loadMore = element("div", "source-pagination");
  panel.append(state.loadMore);
  host.append(panel);
  renderEvidenceControls(state, source);
  loadView(state, true).catch((error) => showQueryError(state, error));
}

function renderSearch(state, host) {
  const section = element("section", "source-search");
  const form = element("form", "source-search-form");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Tìm trong transcript và nhận xét…";
  input.setAttribute("aria-label", "Tìm trong nguồn đang chọn");
  const button = element("button", "", "Tìm");
  button.type = "submit";
  form.append(input, button);
  state.searchStatus = element("p", "input-meta source-search-status");
  state.searchResults = element("div", "source-search-results");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) runSearch(state, text);
  });
  section.append(form, state.searchStatus, state.searchResults);
  host.append(section);
}

function renderWorkspace(state) {
  const source = currentSource(state);
  state.container.replaceChildren();
  state.player = null;
  state.evidenceRows = [];
  if (!source) {
    state.container.append(element("div", "source-state", "Chưa có dữ liệu phân tích."));
    return;
  }
  const layout = element("div", "source-workspace");
  layout.append(renderSourceList(state));
  const main = element("div", "source-workspace-main");
  const heading = element("header", "source-current-head");
  const identity = element("div", "");
  identity.append(
    element("p", "eyebrow", { video: "VIDEO", audio: "ÂM THANH", image: "HÌNH ẢNH", unknown: "TƯ LIỆU" }[sourceKind(state.context, source)] ?? "TƯ LIỆU"),
    element("h4", "", sourceName(state.context, source))
  );
  const badges = element("div", "source-badges");
  const profile = sourceProfile(state.context, source.sourceKey);
    if (profile?.data?.usage) badges.append(pill(profile.data.usage));
    badges.append(pill(freshnessLabel(source.freshness), "freshness-" + source.freshness));
  heading.append(identity, badges);
  main.append(heading);
  renderMedia(state, source, main);
  renderTimeline(state, source, main);
  renderSearch(state, main);
  renderEvidencePanel(state, source, main);
  layout.append(main);
  state.container.append(layout);
  state.body.scrollTop = state.scrollTop;
}

export function renderSourceAnalysis(container, context) {
  const sources = context.analysis?.sources ?? [];
  if (!sources.length) {
    clearSourceAnalysis(container);
    container.append(element("div", "source-state", "Chưa có dữ liệu phân tích. Bạn vẫn có thể xem các file tư liệu bên dưới."));
    return;
  }
  const signature = contextSignature(context);
  const current = workspaceStates.get(container);
  if (current?.signature === signature && current.context.project.id === context.project.id) return;
  const state = makeState(container, context);
  workspaceStates.set(container, state);
  renderWorkspace(state);
}

export function clearSourceAnalysis(container) {
  workspaceStates.get(container)?.viewController?.abort();
  workspaceStates.get(container)?.searchController?.abort();
  workspaceStates.delete(container);
  container.replaceChildren();
}
