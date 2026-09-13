let lastSignature = null;
const choices = new Map();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function fileUrl(projectId, resultId, fileId) {
  return "/project-results/" + [projectId, resultId, fileId].map(encodeURIComponent).join("/");
}
function feedbackAnchor(context, sequence, render, segment = null) {
  if (!render) return null;
  const range = segment ? sequence.timeline?.find((item) => item.track === "Hình" && item.segmentId === segment.id) : null;
  const value = [
    `project=${context.project.id}`, `result=${render.resultId}`,
    `artifact=${sequence.artifactId}`, `revision=${sequence.revision}`,
    ...(segment ? [`segment=${segment.id}`] : []),
    ...(range ? [`time=${range.startSeconds.toFixed(3)}-${range.endSeconds.toFixed(3)}`] : []),
  ].join(" · ");
  const box = node("div", undefined, "feedback-anchor");
  box.dataset.feedbackAnchor = value;
  box.append(node("code", value));
  const button = node("button", "Sao chép mốc phản hồi");
  button.type = "button";
  button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(value); button.textContent = "Đã sao chép"; }
    catch { button.textContent = "Hãy sao chép mã bên cạnh"; }
  });
  box.append(button);
  return box;
}

export function productionRenderOptions(revisions) {
  return revisions.flatMap((sequence) => sequence.renders.map((render) => ({
    artifactId: sequence.artifactId,
    revision: sequence.revision,
    resultId: render.resultId,
    createdAt: render.createdAt
  })));
}

export function feedbackForSegment(render, segmentId = null) {
  return (render?.decisions ?? []).filter((decision) =>
    segmentId === null
      ? !decision.feedbackTarget?.segmentId
      : decision.feedbackTarget?.segmentId === segmentId
  );
}

function feedbackPanel(render, segmentId = null) {
  const decisions = feedbackForSegment(render, segmentId);
  if (!decisions.length) return null;
  const box = node("div", undefined, "result-feedback");
  box.append(node("strong", segmentId ? "Phản hồi cho đoạn này" : "Phản hồi cho Result này"));
  const labels = { accepted: "Đã chấp nhận", changes_requested: "Cần sửa", rejected: "Đã loại" };
  for (const decision of decisions) {
    const range = decision.feedbackTarget?.timeRange;
    const suffix = range ? ` · ${range.startSeconds.toFixed(3)}–${range.endSeconds.toFixed(3)}s` : "";
    box.append(node("p", `${labels[decision.outcome]}${suffix}${decision.note ? " — " + decision.note : ""}`));
  }
  return box;
}

function outputQualityPanel(context, render) {
  const reports = render?.qualityReports ?? [];
  const quality = reports.at(-1);
  const box = node("section", undefined, "output-quality");
  box.append(node("h5", "Automated output QA"));
  if (!quality) {
    box.append(node("p", "Chưa có QA trên chính exact Result này; chưa đủ điều kiện xuất delivery.", "sequence-warning"));
    return box;
  }
  const eligible = quality.data?.gate?.deliveryEligible === true;
  box.dataset.deliveryEligible = String(eligible);
  box.dataset.qualityResultId = quality.resultId;
  box.classList.add(eligible ? "is-passed" : "is-failed");
  box.append(
    node("p", `${eligible ? "Đủ gate delivery" : "Không đạt gate delivery"} · ${quality.resultId}`, eligible ? "result-verification" : "sequence-warning"),
    node("p", `Profile ${quality.data?.profile?.id ?? "không rõ"} · ${new Date(quality.createdAt).toLocaleString("vi-VN")}`, "input-meta")
  );
  const checks = node("ul", undefined, "quality-checks");
  for (const item of quality.data?.checks ?? []) {
    checks.append(node("li", `${item.status === "passed" ? "Đạt" : "Lỗi"}: ${item.id} — ${item.evidence}`));
  }
  box.append(checks);
  const metrics = quality.data?.metrics;
  if (metrics) box.append(node("p", [
    `${metrics.durationSeconds}s`, `${metrics.frames} frame`, `${metrics.contactSheets} contact sheet`,
    `${metrics.clippingCandidates} clipping`,
    metrics.speechLeadSeconds === undefined ? null : `lead ${metrics.speechLeadSeconds}s`,
    metrics.speechTailSeconds === undefined ? null : `tail ${metrics.speechTailSeconds}s`
  ].filter(Boolean).join(" · "), "input-meta"));
  const reportFile = quality.files.find((file) => file.id === "report");
  if (reportFile?.available) {
    const link = node("a", "Mở quality report");
    link.href = fileUrl(context.project.id, quality.resultId, reportFile.id);
    link.target = "_blank";
    link.dataset.qualityReport = quality.resultId;
    box.append(link);
  }
  if (quality.contactSheets.length) {
    const strip = node("div", undefined, "quality-contact-sheets");
    for (const file of quality.contactSheets) {
      if (!file.available) continue;
      const image = node("img");
      image.loading = "lazy";
      image.alt = "Contact sheet QA của exact Result";
      image.src = fileUrl(context.project.id, file.resultId, file.id);
      strip.append(image);
    }
    box.append(strip);
  }
  box.append(node("p", quality.data?.humanReview?.note ?? "QA máy không thay thế review của con người.", "input-meta"));
  return box;
}

