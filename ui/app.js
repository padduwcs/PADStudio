import { ICONS, clock, node, orientationLabel, relativeTime, statusChip, svgIcon } from "./dom.js";
import { renderTheatre, clearTheatre } from "./production-view.js";
import { renderSources, clearSources } from "./sources-view.js";
import { createLibrary } from "./library-view.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  topbar: $("#topbar"), main: $("#main"), welcome: $("#welcome"), project: $("#project"),
  title: $("#project-title"), meta: $("#project-meta"), tabs: $("#tabs"),
  theatre: $("#theatre"), sources: $("#sources"),
  error: $("#app-error"), errorText: $("#app-error-text"), connection: $("#connection-status"),
  libraryButton: $("#library-button"), libraryCount: $("#library-count"), themeToggle: $("#theme-toggle")
};

const VIEWS = Object.freeze({ video: "Video", sources: "Tư liệu" });
const VIEW_SECTIONS = Object.freeze({
  video: ["production", "animation", "delivery"],
  sources: ["activity", "production"]
});

const parameters = new URLSearchParams(window.location.search);
let selectedProjectId = parameters.get("project");
if (!selectedProjectId) {
  try { selectedProjectId = localStorage.getItem("padstudio-project"); } catch { /* Optional preference. */ }
}
let currentView = parameters.get("view") ?? "video";
if (!VIEWS[currentView]) currentView = "video";

let projectsById = new Map();
let projectsEtag = null;
let renderedProjectId = null;
let renderedGeneration = null;
let listRequestRunning = false;
const sectionEtags = new Map();
const sectionGenerations = new Map();
const sectionLoads = new Map();
const sectionControllers = new Map();
const loadedSections = new Set();
let contexts = {};

const library = createLibrary({
  root: $("#library"), grid: $("#library-grid"), search: $("#library-search"), count: elements.libraryCount,
  onSelect: (projectId) => selectProject(projectId)
});

/* ------------------------------------------------------------------------------------------------ */
/* Small UI pieces                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

function setConnection(connected) {
  elements.connection.textContent = connected ? "Đã đồng bộ" : "Mất kết nối";
  document.body.classList.toggle("is-offline", !connected);
}

function showError(error) {
  elements.error.hidden = false;
  elements.errorText.textContent = error.message;
  setConnection(false);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  elements.themeToggle.setAttribute("aria-label", theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối");
  elements.themeToggle.replaceChildren(svgIcon(theme === "dark" ? ICONS.sun : ICONS.moon, { size: 19 }));
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#141613" : "#f6f6f2";
}

function initialTheme() {
  try {
    const stored = localStorage.getItem("padstudio-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch { /* Optional preference. */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function showWorkspace(hasProject) {
  elements.project.hidden = !hasProject;
  elements.welcome.hidden = hasProject;
}

function renderHeader() {
  const project = projectsById.get(selectedProjectId);
  const card = contexts.card?.card;
  const title = card?.project.title ?? project?.title ?? "Đang mở dự án…";
  elements.title.textContent = title;
  document.title = title + " · PADStudio";
  elements.meta.replaceChildren();
  if (!card) return;
  elements.meta.append(statusChip(card.status));
  const facts = [
    card.video ? [Number.isFinite(card.video.durationSeconds) ? clock(card.video.durationSeconds) : null,
      orientationLabel(card.video.width, card.video.height).split(" ")[0]].filter(Boolean).join(" · ") : null,
    card.lastActivityAt ? "Cập nhật " + relativeTime(card.lastActivityAt).toLocaleLowerCase("vi") : null
  ].filter(Boolean);
  for (const fact of facts) elements.meta.append(node("span", fact, "project-meta-item"));
}

