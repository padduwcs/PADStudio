/*
 * The compact "card" of a project for the read-only observer: what state it is in, which frame represents
 * it, which video a viewer would open first, and when anything last happened. It is derived from the same
 * context the other observer sections use, so the library and the project page never disagree.
 */

export const CARD_VERSION = "1.0";

const HEAVY_RENDER = /^(video\.(render|concat|reformat|trim)|animation\.(render|preview))/;

// Plain-language label for a Run that is currently executing.
export function runningLabel(capability = "") {
  if (capability === "video.export-delivery") return "Đang chuẩn bị bản tải xuống";
  if (HEAVY_RENDER.test(capability)) return "Đang dựng video";
  if (capability === "tts.synthesize" || capability.startsWith("audio.tts")) return "Đang tạo giọng đọc";
  if (/^(video\.inspect|animation\.(validate|preflight|verify))/.test(capability)) return "Đang kiểm tra video";
  if (capability.startsWith("animation.")) return "Đang dựng hoạt họa";
  if (/^(source\.|media\.|audio\.|video\.(detect|thumbnail))/.test(capability)) return "Đang chuẩn bị tư liệu";
  return "Đang thực hiện";
}

function isImage(file) {
  return file?.available !== false && String(file?.mediaType ?? "").split("/")[0] === "image";
}

// The picture that stands for the project: a representative frame of the newest sequence render, else the
// poster of the newest code-animation render or preview.
function pickCover(context) {
  const sequences = [...(context.production?.sequences ?? [])]
    .sort((left, right) => Number(right.active) - Number(left.active) || right.revision - left.revision);
  for (const sequence of sequences) {
    for (const render of [...sequence.renders].reverse()) {
      const longest = [...sequence.segments].sort((left, right) => right.durationSeconds - left.durationSeconds)
        .find((segment) => render.segments?.some((frame) => frame.id === segment.id && frame.frameFileId));
      const frameId = render.segments?.find((frame) => frame.id === longest?.id)?.frameFileId;
      const file = render.files.find((candidate) => candidate.id === frameId && isImage(candidate))
        ?? render.files.find(isImage);
      if (file) return { resultId: render.resultId, fileId: file.id };
    }
  }
  const compositions = [...(context.animation?.compositions ?? [])]
    .sort((left, right) => Number(right.role === "current") - Number(left.role === "current") || right.revision - left.revision);
  for (const composition of compositions) {
    for (const result of [...(composition.renders ?? []), ...(composition.previews ?? [])].reverse()) {
      const file = result.files.find(isImage);
      if (file) return { resultId: result.resultId, fileId: file.id };
    }
  }
  return null;
}

function playable(render) {
  return render?.files?.some((file) => file.id === "primary" && file.available);
}

// The video a viewer would open first, described without loading anything.
function pickVideo(context) {
  const sequences = [...(context.production?.sequences ?? [])]
    .sort((left, right) => Number(right.active) - Number(left.active) || right.revision - left.revision);
  for (const sequence of sequences) {
    const render = [...sequence.renders].reverse().find(playable);
    if (render) {
      return {
        source: "sequence", resultId: render.resultId, revision: sequence.revision, name: sequence.name,
        durationSeconds: sequence.durationSeconds ?? null, width: sequence.format?.width ?? null, height: sequence.format?.height ?? null
      };
    }
  }
  const compositions = [...(context.animation?.compositions ?? [])]
    .sort((left, right) => Number(right.role === "current") - Number(left.role === "current") || right.revision - left.revision);
  for (const composition of compositions) {
    const render = [...(composition.renders ?? [])].reverse().find(playable);
    if (render) {
      return {
        source: "animation", resultId: render.resultId, revision: composition.revision, name: composition.name,
        durationSeconds: render.durationSeconds ?? composition.durationSeconds ?? null,
        width: composition.format?.width ?? null, height: composition.format?.height ?? null
      };
    }
  }
  return null;
}

function lastActivity(context) {
  const times = [
    ...context.runs.flatMap((run) => [run.finishedAt, run.startedAt]),
    ...context.results.map((result) => result.createdAt),
    ...context.decisions.map((decision) => decision.createdAt),
    ...context.artifacts.map((artifact) => artifact.createdAt),
    context.checkpoint?.updatedAt
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Reduce a project's context to one status. The first matching rule wins, so work in progress is never
 * hidden behind an older approval.
 */
export function projectStatus(context) {
  const recoverable = new Set((context.runRecovery?.pendingFinalizations ?? [])
    .filter((entry) => entry.recoverable).map((entry) => entry.runId));
  const runs = [...context.runs].sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
  const running = runs.find((run) => ["in_progress", "running"].includes(run.status) && !recoverable.has(run.id));
  if (running) return { kind: "working", label: runningLabel(running.capability) };

  const items = context.intelligence?.currentWorkItems ?? [];
  if (items.some((item) => item.status === "in_progress")) return { kind: "working", label: "Đang thực hiện" };
  if (context.intelligence?.pendingApprovals?.length) return { kind: "waiting", label: "Chờ bạn xem" };
  if (items.some((item) => item.status === "blocked") || runs.some((run) => recoverable.has(run.id))) {
    return { kind: "waiting", label: "Chờ tiếp tục" };
  }
  if (items.some((item) => item.status === "awaiting_review")) return { kind: "waiting", label: "Chờ kiểm tra" };
  if (context.pendingFeedback?.length) return { kind: "feedback", label: "Chờ chỉnh theo phản hồi" };

  const accepted = context.decisions.filter((decision) => decision.kind !== "project_decision" && decision.outcome === "accepted");
  const delivered = context.results.some((result) => result.type === "delivery.bundle");
  if (delivered) return { kind: "delivered", label: "Đã giao" };
  if (accepted.length) return { kind: "accepted", label: "Đã duyệt" };
  if (pickVideo(context)) return { kind: "draft", label: "Bản nháp" };
  return { kind: "empty", label: "Chưa có video" };
}

export function buildProjectCard(context) {
  const video = pickVideo(context);
  const versions = (context.production?.sequences ?? []).length || (context.animation?.compositions ?? []).length;
  return {
    version: CARD_VERSION,
    project: { id: context.project.id, title: context.project.title, createdAt: context.project.createdAt },
    status: projectStatus(context),
    cover: pickCover(context),
    video: video && {
      ...video,
      orientation: video.width && video.height ? (video.height > video.width ? "portrait" : video.height < video.width ? "landscape" : "square") : null
    },
    counts: { versions, sources: context.resources.length, deliveries: context.results.filter((result) => result.type === "delivery.bundle").length },
    pendingFeedback: context.pendingFeedback?.length ?? 0,
    lastActivityAt: lastActivity(context)
  };
}

