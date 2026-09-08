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
function compareRevisions(before, after) {
  const plain = ({ blockers, reasons, ...segment }) => segment;
  const formatChanged = JSON.stringify(before.format) !== JSON.stringify(after.format);
  return {
    globalReferencesChanged: JSON.stringify(before.references) !== JSON.stringify(after.references),
    segments: after.segments.map((segment, index) => {
      const oldIndex = before.segments.findIndex((s) => s.id === segment.id);
      const old = before.segments[oldIndex];
      return { id: segment.id, status: !old ? "added" : formatChanged ||
        JSON.stringify(plain(old)) !== JSON.stringify(plain(segment)) ? "changed" : "unchanged",
        moved: oldIndex >= 0 && oldIndex !== index };
    }),
    removed: before.segments.filter((s) => !after.segments.some((current) => current.id === s.id)).map((s) => s.id),
  };
}
function revisionPanel(context, sequence, baseline = null) {
  const changes = baseline ? compareRevisions(baseline, sequence) : sequence.changes;
  const panel = node("article", undefined, "sequence-panel");
  const stateLabel = sequence.active ? "hiện hành" : sequence.status === "draft" ? "bản nháp" : sequence.status === "retired" ? "đã ngừng dùng" : "lịch sử";
  panel.append(node("h4", sequence.name + " · r" + sequence.revision + " · " + stateLabel));
  panel.append(node("p", sequence.changeReason));
  panel.append(node("p", baseline ? "Thay đổi so với r" + baseline.revision : "Thay đổi so với revision trước", "input-meta"));
  if (changes.globalReferencesChanged) panel.append(node("p", "Bối cảnh chung của video đã thay đổi; cần xem lại toàn bản dựng.", "sequence-warning"));
  panel.append(node("p", sequence.durationSeconds + " giây · " + sequence.format.width + "×" + sequence.format.height, "input-meta"));
  const dependencies = sequence.reasons.filter((reason) => !(reason.kind === "artifact" && reason.id === sequence.artifactId && reason.reason === "not_active_revision"));
  if (dependencies.length) panel.append(node("p", "Có " + dependencies.length + " phụ thuộc cần xem lại. Phiên bản cũ vẫn được giữ; trao đổi với Agent trước khi dùng tiếp.", "sequence-warning"));
  const render = sequence.renders.at(-1);
  if (render) {
    const primary = render.files.find((f) => f.id === "primary");
    if (primary?.available) {
      const video = node("video", undefined, "result-video");
      video.controls = true;
      video.preload = "metadata";
      video.src = fileUrl(context.project.id, render.resultId, primary.id);
      panel.append(video);
    } else panel.append(node("p", "File preview không còn khả dụng.", "sequence-warning"));
    const accepted = render.decisions.at(-1);
    const label = { accepted: "Đã chấp nhận", changes_requested: "Cần sửa", rejected: "Đã loại" }[accepted?.outcome] ?? "Chưa có quyết định";
    panel.append(node("p", label + " cho bản dựng này. Kiểm tra kỹ thuật không thay thế việc xem/nghe.", "input-meta"));
    for (const review of render.reviews) panel.append(node("p", review.perspective + " · " + review.verdict + " — " + review.summary));
  } else panel.append(node("p", "Chưa có bản dựng cho phiên bản này.", "empty-note"));
  const strip = node("div", undefined, "sequence-strip");
  for (const segment of sequence.segments) {
    const card = node("article", undefined, "sequence-segment");
    const change = changes.segments.find((s) => s.id === segment.id);
    const changeLabel = { added: "Mới", changed: "Đã sửa", unchanged: "Không đổi" }[change?.status];
    const rendered = render && context.results.find((r) => r.id === render.resultId)?.data.segments?.find((s) => s.id === segment.id);
    const frame = rendered && render.files.find((f) => f.id === rendered.frameFileId);
    if (frame?.available) {
      const image = node("img");
      image.loading = "lazy";
      image.src = fileUrl(context.project.id, render.resultId, frame.id);
      image.alt = "Khung hình xem lại: " + segment.title;
      card.append(image);
    }
    card.append(node("h5", segment.title));
    card.append(node("p", segment.intent));
    card.append(node("p", segment.durationSeconds + " giây · " + changeLabel + (change?.moved ? " · đổi vị trí" : ""), "input-meta"));
    if (segment.reasons?.length) card.append(node("p", "Nguồn hoặc quyết định liên quan đến đoạn này cần xem lại.", "sequence-warning"));
    if (segment.blockers.length) card.append(node("p", segment.blockers.map((b) => ({ missing_visual: "Chờ hình / video", missing_visual_media: "File hình / video không còn khả dụng", missing_narration_audio: "Chờ file lời đọc" }[b] ?? b)).join(" · "), "sequence-warning"));
    if (rendered?.reusedFrom) card.append(node("p", "Đã dùng lại đoạn có nội dung khớp.", "input-meta"));
    if (segment.narration) card.append(node("p", "Lời đọc: " + segment.narration.text));
    if (segment.captions.length) {
      const details = node("details");
      details.append(node("summary", "Phụ đề (" + segment.captions.length + ")"));
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
  const signature = JSON.stringify([context.project.id, context.production, context.results.filter((r) => r.type === "video.sequence-render")]);
  if (lastSignature === signature) return; // Polling must not interrupt preview playback.
  lastSignature = signature;
  container.replaceChildren();
  const sequences = context.production?.sequences ?? [];
  if (!sequences.length) {
    container.append(node("p", "Chưa có cấu trúc video. Agent có thể bắt đầu từ ý tưởng hoặc tư liệu trong chat.", "empty-note"));
    return;
  }
  const keys = [...new Set(sequences.map((s) => s.key))];
  for (const key of keys) {
    const revisions = sequences.filter((s) => s.key === key).sort((a, b) => a.revision - b.revision);
    const saved = choices.get(context.project.id + ":" + key) ?? {};
    const group = node("section", undefined, "sequence-group");
    const controls = node("div", undefined, "sequence-controls");
    const selected = node("select");
    const compare = node("select");
    selected.setAttribute("aria-label", "Phiên bản cần xem: " + key);
    compare.setAttribute("aria-label", "Phiên bản so sánh: " + key);
    compare.append(new Option("Không so sánh", ""));
    for (const revision of revisions) {
      const label = "r" + revision.revision + (revision.active ? " · hiện hành" : revision.status === "draft" ? " · bản nháp" : revision.status === "retired" ? " · đã ngừng dùng" : " · lịch sử");
      selected.append(new Option(label, revision.artifactId));
      compare.append(new Option(label, revision.artifactId));
    }
    selected.value = revisions.some((s) => s.artifactId === saved.selected) ? saved.selected : (revisions.find((s) => s.active) ?? revisions.at(-1)).artifactId;
    compare.value = saved.compare ?? "";
    const panels = node("div", undefined, "sequence-panels");
    function refresh() {
      choices.set(context.project.id + ":" + key, { selected: selected.value, compare: compare.value });
      const chosen = revisions.find((s) => s.artifactId === selected.value);
      const baseline = compare.value !== selected.value ? revisions.find((s) => s.artifactId === compare.value) : null;
      panels.replaceChildren(revisionPanel(context, chosen, baseline));
      if (baseline) panels.append(revisionPanel(context, baseline, chosen));
    }
    selected.addEventListener("change", refresh);
    compare.addEventListener("change", refresh);
    controls.append(node("strong", key), selected, compare);
    group.append(controls, panels);
    container.append(group);
    refresh();
  }
}
export function clearProduction(container) {
  lastSignature = null;
  container.replaceChildren();
}
