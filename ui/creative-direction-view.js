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
const pill = (text, kind = "") => node("span", text, `creative-pill ${kind}`.trim());

function list(title, values, kind = "") {
  const section = node("section", undefined, `creative-list ${kind}`.trim());
  section.append(node("h5", title));
  const items = node("ul");
  for (const value of values ?? []) items.append(node("li", value));
  if (!values?.length) items.append(node("li", "Không có.", "empty-note"));
  section.append(items);
  return section;
}

function meta(artifact) {
  const result = node("div", undefined, "creative-meta");
  result.append(pill(`r${artifact.revision}`, artifact.active ? "is-active" : ""),
    pill(artifact.status), node("code", artifact.id));
  if (artifact.reasons.length) result.append(pill("Cần xem lại phụ thuộc", "is-warning"));
  return result;
}

function cardHeader(label, artifact) {
  const header = node("header");
  const title = node("div", undefined, "creative-card-title");
  title.append(node("p", label, "eyebrow"), node("h4", artifact.name));
  header.append(title, meta(artifact));
  return header;
}

function briefCard(brief) {
  const card = node("article", undefined, "creative-card creative-brief");
  card.append(cardHeader("BRIEF", brief), node("p", brief.summary, "creative-summary"));
  const facts = node("div", undefined, "creative-facts");
  for (const [label, value] of [["Mục đích", brief.data.purpose], ["Khán giả", brief.data.audience],
    ["Kết quả mong muốn", brief.data.desiredOutcome]]) {
    const fact = node("div");
    fact.append(node("span", label), node("strong", value));
    facts.append(fact);
  }
  const lists = node("div", undefined, "creative-list-grid");
  lists.append(list("Ràng buộc", brief.data.constraints), list("Sự thật đã biết", brief.data.knownFacts),
    list("Giả định", brief.data.assumptions, "is-assumption"),
    list("Câu hỏi mở", brief.data.openQuestions, "is-question"));
  card.append(facts, lists);
  return card;
}

function proposalCard(proposal, direction) {
  const card = node("article", undefined, "creative-card creative-proposal");
  card.append(cardHeader("PHƯƠNG ÁN", proposal),
    node("p", proposal.data.recommendationReason, "creative-summary"),
    node("p", `So sánh theo: ${proposal.data.comparisonCriteria.join(" · ")}`, "input-meta"));
  const options = node("div", undefined, "creative-options");
  const selectedId = direction?.data.basis?.kind === "proposal" ? direction.data.basis.optionId : null;
  for (const option of proposal.data.options) {
    const selected = option.id === selectedId;
    const item = node("article", undefined, `creative-option${selected ? " is-selected" : ""}`);
    const heading = node("div", undefined, "creative-option-head");
    heading.append(node("h5", option.name));
    if (selected) heading.append(pill("Đã chọn", "is-approved"));
    else if (option.id === proposal.data.recommendedOptionId) heading.append(pill("Agent đề xuất", "is-active"));
    item.append(heading, node("p", option.hook, "creative-hook"), node("p", option.premise));
    const details = node("details");
    details.append(node("summary", "Xem cách kể và đánh đổi"), node("p", option.narrativeApproach),
      list("Ưu điểm", option.advantages), list("Đánh đổi", option.tradeoffs),
      list("Rủi ro", option.risks, "is-warning"));
    item.append(details);
    options.append(item);
  }
  card.append(options);
  return card;
}

const approvalLabel = (approval) => approval ? "Người dùng đã phê duyệt" : "Chưa có phê duyệt";

function directionCard(model) {
  const direction = model.direction;
  const card = node("article", undefined, "creative-card creative-direction");
  card.append(cardHeader("HƯỚNG ĐANG DÙNG", direction),
    node("p", direction.data.selectionReason, "creative-summary"));
  if (model.selectedOption) card.append(node("p", `Phương án: ${model.selectedOption.name}`, "creative-selection"));
  const lists = node("div", undefined, "creative-list-grid");
  lists.append(list("Nguyên tắc phải giữ", direction.data.principles),
    list("Điều cần tránh", direction.data.avoidances, "is-warning"),
    list("Tiêu chí review", direction.data.reviewCriteria));
  if (direction.data.deliveryPromise) {
    const promise = direction.data.deliveryPromise;
    const promiseBlock = node("section", undefined, "creative-delivery-promise");
    promiseBlock.append(node("h5", "L\u1eddi h\u1ee9a \u0111\u1ea7u ra"), node("p", promise.summary));
    const requirements = node("ul");
    for (const requirement of promise.requirements) {
      requirements.append(node("li",
        (requirement.blocking ? "B\u1eaft bu\u1ed9c: " : "Khuy\u1ebfn ngh\u1ecb: ") +
        requirement.criterion + " \u00b7 " + requirement.evidence.join(" + ")));
    }
    promiseBlock.append(requirements,
      node("p", "Fallback \u0111\u01b0\u1ee3c ph\u00e9p: " +
        (promise.allowedFallbacks.join(" \u00b7 ") || "kh\u00f4ng c\u00f3"), "input-meta"),
      node("p", "Kh\u00f4ng \u0111\u01b0\u1ee3c h\u1ea1 c\u1ea5p th\u00e0nh: " +
        (promise.prohibitedFallbacks.join(" \u00b7 ") || "kh\u00f4ng quy \u0111\u1ecbnh"), "input-meta"));
    card.append(promiseBlock);
  }
  const approval = latest(direction.approvals);
  const status = node("div", undefined, `creative-approval${approval ? " is-approved" : ""}`);
  status.append(node("strong", approvalLabel(approval)),
    node("span", approval?.reason ?? "Phản hồi với Agent trong chat khi cần chọn hướng."));
  card.append(lists, status);
  return card;
}

