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

function seconds(value) {
  return `${Math.round(value * 1000) / 1000}s`;
}

export function previewClipDescription(preview) {
  const range = preview?.range;
  const frameRate = preview?.clip?.frameRate;
  if (!range || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame)) return "Đoạn preview ngắn";
  const frames = `frame ${range.startFrame}–${range.endFrame}`;
  if (!Number.isFinite(frameRate) || frameRate <= 0) return frames;
  const start = range.startFrame / frameRate;
  const end = (range.endFrame + 1) / frameRate;
  return `${seconds(start)}–${seconds(end)} · ${frames}`;
}

function reviewClip(projectId, preview, clip) {
  const figure = node("figure", undefined, "clip");
  const video = node("video");
  video.controls = true;
  video.preload = "metadata";
  video.src = resultUrl(projectId, preview.resultId, clip.id);
  const caption = node("figcaption");
  caption.append(node("span", previewClipDescription(preview)));
  const loopLabel = node("label", undefined, "toggle");
  const loop = node("input");
  loop.type = "checkbox";
  loop.addEventListener("change", () => { video.loop = loop.checked; });
  loopLabel.append(loop, document.createTextNode(" Lặp đoạn để so hình với tiếng"));
  caption.append(loopLabel);
  figure.append(video, caption);
  return figure;
}

function statusLine(composition) {
  const validation = composition.validation ? "đã validation" : "chưa validation";
  const preflight = composition.preflights?.at(-1);
  const runtimeCheck = preflight ? `preflight ${preflight.status}` : "chưa preflight";
  return `${composition.runtime} · r${composition.revision} · ${validation} · ${runtimeCheck}`;
}

const NEWEST_SHOWN = 1;