function compareRevisions(before, after) {
  const plain = ({ blockers, reasons, ...segment }) => segment;
  const formatChanged = JSON.stringify(before.format) !== JSON.stringify(after.format);
  return {
    globalReferencesChanged: JSON.stringify(before.references) !== JSON.stringify(after.references),
    mixChanged: JSON.stringify([before.music, before.audio]) !== JSON.stringify([after.music, after.audio]),
    segments: after.segments.map((segment, index) => {
      const oldIndex = before.segments.findIndex((candidate) => candidate.id === segment.id);
      const old = before.segments[oldIndex];
      return {
        id: segment.id,
        status: !old ? "added" : formatChanged || JSON.stringify(plain(old)) !== JSON.stringify(plain(segment)) ? "changed" : "unchanged",
        moved: oldIndex >= 0 && oldIndex !== index
      };
    }),
    removed: before.segments.filter((segment) => !after.segments.some((current) => current.id === segment.id)).map((segment) => segment.id),
  };
}

function timelinePanel(sequence, video) {
  const box = node("section", undefined, "composition-timeline");
  box.setAttribute("aria-label", "Timeline quan sát");
  box.append(node("h5", "Timeline · chỉ quan sát"));
  box.append(node("p", "Chọn một khoảng để xem. Yêu cầu chỉnh sửa trong chat.", "input-meta"));
  const duration = sequence.durationSeconds;
  const seek = node("input");
  seek.type = "range"; seek.min = "0"; seek.max = String(duration);
  seek.step = String(1 / sequence.format.fps); seek.value = "0";
  seek.setAttribute("aria-label", "Vị trí xem video"); seek.disabled = !video;
  const time = node("output", "0.00 / " + duration.toFixed(2) + " s");
  seek.addEventListener("input", () => {
    if (video) video.currentTime = Number(seek.value);
    time.textContent = Number(seek.value).toFixed(2) + " / " + duration.toFixed(2) + " s";
  });
  if (video) video.addEventListener("timeupdate", () => {
    seek.value = String(video.currentTime);
    time.textContent = video.currentTime.toFixed(2) + " / " + duration.toFixed(2) + " s";
  });
  box.append(seek, time);
  const rows = sequence.timeline ?? [];
  for (const track of [...new Set(rows.map((row) => row.track))]) {
    const row = node("div", undefined, "timeline-row"); row.append(node("span", track, "timeline-label"));
    const lane = node("div", undefined, "timeline-lane");
    for (const item of rows.filter((candidate) => candidate.track === track)) {
      const label = item.label + " · " + item.startSeconds.toFixed(2) + "–" + item.endSeconds.toFixed(2) + "s" + (item.estimatedEnd ? " (giới hạn dự kiến; chưa đo lời đọc)" : "");
      const bar = node("button", item.label, "timeline-bar");
      bar.type = "button"; bar.title = label; bar.setAttribute("aria-label", label); bar.disabled = !video;
      bar.dataset.startSeconds = String(item.startSeconds);
      bar.style.left = (100 * item.startSeconds / duration) + "%";
      bar.style.width = (100 * (item.endSeconds - item.startSeconds) / duration) + "%";
      bar.addEventListener("click", () => {
        if (video) { video.currentTime = item.startSeconds; seek.value = String(item.startSeconds); }
      });
      lane.append(bar);
    }
    row.append(lane); box.append(row);
  }
  return box;
}

