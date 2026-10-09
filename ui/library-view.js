import { clock, node, orientationLabel, relativeTime, resultFileUrl, searchKey, statusChip } from "./dom.js";

const MAX_CONCURRENT_CARDS = 3;

function activityTime(project, card) {
  return Date.parse(card?.lastActivityAt ?? project.modifiedAt ?? project.createdAt) || 0;
}

/**
 * The project library: a full-screen sheet with a searchable grid of project cards. Cards show a real frame
 * of the project's video and its status; both come from the observer's lightweight `card` section, fetched
 * lazily as cards scroll into view and cached per generation.
 */
export function createLibrary({ root, grid, search, count, onSelect }) {
  const cards = new Map();            // projectId -> { generation, card }
  const queued = new Set();
  const queue = [];
  let running = 0;
  let projects = [];
  let selectedId = null;
  let opener = null;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const project = projects.find((candidate) => candidate.id === entry.target.dataset.projectId);
      if (!project || queued.has(project.id) || cards.get(project.id)?.generation === project.generation) continue;
      queued.add(project.id);
      queue.push(project);
    }
    pump();
  }, { root: grid, rootMargin: "160px" });

  async function fetchCard(project) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/observer/card`);
    if (!response.ok) return null;
    return (await response.json()).context;
  }

  function pump() {
    while (running < MAX_CONCURRENT_CARDS && queue.length) {
      const project = queue.shift();
      running += 1;
      fetchCard(project).then((context) => {
        if (!context) return;
        cards.set(project.id, { generation: context.generation, card: context.card });
        paintCard(project.id);
      }).catch(() => {}).finally(() => { running -= 1; queued.delete(project.id); pump(); });
    }
  }

  function cover(project, card) {
    const box = node("span", undefined, "card-cover");
    box.setAttribute("aria-hidden", "true");
    if (card?.cover) {
      const image = node("img"); image.alt = ""; image.loading = "lazy"; image.decoding = "async";
      image.src = resultFileUrl(project.id, card.cover.resultId, card.cover.fileId);
      image.addEventListener("error", () => image.remove(), { once: true });
      box.append(image);
    } else {
      const mark = node("img", undefined, "card-cover-mark"); mark.src = "/brand/padstudio-mark.webp"; mark.alt = "";
      box.append(mark);
    }
    if (card?.video) {
      const badge = [orientationLabel(card.video.width, card.video.height).split(" ")[0], Number.isFinite(card.video.durationSeconds) ? clock(card.video.durationSeconds) : null].filter(Boolean).join(" · ");
      if (badge) box.append(node("span", badge, "card-badge"));
    }
    return box;
  }

  function cardContent(project) {
    const card = cards.get(project.id)?.card ?? null;
    const body = node("span", undefined, "card-body");
    body.append(node("span", project.title, "card-title"));
    const meta = node("span", undefined, "card-meta");
    meta.append(card ? statusChip(card.status) : node("span", undefined, "chip chip-loading"));
    const time = relativeTime(card?.lastActivityAt ?? project.modifiedAt ?? project.createdAt);
    if (time) meta.append(node("span", time, "card-time"));
    body.append(meta);
    return [cover(project, card), body];
  }

  function paintCard(projectId) {
    const button = grid.querySelector(`[data-project-id="${CSS.escape(projectId)}"]`);
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!button || !project) return;
    button.replaceChildren(...cardContent(project));
  }

  function render() {
    count.textContent = String(projects.length);
    const query = searchKey(search.value);
    const shown = projects
      .filter((project) => searchKey(project.title).includes(query))
      .sort((left, right) => activityTime(right, cards.get(right.id)?.card) - activityTime(left, cards.get(left.id)?.card)
        || left.title.localeCompare(right.title, "vi"));
    observer.disconnect();
    grid.replaceChildren(...shown.map((project) => {
      const button = node("button", undefined, "project-card" + (project.id === selectedId ? " is-active" : ""));
      button.type = "button"; button.dataset.projectId = project.id; button.title = project.title;
      if (project.id === selectedId) button.setAttribute("aria-current", "true");
      button.append(...cardContent(project));
      button.addEventListener("click", () => { close(); if (project.id !== selectedId) onSelect(project.id); });
      return button;
    }));
    if (!shown.length) grid.append(node("p", projects.length ? "Không tìm thấy dự án." : "Chưa có dự án.", "empty-note library-empty"));
    for (const button of grid.querySelectorAll(".project-card")) observer.observe(button);
  }

  function isOpen() { return !root.hidden; }

  function open() {
    if (isOpen()) return;
    opener = document.activeElement;
    root.hidden = false;
    document.body.classList.add("library-open");
    document.querySelector("#main")?.setAttribute("inert", "");
    document.querySelector("#topbar")?.setAttribute("inert", "");
    render();
    search.focus();
    root.dispatchEvent(new CustomEvent("librarychange", { bubbles: true, detail: { open: true } }));
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    root.hidden = true;
    document.body.classList.remove("library-open");
    document.querySelector("#main")?.removeAttribute("inert");
    document.querySelector("#topbar")?.removeAttribute("inert");
    if (restoreFocus && opener instanceof HTMLElement) opener.focus();
    root.dispatchEvent(new CustomEvent("librarychange", { bubbles: true, detail: { open: false } }));
  }

  search.addEventListener("input", render);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "Tab") {
      const focusable = [...root.querySelectorAll("button:not(:disabled), input")].filter((element) => !element.closest("[hidden]"));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    // Arrow keys move through the cards like a grid.
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key) && document.activeElement?.classList.contains("project-card")) {
      const all = [...grid.querySelectorAll(".project-card")];
      const index = all.indexOf(document.activeElement);
      const columns = Math.max(1, Math.round(grid.clientWidth / (all[0]?.offsetWidth || grid.clientWidth)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      const target = all[Math.min(all.length - 1, Math.max(0, index + step))];
      if (target) { event.preventDefault(); target.focus(); }
    }
  });
  root.querySelector("[data-library-backdrop]")?.addEventListener("click", () => close());
  root.querySelector("[data-library-close]")?.addEventListener("click", () => close());

  return {
    open, close, isOpen,
    update(nextProjects, nextSelectedId) {
      projects = nextProjects;
      selectedId = nextSelectedId;
      if (isOpen()) render(); else count.textContent = String(projects.length);
    },
    // The page already fetched the selected project's card; reuse it instead of asking again.
    setCard(projectId, generation, card) {
      cards.set(projectId, { generation, card });
      if (isOpen()) paintCard(projectId);
    }
  };
}

