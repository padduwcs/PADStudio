const elements = {
  title: document.querySelector("#project-title"),
  overview: document.querySelector("#overview"),
  projectList: document.querySelector("#project-list")
};

let selectedProjectId = null;

function renderProjectList(projects) {
  elements.projectList.replaceChildren(
    ...projects.map((projectId) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = projectId === selectedProjectId ? "project-button is-active" : "project-button";
      button.textContent = projectId;
      button.addEventListener("click", () => {
        selectedProjectId = projectId;
        loadProjects().catch(showError);
      });
      return button;
    })
  );
}

function showError(error) {
  elements.overview.textContent = error.message;
}

async function loadOverview() {
  if (!selectedProjectId) {
    elements.title.textContent = "Chưa chọn project";
    elements.overview.textContent = "Chưa có project nào để quan sát.";
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
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Không thể đọc danh sách project.");
  }

  if (!body.projects.includes(selectedProjectId)) {
    selectedProjectId = body.projects[0] ?? null;
  }

  renderProjectList(body.projects);
  await loadOverview();
}

loadProjects().catch(showError);
window.setInterval(() => loadProjects().catch(() => {}), 2_000);