function revisionPanel(context, sequence, baseline = null, render = null) {
  const changes = baseline ? compareRevisions(baseline, sequence) : sequence.changes;
  const panel = node("article", undefined, "sequence-panel");
  const stateLabel = sequence.role === "current" ? "hiện hành" : sequence.role === "candidate" ? "candidate" : "lịch sử";
  panel.append(node("h4", sequence.name + " · r" + sequence.revision + " · " + stateLabel));
  if (render) panel.append(node("p", "Exact Result: " + render.resultId + " · " + new Date(render.createdAt).toLocaleString("vi-VN"), "exact-result-id"));
  panel.append(node("p", sequence.changeReason));
  panel.append(node("p", baseline ? "Thay đổi so với r" + baseline.revision : "Thay đổi so với revision trước", "input-meta"));
  if (baseline?.artifactId === sequence.artifactId && render) {
    panel.append(node("p", "Cùng revision; đang đối chiếu hai lần render khác nhau.", "input-meta"));
  }
  if (changes.mixChanged) panel.append(node("p", "Nhạc hoặc cấu hình mix đã thay đổi; cần nghe lại bản dựng cuối.", "sequence-warning"));
  if (changes.globalReferencesChanged) panel.append(node("p", "Bối cảnh chung của video đã thay đổi; cần xem lại toàn bản dựng.", "sequence-warning"));
  panel.append(node("p", sequence.durationSeconds + " giây · " + sequence.format.width + "×" + sequence.format.height, "input-meta"));
  const dependencies = sequence.reasons.filter((reason) => !(reason.kind === "artifact" && reason.id === sequence.artifactId && reason.reason === "not_active_revision"));
  if (dependencies.length) panel.append(node("p", "Có " + dependencies.length + " phụ thuộc cần xem lại. Phiên bản cũ vẫn được giữ; trao đổi với Agent trước khi dùng tiếp.", "sequence-warning"));
  let previewVideo = null;
  if (render) {
    const primary = render.files.find((file) => file.id === "primary");
    if (primary?.available) {
      const video = node("video", undefined, "result-video");
      previewVideo = video; video.controls = true; video.preload = "metadata";
      video.src = fileUrl(context.project.id, render.resultId, primary.id);
      panel.append(video);
    } else panel.append(node("p", "File preview không còn khả dụng.", "sequence-warning"));
    const wholeFeedback = feedbackForSegment(render);
    const latest = wholeFeedback.at(-1);
    const label = { accepted: "Đã chấp nhận", changes_requested: "Cần sửa", rejected: "Đã loại" }[latest?.outcome] ?? (render.decisions.length ? "Có phản hồi theo đoạn" : "Chưa có quyết định");
    panel.append(node("p", label + " cho exact Result này. Kiểm tra kỹ thuật không thay thế việc xem/nghe.", "input-meta"));
    const feedback = feedbackPanel(render);
    if (feedback) panel.append(feedback);
    for (const review of render.reviews) panel.append(node("p", review.perspective + " · " + review.verdict + " — " + review.summary));
    panel.append(feedbackAnchor(context, sequence, render));
  } else panel.append(node("p", "Chưa có bản dựng cho phiên bản này.", "empty-note"));
  panel.append(timelinePanel(sequence, previewVideo));
  if (render) panel.append(outputQualityPanel(context, render));
  const strip = node("div", undefined, "sequence-strip");
  for (const segment of sequence.segments) {
    const card = node("article", undefined, "sequence-segment");
    const change = changes.segments.find((candidate) => candidate.id === segment.id);
    const changeLabel = { added: "Mới", changed: "Đã sửa", unchanged: "Không đổi" }[change?.status];
    const rendered = render?.segments?.find((item) => item.id === segment.id);
    const frame = rendered && render.files.find((file) => file.id === rendered.frameFileId);
    if (frame?.available) {
      const image = node("img"); image.loading = "lazy";
      image.src = fileUrl(context.project.id, render.resultId, frame.id);
      image.alt = "Khung hình xem lại: " + segment.title; card.append(image);
    }
    card.append(node("h5", segment.title)); card.append(node("p", segment.intent));
    card.append(node("p", segment.durationSeconds + " giây · " + changeLabel + (change?.moved ? " · đổi vị trí" : ""), "input-meta"));
    if (segment.reasons?.length) card.append(node("p", "Nguồn hoặc quyết định liên quan đến đoạn này cần xem lại.", "sequence-warning"));
    if (segment.blockers.length) card.append(node("p", segment.blockers.map((blocker) => ({ missing_visual: "Chờ hình / video", missing_visual_media: "File hình / video không còn khả dụng", missing_narration_audio: "Chờ file lời đọc" }[blocker] ?? blocker)).join(" · "), "sequence-warning"));
    if (rendered?.reusedFrom) card.append(node("p", "Đã dùng lại đoạn có nội dung khớp.", "input-meta"));
    if (segment.narration) card.append(node("p", "Lời đọc: " + segment.narration.text));
    const segmentFeedback = feedbackPanel(render, segment.id);
    if (segmentFeedback) card.append(segmentFeedback);
    if (render) card.append(feedbackAnchor(context, sequence, render, segment));
    if (segment.captions.length) {
      const details = node("details"); details.append(node("summary", "Phụ đề (" + segment.captions.length + ")"));
      for (const cue of segment.captions) details.append(node("p", cue.startSeconds + "–" + cue.endSeconds + "s: " + cue.text));
      card.append(details);
    }
    strip.append(card);
  }
  panel.append(strip);
  if (changes.removed.length) panel.append(node("p", "Đoạn đã bỏ so với bản đối chiếu: " + changes.removed.join(", "), "input-meta"));
  return panel;
}