function drawTheatre() {
  if (!contexts.production || !contexts.animation) return;
  const card = contexts.card?.card;
  renderTheatre(elements.theatre, {
    projectId: selectedProjectId,
    production: contexts.production.production,
    animation: contexts.animation.animation,
    delivery: contexts.delivery?.delivery
  }, {
    status: card?.status ?? null,
    hasSources: (card?.counts?.sources ?? 0) > 0,
    onOpenSources: () => setView("sources", { focus: true })
  });
}

function drawSources() {
  if (!contexts.activity) return;
  renderSources(elements.sources, {
    projectId: selectedProjectId, resources: contexts.activity.resources, results: contexts.activity.results,
    production: contexts.production?.production
  });
}

function renderSection(section, context) {
  contexts[section] = context;
  if (section === "card") {
    renderHeader();
    library.setCard(context.project.id, context.generation, context.card);
    drawTheatre();
  } else if (section === "production" || section === "delivery") {
    drawTheatre();
    if (section === "production") drawSources();
  } else if (section === "animation") {
    drawTheatre();
  } else if (section === "activity") {
    drawSources();
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Views                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

function setView(view, { updateUrl = true, focus = false } = {}) {
  if (!VIEWS[view]) view = "video";
  currentView = view;
  document.body.dataset.view = view;
  for (const tab of elements.tabs.querySelectorAll(".tab")) {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of document.querySelectorAll(".view")) panel.hidden = panel.id !== "view-" + view;
  for (const media of document.querySelectorAll(".view[hidden] video, .view[hidden] audio")) media.pause();
  if (updateUrl) {
    const location = new URL(window.location.href);
    location.searchParams.set("view", view);
    window.history.replaceState(null, "", location);
  }
  if (selectedProjectId) {
    const generation = projectsById.get(selectedProjectId)?.generation;
    if (generation) Promise.all(VIEW_SECTIONS[view].map((section) => loadSection(section, generation))).catch((error) => {
      if (error.name !== "AbortError") showError(error);
    });
  }
}

elements.tabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) setView(tab.dataset.view);
});
elements.tabs.addEventListener("keydown", (event) => {
  const views = Object.keys(VIEWS);
  const index = views.indexOf(currentView);
  const next = { ArrowRight: views[(index + 1) % views.length], ArrowLeft: views[(index + views.length - 1) % views.length], Home: views[0], End: views.at(-1) }[event.key];
  if (next) { event.preventDefault(); setView(next, { focus: true }); }
});

/* ------------------------------------------------------------------------------------------------ */
/* Loading: one request per section, conditional on the project's generation                          */
/* ------------------------------------------------------------------------------------------------ */

