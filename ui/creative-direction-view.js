const TYPES = new Set(["project.brief", "creative.proposal", "creative.direction"]);
const signatures = new WeakMap();
const latest = (rows) => [...rows].sort((a, b) =>
  String(a.createdAt).localeCompare(String(b.createdAt))).at(-1) ?? null;
const binds = (record, kind, id) => record.binding?.outputReferences?.some(
  (reference) => reference.kind === kind && reference.id === id) ?? false;

export function buildCreativeObserverModel(context) {
  const activeIds = new Set((context.intelligence?.activeArtifacts ?? []).map((item) => item.id));
  const reviews = context.reviews ?? [];
  const decisions = context.projectDecisions ??
    (context.decisions ?? []).filter((item) => item.kind === "project_decision");
  const stateById = new Map((context.production?.artifactStates ?? [])
    .map((item) => [item.artifactId, item]));
  const artifacts = (context.artifacts ?? []).filter((item) => TYPES.has(item.type)).map((item) => ({
    ...item,
    active: activeIds.has(item.id),
    reasons: stateById.get(item.id)?.reasons ?? [],
    approvals: decisions.filter((decision) => decision.decidedBy === "user" &&
      decision.outcome === "approved" && binds(decision, "artifact", item.id))
  }));
  const active = (type) => latest(artifacts.filter((item) => item.type === type && item.active));
  const direction = active("creative.direction");
  let proposal = active("creative.proposal");
  let brief = active("project.brief");
  let selectedOption = null;
  if (direction?.data.basis?.kind === "proposal") {
    proposal = artifacts.find((item) => item.id === direction.data.basis.proposalArtifactId) ?? proposal;
    selectedOption = proposal?.data.options.find((item) => item.id === direction.data.basis.optionId) ?? null;
    brief = artifacts.find((item) => item.type === "project.brief" &&
      proposal?.references.some((reference) => reference.kind === "artifact" && reference.id === item.id)) ?? brief;
  } else if (direction?.data.basis?.kind === "direct") {
    brief = artifacts.find((item) => item.id === direction.data.basis.briefArtifactId) ?? brief;
  }
  const sequences = context.production?.sequences ?? [];
  const related = direction ? sequences.filter((item) => item.references.some(
    (reference) => reference.kind === "artifact" && reference.id === direction.id)) : [];
  const sequence = related.find((item) => item.active) ?? related.at(-1) ??
    sequences.find((item) => item.active) ?? null;
  const approvalForResult = (resultId) => latest(decisions.filter((decision) =>
    decision.decidedBy === "user" && decision.outcome === "approved" &&
    binds(decision, "result", resultId))) ?? latest((context.decisions ?? []).filter(
      (decision) => decision.resultId === resultId && decision.outcome === "accepted"));
  const renders = sequence?.renders ?? [];
  const render = [...renders].reverse().find((item) => approvalForResult(item.resultId)) ??
    renders.at(-1) ?? null;
  const approval = render ? approvalForResult(render.resultId) : null;
  const renderReview = render ? latest(reviews.filter((review) =>
    (review.target?.kind === "result" && review.target.id === render.resultId) ||
    binds(review, "result", render.resultId))) : null;
  return {
    empty: artifacts.length === 0,
    brief, proposal, direction, selectedOption, sequence, render, approval, renderReview,
    pendingApprovals: context.intelligence?.pendingApprovals ?? [],
    history: artifacts.sort((a, b) =>
      a.type.localeCompare(b.type) || a.key.localeCompare(b.key) || a.revision - b.revision),
    trace: [brief?.id, proposal?.id, direction?.id, sequence?.artifactId, render?.resultId].filter(Boolean)
  };
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function briefCard(brief) {
  const card = node("article", undefined, "creative-brief");
  card.append(node("h3", brief.name), node("p", brief.data.purpose));
  const facts = node("dl", undefined, "brief-facts");
  for (const [label, value] of [["Khán giả", brief.data.audience], ["Mục tiêu", brief.data.desiredOutcome]]) {
    if (value) facts.append(node("dt", label), node("dd", value));
  }
  card.append(facts);
  if (brief.data.constraints?.length) {
    const list = node("ul");
    for (const constraint of brief.data.constraints) list.append(node("li", constraint));
    card.append(list);
  }
  return card;
}
function proposalCard(model) {
  const card = node("div", undefined, "creative-options");
  const selectedId = model.direction?.data.basis?.optionId;
  for (const option of model.proposal.data.options) {
    const item = node("article", undefined, "creative-option" + (option.id === selectedId ? " is-selected" : ""));
    item.append(node("h3", option.name), node("p", option.hook, "creative-hook"), node("p", option.premise));
    const details = node("details", undefined, "creative-option-notes");
    details.append(node("summary", "Cách kể"), node("p", option.narrativeApproach));
    item.append(details); card.append(item);
  }
  return card;
}
export function renderCreativeDirection(container, context) {
  const signature = JSON.stringify([context.project.id, context.artifacts, context.projectDecisions,
    context.intelligence?.activeArtifacts]);
  if (signatures.get(container) === signature) return;
  signatures.set(container, signature);
  container.replaceChildren();
  const model = buildCreativeObserverModel(context);
  const script = (model.sequence?.segments ?? []).filter(segment => segment.narration?.text?.trim());
  if (model.empty && !script.length) {
    container.append(node("p", "Chưa có nội dung.", "content-empty"));
    return;
  }
  const workspace = node("div", undefined, "creative-workspace");
  if (script.length) {
    const story = node("article", undefined, "story-script");
    story.append(node("h2", model.selectedOption?.hook ?? "Lời thoại"));
    for (const segment of script) story.append(node("p", segment.narration.text));
    workspace.append(story);
  }
  if (model.direction) {
    const direction = node("article", undefined, "creative-direction");
    direction.append(node("h2", model.selectedOption?.name ?? model.direction.name));
    const premise = model.selectedOption?.premise ?? model.direction.summary;
    if (premise) direction.append(node("p", premise, "creative-premise"));
    if (model.selectedOption?.narrativeApproach) direction.append(node("p", model.selectedOption.narrativeApproach));
    if (script.length) {
      const details = node("details", undefined, "content-sheet");
      details.append(node("summary", "Ý tưởng"), direction); workspace.append(details);
    } else workspace.append(direction);
  }
  if (model.brief) {
    if (model.direction) {
      const details = node("details", undefined, "content-sheet");
      details.append(node("summary", "Yêu cầu ban đầu"), briefCard(model.brief)); workspace.append(details);
    } else workspace.append(briefCard(model.brief));
  }
  if (model.proposal) {
    if (model.direction) {
      const details = node("details", undefined, "content-sheet");
      details.append(node("summary", "Các hướng khác"), proposalCard(model)); workspace.append(details);
    } else workspace.append(proposalCard(model));
  }
  container.append(workspace);
}
export function clearCreativeDirection(container) {
  signatures.delete(container); container.replaceChildren();
}
