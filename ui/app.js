const elements = {
  title: document.querySelector("#project-title"),
  overview: document.querySelector("#overview"),
  projectList: document.querySelector("#project-list"),
  inputList: document.querySelector("#input-list"),
  inputPreview: document.querySelector("#input-preview")
};

let selectedProjectId = null;
let selectedInputPath = null;
let renderedPreviewKey = null;

function renderProjectList(projects) {
  elements.projectList.replaceChildren(
    ...projects.map((projectId) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = projectId === selectedProjectId ? "project-button is-active" : "project-button";
      button.textContent = projectId;
      button.addEventListener("click", () => {
        selectedProjectId = projectId;
        selectedInputPath = null;
        renderedPreviewKey = null;
        loadProjects().catch(showError);
      });
      return button;
    })
  );
}

function showError(error) {
  elements.overview.textContent = error.message;
}

function inputUrl(projectId, input) {
  const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
  return `/project-inputs/${encodeURIComponent(projectId)}/${encodedPath}?v=${encodeURIComponent(input.modifiedAt)}`;
}

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPreview(projectId, input) {
  const previewKey = input ? `${projectId}:${input.path}:${input.modifiedAt}` : "empty";
  if (previewKey === renderedPreviewKey) return;
  renderedPreviewKey = previewKey;
  elements.inputPreview.replaceChildren();

  if (!input) {
    elements.inputPreview.textContent = "Chọn tư liệu để xem preview.";
    return;
  }

  const url = inputUrl(projectId, input);
  if (input.mediaType === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = input.name;
    elements.inputPreview.append(image);
    return;
  }

  if (input.mediaType === "video" || input.mediaType === "audio") {
    const media = document.createElement(input.mediaType === "video" ? "video" : "audio");
    media.src = url;
    media.controls = true;
    media.preload = "metadata";
    elements.inputPreview.append(media);
    return;
  }

  elements.inputPreview.textContent = "Trình duyệt chưa có preview cho loại file này.";
}

function renderInputs(project) {
  const inputs = project.inputs || [];
  if (!inputs.some((input) => input.path === selectedInputPath)) {
    selectedInputPath = null;
  }

  if (!inputs.length) {
    elements.inputList.textContent = "Chưa có tư liệu đầu vào.";
    renderPreview(project.id, null);
    return;
  }

  elements.inputList.replaceChildren(
    ...inputs.map((input) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = input.path === selectedInputPath ? "input-button is-active" : "input-button";

      const name = document.createElement("span");
      name.className = "input-name";
      name.textContent = input.path;
      const meta = document.createElement("span");
      meta.className = "input-meta";
      meta.textContent = `${input.mediaType} · ${formatSize(input.size)}`;
      button.append(name, meta);
      button.addEventListener("click", () => {
        selectedInputPath = input.path;
        renderedPreviewKey = null;
        renderInputs(project);
      });
      return button;
    })
  );

  renderPreview(project.id, inputs.find((input) => input.path === selectedInputPath));
}

async function loadOverview() {
  if (!selectedProjectId) {
    elements.title.textContent = "Chưa chọn project";
    elements.overview.textContent = "Chưa có project nào để quan sát.";
    elements.inputList.textContent = "Chưa có tư liệu đầu vào.";
    renderPreview("", null);
    return;
  }

  const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Không thể đọc project.");
  }

  elements.title.textContent = body.project.id;
  elements.overview.textContent =
    body.project.overview ??
    "Agent chưa lưu overview.md cho project này. Web chưa có gì để hiển thị thêm.";
  renderInputs(body.project);
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Không thể đọc danh sách project.");
  }

  if (!body.projects.includes(selectedProjectId)) {
    selectedProjectId = body.projects[0] ?? null;
    selectedInputPath = null;
    renderedPreviewKey = null;
  }

  renderProjectList(body.projects);
  await loadOverview();
}

loadProjects().catch(showError);
window.setInterval(() => loadProjects().catch(() => {}), 2_000);