function resetProject() {
  for (const controller of sectionControllers.values()) controller.abort();
  sectionControllers.clear(); sectionEtags.clear(); sectionGenerations.clear(); sectionLoads.clear(); loadedSections.clear();
  contexts = {};
  clearTheatre(elements.theatre);
  clearSources(elements.sources);
  const skeleton = node("div", undefined, "theatre-skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  skeleton.append(node("div", undefined, "skeleton-stage"), node("div", undefined, "skeleton-rail"));
  elements.theatre.append(skeleton);
  renderHeader();
}

async function loadSection(section, requestedGeneration = null) {
  if (!selectedProjectId) return;
  const projectId = selectedProjectId;
  const key = `${projectId}:${section}`;
  const generation = requestedGeneration ?? projectsById.get(projectId)?.generation ?? null;
  if (generation && sectionGenerations.get(key) === generation) {
    loadedSections.add(section);
    return;
  }
  const loadKey = `${key}:${generation ?? "current"}`;
  if (sectionLoads.has(loadKey)) return sectionLoads.get(loadKey);

  sectionControllers.get(section)?.abort();
  const controller = new AbortController();
  sectionControllers.set(section, controller);
  const promise = (async () => {
    const headers = {};
    if (sectionEtags.has(key)) headers["If-None-Match"] = sectionEtags.get(key);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/observer/${section}`, { headers, signal: controller.signal });
    if (response.status === 304) {
      if (generation) sectionGenerations.set(key, generation);
      loadedSections.add(section);
      return;
    }
    const body = await response.json();
    if (selectedProjectId !== projectId) return;
    if (!response.ok) throw new Error(body.error || `Không thể đọc khu vực ${section}.`);
    sectionEtags.set(key, response.headers.get("etag"));
    sectionGenerations.set(key, body.context.generation);
    loadedSections.add(section);
    renderedGeneration = body.context.generation;
    renderSection(section, body.context);
  })();
  sectionLoads.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    if (sectionLoads.get(loadKey) === promise) sectionLoads.delete(loadKey);
  }
}

async function loadSelectedProject(generation) {
  if (!selectedProjectId) return;
  const changedProject = renderedProjectId !== selectedProjectId;
  const changedGeneration = renderedGeneration !== generation;
  if (!changedProject && !changedGeneration) return;
  if (changedProject) {
    renderedProjectId = selectedProjectId;
    renderedGeneration = null;
    resetProject();
  }
  const sections = new Set(["card", ...VIEW_SECTIONS[currentView], ...loadedSections]);
  await Promise.all([...sections].map((section) => loadSection(section, generation)));
}

function selectProject(projectId) {
  selectedProjectId = projectId;
  try { localStorage.setItem("padstudio-project", projectId); } catch { /* Optional preference. */ }
  const location = new URL(window.location.href);
  location.searchParams.set("project", projectId);
  window.history.replaceState(null, "", location);
  showWorkspace(true);
  library.update([...projectsById.values()], selectedProjectId);
  loadSelectedProject(projectsById.get(projectId)?.generation ?? null).catch((error) => {
    if (error.name !== "AbortError") showError(error);
  });
  elements.title.focus({ preventScroll: true });
}

async function loadProjects() {
  if (listRequestRunning) return;
  listRequestRunning = true;
  try {
    const headers = {};
    if (projectsEtag) headers["If-None-Match"] = projectsEtag;
    const response = await fetch("/api/projects", { headers });
    if (response.status === 304) { setConnection(true); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Không thể đọc danh sách dự án.");
    setConnection(true);
    elements.error.hidden = true;
    projectsEtag = response.headers.get("etag");
    projectsById = new Map(body.projects.map((project) => [project.id, project]));
    if (!projectsById.has(selectedProjectId)) {
      const newest = [...body.projects].sort((left, right) =>
        (Date.parse(right.modifiedAt ?? right.createdAt) || 0) - (Date.parse(left.modifiedAt ?? left.createdAt) || 0))[0];
      selectedProjectId = newest?.id ?? null;
    }
    library.update(body.projects, selectedProjectId);
    if (!selectedProjectId) {
      showWorkspace(false);
      document.title = "PADStudio";
      return;
    }
    showWorkspace(true);
    try { localStorage.setItem("padstudio-project", selectedProjectId); } catch { /* Optional preference. */ }
    await loadSelectedProject(projectsById.get(selectedProjectId).generation);
  } finally {
    listRequestRunning = false;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Startup                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

elements.libraryButton.addEventListener("click", () => library.open());
$("#library").addEventListener("librarychange", (event) => {
  elements.libraryButton.setAttribute("aria-expanded", String(event.detail.open));
});
document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); library.open(); });
document.querySelector("#retry-button").addEventListener("click", () => {
  elements.error.hidden = true;
  projectsEtag = null;
  loadProjects().catch(showError);
});
elements.themeToggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try { localStorage.setItem("padstudio-theme", theme); } catch { /* Optional preference. */ }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadProjects().catch((error) => { if (error.name !== "AbortError") showError(error); });
});

applyTheme(initialTheme());
setView(currentView, { updateUrl: false });
loadProjects().catch(showError);
window.setInterval(() => {
  if (document.hidden) return;
  loadProjects().catch((error) => { if (error.name !== "AbortError") showError(error); });
}, 2_000);
