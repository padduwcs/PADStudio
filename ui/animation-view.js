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
  return `${composition.runtime} · r${composition.revision} · ${validation} · ${runtimeCheck}`;
}

export function renderAnimation(container, context) {
  const signature = JSON.stringify([context.project.id, context.animation]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const compositions = context.animation?.compositions ?? [];
  const choreographies = context.animation?.choreographies ?? [];
  if (!compositions.length && !choreographies.length) {
    container.append(node("p", "Project chưa có composition hoạt họa bằng code. Đây là một nhánh tùy chọn, không phải bước bắt buộc.", "empty-note"));
    return;
  }
  for (const choreography of [...choreographies].reverse()) {
    const card = node("article", undefined, "sequence-panel choreography-panel");
    card.dataset.choreographyArtifact = choreography.artifactId;
    card.append(
      node("h4", `${choreography.name} · ${choreography.role}`),
      node("p", choreography.purpose),
      node("p", `${choreography.durationSeconds}s · ${choreography.fps} fps · ${choreography.objectCount} đối tượng · ${choreography.semanticBeatCount} beat ngữ nghĩa`, "input-meta"),
      node("p", `Exact choreography: ${choreography.artifactId} · r${choreography.revision}`, "exact-result-id")
    );
    if (choreography.continuity?.contractVersion === "1.1") {
      card.append(node("p",
        `${choreography.continuity.continuityMode} · ${choreography.continuity.chapterCount} chương · ${choreography.continuity.heroObjectCount} đối tượng chủ đạo · ${choreography.continuity.resetCount} reset · sân khấu mục tiêu ${choreography.continuity.targetStageCoveragePercent}% · chữ tối đa ${choreography.continuity.maxTextAreaPercent}%`,
        choreography.continuity.resetCount > 0 ? "sequence-warning" : "result-verification"));
    } else if (choreography.continuity?.contractVersion === "1.2") {
      const relationships = Object.entries(choreography.continuity.relationshipCounts ?? {})
        .map(([name, count]) => `${name} ${count}`).join(" · ");
      card.append(
        node("p", choreography.direction.visualThesis, "result-verification"),
        node("p", `Quan hệ cảnh do agent chọn: ${relationships || "chưa có"} · ${choreography.presentation.narrationMode}`, "input-meta"),
        node("p", `Ý định biến hóa: ${choreography.direction.variationIntent}`, "input-meta"),
        node("p", `Mẫu đại diện: ${choreography.direction.sampleIntent}`, "input-meta")
      );
    }
    const beats = node("ol", undefined, "choreography-beats");
    for (const beat of choreography.beats) {
      const item = node("li");
      item.append(
        node("strong", `${beat.startSeconds}s–${beat.endSeconds}s · ${beat.message}`),
        node("span", `${beat.actions.length} hành động · ${beat.stateBefore} → ${beat.stateAfter}${beat.continuityMode ? ` · ${beat.continuityMode} · ${beat.stateBeforeId} → ${beat.stateAfterId}` : ""}${beat.relationToPrevious ? ` · ${beat.relationToPrevious} · ${beat.audienceInsight}` : ""}`, "input-meta")
      );
      beats.append(item);
    }
    card.append(beats);
    container.append(card);
  }
  for (const composition of [...compositions].reverse()) {
    const card = node("article", undefined, "sequence-panel");
    card.dataset.animationArtifact = composition.artifactId;
    card.dataset.animationRevision = String(composition.revision);
    card.append(
      node("h4", `${composition.name} · ${composition.role}`),
      node("p", statusLine(composition), composition.validation ? "result-verification" : "sequence-warning"),
      node("p", composition.intent),
      node("p", `${composition.durationSeconds}s mục tiêu (${composition.timing?.mode ?? "exact"}) · ${composition.format.width}×${composition.format.height} · ${composition.format.fps} fps · ${composition.entry.file}#${composition.entry.symbol}`, "input-meta"),
      node("p", `Exact source: ${composition.sourceResultId}`, "exact-result-id")
    );
    if (composition.propsResultId) card.append(node("p", `Managed props: ${composition.propsResultId}`, "exact-result-id"));
    if (composition.choreography) card.append(node("p",
      `Biên đạo: ${composition.choreography.name} · ${composition.choreography.semanticBeatCount} beat ngữ nghĩa · preview frames ${composition.choreography.recommendedPreviewFrames.join(", ")}`,
      "result-verification"));
    if (composition.dependencyReasons?.length) card.append(node("p",
      "Composition đang bind một choreography revision không còn active; cần revise hoặc chủ động chạy historical.",
      "sequence-warning"));
    const preflight = composition.preflights?.at(-1);
    if (preflight) {
      card.append(node("p", `Preflight ${preflight.status}: ${preflight.resultId} · ${preflight.scope}`,
        preflight.status === "passed" ? "result-verification" : "sequence-warning"));
      if (preflight.findings) card.append(node("p",
        `${preflight.findings.findingCount} finding · ${preflight.findings.errorCount} lỗi · ${preflight.findings.warningCount} cảnh báo · ${preflight.snapshotCount} ảnh bằng chứng`,
        preflight.findings.errorCount || preflight.findings.warningCount || preflight.findings.coverageComplete === false ? "sequence-warning" : "input-meta"));
      if (preflight.findings?.coverageComplete === false) card.append(node("p",
        `Diagnostic coverage incomplete: ${preflight.findings.sections?.layout?.transitionSamplesDropped ?? 0} transition samples dropped or report findings truncated.`,
        "sequence-warning"));
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
      if (gallery.childElementCount) card.append(node("p",
        preview.motion ? `Motion preview ${preview.motion.selector}: ${preview.resultId}` :
          `Preview exact (${preview.frameSelection === "choreography" ? "theo beat biên đạo" : "frame chỉ định"}): ${preview.resultId}`,
        "exact-result-id"), gallery);
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
