let lastSignature = null;
export function renderDelivery(container, context) {
  const signature = JSON.stringify([context.project.id, context.delivery]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const bundle = [...(context.delivery?.bundles ?? [])].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!bundle) return;
  const files = bundle.files.filter(file => file.available !== false &&
    (["video", "audio"].includes(file.mediaType?.split("/")[0]) || /\.(mp4|webm|mov|m4v|mp3|wav)$/i.test(file.name)));
  for (const file of files) {
    const link = document.createElement("a");
    link.className = "download-button";
    link.textContent = /\.(mp3|wav)$/i.test(file.name) || file.mediaType?.startsWith("audio") ? "Tải âm thanh đã duyệt" : "Tải bản đã duyệt";
    link.title = "Bản đã được bạn duyệt";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4");
    icon.append(path); link.prepend(icon);
    link.href = "/project-results/" + [context.project.id, bundle.id, file.id].map(encodeURIComponent).join("/");
    link.download = file.name;
    container.append(link);
  }
}
export function clearDelivery(container) { lastSignature = null; container.replaceChildren(); }
