let lastSignature = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function fileUrl(projectId, resultId, fileId) {
  return "/project-results/" + [projectId, resultId, fileId].map(encodeURIComponent).join("/");
}

export function renderDelivery(container, context) {
  const signature = JSON.stringify([context.project.id, context.delivery]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const bundles = context.delivery?.bundles ?? [];
  if (!bundles.length) {
    container.append(node(
      "p",
      "Chưa có bundle giao. Agent chỉ có thể xuất khi exact Result hiện hành đã được duyệt và vượt toàn bộ kiểm tra.",
      "empty-note"
    ));
    return;
  }
  for (const bundle of [...bundles].reverse()) {
    const card = node("article", undefined, "delivery-card");
    const header = node("header");
    const title = node("div");
    title.append(
      node("h4", bundle.name),
      node("p", bundle.id + " · " + new Date(bundle.createdAt).toLocaleString("vi-VN"), "input-meta")
    );
    header.append(title, node("span", bundle.verification?.status === "passed" ? "Đã kiểm chứng" : "Cần kiểm tra", "result-verification"));
    card.append(header);
    const media = bundle.data?.media;
    card.append(node(
      "p",
      [
        "Nguồn: " + bundle.data?.sourceResultId,
        "Duyệt: " + bundle.data?.approvalDecisionId,
        "Profile: " + bundle.data?.profileId
      ].join(" · "),
      "input-meta"
    ));
    if (media) {
      card.append(node(
        "p",
        `${media.width}×${media.height} · ${media.fps} fps · ${media.videoCodec}/${media.audioCodec} · ${media.durationSeconds}s · ${media.integratedLufs} LUFS`
      ));
    }
    const files = node("div", undefined, "delivery-files");
    for (const file of bundle.files) {
      const link = node("a", file.name);
      link.href = fileUrl(context.project.id, bundle.id, file.id);
      link.download = file.name;
      link.title = file.sha256 ? "SHA-256: " + file.sha256 : "";
      files.append(link);
    }
    card.append(files);
    container.append(card);
  }
}

export function clearDelivery(container) {
  lastSignature = null;
  container.replaceChildren();
}