/** The newest cards are drawn at once; older revisions are built only when the disclosure is opened. */
function appendWithHistory(container, items, build, label) {
  const newest = [...items].reverse();
  for (const item of newest.slice(0, NEWEST_SHOWN)) container.append(build(item));
  const older = newest.slice(NEWEST_SHOWN);
  if (!older.length) return;
  const more = node("details", undefined, "disclosure");
  more.append(node("summary", `${label} cũ hơn (${older.length})`));
  more.addEventListener("toggle", () => {
    if (!more.open || more.dataset.built) return;
    more.dataset.built = "1";
    more.append(...older.map(build));
  });
  container.append(more);
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
  const buildChoreography = (choreography) => {
    const card = node("article", undefined, "card choreography");
    card.dataset.choreographyArtifact = choreography.artifactId;
    card.append(
      node("h4", `${choreography.name} · ${choreography.role}`),
      node("p", choreography.purpose),
      node("p", `${choreography.durationSeconds}s · ${choreography.fps} fps · ${choreography.objectCount} đối tượng · ${choreography.semanticBeatCount} beat ngữ nghĩa`, "rail-note"),
      node("p", `Exact choreography: ${choreography.artifactId} · r${choreography.revision}`, "mono")
    );
    if (choreography.continuity?.contractVersion === "1.1") {
      card.append(node("p",
        `${choreography.continuity.continuityMode} · ${choreography.continuity.chapterCount} chương · ${choreography.continuity.heroObjectCount} đối tượng chủ đạo · ${choreography.continuity.resetCount} reset · sân khấu mục tiêu ${choreography.continuity.targetStageCoveragePercent}% · chữ tối đa ${choreography.continuity.maxTextAreaPercent}%`,
        choreography.continuity.resetCount > 0 ? "tone-warn" : "tone-ok"));
    } else if (["1.2", "1.3"].includes(choreography.continuity?.contractVersion)) {
      const relationships = Object.entries(choreography.continuity.relationshipCounts ?? {})
        .map(([name, count]) => `${name} ${count}`).join(" · ");
      card.append(
        node("p", choreography.direction.visualThesis, "tone-ok"),
        node("p", `Quan hệ cảnh do agent chọn: ${relationships || "chưa có"} · ${choreography.presentation.narrationMode}`, "rail-note"),
        node("p", `Ý định biến hóa: ${choreography.direction.variationIntent}`, "rail-note"),
        node("p", `Mẫu đại diện: ${choreography.direction.sampleIntent}`, "rail-note")
      );
      if (choreography.communication?.communicationMode) {
        const textRoles = Object.entries(choreography.communication.roleCounts ?? {})
          .map(([role, count]) => `${role}: ${count}`).join(" · ");
        card.append(node("p",
          `Giao tiếp ${choreography.communication.communicationMode} · ${choreography.communication.totalTextElementCount} phần chữ · ${choreography.communication.textlessBeatCount} beat không chữ${textRoles ? ` · ${textRoles}` : ""}`,
          choreography.communication.communicationMode === "visual-first"
            && choreography.communication.narrationDuplicateCount > 0 ? "tone-warn" : "tone-ok"));
      }
    }
    const beats = node("ol", undefined, "beats");
    for (const beat of choreography.beats) {
      const item = node("li");
      item.append(
        node("strong", `${beat.startSeconds}s–${beat.endSeconds}s · ${beat.message}`),
        node("span", `${beat.actions.length} hành động · ${beat.stateBefore} → ${beat.stateAfter}${beat.continuityMode ? ` · ${beat.continuityMode} · ${beat.stateBeforeId} → ${beat.stateAfterId}` : ""}${beat.relationToPrevious ? ` · ${beat.relationToPrevious} · ${beat.audienceInsight}` : ""}${beat.visualProof ? ` · minh chứng hình: ${beat.visualProof}` : ""}${beat.textElements ? ` · ${beat.textElements.length} phần chữ` : ""}`, "rail-note")
      );
      if (beat.textElements?.length) {
        const textDetail = node("details");
        textDetail.append(node("summary", `Chữ trên hình (${beat.textElements.length})`));
        const inventory = node("ul");
        for (const element of beat.textElements) {
          inventory.append(node("li", `${element.role}: “${element.text}” — ${element.purpose}`));
        }
        textDetail.append(inventory);
        item.append(textDetail);
      }
      beats.append(item);
    }
    if (choreography.beats.length > 6) {
      const list = node("details", undefined, "disclosure");
      list.append(node("summary", `Các beat (${choreography.beats.length})`), beats);
      card.append(list);
    } else {
      card.append(beats);
    }
    return card;
  };
  const buildComposition = (composition) => {
    const card = node("article", undefined, "card composition");
    card.dataset.animationArtifact = composition.artifactId;
    card.dataset.animationRevision = String(composition.revision);
    card.append(
      node("h4", `${composition.name} · ${composition.role}`),
      node("p", statusLine(composition), composition.validation ? "tone-ok" : "tone-warn"),
      node("p", composition.intent),
      node("p", `${composition.durationSeconds}s mục tiêu (${composition.timing?.mode ?? "exact"}) · ${composition.format.width}×${composition.format.height} · ${composition.format.fps} fps · ${composition.entry.file}#${composition.entry.symbol}`, "rail-note"),
      node("p", `Exact source: ${composition.sourceResultId}`, "mono")
    );
    if (composition.propsResultId) card.append(node("p", `Managed props: ${composition.propsResultId}`, "mono"));
    if (composition.choreography) card.append(node("p",
      `Biên đạo: ${composition.choreography.name} · ${composition.choreography.semanticBeatCount} beat ngữ nghĩa · preview frames ${composition.choreography.recommendedPreviewFrames.join(", ")}`,
      "tone-ok"));
    if (composition.dependencyReasons?.length) card.append(node("p",
      "Composition đang bind một choreography revision không còn active; cần revise hoặc chủ động chạy historical.",
      "tone-warn"));
    const preflight = composition.preflights?.at(-1);
    if (preflight) {
      card.append(node("p", `Preflight ${preflight.status}: ${preflight.resultId} · ${preflight.scope}`,
        preflight.status === "passed" ? "tone-ok" : "tone-warn"));
      if (preflight.findings) card.append(node("p",
        `${preflight.findings.findingCount} finding · ${preflight.findings.errorCount} lỗi · ${preflight.findings.warningCount} cảnh báo · ${preflight.snapshotCount} ảnh bằng chứng`,
        preflight.findings.errorCount || preflight.findings.warningCount || preflight.findings.coverageComplete === false ? "tone-warn" : "rail-note"));
      if (preflight.findings?.coverageComplete === false) card.append(node("p",
        `Diagnostic coverage incomplete: ${preflight.findings.sections?.layout?.transitionSamplesDropped ?? 0} transition samples dropped or report findings truncated.`,
        "tone-warn"));
      const evidence = node("div", undefined, "gallery");
      for (const file of preflight.files?.filter((file) => file.available && file.mediaType === "image") ?? []) {
        const image = node("img"); image.loading = "lazy"; image.alt = file.name;
        image.src = resultUrl(context.project.id, preflight.resultId, file.id); evidence.append(image);
      }
      if (evidence.childElementCount) card.append(evidence);
      for (const limitation of preflight.limitations ?? []) card.append(node("p", limitation, "rail-note"));
    }
    const preview = composition.previews?.at(-1);
    if (preview) {
      const gallery = node("div", undefined, "gallery");
      for (const file of preview.files.filter((file) => file.available && file.mediaType === "image")) {
        const image = node("img"); image.loading = "lazy"; image.alt = file.name;
        image.src = resultUrl(context.project.id, preview.resultId, file.id); gallery.append(image);
      }
      const clip = preview.files.find((file) => file.available && file.mediaType === "video");
      if (clip) {
        gallery.append(reviewClip(context.project.id, preview, clip));
      }
      if (gallery.childElementCount) card.append(node("p",
        preview.motion ? `Motion preview ${preview.motion.selector}: ${preview.resultId}` :
          `Preview exact (${preview.frameSelection === "choreography" ? "theo beat biên đạo" : "frame chỉ định"}): ${preview.resultId}`,
        "mono"), gallery);
    }
    const render = composition.renders.at(-1);
    if (render) {
      const primary = render.files.find((file) => file.id === "primary" && file.available);
      if (primary) {
        const video = node("video", undefined, "result-media");
        video.controls = true; video.preload = "metadata";
        video.src = resultUrl(context.project.id, render.resultId, primary.id);
        card.append(video);
      }
      card.append(node("p", `Exact render: ${render.resultId}`, "mono"));
      if (Number.isFinite(render.durationSeconds)) {
        const drift = render.timing?.durationDriftSeconds;
        const driftText = Number.isFinite(drift) ? ` · lệch ${Math.round(drift * 1000) / 1000}s` : "";
        card.append(node("p", `${render.durationSeconds}s đo được${driftText}`, "rail-note"));
      }
    } else {
      card.append(node("p", "Revision này chưa có render.", "empty-note"));
    }
    return card;
  };
  appendWithHistory(container, choreographies, buildChoreography, "Biên đạo");
  appendWithHistory(container, compositions, buildComposition, "Bản");
}

export function clearAnimation(container) {
  lastSignature = null;
  container.replaceChildren();
}
