const elements = {
  title: document.querySelector("#project-title"),
  projectId: document.querySelector("#project-id"),
  checkpoint: document.querySelector("#checkpoint"),
  projectList: document.querySelector("#project-list"),
  resourceList: document.querySelector("#resource-list"),
  inputPreview: document.querySelector("#input-preview"),
  runList: document.querySelector("#run-list")
};

let selectedProjectId = null;
let selectedItemPath = null;
let renderedPreviewKey = null;

function renderProjectList(projects) {
  elements.projectList.replaceChildren(
    ...projects.map((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = project.id === selectedProjectId ? "project-button is-active" : "project-button";
      const title = document.createElement("span");
      title.textContent = project.title;
      const id = document.createElement("span");
      id.className = "input-meta";
      id.textContent = project.id;
      button.append(title, id);
      button.addEventListener("click", () => {
        selectedProjectId = project.id;
        selectedItemPath = null;
        renderedPreviewKey = null;
        loadProjects().catch(showError);
      });
      return button;
    })
  );
}

function showError(error) {
  elements.checkpoint.textContent = error.message;
}

function inputUrl(projectId, item) {
  const inputPath = item.path.startsWith("inputs/") ? item.path.slice(7) : item.path;
  const encodedPath = inputPath.split("/").map(encodeURIComponent).join("/");
  return `/project-inputs/${encodeURIComponent(projectId)}/${encodedPath}?v=${encodeURIComponent(item.modifiedAt)}`;
}

function formatSize(size) {
  if (!Number.isFinite(size)) return "không rõ dung lượng";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "chưa kết thúc";
  return new Intl.DateTimeFormat("vi", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function renderPreview(projectId, item) {
  const previewKey = item ? `${projectId}:${item.path}:${item.modifiedAt}` : "empty";
  if (previewKey === renderedPreviewKey) return;
  renderedPreviewKey = previewKey;
  elements.inputPreview.replaceChildren();
  if (!item) {
    elements.inputPreview.textContent = "Chọn một file để xem preview.";
    return;
  }

  const url = inputUrl(projectId, item);
  if (item.mediaType === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.name;
    elements.inputPreview.append(image);
    return;
  }
  if (item.mediaType === "video" || item.mediaType === "audio") {
    const media = document.createElement(item.mediaType === "video" ? "video" : "audio");
    media.src = url;
    media.controls = true;
    media.preload = "metadata";
    elements.inputPreview.append(media);
    return;
  }
  elements.inputPreview.textContent = "Trình duyệt chưa có preview cho loại file này.";
}

function renderCheckpoint(context) {
  const checkpoint = context.checkpoint;
  elements.checkpoint.replaceChildren();
  if (!checkpoint) {
    elements.checkpoint.textContent = "Agent chưa ghi checkpoint cho project này.";
    return;
  }

  const goal = document.createElement("p");
  goal.className = "context-goal";
  goal.textContent = checkpoint.goal;
  elements.checkpoint.append(goal);

  const groups = [
    ["Ràng buộc", checkpoint.constraints],
    ["Đang chờ", checkpoint.pending],
    ["Tiếp theo", checkpoint.next ? [checkpoint.next] : []]
  ];
  for (const [label, values] of groups) {
    if (!values.length) continue;
    const group = document.createElement("div");
    group.className = "context-group";
    const heading = document.createElement("strong");
    heading.textContent = label;
    const list = document.createElement("ul");
    list.replaceChildren(...values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }));
    group.append(heading, list);
    elements.checkpoint.append(group);
  }
}

function renderResources(context) {
  const allItems = context.resources.flatMap((resource) => resource.items);
  if (!allItems.some((item) => item.path === selectedItemPath)) selectedItemPath = null;
  if (!context.resources.length) {
    elements.resourceList.textContent = "Chưa có tư liệu.";
    renderPreview(context.project.id, null);
    return;
  }

  elements.resourceList.replaceChildren(...context.resources.map((resource) => {
    const card = document.createElement("article");
    card.className = "resource-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    name.textContent = resource.name;
    const meta = document.createElement("span");
    meta.className = "input-meta";
    meta.textContent = `${resource.kind} · nguồn: ${resource.source.name} · ${resource.items.length} file${resource.available ? "" : " · thiếu dữ liệu"}`;
    header.append(name, meta);
    card.append(header);

    if (!resource.items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "Folder rỗng.";
      card.append(empty);
      return card;
    }

    const items = document.createElement("div");
    items.className = "resource-items";
    items.replaceChildren(...resource.items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.path === selectedItemPath ? "input-button is-active" : "input-button";
      const path = document.createElement("span");
      path.className = "input-name";
      path.textContent = item.relativePath;
      const itemMeta = document.createElement("span");
      itemMeta.className = "input-meta";
      itemMeta.textContent = `${item.mediaType} · ${formatSize(item.sizeBytes)}${item.available ? "" : " · thiếu file"}`;
      button.disabled = !item.available;
      button.append(path, itemMeta);
      button.addEventListener("click", () => {
        selectedItemPath = item.path;
        renderedPreviewKey = null;
        renderResources(context);
      });
      return button;
    }));
    card.append(items);
    return card;
  }));

  renderPreview(context.project.id, allItems.find((item) => item.path === selectedItemPath));
}

function renderRuns(context) {
  if (!context.runs.length) {
    elements.runList.textContent = "Chưa có lần chạy nào.";
    return;
  }
  elements.runList.replaceChildren(...context.runs.slice(0, 20).map((run) => {
    const card = document.createElement("article");
    card.className = "run-card";
    const top = document.createElement("div");
    const capability = document.createElement("strong");
    capability.textContent = run.capability;
    const status = document.createElement("span");
    status.className = `run-status status-${run.status}`;
    status.textContent = run.status;
    top.append(capability, status);
    const time = document.createElement("span");
    time.className = "input-meta";
    time.textContent = `${formatDate(run.startedAt)} → ${formatDate(run.finishedAt)}`;
    card.append(top, time);
    if (run.error) {
      const error = document.createElement("p");
      error.className = "run-error";
      error.textContent = run.error;
      card.append(error);
    }
    return card;
  }));
}

function renderContext(context) {
  elements.title.textContent = context.project.title;
  elements.projectId.textContent = context.project.id;
  renderCheckpoint(context);
  renderResources(context);
  renderRuns(context);
}

function renderEmpty() {
  elements.title.textContent = "Chưa chọn project";
  elements.projectId.textContent = "";
  elements.checkpoint.textContent = "Chưa có project nào để quan sát.";
  elements.resourceList.textContent = "Chưa có tư liệu.";
  elements.runList.textContent = "Chưa có lần chạy nào.";
  renderPreview("", null);
}

async function loadContext() {
  if (!selectedProjectId) return renderEmpty();
  const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Không thể đọc project.");
  renderContext(body.context);
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Không thể đọc danh sách project.");
  if (!body.projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = body.projects[0]?.id ?? null;
    selectedItemPath = null;
    renderedPreviewKey = null;
  }
  renderProjectList(body.projects);
  await loadContext();
}

loadProjects().catch(showError);
window.setInterval(() => loadProjects().catch(() => {}), 2_000);