function sampleCard(model) {
  const card = node("article", undefined, "creative-card creative-sample");
  const title = node("div", undefined, "creative-card-title");
  title.append(node("p", "MẪU VÀ BẢN DUYỆT", "eyebrow"),
    node("h4", model.direction?.data.sample?.purpose ?? "Không yêu cầu làm mẫu"));
  card.append(title);
  if (model.direction?.data.sample) {
    card.append(node("p", `Dự kiến ${model.direction.data.sample.durationSeconds} giây`, "input-meta"),
      list("Điều kiện thành công", model.direction.data.sample.successCriteria));
  }
  if (!model.sequence) {
    card.append(node("p", "Chưa có sequence liên kết với hướng này.", "empty-note"));
    return card;
  }
  const sequence = node("div", undefined, "creative-sample-state");
  sequence.append(node("strong", `${model.sequence.name} · r${model.sequence.revision}`),
    node("span", `${model.sequence.durationSeconds} giây · ${model.sequence.segments.length} đoạn`));
  if (model.sequence.reasons.length) sequence.append(pill("Phụ thuộc cần xem lại", "is-warning"));
  card.append(sequence);
  if (!model.render) {
    card.append(node("p", "Sequence này chưa có render.", "empty-note"));
    return card;
  }
  const render = node("div", undefined, "creative-render-state");
  render.append(node("strong", `Render ${model.render.resultId}`),
    pill(approvalLabel(model.approval), model.approval ? "is-approved" : "is-warning"));
  if (model.render.reusedSegmentIds.length) render.append(node("span",
    `Dùng lại ${model.render.reusedSegmentIds.length}/${model.sequence.segments.length} đoạn không đổi.`));
  if (model.renderReview) render.append(node("span",
    `${model.renderReview.perspective} · ${model.renderReview.verdict} — ${model.renderReview.summary}`));
  if (model.approval?.reason) render.append(node("span", model.approval.reason));
  card.append(render);
  return card;
}

function history(model) {
  const details = node("details", undefined, "creative-history");
  details.append(node("summary", `Lịch sử creative · ${model.history.length} revision`));
  const rows = node("div", undefined, "creative-history-list");
  for (const artifact of model.history) {
    const row = node("article");
    row.append(node("strong", `${artifact.name} · r${artifact.revision}`),
      pill(artifact.active ? "hiện hành" : artifact.status), node("span", artifact.summary),
      node("code", artifact.id));
    rows.append(row);
  }
  details.append(rows);
  return details;
}

export function renderCreativeDirection(container, context) {
  const signature = JSON.stringify([context.project.id, context.artifacts, context.reviews,
    context.projectDecisions, context.intelligence?.pendingApprovals, context.production]);
  if (signatures.get(container) === signature) return;
  signatures.set(container, signature);
  container.replaceChildren();
  const model = buildCreativeObserverModel(context);
  if (model.empty) {
    container.append(node("p", "Project chưa có brief hoặc hướng sáng tạo có cấu trúc.", "empty-note"));
    return;
  }
  const workspace = node("div", undefined, "creative-workspace");
  const status = node("div", undefined, "creative-status-line");
  status.append(pill(model.pendingApprovals.length ? `${model.pendingApprovals.length} việc chờ duyệt` :
    "Không có việc chờ duyệt", model.pendingApprovals.length ? "is-warning" : "is-approved"),
    node("span", `Dấu vết hiện hành: ${model.trace.join(" → ")}`));
  workspace.append(status);
  if (model.brief) workspace.append(briefCard(model.brief));
  if (model.proposal) workspace.append(proposalCard(model.proposal, model.direction));
  if (model.direction) workspace.append(directionCard(model), sampleCard(model));
  workspace.append(history(model));
  container.append(workspace);
}

export function clearCreativeDirection(container) {
  signatures.delete(container);
  container.replaceChildren();
}
