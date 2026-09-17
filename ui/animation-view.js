let lastSignature = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function resultUrl(projectId, resultId, fileId) {
  return "/project-results/" + [projectId, resultId, fileId].map(encodeURIComponent).join("/");
}

function statusLine(composition) {
  const validation = composition.validation ? "đã validation" : "chưa validation";
  const preflight = composition.preflights?.at(-1);
  const runtimeCheck = preflight ? `preflight ${preflight.status}` : "chưa preflight";
  const approval = composition.executionApproval?.outcome === "approved" ? "đã cho phép chạy exact source" : "chưa được phép chạy code";
  return `${composition.runtime} · r${composition.revision} · ${validation} · ${runtimeCheck} · ${approval}`;
}

export function renderAnimation(container, context) {
  const signature = JSON.stringify([context.project.id, context.animation]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const compositions = context.animation?.compositions ?? [];
  if (!compositions.length) {
    container.append(node("p", "Project chưa có composition hoạt họa bằng code. Đây là một nhánh tùy chọn, không phải bước bắt buộc.", "empty-note"));
    return;
  }
  for (const composition of [...compositions].reverse()) {
    const card = node("article", undefined, "sequence-panel");
    card.dataset.animationArtifact = composition.artifactId;
    card.dataset.animationRevision = String(composition.revision);
    card.append(
      node("h4", `${composition.name} · ${composition.role}`),
      node("p", statusLine(composition), composition.executionApproval?.outcome === "approved" ? "result-verification" : "sequence-warning"),
      node("p", composition.intent),
      node("p", `${composition.durationSeconds}s mục tiêu (${composition.timing?.mode ?? "exact"}) · ${composition.format.width}×${composition.format.height} · ${composition.format.fps} fps · ${composition.entry.file}#${composition.entry.symbol}`, "input-meta"),
      node("p", `Exact source: ${composition.sourceResultId}`, "exact-result-id")
    );
    if (composition.propsResultId) card.append(node("p", `Managed props: ${composition.propsResultId}`, "exact-result-id"));
    if (composition.executionApproval) card.append(node("p", `Quyết định ${composition.executionApproval.id}: ${composition.executionApproval.reason}`, "input-meta"));
    const preflight = composition.preflights?.at(-1);
    if (preflight) {
      card.append(node("p", `Preflight ${preflight.status}: ${preflight.resultId} · ${preflight.scope}`,
        preflight.status === "passed" ? "result-verification" : "sequence-warning"));
      if (preflight.findings) card.append(node("p",
        `${preflight.findings.findingCount} finding · ${preflight.findings.errorCount} lỗi · ${preflight.findings.warningCount} cảnh báo · ${preflight.snapshotCount} ảnh bằng chứng`,
        preflight.findings.errorCount || preflight.findings.warningCount ? "sequence-warning" : "input-meta"));
      const evidence = node("div", undefined, "animation-preview-gallery");
      for (const file of preflight.files?.filter((file) => file.available && file.mediaType === "image") ?? []) {
        const image = node("img"); image.loading = "lazy"; image.alt = file.name;
        image.src = resultUrl(context.project.id, preflight.resultId, file.id); evidence.append(image);
      }
      if (evidence.childElementCount) card.append(evidence);
      for (const limitation of preflight.limitations ?? []) card.append(node("p", limitation, "input-meta"));
    }
    const preview = composition.previews?.at(-1);
    if (preview) {
      const gallery = node("div", undefined, "animation-preview-gallery");
      for (const file of preview.files.filter((file) => file.available && file.mediaType === "image")) {
        const image = node("img"); image.loading = "lazy"; image.alt = file.name;
        image.src = resultUrl(context.project.id, preview.resultId, file.id); gallery.append(image);
      }
      const clip = preview.files.find((file) => file.available && file.mediaType === "video");
      if (clip) {
        const video = node("video"); video.controls = true; video.preload = "metadata";
        video.src = resultUrl(context.project.id, preview.resultId, clip.id); gallery.append(video);
      }
      if (gallery.childElementCount) card.append(node("p", `Preview exact: ${preview.resultId}`, "exact-result-id"), gallery);
    }
    const render = composition.renders.at(-1);
    if (render) {
      const primary = render.files.find((file) => file.id === "primary" && file.available);
      if (primary) {
        const video = node("video", undefined, "result-video");
        video.controls = true; video.preload = "metadata";
        video.src = resultUrl(context.project.id, render.resultId, primary.id);
        card.append(video);
      }
      card.append(node("p", `Exact render: ${render.resultId}`, "exact-result-id"));
      if (Number.isFinite(render.durationSeconds)) {
        const drift = render.timing?.durationDriftSeconds;
        const driftText = Number.isFinite(drift) ? ` · lệch ${Math.round(drift * 1000) / 1000}s` : "";
        card.append(node("p", `${render.durationSeconds}s đo được${driftText}`, "input-meta"));
      }
    } else {
      card.append(node("p", "Revision này chưa có render.", "empty-note"));
    }
    container.append(card);
  }
}

export function clearAnimation(container) {
  lastSignature = null;
  container.replaceChildren();
}