export function renderProduction(container, context) {
  const signature = JSON.stringify([context.project.id, context.production]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const sequences = context.production?.sequences ?? [];
  if (!sequences.length) {
    container.append(node("p", "Chưa có cấu trúc video. Agent có thể bắt đầu từ ý tưởng hoặc tư liệu trong chat.", "empty-note"));
    return;
  }
  const keys = [...new Set(sequences.map((sequence) => sequence.key))].sort((left, right) =>
    Number(sequences.some((sequence) => sequence.key === right && sequence.role === "current")) -
    Number(sequences.some((sequence) => sequence.key === left && sequence.role === "current"))
  );
  for (const key of keys) {
    const revisions = sequences.filter((sequence) => sequence.key === key).sort((left, right) => left.revision - right.revision);
    const renderOptions = productionRenderOptions(revisions);
    const storageKey = context.project.id + ":" + key;
    const saved = choices.get(storageKey) ?? {};
    const group = node("section", undefined, "sequence-group");
    const controls = node("div", undefined, "sequence-controls");
    const selectedRevision = node("select");
    const selectedResult = node("select");
    const compareResult = node("select");
    selectedRevision.setAttribute("aria-label", "Phiên bản cần xem: " + key);
    selectedResult.setAttribute("aria-label", "Exact Result cần xem: " + key);
    compareResult.setAttribute("aria-label", "Exact Result so sánh: " + key);
    compareResult.append(new Option("Không so sánh Result", ""));
    for (const revision of revisions) {
      const label = "r" + revision.revision + (revision.role === "current" ? " · hiện hành" : revision.role === "candidate" ? " · candidate" : " · lịch sử");
      selectedRevision.append(new Option(label, revision.artifactId));
    }
    for (const option of renderOptions) {
      compareResult.append(new Option(`r${option.revision} · ${option.resultId} · ${new Date(option.createdAt).toLocaleString("vi-VN")}`, option.resultId));
    }
    selectedRevision.value = revisions.some((sequence) => sequence.artifactId === saved.selected)
      ? saved.selected
      : (revisions.find((sequence) => sequence.active) ?? revisions.at(-1)).artifactId;
    const panels = node("div", undefined, "sequence-panels");
    function populateSelectedResults() {
      const chosen = revisions.find((sequence) => sequence.artifactId === selectedRevision.value);
      selectedResult.replaceChildren();
      if (!chosen.renders.length) {
        selectedResult.append(new Option("Chưa có Result", "")); selectedResult.disabled = true; return;
      }
      selectedResult.disabled = false;
      for (const render of chosen.renders) {
        selectedResult.append(new Option(render.resultId + " · " + new Date(render.createdAt).toLocaleString("vi-VN"), render.resultId));
      }
      selectedResult.value = chosen.renders.some((render) => render.resultId === saved.resultId)
        ? saved.resultId : chosen.renders.at(-1).resultId;
    }
    function refresh() {
      const chosen = revisions.find((sequence) => sequence.artifactId === selectedRevision.value);
      const render = chosen.renders.find((candidate) => candidate.resultId === selectedResult.value) ?? null;
      const compareOption = renderOptions.find((option) => option.resultId === compareResult.value && option.resultId !== render?.resultId);
      const baseline = compareOption ? revisions.find((sequence) => sequence.artifactId === compareOption.artifactId) : null;
      const baselineRender = baseline?.renders.find((candidate) => candidate.resultId === compareOption?.resultId) ?? null;
      choices.set(storageKey, { selected: selectedRevision.value, resultId: render?.resultId ?? null, compareResultId: baselineRender?.resultId ?? null });
      panels.replaceChildren(revisionPanel(context, chosen, baseline, render));
      if (baseline && baselineRender) panels.append(revisionPanel(context, baseline, chosen, baselineRender));
    }
    selectedRevision.addEventListener("change", () => { saved.resultId = null; populateSelectedResults(); refresh(); });
    selectedResult.addEventListener("change", refresh);
    compareResult.addEventListener("change", refresh);
    populateSelectedResults();
    compareResult.value = renderOptions.some((option) => option.resultId === saved.compareResultId) ? saved.compareResultId : "";
    controls.append(node("strong", key), selectedRevision, selectedResult, compareResult);
    group.append(controls, panels); container.append(group); refresh();
  }
}
export function clearProduction(container) {
  lastSignature = null;
  container.replaceChildren();
}
